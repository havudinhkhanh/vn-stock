"""Dò nguồn TIN TỨC LỊCH SỬ theo mã (để mô tả sự kiện giá sập là chuyện gì). Chạy: python run.py probe news"""
from __future__ import annotations

import json
from datetime import datetime

import requests

from ..config import DATA_DIR
from . import vci

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "application/json, text/plain, */*", "Origin": "https://trading.vietcap.com.vn", "Referer": "https://trading.vietcap.com.vn/"}

GQL_NEWS = """query Query($ticker: String!, $lang: String!) {
  News(ticker: $ticker, langCode: $lang) { id organCode ticker newsTitle newsSubTitle newsSourceLink publicDate newsShortContent }
}"""
GQL_EV = """query Query($ticker: String!, $lang: String!) {
  OrganizationEvents(ticker: $ticker) { id organCode ticker eventTitle eventListCode publicDate issueDate recordDate exrightDate }
}"""
GQL_EV2 = """query Query($ticker: String!, $lang: String!) {
  OrganizationEvents(ticker: $ticker) { id ticker eventTitleVi eventDescVi eventListCode publicDate issueDate }
}"""


def run() -> dict:
    rep: dict = {"at": datetime.now().isoformat()}
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    out = DATA_DIR / "probe_report.json"

    def save():
        out.write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    def tryit(k, fn):
        try:
            r = fn()
            body = r.text
            rep[k] = f"{r.status_code} len={len(body)} {body[:1800]}"
        except Exception as e:  # noqa: BLE001
            rep[k] = "ERR " + str(e)[:300]
        print(k, rep[k][:240], flush=True)
        save()

    S = requests.Session()
    for nm, (tk, a, b) in {"iq_apg_2022": ("APG", "20220301", "20220630"), "iq_apg_2026": ("APG", "20251001", "20260615"),
                           "iq_dig_2022": ("DIG", "20220101", "20220630"), "iq_hag_2018": ("HAG", "20180101", "20180601"),
                           "iq_vic_2023": ("VIC", "20230801", "20231110")}.items():
        def f(tk=tk, a=a, b=b):
            r = S.get(vci.IQ + "/v1/news", params={"ticker": tk, "fromDate": a, "toDate": b, "page": 0, "size": 50}, headers=UA, timeout=30)
            j_ = r.json()
            d = (j_.get("data") or {})
            C = d.get("content") or []
            class R:  # noqa: D401
                status_code = r.status_code
                text = json.dumps({"total": d.get("totalElements"), "keys": list(C[0].keys()) if C else [], "first": C[0] if C else None,
                                   "items": [(x.get("publicDate"), x.get("newsTitle"), x.get("newsCategoryCode"), x.get("ticker"), x.get("newsSourceLink")) for x in C]}, ensure_ascii=False)
            return R()
        tryit(nm, f)
    H = {"User-Agent": UA["User-Agent"]}
    for pg_ in (2, 3, 4):
        tryit(f"cafef_p{pg_}", lambda pg_=pg_: S.get("https://cafef.vn/du-lieu/Ajax/Events_RelatedNews_New.aspx",
                                                     params={"symbol": "APG", "floorID": 0, "configID": 0, "PageIndex": pg_, "PageSize": 30, "Type": 2}, headers=H, timeout=30))
    tryit("cafef_hpg_p20", lambda: S.get("https://cafef.vn/du-lieu/Ajax/Events_RelatedNews_New.aspx",
                                          params={"symbol": "HPG", "floorID": 0, "configID": 0, "PageIndex": 20, "PageSize": 30, "Type": 2}, headers=H, timeout=30))
    tryit("cafef_type1", lambda: S.get("https://cafef.vn/du-lieu/Ajax/Events_RelatedNews_New.aspx",
                                        params={"symbol": "APG", "floorID": 0, "configID": 0, "PageIndex": 1, "PageSize": 30, "Type": 1}, headers=H, timeout=30))
    return rep
