"""Kiểm tra nhanh từng nguồn dữ liệu còn hoạt động không (chạy: python run.py probe)."""
from __future__ import annotations

import json
import time
import traceback
from datetime import datetime, timedelta

from ..config import DATA_DIR
from . import normalize, tcbs, vci, yahoo


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


def _run(report: dict) -> None:
    start = datetime.now() - timedelta(days=30)
    _try("vci.listing", vci.listing, report)
    _try("vci.prices[FPT,VCB,VNINDEX]",
         lambda: __import__("pandas").concat(
             [d.assign(symbol=s) for s, d in vci.prices(["FPT", "VCB", "VNINDEX"], start).items()]),
         report)
    _try("vci.ratio_dictionary", vci.ratio_dictionary, report)
    for sym, ct in (("FPT", "CT"), ("VCB", "NH"), ("SSI", "CK")):
        _try(f"vci.financial_raw[{sym},Q]", lambda s=sym: vci.financial_raw(s, "Q"), report)
        try:
            mp = vci.ratio_dictionary()
            fmap = normalize.build_vci_map(mp, ct)
            names = dict(zip(mp["fieldName"], mp["en_Name"]))
            report[f"vci.map[{ct}]"] = {k: f"{v} <- {names.get(k)}" for k, v in fmap.items()}
            raw = vci.financial_raw(sym, "Y")
            _try(f"vci.normalized[{sym},Y]",
                 lambda: normalize.finalize(normalize.normalize_vci(sym, raw, mp, ct, True)), report)
        except Exception as e:  # noqa: BLE001
            report[f"vci.map[{ct}]"] = str(e)
    _try("vci.snapshot", lambda: vci.snapshot(["FPT", "VCB", "HPG"]), report)
    _try("tcbs.prices[FPT]", lambda: tcbs.prices("FPT", 30), report)
    _try("tcbs.prices[VNINDEX]", lambda: tcbs.prices("VNINDEX", 30, is_index=True), report)
    for kind in ("incomestatement", "balancesheet", "cashflow", "financialratio"):
        _try(f"tcbs.{kind}[FPT]", lambda k=kind: tcbs.statement("FPT", k, False), report)
    _try("tcbs.dividends[FPT]", lambda: tcbs.dividends("FPT"), report)
    _try("tcbs.overview[FPT]", lambda: tcbs.overview("FPT"), report)
    _try("yahoo.prices[FPT]", lambda: yahoo.prices("FPT", 1), report)
    _try("yahoo.prices[VNINDEX]", lambda: yahoo.prices("VNINDEX", 1), report)

