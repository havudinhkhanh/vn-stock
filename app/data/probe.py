"""Kiểm tra nhanh từng nguồn dữ liệu còn hoạt động không (chạy: python run.py probe)."""
from __future__ import annotations

import json
import re
import time
import traceback
from datetime import datetime, timedelta

from ..config import DATA_DIR
from . import kbs, normalize, vci, yahoo


def _try(name, fn, report):
    t = time.time()
    try:
        res = fn()
        info = {"ok": True, "sec": round(time.time() - t, 2)}
        if hasattr(res, "shape"):
            info["shape"] = list(res.shape)
            info["columns"] = [str(c) for c in list(res.columns)[:80]]
            info["head"] = json.loads(res.head(3).to_json(orient="records", date_format="iso"))
            info["tail"] = json.loads(res.tail(2).to_json(orient="records", date_format="iso"))
        elif isinstance(res, dict):
            info["keys"] = {k: (len(v) if hasattr(v, "__len__") else v) for k, v in list(res.items())[:30]}
        else:
            info["value"] = str(res)[:2000]
    except Exception as e:  # noqa: BLE001
        info = {"ok": False, "sec": round(time.time() - t, 2), "error": f"{type(e).__name__}: {e}"[:600],
                "trace": traceback.format_exc()[-800:]}
    report[name] = info
    print(("OK  " if info["ok"] else "FAIL"), name, info.get("shape", ""), info.get("error", "")[:200], flush=True)
    _save(report)
    return info


def _save(report: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "probe_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def run() -> dict:
    report: dict = {"at": datetime.now().isoformat()}
    try:
        _run(report)
    except Exception:  # noqa: BLE001
        report["crash"] = traceback.format_exc()
        print(report["crash"], flush=True)
    _save(report)
    print("Báo cáo:", DATA_DIR / "probe_report.json")
    return report


KEY = ["revenue", "gross_profit", "pbt", "net_income", "ni_parent", "toi", "nii", "total_assets", "equity",
       "debt", "cash", "cfo", "capex", "shares", "pe_src", "roe_src"]


def _summary(df):
    import pandas as pd
    if df is None or df.empty:
        return {}
    d = normalize.finalize(df.copy())
    y = d[d["quarter"] == 0].tail(3)
    q = d[d["quarter"] > 0].tail(2)
    pick = lambda x: x[["year", "quarter"] + [c for c in KEY if c in x]].round(1).to_dict("records")  # noqa: E731
    return {"annual": pick(y), "quarterly": pick(q), "n_rows": int(len(d)),
            "missing_canon": [c for c in normalize.CANON if c not in df.columns]}


def _run(report: dict) -> None:
    import pandas as pd
    start = datetime.now() - timedelta(days=30)
    _try("vci.listing", vci.listing, report)
    lst = report.get("vci.listing", {})
    try:
        ind = vci.industries()
        report["vci.industries"] = {"n": len(ind), "sample": ind.head(5).to_dict("records"),
                                    "comType": ind["comTypeCode"].value_counts().to_dict()}
        print("OK   vci.industries", len(ind), flush=True)
    except Exception as e:  # noqa: BLE001
        report["vci.industries"] = {"ok": False, "error": str(e)[:400]}
        print("FAIL vci.industries", e, flush=True)
    _try("vci.prices[FPT,VCB,VNINDEX]",
         lambda: pd.concat([d.assign(symbol=s) for s, d in vci.prices(["FPT", "VCB", "VNINDEX"], start).items()]),
         report)
    for sym, ct in (("FPT", "CT"), ("VCB", "NH"), ("SSI", "CK"), ("BVH", "BH"), ("HPG", "CT")):
        try:
            mp = vci.metrics(sym, ct + sym)  # không dùng cache trong lúc kiểm tra
            stm = {sec: vci.statement(sym, sec) for sec in ("IS", "BS", "CF")}
            try:
                rt = vci.ratios(sym)
            except Exception as e:  # noqa: BLE001
                rt = None
                report[f"vci.ratios[{sym}]"] = str(e)[:300]
            info = {"ok": True, "metrics_rows": len(mp),
                    "sections": mp["section"].value_counts().to_dict()}
            for sec, by in stm.items():
                info[f"{sec}_shape"] = {k: list(v.shape) for k, v in by.items()}
                q = by.get("quarters")
                if q is not None and not q.empty:
                    info[f"{sec}_cols"] = list(q.columns)[:40]
                    info[f"{sec}_row0"] = {k: q.iloc[0][k] for k in list(q.columns)[:25]}
            m2 = mp.copy()
            detail = {}
            for sec in ("IS", "BS", "CF"):
                mm = m2[m2["section"].str.contains({"IS": "INCOME", "BS": "BALANCE", "CF": "CASH"}[sec])]
                fm = normalize.match_items([{"key": r.field, "en": r.en, "vi": r.vi} for r in mm.itertuples()])
                yrs = stm[sec].get("years")
                for f, canon in fm.items():
                    hit = mm[mm["field"] == f]
                    if hit.empty:
                        continue
                    row = hit.iloc[0]
                    val = None
                    if yrs is not None and not yrs.empty and f in yrs:
                        v = pd.to_numeric(yrs[f], errors="coerce").dropna()
                        val = float(v.iloc[0]) if len(v) else None
                    detail.setdefault(canon, []).append(f"{sec}:{f} {row.en} | {row.vi} = {val}")
            info["mapping"] = detail
            titles = [f"[{r.section[:2]}:{r.field}] {r.en} | {r.vi}" for r in m2.itertuples() if r.section != "NOTE"]
            info["titles_revenue_equity"] = [t for t in titles if re.search(
                r"revenue|sales|premium|equity|before tax|after tax|operating activ|doanh thu|vốn chủ|trước thuế|sau thuế", t, re.I)][:80]
            if sym in ("SSI", "BVH"):
                info["all_titles"] = titles[:500]
            if rt is not None and not rt.empty:
                info["ratio_cols"] = list(rt.columns)[:60]
                info["ratio_row0"] = {k: rt.iloc[0][k] for k in list(rt.columns)[:30]}
            info["normalized"] = _summary(normalize.normalize_iq(sym, stm, mp, rt))
            report[f"vci.fin[{sym}]"] = info
            print("OK   vci.fin", sym, json.dumps(info["normalized"].get("annual", [])[-1:], default=str)[:400], flush=True)
        except Exception as e:  # noqa: BLE001
            report[f"vci.fin[{sym}]"] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:500],
                                         "trace": traceback.format_exc()[-1200:]}
            print("FAIL vci.fin", sym, e, flush=True)
        _save(report)
    try:
        raw = vci.dividends("FPT")
        report["vci.dividends_raw[FPT]"] = {"shape": list(raw.shape), "cols": list(raw.columns),
                                            "rows": raw.head(4).to_dict("records")}
        par = vci.parse_dividends("FPT", raw)
        report["vci.dividends[FPT]"] = par.tail(8).to_dict("records")
        print("OK   vci.dividends", raw.shape, len(par), flush=True)
    except Exception as e:  # noqa: BLE001
        report["vci.dividends[FPT]"] = {"ok": False, "error": str(e)[:400]}
        print("FAIL vci.dividends", e, flush=True)
    _try("vci.snapshot", lambda: vci.snapshot(["FPT", "VCB", "HPG"]), report)
    for sym in ("FPT", "VCB"):
        try:
            reps = {k: kbs.finance(sym, k, True) for k in ("IS", "BS", "CF")}
            r0 = reps["IS"]
            info = {"ok": True, "head": (r0.get("Head") or [])[:4],
                    "content_keys": {k: list((v.get("Content") or {}).keys()) for k, v in reps.items()},
                    "is_items": [(x.get("Name"), x.get("NameEn"), x.get("Value1")) for v in (r0.get("Content") or {}).values() for x in v][:40],
                    "normalized": _summary(normalize.normalize_kbs(sym, list(reps.values()), True))}
            report[f"kbs.fin[{sym}]"] = info
            print("OK   kbs.fin", sym, json.dumps(info["normalized"].get("annual", [])[-1:], default=str)[:300], flush=True)
        except Exception as e:  # noqa: BLE001
            report[f"kbs.fin[{sym}]"] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:500]}
            print("FAIL kbs.fin", sym, e, flush=True)
        _save(report)
    _try("kbs.prices[FPT]", lambda: kbs.prices("FPT", 40), report)
    _try("kbs.prices[VNINDEX]", lambda: kbs.prices("VNINDEX", 40, is_index=True), report)
    _try("yahoo.prices[FPT]", lambda: yahoo.prices("FPT", 1), report)
