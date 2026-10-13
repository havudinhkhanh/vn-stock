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
    for q, nm in ((GQL_NEWS, "gql_news"), (GQL_EV, "gql_events"), (GQL_EV2, "gql_events2")):
        tryit(nm, lambda q=q: S.post(vci.GRAPHQL, json={"query": q, "variables": {"ticker": "APG", "lang": "vi"}}, headers=UA, timeout=30))
    for nm, params in (("iq_news_a", {"ticker": "APG", "fromDate": "20220101", "toDate": "20261013", "page": 0, "size": 5}),
                       ("iq_news_b", {"ticker": "APG", "fromDate": "2022-01-01", "toDate": "2026-10-13", "page": 0, "size": 5}),
                       ("iq_news_c", {"ticker": "APG", "fromDate": "2022-01-01T00:00:00", "toDate": "2026-10-13T00:00:00", "page": 0, "size": 5}),
                       ("iq_news_d", {"ticker": "APG", "page": 0, "size": 5, "languageId": 1})):
        tryit(nm, lambda p=params: S.get(vci.IQ + "/v1/news", params=p, headers=UA, timeout=30))
    for nm, url in (("iq_comp_news", vci.IQ + "/v1/company/APG/news-events?page=0&size=5"),
                    ("iq_comp_news2", vci.IQ + "/v1/company/APG/news?page=0&size=5&languageId=1"),
                    ("iq_events", vci.IQ + "/v1/events?ticker=APG&page=0&size=5")):
        tryit(nm, lambda u=url: S.get(u, headers=UA, timeout=30))
    H = {"User-Agent": UA["User-Agent"]}
    tryit("cafef_ajax", lambda: S.get("https://cafef.vn/du-lieu/Ajax/Events_RelatedNews_New.aspx",
                                      params={"symbol": "APG", "floorID": 0, "configID": 0, "PageIndex": 1, "PageSize": 30, "Type": 2}, headers=H, timeout=30))
    tryit("cafef_ajax2", lambda: S.get("https://s.cafef.vn/Ajax/Events_RelatedNews_New.aspx",
                                       params={"symbol": "APG", "floorID": 0, "configID": 0, "PageIndex": 5, "PageSize": 30, "Type": 2}, headers=H, timeout=30))
    tryit("cafef_tag", lambda: S.get("https://cafef.vn/timeline/apg.chn", headers=H, timeout=30))
    tryit("vietstock_news", lambda: S.get("https://finance.vietstock.vn/APG/tin-moi-nhat.htm", headers=H, timeout=30))
    tryit("tcbs_news", lambda: S.get("https://apipubaws.tcbs.com.vn/tcanalysis/v1/news/APG", params={"page": 0, "size": 5}, headers=H, timeout=30))
    tryit("ssi_news", lambda: S.get("https://iboard-api.ssi.com.vn/statistics/company/news", params={"symbol": "APG", "pageSize": 5, "page": 1}, headers=H, timeout=30))
    tryit("fireant_news", lambda: S.get("https://restv2.fireant.vn/posts", params={"symbol": "APG", "type": 1, "offset": 0, "limit": 5}, headers=H, timeout=30))
    return rep
