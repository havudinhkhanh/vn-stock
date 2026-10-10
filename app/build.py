"""Chạy toàn bộ phân tích và xuất JSON cho trang web (site/data/)."""
from __future__ import annotations

import json
import logging
import math
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

from . import config
from .analysis import backtest as bt
from .analysis import forward as fwd
from .analysis import fundamentals as fu
from .analysis import indicators as ind
from .analysis import market as mk
from .analysis import orderflow as ofl
from .analysis import sector as sec_
from .analysis import fwdback as fb_
from .analysis import seasonal as seas
from .analysis import mtf as mtf_
from .analysis import sector_outlook as sec_out
from .analysis import signals as sgn
from .analysis import smc as smc_
from .analysis import vsa as vsa_
from .analysis import patterns as pt
from .analysis import portfolio as pf
from .analysis import strategy as st
from .analysis import styles as sty
from .analysis import technical as tech
from .analysis import valuation as va
from .analysis import events as evx
from .analysis import forecast as fc
from . import swing_build as swb
from . import pairs_build as pab
from . import personal as per_
from . import users as users_
import copy
from .data import store
from .portfolio_store import apply_profile, load_holdings, load_overrides, load_profile, load_watchlist

log = logging.getLogger("build")
INDEX_SYMS = {"VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"}


def _clean(o):
    """Đổi NaN/inf/numpy sang kiểu JSON hợp lệ."""
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if math.isnan(f) or math.isinf(f) else round(f, 4)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, datetime)):
        return str(o.date()) if hasattr(o, "date") else str(o)
    if o is pd.NA or o is pd.NaT:
        return None
    return o


def dump(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def _val_hist(q, n: int = 24) -> list:
    """P/E, P/B của chính mã theo từng quý (số liệu tại thời điểm cuối quý)."""
    if q is None or q.empty or "pe_src" not in q:
        return []
    d = q.sort_values(["year", "quarter"]).tail(n)
    out = []
    for r in d.itertuples():
        pe = getattr(r, "pe_src", None)
        pb = getattr(r, "pb_src", None)
        pe = float(pe) if pe is not None and pe == pe and 0 < pe < 200 else None
        pb = float(pb) if pb is not None and pb == pb and 0 < pb < 30 else None
        out.append({"p": f"Q{int(r.quarter)}/{int(r.year) % 100:02d}", "pe": round(pe, 1) if pe else None, "pb": round(pb, 2) if pb else None})
    return out


def _f(x):
    try:
        x = float(x)
        return None if math.isnan(x) or math.isinf(x) else round(x, 2)
    except (TypeError, ValueError):
        return None


def _sup_extra(r) -> list:
    comp, ni = r.get("composite"), r.get("ni_yoy")
    return [(bool(comp >= 55) if pd.notna(comp) else None, f"điểm tổng hợp {comp:.0f}" if pd.notna(comp) else "", f"điểm tổng hợp chỉ {comp:.0f}" if pd.notna(comp) else ""),
            (bool(ni > 0) if pd.notna(ni) else None, f"lợi nhuận 12 tháng {ni:+.0f}%" if pd.notna(ni) else "", f"lợi nhuận 12 tháng {ni:+.0f}%" if pd.notna(ni) else ""),
            (r.get("trend") != "down", "xu hướng ngày không giảm", "xu hướng ngày đang giảm")]


def _ohlc_payload(df: pd.DataFrame, n: int = 750) -> dict:
    d = df.iloc[-n:]
    return {"t": [x.strftime("%Y-%m-%d") for x in d.index],
            "o": d["open"].round(2).tolist(), "h": d["high"].round(2).tolist(),
            "l": d["low"].round(2).tolist(), "c": d["close"].round(2).tolist(),
            "v": d["volume"].astype("int64").tolist()}


def run(skip_backtest: bool = False, force_backtest: bool = False, only: list[str] | None = None) -> dict:
    cfg = config.load()
    cfg0 = copy.deepcopy(cfg)
    # nhiều người dùng (D1): khẩu vị / giả định của quản trị viên là "cấu hình nhà"; mỗi người có tư vấn riêng
    be = users_.backend()
    U = users_.load(be) if be else None
    multi = U is not None
    owner = next((x for x in (U or []) if x["role"] == "admin"), None)
    if multi:
        log.info("Nhiều người dùng: %d tài khoản đang hoạt động (quản trị: %s)", len(U), owner["email"] if owner else "—")
    profile = ((owner or {}).get("data", {}).get("profile") or {}) if multi else load_profile()
    prof_changed = apply_profile(cfg, profile)
    if prof_changed:
        log.info("Dùng khẩu vị anh chỉnh trên web: %s", ", ".join(prof_changed))
    if cfg.get("regime_exposure"):
        mk.EXPOSURE.update({k: int(round(v)) for k, v in cfg["regime_exposure"].items()})
    t0 = datetime.now()
    out_dir = config.OUT_DIR
    listing = store.read("listing")
    prices = store.read("prices")
    fin_q = store.read("fin_q")
    fin_y = store.read("fin_y")
    divs = store.read("dividends")
    sh_now = store.read("shares_now")
    if not sh_now.empty:
        sh_now = sh_now[pd.to_datetime(sh_now["date"]) >= pd.Timestamp.now() - pd.Timedelta(days=45)]
    sh_now = dict(zip(sh_now["symbol"], sh_now["shares_now"])) if not sh_now.empty else {}
    if prices.empty or listing.empty:
        raise SystemExit("Chưa có dữ liệu. Chạy: python run.py update")
    prices["date"] = pd.to_datetime(prices["date"])
    if not divs.empty:
        divs["ex_date"] = pd.to_datetime(divs["ex_date"])
    listing = listing.copy()
    for c in ("sector", "industry", "subindustry"):
        if c not in listing:
            listing[c] = None
    listing["sector"] = listing["sector"].fillna("Khác")
    listing["industry"] = listing["industry"].fillna(listing["sector"])
    lst = listing.set_index("symbol")
    exch = set((cfg.get("universe") or {}).get("exchanges", ["HOSE", "HNX", "UPCOM"]))

    # ------------------------------------------------------------ chuẩn bị
    g = {s: d.set_index("date").sort_index()[["open", "high", "low", "close", "volume"]]
         for s, d in prices.groupby("symbol")}
    idx = g.get("VNINDEX")
    if idx is None or len(idx) < 250:
        raise SystemExit("Thiếu dữ liệu VN-Index")
    last_date = idx.index[-1]
    wide = prices[~prices["symbol"].isin(INDEX_SYMS)].pivot_table(index="date", columns="symbol",
                                                                  values="close").sort_index()
    wide = wide.ffill(limit=5)
    wide_val = (prices.assign(v=prices["close"] * prices["volume"] / 1e6)
                .pivot_table(index="date", columns="symbol", values="v").reindex(wide.index).fillna(0))
    avg_val = wide_val.iloc[-20:].mean()
    ucfg = cfg.get("universe") or {}
    min_val = float(ucfg.get("min_avg_value_bn", 3))
    liquid = sorted(avg_val[avg_val >= min_val].index)
    deep_val = float(ucfg.get("deep_min_avg_value_bn", 0.5))
    if multi:
        holdings, cash_vnd, capital = per_.holdings_of((owner or {}).get("data") or {})
        held_all = {h["symbol"].upper() for x in U for h in per_.holdings_of(x["data"])[0]}
        watch_all = {str(w["symbol"]).upper() for x in U for w in per_.watch_of(x["data"])}
    else:
        holdings, cash_vnd, capital = load_holdings()
    held = {h["symbol"].upper() for h in holdings}
    if not multi:
        held_all, watch_all = held, {str(w.get("symbol", "")).upper() for w in load_watchlist()}
    symbols = [s for s in lst.index if lst.loc[s, "exchange"] in exch and s in g]
    if only:
        symbols = [s for s in symbols if s in only]
    deep = {s for s in symbols if avg_val.get(s, 0) >= deep_val} | (held_all & set(symbols))

    fq = fu.add_ttm(fin_q) if not fin_q.empty else pd.DataFrame()
    of_all = store.read("orderflow")
    of_by = {k: v for k, v in of_all.groupby("symbol")} if not of_all.empty else {}
    fp_all = store.read("footprint")
    fp_by = {k: v for k, v in fp_all.groupby("symbol")} if not fp_all.empty else {}
    adj_ev = store.read("adjust_events")

    def effective_shares(sym: str, qs, close: pd.Series) -> float | None:
        """Số cổ phiếu dùng cho EPS/BVPS hiện tại.
        1) số CP hiện tại lấy trực tiếp (nếu có, ≤ 45 ngày);
        2) suy ra từ giá: vốn hoá/số CP tại cuối quý (giá thật lúc đó) so với giá đã điều chỉnh cùng ngày;
        3) None -> dùng số CP trong báo cáo."""
        if sym in sh_now:
            return sh_now[sym]
        L = fu.latest_row(qs) if qs is not None and not qs.empty else None
        if L is None:
            return None
        sh, mc = fu._num(L.get("shares")), fu._num(L.get("mcap_src"))
        if not sh or not mc or close is None or close.empty:
            return None
        qend = fu.period_end(int(L["year"]), int(L["quarter"]))
        px = close[:qend]
        if px.empty or (qend - px.index[-1]).days > 10:
            return None
        raw = mc / sh            # nghìn đồng/cp (tỷ đồng ÷ triệu cp)
        f = float(px.iloc[-1]) / raw
        if 0.2 < f < 0.93:       # giá quá khứ đã bị điều chỉnh giảm -> có chia thưởng/phát hành sau kỳ báo cáo
            return sh / f
        return None
    fq_by = {s: d for s, d in fq.groupby("symbol")} if not fq.empty else {}
    fy_by = {s: d.sort_values("year") for s, d in fin_y.groupby("symbol")} if not fin_y.empty else {}
    dv_by = {s: d for s, d in divs.groupby("symbol")} if not divs.empty else {}

    ps_path = store.path("pattern_stats.json")
    pstats_prev = json.loads(ps_path.read_text(encoding="utf-8")).get("stats", {}) if ps_path.exists() else {}

    def pattern_boost(pat: dict, last_date) -> tuple[float, list[str]]:
        """Chỉ tín hiệu đã được kiểm chứng là có lợi thế trên dữ liệu VN mới được cộng/trừ điểm."""
        sig = sgn.from_results(pat, pd.Timestamp(last_date))
        boost, used = 0.0, []
        for name, b in sig:
            st_ = pstats_prev.get(name)
            if st_ and st_.get("useful"):
                boost += 5 * b
                used.append(name)
        return float(np.clip(boost, -10, 10)), used

    # ------------------------------------------------------------ thị trường
    br = mk.breadth(wide, liquid)
    regime = mk.regime(idx, br)
    sectors = mk.sector_map(wide, wide_val, listing, liquid)
    idx_ti = ind.compute_all(idx)
    idx_ta = tech.summarize(idx, idx_ti)
    market = {"date": str(last_date.date()), "regime": regime, "sectors": sectors,
              "index_ta": {k: idx_ta.get(k) for k in ("score", "label", "trend_vi", "groups", "table")},
              "index_waves": pt.analyze(idx),
              "breadth": [{"d": str(d.date()), "a50": round(r.above50, 1) if r.above50 == r.above50 else None,
                           "a200": round(r.above200, 1) if r.above200 == r.above200 else None,
                           "ad": int(r.ad_line)} for d, r in br.iloc[-250:].iterrows()],
              "indices": {}}
    for s in ("VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"):
        if s in g and len(g[s]) > 2:
            c = g[s]["close"]
            market["indices"][s] = {"close": round(float(c.iloc[-1]), 2),
                                    "chg": round(100 * float(c.iloc[-1] / c.iloc[-2] - 1), 2),
                                    "ohlc": _ohlc_payload(g[s], 500),
                                    "ohlc_w": mtf_.payload(mtf_.resample(g[s], "W")), "ohlc_m": mtf_.payload(mtf_.resample(g[s], "M")),
                                    "mtf": mtf_.full(g[s]),
                                    "season": seas.profile(g[s]["close"], None if s == "VNINDEX" else g["VNINDEX"]["close"] if "VNINDEX" in g else None, g[s].index[-1])}

    # ------------------------------------------------------------ từng mã
    rows, details = {}, {}
    sector_growth = {}
    log.info("Phân tích %d mã (%d mã phân tích sâu)", len(symbols), len(deep))
    for n, s in enumerate(symbols, 1):
        df = g[s]
        if len(df) < 30:
            continue
        price = float(df["close"].iloc[-1])
        ti = ind.compute_all(df)
        ta = tech.summarize(df, ti, idx["close"])
        ctype = lst.loc[s, "com_type"] if "com_type" in lst.columns and isinstance(lst.loc[s, "com_type"], str) else "CT"
        fa = fu.analyze_symbol(s, fq_by.get(s), fy_by.get(s), price, dv_by.get(s), ctype,
                               effective_shares(s, fq_by.get(s), df["close"]))
        c = df["close"]
        r = {
            "symbol": s, "name": lst.loc[s, "name"], "exchange": lst.loc[s, "exchange"],
            "sector": lst.loc[s, "sector"], "industry": lst.loc[s, "industry"], "ctype": ctype,
            "subindustry": lst.loc[s, "subindustry"] if "subindustry" in lst.columns else None,
            "price": price, "chg1d": 100 * (c.iloc[-1] / c.iloc[-2] - 1) if len(c) > 1 else None,
            "chg1m": 100 * (c.iloc[-1] / c.iloc[-22] - 1) if len(c) > 22 else None,
            "chg1w": 100 * (c.iloc[-1] / c.iloc[-6] - 1) if len(c) > 6 else None,
            "chg3m": 100 * (c.iloc[-1] / c.iloc[-64] - 1) if len(c) > 64 else None,
            "chg1y": 100 * (c.iloc[-1] / c.iloc[-250] - 1) if len(c) > 250 else None,
            "avg_value_bn": float(avg_val.get(s, 0)), "days": len(df),
            "ta_score": ta.get("score"), "ta_label": ta.get("label"), "trend": ta.get("trend"),
            "atr": ta.get("atr"), "from_hi52": ta.get("from_hi52_pct"),
            "e20": float(ind.ema(c, 20).iloc[-1]) if len(c) >= 20 else None,
            "e20_below2": bool(len(c) >= 22 and (c.iloc[-2:] < ind.ema(c, 20).iloc[-2:]).all()),
            "st_dir": float(ti["st_dir"].iloc[-1]),
            "rsi": float(ti["rsi"].iloc[-1]) if ti["rsi"].notna().iloc[-1] else None,
            "ret_12_1": float(c.iloc[-22] / c.iloc[-252] - 1) if len(c) > 252 else None,
            "ret_6m": float(c.iloc[-1] / c.iloc[-126] - 1) if len(c) > 126 else None,
            "rs_raw": ind.rs_rating_raw(c),
            "vol_1y": float(c.iloc[-250:].pct_change().std() * np.sqrt(250)) if len(c) > 60 else None,
            "vol_3m": float(c.iloc[-63:].pct_change().std() * np.sqrt(250)) if len(c) > 63 else None,
            "beta": va.beta(c, idx["close"]) if len(c) > 120 else 1.0,
            "spk": [round(float(x), 2) for x in c.iloc[-30:]] if (s in deep and len(c) >= 30) else None,
        }
        for k in ("pe", "pb", "ps", "ev_ebitda", "earnings_yield", "roe", "roa", "roic", "gross_margin",
                  "net_margin", "de", "cfo_ni", "rev_yoy", "ni_yoy", "rev_q_yoy", "ni_q_yoy", "rev_cagr3",
                  "ni_cagr3", "ni_growth_streak", "roe_avg5", "roe_std5", "loss_years", "fscore", "mcap_bn",
                  "ni_ttm", "eps", "bvps", "fcf_yield", "period"):
            r[k] = fa.get(k) if fa.get("ok") else None
        dvp = fa.get("dividend") or {}
        r["div_yield"] = dvp.get("yield")
        r["cash_years"] = dvp.get("cash_years")
        r["payout"] = dvp.get("payout")
        r["has_fin"] = bool(fa.get("ok"))
        r["liquid_ok"] = bool(avg_val.get(s, 0) >= min_val and price >= float(ucfg.get("min_price", 5))
                              and len(df) >= int(ucfg.get("min_history_days", 120)))
        if s in deep:
            pat = pt.analyze(df)
            for key, fn in (("smc", smc_.analyze), ("vsa", vsa_.analyze), ("wyckoff2", vsa_.wyckoff_events)):
                try:
                    pat[key] = fn(df)
                except Exception as e:  # noqa: BLE001
                    pat[key] = {"ok": False, "error": str(e)}
            pat["_last"] = price
            pat["orderflow"] = ofl.analyze(of_by.get(s), fp_by.get(s), df["close"])
            r["wyckoff"] = (pat.get("wyckoff") or {}).get("code")
            r["smc_bias"] = (pat["smc"] or {}).get("bias")
            r["smc_zone"] = ((pat["smc"] or {}).get("range") or {}).get("pos_pct")
            r["vsa_bias"] = (pat["vsa"] or {}).get("bias")
            r["wy_phase"] = (pat["wyckoff2"] or {}).get("phase")
            r["of_bias"] = pat["orderflow"].get("bias") if pat["orderflow"].get("ok") else None
            r["of_delta5"] = pat["orderflow"].get("delta5_pct")
            lv = pat.get("levels") or {}
            r["support1"] = lv["support"][0]["price"] if lv.get("support") else None
            r["resist1"] = lv["resistance"][0]["price"] if lv.get("resistance") else None
            boost, used_p = pattern_boost(pat, df.index[-1])
            if boost and r["ta_score"] is not None:
                r["ta_score"] = int(np.clip(r["ta_score"] + boost, 0, 100))
                ta["score"] = r["ta_score"]
                ov_ = (r["ta_score"] - 50) / 50   # nhãn phải khớp với điểm sau khi cộng/trừ mô hình
                ta["label"] = r["ta_label"] = ("Mua mạnh" if ov_ > 0.5 else "Mua" if ov_ > 0.15 else "Bán mạnh" if ov_ < -0.5 else "Bán" if ov_ < -0.15 else "Trung tính")
                ta["pattern_boost"] = {"points": boost, "patterns": used_p}
            try:
                mt = mtf_.full(df)
            except Exception as e:  # noqa: BLE001
                mt = {"tf": {}, "summary": {"text": f"lỗi: {e}"}}
            for k in ("D", "W", "M", "Q"):
                x = mt["tf"].get(k) or {}
                r[f"tf_{k.lower()}"] = x.get("score") if x.get("ok") else None
            r["mtf_align"] = mt["summary"].get("align")
            try:
                sp = seas.profile(df["close"], idx["close"], last_date)
            except Exception:  # noqa: BLE001
                sp = None
            h1 = ((sp or {}).get("same") or {}).get("h1") or {}
            r["ss1_rel"], r["ss1_hit"], r["ss1_mean"], r["ss_n"] = h1.get("rel"), h1.get("relhit"), h1.get("mean"), h1.get("n")
            nx = (sp or {}).get("next") or []
            r["ss_strong"] = bool(nx and nx[0].get("strong")) or bool(h1 and seas.is_strong({"n": h1.get("n"), "rel": h1.get("rel"), "relhit": h1.get("relhit")}))
            r["mtf_conflict"] = mt["summary"].get("conflict")
            details[s] = {"df": df, "ti": ti, "ta": ta, "fa": fa, "pat": pat, "mtf": mt, "season": sp}
        rows[s] = r
        if n % 200 == 0:
            log.info("  %d/%d mã", n, len(symbols))

    u = pd.DataFrame.from_dict(rows, orient="index")
    if u.empty:
        raise SystemExit("Không có mã nào để phân tích")
    u = fu.peer_stats(u.reset_index(drop=True).assign(symbol=list(u.index)), "industry").set_index("symbol", drop=False)
    for c in ("ni_yoy", "rev_yoy"):
        sector_growth[c] = u.groupby("industry")[c].median()

    # ------------------------------------------------------------ định giá (cần trung vị ngành)
    vcfg = cfg.get("valuation") or {}
    mos = float((cfg.get("risk") or {}).get("margin_of_safety", 20))
    post_events, ev_active = [], []
    overrides = ({k.upper(): v for k, v in (((owner or {}).get("data", {}).get("assumptions")) or {}).items() if isinstance(v, dict)}
                 if multi else load_overrides())
    for s in u.index:
        r = u.loc[s]
        d = details.get(s)
        if d is None or not d["fa"].get("ok"):
            continue
        fa = d["fa"]
        qs = fq_by.get(s)
        ttm_row = fu.latest_row(qs) if qs is not None and not qs.empty else None
        sg = sector_growth["rev_yoy" if fa["ctype"] == "CT" else "ni_yoy"].get(r["industry"])
        fa["norm"] = va.norm_earnings(qs)
        model = fc.build_base(fa, fy_by.get(s), ttm_row, sg, vcfg)
        if model is not None and s in overrides:
            ov = {k: float(v) for k, v in overrides[s].items()
                  if k in model["assumptions"] and v is not None}
            model["assumptions"].update(ov)
            model["overridden"] = sorted(ov)
        hist = va.hist_multiples(qs, d["df"]["close"], fa.get("shares_mn"))
        peers = {"pe_ind_med": r.get("pe_ind_med"), "pb_ind_med": r.get("pb_ind_med"), "roe_ind_med": r.get("roe_ind_med")}
        ep = evx.episode(d["df"]["close"])
        val = va.value(fa, model, peers, hist, r["beta"], vcfg, mos, event=ep if ep and ep["phase"] == "active" else None)
        if ep and ep["phase"] == "window":
            qual = bool((fa.get("ni_ttm") or 0) > 0 and (fa.get("de") if fa.get("de") is not None else 0) < 1.5)
            ep["plan"] = evx.entry_plan(ep, qual, val.get("fair") if val.get("reliable") else None)
            val["post_event"] = ep
            post_events.append({"symbol": s, "sector": r.get("sector"), **{k: ep[k] for k in ("start", "since", "quiet", "pre_hi", "low", "price", "dd_now", "from_low")},
                                "quality": qual, **ep["plan"], "fair": val.get("fair"), "verdict": val.get("verdict")})
        elif ep:
            ev_active.append({"symbol": s, "sector": r.get("sector"), **{k: ep[k] for k in ("start", "since", "quiet", "dd_now", "n_down", "wait_since", "wait_quiet", "price", "low")}})
        d["val"] = val
        if val.get("ok"):
            u.at[s, "verdict"] = val["verdict"]
            u.at[s, "val_flag"] = val.get("flag")
            if val.get("reliable"):
                for k in ("fair", "fair_lo", "fair_hi", "buy_below", "sell_above", "upside"):
                    u.at[s, k] = val[k]
            if hist.get("pe_med") and r.get("pe"):
                u.at[s, "pe_vs_hist"] = r["pe"] / hist["pe_med"]
    for k in ("fair", "fair_lo", "fair_hi", "buy_below", "sell_above", "upside", "pe_vs_hist"):
        if k not in u:
            u[k] = np.nan
    if "val_flag" not in u:
        u["val_flag"] = None
    if "verdict" not in u:
        u["verdict"] = None

    # ------------------------------------------------------------ điểm, rổ, kế hoạch
    st.STRATEGY.update({k: v for k, v in (cfg.get("strategy") or {}).items() if k in st.STRATEGY})
    elig = u[u["has_fin"] & (u["days"] >= 60)].copy()
    sc = st.score_methods(elig, regime["light"])
    weights = cfg.get("methods") or {}
    sc["composite"] = st.composite(sc, weights)
    xs, xy = set(cfg.get("exclude_sectors") or []), set(cfg.get("exclude_symbols") or [])
    buyable = elig[~(elig["sector"].isin(xs) | elig["industry"].isin(xs) | elig.index.isin(xy))]
    members = st.basket_members(buyable, sc.loc[buyable.index], regime["light"])
    plan = st.plan(buyable, sc.loc[buyable.index], members, cfg, regime)
    style_plans = {"position": plan}
    for key, fn in (("swing", lambda: sty.plan_swing(buyable, g, regime)), ("long", lambda: sty.plan_long(buyable, sc.loc[buyable.index], regime, cfg)),
                    ("income", lambda: sty.plan_income(buyable, regime))):
        try:
            style_plans[key] = fn()
        except Exception as e:  # noqa: BLE001
            log.exception("Kế hoạch phong cách %s lỗi: %s", key, e)
            style_plans[key] = {"picks": [], "watch": [], "invested": 0, "cash": 100, "error": str(e)}
    active_style = cfg.get("style") or "position"
    if active_style not in style_plans:
        active_style = "position"
    for b, ser in members.items():
        for s in ser.index:
            u.at[s, f"in_{b}"] = True
    u = u.join(sc, how="left")
    # hạng trong ngành theo điểm tổng hợp
    u["ind_rank"] = u.groupby("industry")["composite"].rank(ascending=False, method="min")
    u["ind_n"] = u.groupby("industry")["composite"].transform("count")

    # ------------------------------------------------------------ danh mục đang nắm
    closes = {s: g[s]["close"] for s in held if s in g}
    advice = pf.advise(holdings, u, closes, cfg, regime, cash_vnd, capital) if holdings else None

    # ------------------------------------------------------------ backtest (theo lịch)
    bt_path = store.path("backtest.json")
    ps_path = store.path("pattern_stats.json")
    if not skip_backtest and (force_backtest or store.age_days("backtest") > 6 or not bt_path.exists()):
        log.info("Chạy backtest…")
        try:
            res = bt.run(prices, fq, divs, listing, cfg)
            bt_path.write_text(json.dumps(_clean(res), ensure_ascii=False), encoding="utf-8")
            store.touch("backtest")
            try:
                log.info("Kiểm chứng từng phong cách (lướt sóng, dài hạn, cổ tức)…")
                sbt = sty.backtest_styles(prices, fq, divs, listing, cfg, bt)
                sbt["position"] = {k: (res.get("combo_regime") or {}).get(k) for k in ("cagr", "max_dd", "vol", "sharpe", "yearly", "curve", "win_years", "n_years")}
                sbt["position"]["ok"] = bool(res.get("ok"))
                store.path("styles_bt.json").write_text(json.dumps(_clean(sbt), ensure_ascii=False), encoding="utf-8")
            except Exception as e:  # noqa: BLE001
                log.exception("Kiểm chứng phong cách lỗi: %s", e)
            try:
                log.info("Mô phỏng các mức khẩu vị (cắt lỗ × số mã)…")
                grid = bt.profile_grid(prices, fq, divs, listing, cfg)
                store.path("profile_grid.json").write_text(json.dumps(_clean(grid), ensure_ascii=False), encoding="utf-8")
            except Exception as e:  # noqa: BLE001
                log.exception("Mô phỏng khẩu vị lỗi: %s", e)
        except Exception as e:  # noqa: BLE001
            log.exception("Backtest lỗi: %s", e)
    if not skip_backtest and (force_backtest or store.age_days("pattern_stats") > 27 or not ps_path.exists()):
        log.info("Đo độ tin cậy mô hình sóng…")
        try:
            top = list(u[u["liquid_ok"]].sort_values("avg_value_bn", ascending=False).index[:300])
            res = bt.pattern_stats(prices, top)
            ps_path.write_text(json.dumps(_clean(res), ensure_ascii=False), encoding="utf-8")
            store.touch("pattern_stats")
        except Exception as e:  # noqa: BLE001
            log.exception("Pattern stats lỗi: %s", e)
    backtest = json.loads(bt_path.read_text(encoding="utf-8")) if bt_path.exists() else {"ok": False}
    pstats = json.loads(ps_path.read_text(encoding="utf-8")) if ps_path.exists() else {"stats": {}}

    # ------------------------------------------------------------ xuất JSON
    if out_dir.exists():
        shutil.rmtree(out_dir / "stocks", ignore_errors=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    cols = ["symbol", "name", "exchange", "sector", "industry", "price", "chg1d", "chg1m", "chg1y",
            "avg_value_bn", "mcap_bn", "pe", "pb", "roe", "ni_yoy", "rev_yoy", "de", "fscore", "div_yield",
            "cash_years", "fair", "buy_below", "upside", "verdict", "ta_score", "ta_label", "trend", "composite",
            "piotroski", "magic_formula", "value", "quality", "growth", "dividend", "momentum", "canslim",
            "low_vol", "rs_rating", "canslim_flags", "liquid_ok",
            # bổ sung cho các chiều nhìn & phân tích ngành
            "subindustry", "chg1w", "chg3m", "ret_6m", "ret_12_1", "vol_1y", "beta", "rsi", "from_hi52",
            "roa", "roic", "gross_margin", "net_margin", "cfo_ni", "fcf_yield", "earnings_yield", "ps", "ev_ebitda",
            "rev_cagr3", "ni_cagr3", "ni_q_yoy", "rev_q_yoy", "ni_growth_streak", "roe_avg5", "payout", "eps", "bvps",
            "smc_bias", "smc_zone", "vsa_bias", "wy_phase", "of_bias", "of_delta5",
            "smc", "vsa", "wyckoff_ev", "orderflow", "ind_rank", "ind_n", "ni_ttm", "spk", "atr", "e20", "e20_below2", "fair_hi", "tf_d", "tf_w", "tf_m", "tf_q", "mtf_align", "mtf_conflict", "ss1_rel", "ss1_hit", "ss1_mean", "ss_n", "ss_strong"] + [f"in_{b}" for b in st.BASKETS]
    for c in cols:
        if c not in u:
            u[c] = None
    scr = u[cols].replace({np.nan: None})
    dump(out_dir / "screener.json", {"cols": cols, "rows": scr.values.tolist()})

    pick_syms = {p["symbol"] for p in plan["picks"]}
    plan = style_plans[active_style]
    seen = set()
    for p in [x for sp in style_plans.values() for x in sp["picks"] + sp["watch"]]:
        if id(p) in seen:
            continue
        seen.add(id(p))
        rr = u.loc[p["symbol"]]
        p.update({"name": rr["name"], "price": rr["price"], "fair": rr.get("fair"), "upside": rr.get("upside"),
                  "fscore": rr.get("fscore"), "div_yield": rr.get("div_yield"), "pe": rr.get("pe"),
                  "roe": rr.get("roe"), "ta_label": rr.get("ta_label"),
                  "why": _why(rr, p["basket"])})
    # ------------------------------------------------------------ theo dõi tín hiệu thực tế
    try:
        flog = store.read("fwd_log")
        if not only:
            new = pd.concat([fwd.log_rows(sp, regime, last_date, k) for k, sp in style_plans.items()], ignore_index=True)
            if not flog.empty:
                flog["date"] = pd.to_datetime(flog["date"])
                flog = flog[flog["date"] != pd.Timestamp(last_date).normalize()]
            flog = pd.concat([flog, new], ignore_index=True) if not new.empty else flog
            if not flog.empty:
                store.write("fwd_log", flog.sort_values(["date", "kind", "symbol"]).reset_index(drop=True))
        fres = fwd.evaluate_styles(flog, wide, idx["close"])
    except Exception as e:  # noqa: BLE001
        log.exception("Theo dõi tín hiệu lỗi: %s", e)
        fres = {"ok": False, "reason": f"Lỗi khi đo: {e}"}
    dump(out_dir / "fwd.json", fres)
    pstats_map = pstats.get("stats", {})
    iw = market.get("index_waves") or {}
    for key, key2 in (("elliott", "Elliott"), ("wyckoff", "Wyckoff"), ("dow", "Dow")):
        if isinstance(iw.get(key), dict):
            iw[key]["reliability"] = pstats_map.get(key2)
    # ------------------------------------------------------------ cảnh báo giá (danh sách theo dõi)
    alerts = []
    plan_syms = {k: {p["symbol"] for p in sp["picks"]} for k, sp in style_plans.items()}
    try:
        if not multi:
            alerts = per_.alerts_for(load_watchlist(), g, last_date, plan_syms, active_style)
    except Exception as e:  # noqa: BLE001
        log.exception("Kiểm tra cảnh báo giá lỗi: %s", e)
    # ------------------------------------------------------------ lịch sự kiện (cổ tức đã công bố + hạn nộp BCTC)
    try:
        dv = store.read("dividends")
        evs = []
        if not dv.empty:
            dv["ex_date"] = pd.to_datetime(dv["ex_date"])
            lo, hi = pd.Timestamp(last_date) - pd.Timedelta(days=45), pd.Timestamp(last_date) + pd.Timedelta(days=120)
            for r in dv[(dv["ex_date"] >= lo) & (dv["ex_date"] <= hi)].itertuples():
                px = float(u.at[r.symbol, "price"]) if r.symbol in u.index and pd.notna(u.at[r.symbol, "price"]) else None
                cash = r.method == "cash"
                evs.append({"date": str(r.ex_date.date()), "symbol": r.symbol, "type": "div_cash" if cash else "div_stock",
                            "title": (f"Chốt quyền cổ tức tiền {r.cash_pct * 10000:,.0f}đ/cp".replace(",", ".") if cash else f"Chốt quyền cổ tức/thưởng cổ phiếu {r.cash_pct * 100:.0f}%"),
                            "yield": round(r.cash_pct * 10 / px * 100, 2) if cash and px else None})
        d0 = pd.Timestamp(last_date)
        for y in (d0.year, d0.year + 1):
            for q, (m_, dd_) in {1: (4, 30), 2: (7, 30), 3: (10, 30), 4: (1, 30)}.items():
                yy = y + 1 if q == 4 else y
                dt = pd.Timestamp(yy, m_, dd_)
                if d0 - pd.Timedelta(days=15) <= dt <= d0 + pd.Timedelta(days=120):
                    evs.append({"date": str((dt - pd.Timedelta(days=10)).date()), "symbol": "", "type": "earnings",
                                "title": f"Hạn công bố BCTC quý {q}/{y} (riêng lẻ: 20 ngày, hợp nhất: 30 ngày sau quý)"})
            agm = pd.Timestamp(d0.year + (1 if d0.month > 4 else 0), 4, 30)
            if d0 <= agm <= d0 + pd.Timedelta(days=120):
                evs.append({"date": str(agm.date()), "symbol": "", "type": "agm", "title": "Hạn tổ chức ĐHCĐ thường niên (trong 4 tháng sau năm tài chính)"})
        dump(out_dir / "events.json", {"date": str(last_date.date()), "events": sorted(evs, key=lambda e: e["date"])})
    except Exception as e:  # noqa: BLE001
        log.exception("Lịch sự kiện lỗi: %s", e)
    today = {"date": str(last_date.date()), "regime": regime, "plan": plan, "alerts": alerts,
             "allocation": cfg.get("allocation"), "risk": cfg.get("risk"), "capital": capital,
             "exposure_map": dict(mk.EXPOSURE), "strategy": cfg.get("strategy"),
             "style": active_style, "styles": {k: {**sp, **{x: sty.STYLES[k][x] for x in ("name", "horizon", "desc", "rules")}} for k, sp in style_plans.items()},
             "profile": {"applied": prof_changed, "updated": (profile or {}).get("updated"),
                         "exclude_sectors": cfg.get("exclude_sectors") or [], "exclude_symbols": cfg.get("exclude_symbols") or []},
             "portfolio": advice,
             "post_event": sorted(post_events, key=lambda x: (not x["quality"], x["since"])), "event_active": sorted(ev_active, key=lambda x: x["since"])}
    if multi:          # phần riêng (danh mục, cảnh báo, khẩu vị) không nằm trong tệp chung – mỗi người đọc qua /api/personal
        for k in ("portfolio", "alerts", "capital", "profile"):
            today.pop(k, None)
    dump(out_dir / "today.json", today)
    dump(out_dir / "market.json", market)
    dump(out_dir / "backtest.json", backtest)
    for fn in ("profile_grid.json", "styles_bt.json"):
        if store.path(fn).exists():
            shutil.copy(store.path(fn), out_dir / fn)
    dump(out_dir / "methods.json", {"methods": st.METHOD_INFO, "baskets": st.BASKETS,
                                    "weights": cfg.get("methods"), "pattern_stats": pstats})
    try:
        sec_l2 = sec_.analyze(u, wide, wide_val, idx["close"], fq, "sector")
        sec_l3 = sec_.analyze(u, wide, wide_val, idx["close"], fq, "industry")
    except Exception as e:  # noqa: BLE001
        log.exception("Phân tích ngành lỗi: %s", e)
        sec_l2, sec_l3 = [], []
    outlook = {}
    sec_m3 = None
    try:
        for lv, recs in (("sector", sec_l2), ("industry", sec_l3)):
            o = sec_out.run(u, wide, idx["close"], fq, lv)
            if lv == "sector":
                sec_m3 = (sec_out._LAST.get("score") or {}).get("m3")
            if not o:
                continue
            for rec in recs:
                if rec["name"] in o["current"]:
                    rec["outlook"] = o["current"][rec["name"]]
            outlook[lv] = {k: v for k, v in o.items() if k != "current"}
    except Exception as e:  # noqa: BLE001
        log.exception("Triển vọng ngành lỗi: %s", e)
    # ------------------------------------------------------------ chỉ số tương lai / quá khứ + trọng số riêng (có kiểm định)
    fbres = {"summary": {"ok": False}, "current": {}, "ind": {}}
    try:
        log.info("Điểm tương lai / quá khứ + kiểm định trọng số…")
        pp_ = prices[~prices["symbol"].isin(INDEX_SYMS)]
        hi_ = pp_.pivot_table(index="date", columns="symbol", values="high").reindex(wide.index)
        lo_ = pp_.pivot_table(index="date", columns="symbol", values="low").reindex(wide.index)
        vo_ = pp_.pivot_table(index="date", columns="symbol", values="volume").reindex(wide.index)
        fbres = fb_.run(u, wide, hi_, lo_, vo_, idx["close"], fq, sec_m3, "sector")
        del hi_, lo_, vo_
        for s_, c_ in fbres["current"].items():
            if s_ in u.index:
                for k_ in ("fwd", "back", "total", "w"):
                    u.at[s_, f"fb_{k_}"] = c_.get(k_)
        for c_ in ("fb_fwd", "fb_back", "fb_total", "fb_w"):
            if c_ not in u:
                u[c_] = None
        cols2 = cols + ["fb_fwd", "fb_back", "fb_total", "fb_w"]
        dump(out_dir / "screener.json", {"cols": cols2, "rows": u[cols2].replace({np.nan: None}).values.tolist()})
    except Exception as e:  # noqa: BLE001
        log.exception("Điểm tương lai/quá khứ lỗi: %s", e)
    dump(out_dir / "fb.json", {"summary": fbres["summary"], "ind": fbres["ind"]})
    # ------------------------------------------------------------ mùa vụ ngành + kiểm chứng ngoài mẫu
    season = {"thresholds": seas.STRONG, "oos": {}, "sectors": [], "stocks": []}
    try:
        for lv, recs in (("sector", sec_l2), ("industry", sec_l3)):
            ser_ = {rec["name"]: rec.pop("_il") for rec in recs if rec.get("_il") is not None}
            for rec in recs:
                if rec["name"] in ser_:
                    rec["season"] = seas.profile(ser_[rec["name"]], idx["close"], last_date)
                    rec["season_support"] = seas.support(rec.get("outlook"), rec.get("mtf"))
            season["oos"][lv] = seas.oos(ser_, idx["close"], last_date, min_prior=seas.STRONG["n"], th_rel=seas.STRONG["rel"], th_hit=seas.STRONG["hit"])
            for rec in recs:
                spf = rec.get("season") or {}
                h1 = (spf.get("same") or {}).get("h1") or {}
                nx = spf.get("next") or []
                strong_now = seas.is_strong({"n": h1.get("n"), "rel": h1.get("rel"), "relhit": h1.get("relhit")})
                strong_m = [x for x in nx[:2] if x.get("strong")]
                if strong_now or strong_m:
                    season["sectors"].append({"level": lv, "name": rec["name"], "h1": h1, "h2": (spf.get("same") or {}).get("h2"), "months": strong_m,
                                              "support": rec.get("season_support"), "outlook": (rec.get("outlook") or {}).get("m3")})
        so_path = store.path("season_oos.json")
        if so_path.exists() and store.age_days("season_oos") <= 6:
            season["oos"]["stock"] = json.loads(so_path.read_text(encoding="utf-8"))
        else:
            liq_syms = [s_ for s_ in u.index[u["avg_value_bn"].fillna(0) >= 3] if s_ in wide.columns]
            res_ = seas.oos({s_: wide[s_] for s_ in liq_syms}, idx["close"], last_date, min_prior=seas.STRONG["n"], th_rel=seas.STRONG["rel"], th_hit=seas.STRONG["hit"])
            so_path.write_text(json.dumps(_clean(res_), ensure_ascii=False), encoding="utf-8")
            store.touch("season_oos")
            season["oos"]["stock"] = res_
    except Exception as e:  # noqa: BLE001
        log.exception("Mùa vụ ngành lỗi: %s", e)
    for recs in (sec_l2, sec_l3):
        for rec in recs:
            rec.pop("_il", None)
    try:
        cand = u[(u["ss_strong"] == True) & (u["avg_value_bn"].fillna(0) >= 3)]  # noqa: E712
        for s_, r_ in cand.sort_values("ss1_rel", ascending=False).iterrows():
            sg = {"W": 1 if (r_.get("tf_w") or 0) >= 0.35 else -1 if (r_.get("tf_w") or 0) <= -0.35 else 0,
                  "M": 1 if (r_.get("tf_m") or 0) >= 0.35 else -1 if (r_.get("tf_m") or 0) <= -0.35 else 0}
            sup = seas.support(None, {"summary": {"signs": sg}}, _sup_extra(r_))
            season["stocks"].append({"symbol": s_, "sector": r_.get("sector"), "rel": _f(r_.get("ss1_rel")), "hit": _f(r_.get("ss1_hit")), "mean": _f(r_.get("ss1_mean")),
                                     "n": _f(r_.get("ss_n")), "support": sup, "composite": _f(r_.get("composite"))})
        season["stocks"] = season["stocks"][:30]
    except Exception as e:  # noqa: BLE001
        log.exception("Mùa vụ mã lỗi: %s", e)
    try:
        mkt_val = sec_.market_summary(u, fq, float(vcfg.get("risk_free", 3.2)))
    except Exception as e:  # noqa: BLE001
        log.exception("Định giá toàn thị trường lỗi: %s", e)
        mkt_val = {}
    dump(out_dir / "sectors.json", {"sector": sec_l2, "industry": sec_l3, "market": mkt_val, "outlook": outlook, "season": season,
                                    "backtest": (backtest or {}).get("sectors", {}),
                                    "backtest_range": [backtest.get("start"), backtest.get("end")] if backtest.get("ok") else None})

    sw_per = {}
    wl_syms = watch_all
    try:
        log.info("Hành vi giá: biên độ, đảo chiều, kiểu tay chơi…")
        sw_per = swb.run(prices[~prices["symbol"].isin(INDEX_SYMS)], listing, u, idx["close"], last_date, out_dir, advice, style_plans, held_all, wl_syms, active_style)
    except Exception as e:  # noqa: BLE001
        log.exception("Hành vi giá lỗi: %s", e)
    rel_by = {}
    try:
        log.info("Mã liên quan: đồng pha, dẫn dắt, chiến thuật…")
        rel_by = pab.run(prices[~prices["symbol"].isin(INDEX_SYMS)], listing, u, idx["close"], out_dir, held_all, wl_syms, pick_syms, cfg, sw_per)
    except Exception as e:  # noqa: BLE001
        log.exception("Mã liên quan lỗi: %s", e)
    # ------------------------------------------------------------ bản tin thị trường (chung)
    try:
        from . import digest as dg_
        dline = dg_.build(out_dir, u, today, market, idx, last_date, sw_per, store, g)
        today["digest_line"] = dline
    except Exception as e:  # noqa: BLE001
        log.exception("Bản tin thị trường lỗi: %s", e)
    # ------------------------------------------------------------ phần riêng từng người dùng
    owner_today, owner_watch = today, None
    pctx = {"u": u, "g": g, "cfg0": cfg0, "regime": regime, "last_date": last_date, "plan_syms": plan_syms, "active_style": active_style,
            "co": pab.LAST_CO, "rel_by": rel_by}
    if multi:
        try:
            pers = per_.run_all(be, U, pctx, today, out_dir)
            cp = store.path("live_ctx.json")
            if cp.exists():
                lc = json.loads(cp.read_text(encoding="utf-8"))
                lc["users"] = {str(uid): {"holdings": per_.holdings_levels(p_.get("portfolio")), "style": p_.get("style")} for uid, p_ in pers.items()}
                lc["owner"] = owner["id"] if owner else None
                cp.write_text(json.dumps(lc, ensure_ascii=False, default=str), encoding="utf-8")
            if owner and owner["id"] in pers:
                owner_today = {**today, **pers[owner["id"]]}
                owner_watch = {str(w["symbol"]).upper() for w in per_.watch_of(owner["data"])}
        except Exception as e:  # noqa: BLE001
            log.exception("Phần riêng người dùng lỗi: %s", e)
    else:
        try:
            today["rel"] = per_.rel_for(pab.LAST_CO, rel_by, held, watch_all)
            dump(out_dir / "today.json", today)
        except Exception as e:  # noqa: BLE001
            log.exception("Mã liên quan trong danh mục lỗi: %s", e)
    for s, d in details.items():
        r = u.loc[s]
        peers = u[(u["industry"] == r["industry"]) & u["has_fin"]].sort_values("mcap_bn", ascending=False)
        peer_rows = peers[["symbol", "price", "mcap_bn", "pe", "pb", "roe", "ni_yoy", "rev_yoy", "de", "fscore",
                           "div_yield", "upside", "composite"]].head(12).replace({np.nan: None}).values.tolist()
        lv = st.trade_levels(r, cfg.get("risk") or {}) if pd.notna(r.get("price")) else None
        ok_t, why_t = st.timing_ok(r)
        pat = d["pat"]
        for key in ("patterns", "harmonics"):
            for p in pat.get(key) or []:
                nm = p.get("name", "")
                key2 = "Harmonic" if key == "harmonics" else nm
                p["reliability"] = pstats_map.get(key2)
        for key, key2 in (("elliott", "Elliott"), ("wyckoff", "Wyckoff"), ("dow", "Dow")):
            if isinstance(pat.get(key), dict):
                pat[key]["reliability"] = pstats_map.get(key2)
        fq_s = fq_by.get(s)
        detail = {
            "symbol": s, "name": r["name"], "exchange": r["exchange"], "sector": r["sector"],
            "industry": r["industry"], "date": str(last_date.date()),
            "row": {k: r.get(k) for k in cols},
            "ohlc": _ohlc_payload(d["df"]),
            "ohlc_w": mtf_.payload(mtf_.resample(d["df"], "W")), "ohlc_m": mtf_.payload(mtf_.resample(d["df"], "M")),
            "mtf": d.get("mtf"), "season": d.get("season"), "fb": fbres["current"].get(s), "swing": sw_per.get(s), "rel": rel_by.get(s),
            "season_support": seas.support(None, d.get("mtf"), _sup_extra(r)),
            "ta": d["ta"], "waves": pat,
            "fa": d["fa"], "history": fu.history_table(fq_s, fy_by.get(s)),
            "valuation": d.get("val"),
            "peers": {"cols": ["symbol", "price", "mcap_bn", "pe", "pb", "roe", "ni_yoy", "rev_yoy", "de",
                               "fscore", "div_yield", "upside", "composite"], "rows": peer_rows,
                      "median": {k: r.get(f"{k}_ind_med") for k in fu.PEER_METRICS},
                      "pctl": {k: r.get(f"{k}_pctl") for k in fu.PEER_METRICS}, "n": r.get("peers_n")},
            "scores": {k: r.get(k) for k in list(st.METHOD_INFO) + ["composite", "rs_rating", "canslim_flags"]},
            "baskets": [b for b in st.BASKETS if r.get(f"in_{b}") is True],
            "levels": lv, "timing": {"ok": ok_t, "reason": why_t},
            "in_plan": s in pick_syms,
            "val_hist": _val_hist(fq_s),
            "style_levels": sty.levels_for(r, d["df"], cfg),
            "beta": r.get("beta"),
            "mos": mos,
        }
        dump(out_dir / "stocks" / f"{s}.json", detail)

    m = store.meta()
    meta = {"generated": datetime.now(__import__("zoneinfo").ZoneInfo("Asia/Ho_Chi_Minh")).isoformat(timespec="seconds"), "data_date": str(last_date.date()),
            "symbols": len(u), "deep": len(details), "liquid": len(liquid),
            "sources": {k: m.get(k) for k in ("prices", "financials", "dividends", "listing", "backtest")},
            "seconds": round((datetime.now() - t0).total_seconds()),
            "demo": bool(m.get("demo")), "repo": __import__("os").environ.get("GITHUB_REPOSITORY")}
    dump(out_dir / "meta.json", meta)
    # bản tóm tắt để kiểm tra nhanh (đẩy lên nhánh status)
    top = u[u["has_fin"]].sort_values("avg_value_bn", ascending=False).head(40)
    chk_cols = ["price", "pe", "pb", "roe", "ni_yoy", "rev_yoy", "fscore", "div_yield", "cash_years", "mcap_bn",
                "fair", "buy_below", "upside", "verdict", "ta_score", "ta_label", "trend", "composite", "period"]
    check = {"meta": meta, "regime": {k: regime[k] for k in ("light", "score", "exposure")},
             "picks": [{k: p.get(k) for k in ("symbol", "basket", "weight", "zone", "stop", "t1", "why")} for p in plan["picks"]],
             "watch": [{k: w.get(k) for k in ("symbol", "basket", "reason")} for w in plan["watch"][:10]],
             "baskets": {b: int(len(v)) for b, v in members.items()},
             "top": {sym: {c: r.get(c) for c in chk_cols} for sym, r in top.iterrows()},
             "valuation": {s_: {k: (details[s_].get("val") or {}).get(k) for k in ("fair", "ke", "beta", "reliable", "warning")}
                           | {"methods": [(m["name"][:40], m["value"]) for m in ((details[s_].get("val") or {}).get("methods") or [])]}
                           for s_ in list(top.index)[:15] if s_ in details}}
    if backtest.get("ok"):
        check["backtest"] = {k: {kk: v.get(kk) for kk in ("cagr", "max_dd", "avg_count", "win_years", "n_years")}
                             for k, v in list(backtest.get("baskets", {}).items())
                             + [("combo", backtest.get("combo", {})), ("combo_regime", backtest.get("combo_regime", {})),
                                ("vnindex", backtest.get("benchmark", {}))]}
        check["backtest_range"] = [backtest.get("start"), backtest.get("end")]
    else:
        check["backtest"] = {"ok": False, "reason": backtest.get("reason")}
    check["pattern_stats"] = pstats.get("stats", {})
    dump(store.path("check.json"), check)
    log.info("Xuất xong %d mã, %d trang chi tiết trong %ss", len(u), len(details), meta["seconds"])
    return {"today": owner_today, "meta": meta, "watch": owner_watch}


def _why(r: pd.Series, basket: str) -> str:
    parts = []
    if r.get("upside") is not None and r.get("upside") == r.get("upside"):
        parts.append(f"rẻ hơn giá trị hợp lý {r['upside']:.0f}%" if r["upside"] > 0 else f"đắt hơn giá trị hợp lý {-r['upside']:.0f}%")
    if r.get("fscore") == r.get("fscore") and r.get("fscore") is not None:
        parts.append(f"F-Score {int(r['fscore'])}/9")
    if r.get("roe") == r.get("roe") and r.get("roe") is not None:
        parts.append(f"ROE {r['roe']:.0f}%")
    if basket in ("dividend", "defensive") and r.get("div_yield"):
        parts.append(f"cổ tức tiền mặt {r['div_yield']:.1f}%/năm")
    if basket in ("garp", "growth") and r.get("ni_yoy") == r.get("ni_yoy") and r.get("ni_yoy") is not None:
        parts.append(f"LN 12T {r['ni_yoy']:+.0f}%")
    if r.get("ta_label"):
        parts.append(f"kỹ thuật: {r['ta_label']}")
    return ", ".join(parts)
