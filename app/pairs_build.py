"""Mã liên quan (đồng pha / dẫn dắt) trong lượt chạy đóng cửa: pairs.json cho web và phần "rel" của từng mã."""
from __future__ import annotations

import json
import logging

import numpy as np
import pandas as pd

from .analysis import pairs as pr
from .analysis import strategy as st
from .data import store

log = logging.getLogger("pairs")
MIN_VAL = 3.0      # tỷ đồng/phiên (trung bình 60 phiên gần nhất)


def _f(x, nd=2):
    try:
        x = float(x)
        return None if x != x or x in (np.inf, -np.inf) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _state(s: str, u: pd.DataFrame, cfg: dict, pick_syms: set, sw_per: dict) -> dict:
    r = u.loc[s]
    lv = st.trade_levels(r, cfg.get("risk") or {}) if pd.notna(r.get("price")) else None
    ok_t, why_t = st.timing_ok(r)
    es = pr.entry_state(lv, (ok_t, why_t), s in pick_syms)
    fl = ((sw_per.get(s) or {}).get("flow") or {}).get("st") or []
    g = lambda k: r.get(k) if k in r.index else None  # noqa: E731
    return {"s": s, "name": g("name"), "industry": g("industry"), "price": _f(g("price")), "chg1m": _f(g("chg1m"), 1), "chg3m": _f(g("chg3m"), 1),
            "rsi": _f(g("rsi"), 0), "trend": g("trend"), "ta_label": g("ta_label"), "verdict": g("verdict"), "fair": _f(g("fair")),
            "upside": _f(g("upside"), 0), "composite": _f(g("composite"), 0), "val": _f(g("avg_value_bn"), 1), "flow_st": list(fl),
            "es_k": es["k"], "es_t": es["t"], "es_c": es.get("c"),
            "lv": {k: lv.get(k) for k in ("zone", "stop", "t1", "t2", "state", "ext")} if lv else None}


def run(prices: pd.DataFrame, listing: pd.DataFrame, u: pd.DataFrame, idx_close: pd.Series, out_dir, held: set, watch: set,
        pick_syms: set, cfg: dict, sw_per: dict) -> dict:
    C = prices.pivot_table(index="date", columns="symbol", values="close", aggfunc="last").sort_index()
    V = prices.pivot_table(index="date", columns="symbol", values="volume", aggfunc="last").reindex(C.index)
    val = (C * V / 1e6).rolling(20, min_periods=10).mean().iloc[-60:].mean()
    liq = [s for s in C.columns if (val.get(s, 0) or 0) >= MIN_VAL or ((s in held or s in watch) and (val.get(s, 0) or 0) >= 1)]
    liq = [s for s in liq if C[s].iloc[-260:].notna().sum() >= 200]
    ind = listing.set_index("symbol")["industry"]
    log.info("Mã liên quan: %d mã đủ thanh khoản", len(liq))
    A = pr.analyze(C, idx_close, ind, liq)
    vp = store.path("pairs_tests.json")
    if vp.exists() and store.age_days("pairs_tests") <= 6:
        V_ = json.loads(vp.read_text(encoding="utf-8"))
    else:
        V_ = pr.validate(C, idx_close, ind, liq, val)
        vp.write_text(json.dumps(V_, ensure_ascii=False), encoding="utf-8")
        store.touch("pairs_tests")
    n_found = len(A["pairs"])
    fdr = (A["exp_false"] or 0) / n_found if n_found else None
    lead_by = {}
    for p in A["pairs"]:
        p["fdr"] = _f(fdr, 2)
        lead_by[(p["lead"], p["follow"])] = p
    need = set(A["co"]) | {p["lead"] for p in A["pairs"]} | {p["follow"] for p in A["pairs"]}
    S = {s: _state(s, u, cfg, pick_syms, sw_per) for s in need if s in u.index}
    tests_small = {k: V_.get(k) for k in ("lead_pool", "catchup", "daily_lead", "follow_dd", "stability", "split", "start")}
    rel = {}
    for x, lst in A["co"].items():
        if x not in S:
            continue
        co = []
        for c in lst:
            y = c["s"]
            if y not in S:
                continue
            ys = S[y]
            strat = pr.strategy(x, y, c, S[x], ys, V_, lead_by.get((x, y)), lead_by.get((y, x)), held)
            co.append({**c, **{k: ys.get(k) for k in ("name", "industry", "price", "chg1m", "trend", "ta_label", "verdict", "upside", "composite",
                                                      "flow_st", "es_k", "es_t", "es_c", "lv", "rsi")}, "held": y in held, "strat": strat})
        leads = [p for p in A["pairs"] if p["lead"] == x]
        follows = [p for p in A["pairs"] if p["follow"] == x]
        if not co and not leads and not follows:
            continue
        grp = pr.group(x, co, S[x], V_, held)
        rel[x] = {"co": co, "group": grp, "leads": leads, "follows": follows, "held_x": x in held, "ccf_lags": A["ccf_lags"], "ccf_band": A["ccf_band"]}
    # cặp đồng pha mạnh nhất toàn thị trường + rủi ro tập trung trong danh mục
    top, seen = [], set()
    for x, lst in A["co"].items():
        for c in lst:
            k = tuple(sorted((x, c["s"])))
            if k in seen:
                continue
            seen.add(k)
            top.append({"a": k[0], "b": k[1], "rc": c["rc"], "rc_l": c["rc_l"], "p_dd": c["p_dd"], "p_base": c["p_base"], "same": c["same"],
                        "ind_a": (S.get(k[0]) or {}).get("industry"), "ind_b": (S.get(k[1]) or {}).get("industry")})
    top.sort(key=lambda z: -(z["rc"] or 0))
    conc = []
    hl = sorted(s for s in held if s in A["co"])
    for i, a in enumerate(hl):
        for c in A["co"][a]:
            if c["s"] in held and c["s"] > a and (c["rc"] or 0) >= 0.4:
                conc.append({"a": a, "b": c["s"], "rc": c["rc"], "p_dd": c["p_dd"], "p_base": c["p_base"]})
    mine = {s: rel[s] for s in sorted((held | watch) & set(rel))}
    out = {"date": A["date"], "n_syms": A["n_syms"], "weeks": A["weeks"], "n_tests": A["n_tests"], "exp_false": A["exp_false"], "n_found": n_found,
           "fdr": _f(fdr, 2), "stats": A["stats"], "pairs": [{**p, "ind_l": (S.get(p["lead"]) or {}).get("industry"), "ind_f": (S.get(p["follow"]) or {}).get("industry"),
                                                               "es_f": (S.get(p["follow"]) or {}).get("es_t")} for p in A["pairs"]],
           "tests": tests_small, "top": top[:60], "conc": conc,
           "mine": {s: [{k: c.get(k) for k in ("s", "rc", "p_dd", "p_base", "es_t", "es_c", "held")} for c in r_["co"][:5]] for s, r_ in mine.items()},
           "split": A["split"], "min_val": MIN_VAL}
    (out_dir / "pairs.json").write_text(json.dumps(_clean(out), ensure_ascii=False), encoding="utf-8")
    log.info("Mã liên quan: %d mã có danh sách đồng pha, %d cặp dẫn dắt qua kiểm chứng (kỳ vọng sai %.1f), %d cặp tập trung trong danh mục",
             len(rel), n_found, A["exp_false"] or 0, len(conc))
    return {s: _clean({**r_, "tests": tests_small, "n_tests": A["n_tests"], "exp_false": A["exp_false"], "n_found": n_found, "fdr": _f(fdr, 2)}) for s, r_ in rel.items()}


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.integer):
        return int(o)
    if isinstance(o, (np.floating, float)):
        return None if (o != o or o in (np.inf, -np.inf)) else float(o)
    if isinstance(o, np.bool_):
        return bool(o)
    if isinstance(o, pd.Timestamp):
        return str(o)
    return o
