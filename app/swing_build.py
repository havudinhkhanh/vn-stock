"""Gộp phân tích hành vi giá (swing.py) vào lượt chạy đóng cửa: swing.json cho web, phần "swing" của từng mã,
và data/live_ctx.json làm bối cảnh cho lượt chạy trong phiên hôm sau."""
from __future__ import annotations

import json
import logging

import numpy as np
import pandas as pd

from .analysis import swing as sw
from .analysis import flow as fl
from .data import store

log = logging.getLogger("swing")


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


TABLE_COLS = ["symbol", "sector", "price", "chg1d", "avg_value_bn", "score", "tags", "rng_med", "rng_rel", "rev_rate", "pump_spike", "dump_spike",
              "leave_c", "rec_f", "spikes", "ac1", "flips", "s_p_fade", "s_n_up", "s_a_after_up", "s_p_bounce", "s_n_dn", "s_a_after_dn", "s_corr_ma",
              "s_atc_mean", "s_atc_up", "s_atc_dn", "s_hi_early", "s_lo_early", "s_n", "today_m", "today_a", "today_atc", "sig"]


def run(prices: pd.DataFrame, listing: pd.DataFrame, u: pd.DataFrame, idx_close: pd.Series, last_date, out_dir,
        advice: dict | None, style_plans: dict, held: set, watch_syms: set, active_style: str = "position") -> dict:
    lst = listing.set_index("symbol")
    syms = [s for s in u.index if (u.at[s, "avg_value_bn"] or 0) >= 1 or s in held or s in watch_syms]
    have = set(prices["symbol"].unique())
    syms = [s for s in syms if s in have]
    P = sw.panels(prices, syms)
    C = P["C"]
    ex = lst["exchange"].reindex(C.columns).map(sw.LIMIT).fillna(0.07)
    E = sw.daily_events(P, ex)
    val20 = (P["V"] * C / 1e6).rolling(20, min_periods=10).mean()
    liq = (val20 >= 2).fillna(False)
    log.info("Hành vi giá: %d mã, nến ngày %s → %s", len(syms), C.index[0].date(), C.index[-1].date())
    ev = sw.event_study(E, C, idx_close, liq)
    mkt_ev = ev["market"]
    try:
        val = sw.score_validation(E, P["V"], C, liq, idx_close)
    except Exception as e:  # noqa: BLE001
        log.exception("Kiểm chứng điểm bất thường lỗi: %s", e)
        val = {"ok": False}
    isess = store.read("isess")
    ibk = store.read("ibk")
    ses = sw.session_table(isess, C.index) if not isess.empty else pd.DataFrame()
    if not ses.empty:
        # bỏ phiên mà lợi nhuận ngày lệch với giá ngày đã điều chỉnh (chia tách, cổ tức)
        dr = E["ret"].stack().rename("dret").reset_index().rename(columns={"level_0": "date", "level_1": "symbol"})
        dr.columns = ["date", "symbol", "dret"]
        ses = ses.merge(dr, on=["date", "symbol"], how="left")
        ses = ses[(ses["dret"].isna()) | ((ses["day_ret"] - ses["dret"]).abs() <= 0.012)]
    liq_last = liq.iloc[-1]
    try:
        sev_ = sw.session_event_study(ses, C, idx_close, list(liq_last[liq_last].index))
        mkt_ev.update(sev_)
    except Exception as e:  # noqa: BLE001
        log.exception("Kiểm chứng kiểu phiên sáng/chiều lỗi: %s", e)
    prof = sw.profiles(E, P, liq_last, ses, ibk, ev["own"], mkt_ev)
    base = sw.market_baseline(ses, ibk, list(liq_last[liq_last].index))
    sigs = sw.today_signals(E, P, ses, prof, mkt_ev, last_date)
    # tin tức gắn mã
    news = store.read("news")
    nby = {}
    if not news.empty:
        news["time"] = pd.to_datetime(news["time"])
        for s, d in news.sort_values("time", ascending=False).groupby("symbol"):
            nby[s] = [{"t": x.time.strftime("%Y-%m-%d %H:%M"), "title": x.title, "link": x.link, "src": x.src} for x in d.head(8).itertuples()]
    for x in sigs:
        x["news"] = [n for n in nby.get(x["symbol"], []) if n["t"] >= str((pd.Timestamp(last_date) - pd.Timedelta(days=3)).date())][:3]
    shark = store.read("shark")
    sh_by = {}
    if not shark.empty:
        shark["date"] = pd.to_datetime(shark["date"])
        for s, d in shark.sort_values("date").groupby("symbol"):
            sh_by[s] = [{"d": str(r.date.date()), **json.loads(r.json)} for r in d.tail(20).itertuples()]
    today_ses = ses[ses["date"] == pd.Timestamp(last_date).normalize()].set_index("symbol") if not ses.empty else pd.DataFrame()
    sig_by = {x["symbol"]: x for x in sigs}

    # ---- bảng
    rows = []
    for s, p in prof.iterrows():
        if s not in u.index:
            continue
        r = u.loc[s]
        rec = {"symbol": s, "sector": r.get("sector"), "price": r.get("price"), "chg1d": r.get("chg1d"), "avg_value_bn": r.get("avg_value_bn")}
        for c in TABLE_COLS:
            if c in rec:
                continue
            if c in p.index:
                v = p[c]
                rec[c] = v if c == "tags" else _r(v, 3 if c in ("ac1", "flips", "rng_rel", "s_corr_ma") else 2)
        if s in today_ses.index:
            t = today_ses.loc[s]
            rec["today_m"], rec["today_a"] = _r(100 * t["m_ret"], 2), _r(100 * t["a_ret"], 2)
            rec["today_atc"] = _r(100 * t["atc_ret"], 2) if t["atc_ret"] == t["atc_ret"] else None
        rec["sig"] = sig_by[s]["sig"] if s in sig_by else []
        rows.append([rec.get(c) for c in TABLE_COLS])
    cov = {"daily_from": str(C.index[0].date()), "n": len(rows),
           "hourly_syms": base.get("n_sym_h"), "minute_syms": base.get("n_sym_m"), "ses_from": base.get("first"),
           "intraday_meta": store.meta().get("intraday")}
    out = {"date": str(pd.Timestamp(last_date).date()), "cols": TABLE_COLS, "rows": rows, "today": sigs[:80], "events": mkt_ev,
           "validation": val, "market": {k: base.get(k) for k in ("n", "p_fade", "a_after_up", "p_bounce", "a_after_dn", "corr_ma", "atc_mean", "atc_abs",
                                                                  "atc_up", "atc_dn", "hi_early", "lo_early", "path", "vshare", "n_up", "n_dn", "n_atc")},
           "coverage": cov, "window": sw.W}
    (out_dir / "swing.json").write_text(json.dumps(_clean(out), ensure_ascii=False), encoding="utf-8")

    # ---- dòng tiền lớn (gom / xả / bứt phá) + tâm lý thị trường
    flow_by = {}
    try:
        P2 = {"C": C, "H": P["H"].reindex_like(C), "L": P["L"].reindex_like(C), "V": P["V"].reindex_like(C)}
        F = fl.features(P2)
        fev = fl.event_study(F, C, P2["H"], idx_close, liq)
        cur = fl.current(F, C, liq_last, store.read("orderflow"), sh_by)
        sent = fl.sentiment(C, P2["H"], P2["V"], liq, idx_close)
        flow_by = {x["s"]: x for x in cur}
        for x in cur:
            if x["s"] in u.index:
                x["sector"] = u.at[x["s"], "sector"]
                x["chg1m"] = _r(u.at[x["s"], "chg1m"], 1)
                x["val"] = _r(u.at[x["s"], "avg_value_bn"], 1)
                x["price"] = _r(u.at[x["s"], "price"])
        fout = {"date": out["date"], "window": fl.N, "events": fev, "rows": [x for x in cur if x["st"] or x["acc_20"] or x["dist_20"]],
                "count": {"acc": sum(1 for x in cur if "acc" in x["st"]), "dist": sum(1 for x in cur if "dist" in x["st"]),
                          "brk": sum(1 for x in cur if set(x["st"]) & {"brk", "acc_brk"}), "n": len(cur)},
                "sentiment": sent}
        (out_dir / "flow.json").write_text(json.dumps(_clean(fout), ensure_ascii=False), encoding="utf-8")
        log.info("Dòng tiền lớn: %s · tâm lý %s (%s)", fout["count"], sent.get("now"), sent.get("label"))
    except Exception as e:  # noqa: BLE001
        log.exception("Dòng tiền lớn / tâm lý lỗi: %s", e)

    # ---- từng mã
    per = {}
    ses_by = {s: d for s, d in ses.groupby("symbol")} if not ses.empty else {}
    for s, p in prof.iterrows():
        recent = []
        if s in ses_by:
            for x in ses_by[s].tail(20).itertuples():
                recent.append({"d": str(x.date.date()), "m": _r(100 * x.m_ret), "a": _r(100 * x.a_ret), "atc": _r(100 * x.atc_ret) if x.atc_ret == x.atc_ret else None,
                               "day": _r(100 * x.day_ret), "rng": _r(100 * x.rng, 1), "hi_t": int(x.hi_t), "lo_t": int(x.lo_t)})
        own = {k: {"n": int(p.get(f"o_{k}_n") or 0), "r5": _r(p.get(f"o_{k}_r5"))} for k in sw.EVENTS if f"o_{k}_n" in p.index}
        per[s] = {"profile": {k: (v if k in ("tags", "path", "vshare") else _r(v, 3)) for k, v in p.items() if not str(k).startswith("o_")},
                  "own": own, "recent": recent, "today": sig_by.get(s), "news": nby.get(s, []), "shark": sh_by.get(s, []), "flow": flow_by.get(s),
                  "market": out["market"]}
    # ---- bối cảnh cho lượt trong phiên
    vavg = P["V"].iloc[-20:].mean()
    ctx = {"date": out["date"], "mkt": {"vshare": base.get("vshare"), "p_fade": base.get("p_fade"), "p_bounce": base.get("p_bounce")}, "syms": {}, "holdings": {}, "picks": [], "active_style": active_style}
    for s in C.columns:
        p = prof.loc[s] if s in prof.index else None
        typ = E["rng"][s].iloc[-20:].median()
        ctx["syms"][s] = {"pc": _r(C[s].iloc[-1]), "typ": _r(100 * typ, 2) if typ == typ else None, "vavg": _r(vavg.get(s), 0),
                          "val": _r(u.at[s, "avg_value_bn"], 1) if s in u.index else None,
                          **({} if p is None else {"p_fade": _r(p.get("s_p_fade"), 0), "n_up": _r(p.get("s_n_up"), 0), "a_after_up": _r(p.get("s_a_after_up")),
                                                   "p_bounce": _r(p.get("s_p_bounce"), 0), "n_dn": _r(p.get("s_n_dn"), 0), "a_after_dn": _r(p.get("s_a_after_dn")),
                                                   "vshare": p.get("vshare") if isinstance(p.get("vshare"), list) and (p.get("path_n") or 0) >= 30 else None,
                                                   "score": _r(p.get("score"), 0), "tags": p.get("tags")})}
    for pos in (advice or {}).get("positions") or []:
        ep = pos.get("exit") or {}
        ctx["holdings"][pos["symbol"]] = {"levels": [{"key": x["key"], "label": x["label"], "price": x.get("price"), "trig": x.get("trig"), "sell": x.get("sell"),
                                                      "done": x.get("status") == "done"} for x in ep.get("levels") or []]}
    for k, sp in (style_plans or {}).items():
        for pk in sp.get("picks") or []:
            z = pk.get("zone")
            if z:
                ctx["picks"].append({"symbol": pk["symbol"], "style": k, "zone": [float(z[0]), float(z[1])], "stop": pk.get("stop"), "chase": round(float(z[1]) * 1.02, 2)})
    store.path("live_ctx.json").write_text(json.dumps(_clean(ctx), ensure_ascii=False), encoding="utf-8")
    log.info("Hành vi giá: %d mã trong bảng, %d tín hiệu hôm nay, kiểm chứng %s", len(rows), len(sigs), {k: val.get(k) for k in ("ic_vol", "t_vol", "ic_ret", "t_ret")})
    return per


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (o != o or o in (np.inf, -np.inf)) else float(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return str(o)
    return o
