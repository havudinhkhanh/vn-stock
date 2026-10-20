"""Dò dữ liệu cho định giá đặc thù (chạy: python run.py probe val): công ty con / liên kết + tỷ lệ sở hữu (SOTP),
giá VinFast (VFS – Nasdaq), tỷ giá, chỉ tiêu EBITDA/EV của hàng không."""
from __future__ import annotations

import json
import traceback
from datetime import datetime

from ..config import DATA_DIR
from . import vci
from .http import get, post

REPORT: dict = {}


def _save():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "probe_report.json").write_text(json.dumps(REPORT, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


def _try(name, fn):
    try:
        v = fn()
        REPORT[name] = {"ok": True, "v": v if isinstance(v, (dict, list)) else str(v)[:4000]}
        print("OK  ", name, str(v)[:300], flush=True)
    except Exception as e:  # noqa: BLE001
        REPORT[name] = {"ok": False, "error": f"{type(e).__name__}: {e}"[:500], "trace": traceback.format_exc()[-500:]}
        print("FAIL", name, REPORT[name]["error"][:200], flush=True)
    _save()


def _short(x, n=3500):
    s = json.dumps(x, ensure_ascii=False, default=str)
    return json.loads(s) if len(s) <= n else s[:n]


def run() -> dict:
    REPORT["at"] = datetime.now().isoformat()
    for tk in ("VIC", "VJC", "MSN"):
        for path in ("subsidiaries", "sub-companies", "subsidiary", "affiliates", "affiliate", "organization-relationship", "shareholder", "shareholders",
                     "ownership", "company-relationship", "related-companies", ""):
            url = f"{vci.IQ}/v1/company/{tk}" + (f"/{path}" if path else "")
            _try(f"iq:{tk}:{path or 'root'}", lambda url=url: _short(get("VCI", url)))
        q = ("query Q($ticker: String!, $lang: String!) { "
             "Subsidiary(ticker: $ticker) { id organCode subOrganCode percentage subOrListingInfo { enOrganName organName } } "
             "Affiliate(ticker: $ticker) { id organCode subOrganCode percentage subOrListingInfo { enOrganName organName } } "
             "OrganizationShareHolders(ticker: $ticker) { id ticker ownerFullName percentage updateDate } }")
        _try(f"gql:{tk}", lambda tk=tk, q=q: _short(post("VCI", vci.GRAPHQL, {"query": q, "variables": {"ticker": tk, "lang": "vi"}})))
        q2 = "query Q($ticker: String!) { CompanyListingInfo(ticker: $ticker) { id issueShare companyProfile icbName3 } }"
        _try(f"gql2:{tk}", lambda tk=tk, q2=q2: _short(post("VCI", vci.GRAPHQL, {"query": q2, "variables": {"ticker": tk}})))
    for sym in ("VFS", "USDVND=X", "JAL", "9201.T", "AAPL"):
        def y(sym=sym):
            d = get("OTHER", f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}", params={"range": "1mo", "interval": "1d"})
            r = d["chart"]["result"][0]
            return {"meta": {k: r["meta"].get(k) for k in ("currency", "regularMarketPrice", "symbol", "exchangeName")}, "n": len(r.get("timestamp") or [])}
        _try(f"yahoo:{sym}", y)
        def yq(sym=sym):
            d = get("OTHER", "https://query1.finance.yahoo.com/v7/finance/quote", params={"symbols": sym})
            return _short(d, 1500)
        _try(f"yahooq:{sym}", yq)
    _try("ratio:VJC", lambda: _short(vci.ratios("VJC").tail(3).to_dict("records")) if hasattr(vci, "ratios") else "no")
    _save()
    return REPORT
