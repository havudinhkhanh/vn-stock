"""Dò BCTC (chạy: python run.py probe fin): tên chỉ tiêu gốc của KBS & Vietcap cho vài mã, chỉ tiêu nào khớp được,
và kết quả chuẩn hoá – để sửa bộ đối chiếu khi nguồn đổi tên / cấu trúc."""
from __future__ import annotations

import json
import traceback
from datetime import datetime

from ..config import DATA_DIR
from . import kbs, normalize, vci

REPORT: dict = {}
SYMS = ("PVT", "FPT", "VCB", "SSI", "BVH", "HPG")
KEY = ["revenue", "gross_profit", "pbt", "tax", "net_income", "ni_parent", "total_assets", "total_liab", "equity", "minority",
       "cash", "st_debt", "lt_debt", "cfo", "capex", "cfi", "cff", "shares", "pe_src", "nii", "toi"]


def _save():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "probe_report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def _try(name, fn):
    try:
        REPORT[name] = {"ok": True, "v": fn()}
        print("OK  ", name, json.dumps(REPORT[name]["v"], ensure_ascii=False, default=str)[:600], flush=True)
    except Exception as e:  # noqa: BLE001
        REPORT[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:600], "trace": traceback.format_exc()[-900:]}
        print("FAIL", name, REPORT[name]["error"][:300], flush=True)
    _save()


def _latest(df):
    if df is None or df.empty:
        return {}
    d = df.sort_values(["year", "quarter"]).iloc[-1]
    return {"period": f"{d['year']}Q{d['quarter']}", **{k: (None if k not in d or d[k] != d[k] else round(float(d[k]), 2)) for k in KEY}}


def kbs_one(sym):
    out = {}
    for yearly in (False, True):
        reps = []
        for kind in ("IS", "BS", "CF"):
            r = kbs.finance(sym, kind, yearly, periods=4)
            reps.append(r)
            content = r.get("Content") or {}
            recs = [x for v in content.values() if isinstance(v, list) for x in v]
            items = [{"key": i, "en": x.get("NameEn"), "vi": x.get("Name")} for i, x in enumerate(recs)]
            fm = normalize.match_items(items)
            out[f"{'Y' if yearly else 'Q'}:{kind}:head"] = [{k: h.get(k) for k in ("ID", "YearPeriod", "TermName", "TermCode", "ReportDate")} for h in (r.get("Head") or [])][:4]
            out[f"{'Y' if yearly else 'Q'}:{kind}:keys"] = list(content.keys())
            out[f"{'Y' if yearly else 'Q'}:{kind}:items"] = [[i, x.get("Name"), x.get("NameEn"), fm.get(i), x.get("Value1")] for i, x in enumerate(recs)][:160]
            out[f"{'Y' if yearly else 'Q'}:{kind}:rec0"] = {k: v for k, v in (recs[0] if recs else {}).items()}
        df = normalize.normalize_kbs(sym, reps, yearly)
        out[f"{'Y' if yearly else 'Q'}:norm"] = _latest(normalize.finalize(df.copy())) if not df.empty else {}
    return out


def vci_one(sym):
    m = vci.metrics(sym, "CT_" + sym)
    st = {sec: vci.statement(sym, sec) for sec in ("IS", "BS", "CF")}
    try:
        rt = vci.ratios(sym)
    except Exception as e:  # noqa: BLE001
        rt = None
        print("ratios lỗi", e)
    df = normalize.normalize_iq(sym, st, m, rt)
    return {"metrics_n": len(m), "sections": sorted(m["section"].unique().tolist()) if not m.empty else [],
            "q_cols": {k: [len(v["quarters"]), list(v["quarters"].columns)[:12]] for k, v in st.items()},
            "ratios_cols": list(rt.columns)[:40] if rt is not None else None,
            "norm": _latest(normalize.finalize(df.copy())) if not df.empty else {}}


def run() -> dict:
    REPORT["at"] = datetime.now().isoformat()
    for s in SYMS:
        _try(f"vci:{s}", lambda s=s: vci_one(s))
        _try(f"kbs:{s}", lambda s=s: kbs_one(s))
    _save()
    return REPORT
