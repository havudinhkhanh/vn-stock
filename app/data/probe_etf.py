"""Dò nguồn ETF + rổ chỉ số (chạy: python run.py probe etf) – ghi probe_out/probe_report.json."""
from __future__ import annotations

import json
import traceback
from collections import Counter
from datetime import datetime, timedelta

from ..config import DATA_DIR
from . import vci
from .http import get, post

REPORT: dict = {}


def _save():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "probe_report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def _try(name, fn):
    try:
        REPORT[name] = {"ok": True, "v": fn()}
        print("OK  ", name, str(REPORT[name]["v"])[:300], flush=True)
    except Exception as e:  # noqa: BLE001
        REPORT[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:500], "trace": traceback.format_exc()[-600:]}
        print("FAIL", name, REPORT[name]["error"][:200], flush=True)
    _save()


def run() -> dict:
    REPORT["at"] = datetime.now().isoformat()
    raw = []

    def all_syms():
        nonlocal raw
        for base in (vci.TRADING, vci.MT):
            try:
                raw = get("VCI", base + "price/symbols/getAll")
                break
            except Exception:  # noqa: BLE001
                continue
        types = Counter(str(x.get("type")) for x in raw)
        etf = [x for x in raw if str(x.get("type", "")).upper() in ("ETF", "FUND", "FU", "IFC") or str(x.get("symbol", "")).startswith(("FUE", "E1V"))]
        return {"n": len(raw), "types": dict(types), "keys": list(raw[0].keys()) if raw else [], "etf": etf[:60]}
    _try("getAll", all_syms)

    groups = ["VN30", "VN100", "VNMidCap", "VNSmallCap", "VNAllShare", "HNX30", "ETF", "VNDiamond", "VNFinLead", "VNFinSelect", "VNX50",
              "VNSI", "HNXCon", "HNXFin", "HNXLCap", "HNXMSCap", "HNXMan", "VNIT", "VNREAL", "VNFIN", "VNMAT", "VNIND", "VNCONS", "VNENE"]
    for g in groups:
        def f(g=g):
            r = get("VCI", vci.TRADING + f"price/symbols/getByGroup?group={g}")
            if isinstance(r, list):
                return {"n": len(r), "sample": r[:3], "syms": [x.get("symbol") for x in r][:120]}
            return {"raw": str(r)[:400]}
        _try(f"group:{g}", f)

    end = datetime.now() + timedelta(days=1)
    start = end - timedelta(days=400)
    idx_codes = ["VN100", "VNMID", "VNMIDCAP", "VNSML", "VNSMALLCAP", "VNALL", "VNALLSHARE", "VNDIAMOND", "VNFINLEAD", "VNFINSELECT", "VNX50", "VNXALL",
                 "VNSI", "HNX30", "HNX30INDEX", "VN30F1M", "VNIT", "VNREAL", "VNFIN", "VNMAT", "VNIND", "VNCONS", "VNENE", "VNHEAL", "VNUTI", "VNCOND", "VNX200"]
    for c in idx_codes:
        def f(c=c):
            d = vci._chart([c], start, end)
            return {k: {"n": len(v), "first": str(v["date"].iloc[0].date()), "last": str(v["date"].iloc[-1].date()), "close": float(v["close"].iloc[-1])} for k, v in d.items()}
        _try(f"chart:{c}", f)

    etfs = ["E1VFVN30", "FUEVFVND", "FUESSVFL", "FUEVN100", "FUESSV30", "FUEKIV30", "FUEDCMID", "FUEMAV30", "FUESSV50", "FUEFCV50", "FUEIP100",
            "FUEKIVFS", "FUEKIVND", "FUEMAVND", "FUEBFVND", "FUEABVND", "FUETCC50", "FUEDCVND"]
    try:
        etfs = sorted(set(etfs) | {x["symbol"] for x in (REPORT.get("getAll", {}).get("v") or {}).get("etf", []) if x.get("symbol")})
    except Exception:  # noqa: BLE001
        pass

    def etf_chart():
        out = {}
        for i in range(0, len(etfs), 10):
            d = vci._chart(etfs[i:i + 10], start - timedelta(days=4000), end)
            for k, v in d.items():
                out[k] = {"n": len(v), "first": str(v["date"].iloc[0].date()), "close": float(v["close"].iloc[-1]), "vol": float(v["volume"].iloc[-20:].mean())}
        return out
    _try("chart:etf", etf_chart)

    # thông tin quỹ (Fmarket / Vietcap) – thử vài địa chỉ hay dùng
    for nm, url in (("iq:etf-info", vci.IQ + "/v1/company/E1VFVN30"), ("mt:fund", vci.MT + "price/symbols/getList?symbols=E1VFVN30,FUEVFVND")):
        _try(nm, lambda url=url: str(get("VCI", url))[:1500])

    def snap():
        r = post("VCI", vci.TRADING + "price/symbols/getList", {"symbols": ["E1VFVN30", "FUEVFVND", "FUESSVFL"]})
        return str(r)[:2500]
    _try("snapshot:etf", snap)
    _save()
    return REPORT
