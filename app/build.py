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
from .analysis import fundamentals as fu
from .analysis import indicators as ind
from .analysis import market as mk
from .analysis import patterns as pt
from .analysis import portfolio as pf
from .analysis import strategy as st
from .analysis import technical as tech
from .analysis import valuation as va
from .analysis import forecast as fc
from .data import store
from .portfolio_store import load_holdings, load_overrides

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


def _ohlc_payload(df: pd.DataFrame, n: int = 750) -> dict:
    d = df.iloc[-n:]
    return {"t": [x.strftime("%Y-%m-%d") for x in d.index],
            "o": d["open"].round(2).tolist(), "h": d["high"].round(2).tolist(),
            "l": d["low"].round(2).tolist(), "c": d["close"].round(2).tolist(),
            "v": d["volume"].astype("int64").tolist()}


def run(skip_backtest: bool = False, force_backtest: bool = False, only: list[str] | None = None) -> dict:
    cfg = config.load()
    t0 = datetime.now()
    out_dir = config.OUT_DIR
    listing = store.read("listing")
    prices = store.read("prices")
    fin_q = store.read("fin_q")
    fin_y = store.read("fin_y")
    divs = store.read("dividends")
    sh_now = store.read("shares_now")
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
    holdings, cash_vnd, capital = load_holdings()
    held = {h["symbol"].upper() for h in holdings}
    symbols = [s for s in lst.index if lst.loc[s, "exchange"] in exch and s in g]
    if only:
        symbols = [s for s in symbols if s in only]
    deep = {s for s in symbols if avg_val.get(s, 0) >= deep_val} | (held & set(symbols))

    fq = fu.add_ttm(fin_q) if not fin_q.empty else pd.DataFrame()
    fq_by = {s: d for s, d in fq.groupby("symbol")} if not fq.empty else {}
    fy_by = {s: d.sort_values("year") for s, d in fin_y.groupby("symbol")} if not fin_y.empty else {}
    dv_by = {s: d for s, d in divs.groupby("symbol")} if not divs.empty else {}

    ps_path = store.path("pattern_stats.json")
    pstats_prev = json.loads(ps_path.read_text(encoding="utf-8")).get("stats", {}) if ps_path.exists() else {}

    def pattern_boost(pat: dict) -> tuple[float, list[str]]:
        """Chỉ mô hình đã được kiểm chứng là có lợi thế trên dữ liệu VN mới được cộng/trừ điểm."""
        sig = []
        el = pat.get("elliott") or {}
        if el.get("ok") and abs(el["main"]["bias"]) >= 0.5:
            sig.append(("Elliott", np.sign(el["main"]["bias"])))
        wy = pat.get("wyckoff") or {}
        if abs(wy.get("bias", 0)) >= 0.4:
            sig.append(("Wyckoff", np.sign(wy["bias"])))
        dw = pat.get("dow") or {}
        if abs(dw.get("bias", 0)) >= 0.7:
            sig.append(("Dow", np.sign(dw["bias"])))
        for p in pat.get("patterns") or []:
            if p.get("bias"):
                sig.append((p["name"], p["bias"]))
        for p in pat.get("harmonics") or []:
            sig.append(("Harmonic", p["bias"]))
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
                                    "ohlc": _ohlc_payload(g[s], 500)}

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
        fa = fu.analyze_symbol(s, fq_by.get(s), fy_by.get(s), price, dv_by.get(s), ctype, sh_now.get(s))
        c = df["close"]
        r = {
            "symbol": s, "name": lst.loc[s, "name"], "exchange": lst.loc[s, "exchange"],
            "sector": lst.loc[s, "sector"], "industry": lst.loc[s, "industry"], "ctype": ctype,
            "price": price, "chg1d": 100 * (c.iloc[-1] / c.iloc[-2] - 1) if len(c) > 1 else None,
            "chg1m": 100 * (c.iloc[-1] / c.iloc[-22] - 1) if len(c) > 22 else None,
            "chg1y": 100 * (c.iloc[-1] / c.iloc[-250] - 1) if len(c) > 250 else None,
            "avg_value_bn": float(avg_val.get(s, 0)), "days": len(df),
            "ta_score": ta.get("score"), "ta_label": ta.get("label"), "trend": ta.get("trend"),
            "atr": ta.get("atr"), "from_hi52": ta.get("from_hi52_pct"),
            "st_dir": float(ti["st_dir"].iloc[-1]),
            "rsi": float(ti["rsi"].iloc[-1]) if ti["rsi"].notna().iloc[-1] else None,
            "ret_12_1": float(c.iloc[-22] / c.iloc[-252] - 1) if len(c) > 252 else None,
            "ret_6m": float(c.iloc[-1] / c.iloc[-126] - 1) if len(c) > 126 else None,
            "rs_raw": ind.rs_rating_raw(c),
            "vol_1y": float(c.iloc[-250:].pct_change().std() * np.sqrt(250)) if len(c) > 60 else None,
            "beta": va.beta(c, idx["close"]) if len(c) > 120 else 1.0,
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
            r["wyckoff"] = (pat.get("wyckoff") or {}).get("code")
            lv = pat.get("levels") or {}
            r["support1"] = lv["support"][0]["price"] if lv.get("support") else None
            r["resist1"] = lv["resistance"][0]["price"] if lv.get("resistance") else None
            boost, used_p = pattern_boost(pat)
            if boost and r["ta_score"] is not None:
                r["ta_score"] = int(np.clip(r["ta_score"] + boost, 0, 100))
                ta["score"] = r["ta_score"]
                ta["pattern_boost"] = {"points": boost, "patterns": used_p}
            details[s] = {"df": df, "ti": ti, "ta": ta, "fa": fa, "pat": pat}
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
    overrides = load_overrides()
    for s in u.index:
        r = u.loc[s]
        d = details.get(s)
        if d is None or not d["fa"].get("ok"):
            continue
        fa = d["fa"]
        qs = fq_by.get(s)
        ttm_row = fu.latest_row(qs) if qs is not None and not qs.empty else None
        sg = sector_growth["rev_yoy" if fa["ctype"] == "CT" else "ni_yoy"].get(r["industry"])
        model = fc.build_base(fa, fy_by.get(s), ttm_row, sg, vcfg)
        if model is not None and s in overrides:
            ov = {k: float(v) for k, v in overrides[s].items()
                  if k in model["assumptions"] and v is not None}
            model["assumptions"].update(ov)
            model["overridden"] = sorted(ov)
        hist = va.hist_multiples(qs, d["df"]["close"], fa.get("shares_mn"))
        peers = {"pe_ind_med": r.get("pe_ind_med"), "pb_ind_med": r.get("pb_ind_med")}
        val = va.value(fa, model, peers, hist, r["beta"], vcfg, mos)
        d["val"] = val
        if val.get("ok"):
            u.at[s, "verdict"] = val["verdict"]
            if val.get("reliable"):
                for k in ("fair", "fair_lo", "fair_hi", "buy_below", "sell_above", "upside"):
                    u.at[s, k] = val[k]
            if hist.get("pe_med") and r.get("pe"):
                u.at[s, "pe_vs_hist"] = r["pe"] / hist["pe_med"]
    for k in ("fair", "fair_lo", "fair_hi", "buy_below", "sell_above", "upside", "pe_vs_hist"):
        if k not in u:
            u[k] = np.nan
    if "verdict" not in u:
        u["verdict"] = None

    # ------------------------------------------------------------ điểm, rổ, kế hoạch
    elig = u[u["has_fin"] & (u["days"] >= 60)].copy()
    sc = st.score_methods(elig, regime["light"])
    weights = cfg.get("methods") or {}
    sc["composite"] = st.composite(sc, weights)
    members = st.basket_members(elig, sc, regime["light"])
    plan = st.plan(elig, sc, members, cfg, regime)
    for b, ser in members.items():
        for s in ser.index:
            u.at[s, f"in_{b}"] = True
    u = u.join(sc, how="left")

    # ------------------------------------------------------------ danh mục đang nắm
    closes = {s: g[s]["close"] for s in held if s in g}
    advice = pf.advise(holdings, u, closes, cfg, regime, cash_vnd) if holdings else None

    # ------------------------------------------------------------ backtest (theo lịch)
    bt_path = store.path("backtest.json")
    ps_path = store.path("pattern_stats.json")
    if not skip_backtest and (force_backtest or store.age_days("backtest") > 6 or not bt_path.exists()):
        log.info("Chạy backtest…")
        try:
            res = bt.run(prices, fq, divs, listing, cfg)
            bt_path.write_text(json.dumps(_clean(res), ensure_ascii=False), encoding="utf-8")
            store.touch("backtest")
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
            "low_vol", "rs_rating", "canslim_flags", "liquid_ok"] + [f"in_{b}" for b in st.BASKETS]
    for c in cols:
        if c not in u:
            u[c] = None
    scr = u[cols].replace({np.nan: None})
    dump(out_dir / "screener.json", {"cols": cols, "rows": scr.values.tolist()})

    pick_syms = {p["symbol"] for p in plan["picks"]}
    for p in plan["picks"] + plan["watch"]:
        rr = u.loc[p["symbol"]]
        p.update({"name": rr["name"], "price": rr["price"], "fair": rr.get("fair"), "upside": rr.get("upside"),
                  "fscore": rr.get("fscore"), "div_yield": rr.get("div_yield"), "pe": rr.get("pe"),
                  "roe": rr.get("roe"), "ta_label": rr.get("ta_label"),
                  "why": _why(rr, p["basket"])})
    pstats_map = pstats.get("stats", {})
    iw = market.get("index_waves") or {}
    for key, key2 in (("elliott", "Elliott"), ("wyckoff", "Wyckoff"), ("dow", "Dow")):
        if isinstance(iw.get(key), dict):
            iw[key]["reliability"] = pstats_map.get(key2)
    today = {"date": str(last_date.date()), "regime": regime, "plan": plan,
             "allocation": cfg.get("allocation"), "risk": cfg.get("risk"), "capital": capital,
             "portfolio": advice}
    dump(out_dir / "today.json", today)
    dump(out_dir / "market.json", market)
    dump(out_dir / "backtest.json", backtest)
    dump(out_dir / "methods.json", {"methods": st.METHOD_INFO, "baskets": st.BASKETS,
                                    "weights": cfg.get("methods"), "pattern_stats": pstats})

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
            "beta": r.get("beta"),
            "mos": mos,
        }
        dump(out_dir / "stocks" / f"{s}.json", detail)

    m = store.meta()
    meta = {"generated": datetime.now().isoformat(timespec="seconds"), "data_date": str(last_date.date()),
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
    return {"today": today, "meta": meta}


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
