"""Dò dữ liệu cho trang "Báo cáo doanh nghiệp": ban lãnh đạo, cổ đông, nhân sự, giao dịch nội bộ, chỉ tiêu BCTC chi tiết
(khấu hao, phải trả, thay đổi vốn lưu động). Chạy trên GitHub qua research.yml với script=profile_probe. Kết quả: research_out/profile_probe.json"""
from __future__ import annotations

import json
import os
import traceback

from app.data import vci
from app.data.http import get, post

OUT = {}
os.makedirs("research_out", exist_ok=True)


def save():
    with open("research_out/profile_probe.json", "w", encoding="utf-8") as f:
        json.dump(OUT, f, ensure_ascii=False, indent=1, default=str)


def short(x, n=6000):
    s = json.dumps(x, ensure_ascii=False, default=str)
    return json.loads(s) if len(s) <= n else s[:n]


def tr(name, fn, n=6000):
    try:
        v = fn(); OUT[name] = {"ok": True, "v": short(v, n)}; print("OK  ", name, str(v)[:400], flush=True)
    except Exception as e:  # noqa: BLE001
        OUT[name] = {"ok": False, "err": f"{type(e).__name__}: {e}"[:600], "tb": traceback.format_exc()[-400:]}; print("FAIL", name, OUT[name]["err"][:300], flush=True)
    save()


TC = "https://apipubaws.tcbs.com.vn"
for tk in ("PVS", "FPT"):
    for p in ("ticker/{t}/overview", "company/{t}/key-officers?page=0&size=30", "company/{t}/large-share-holders", "company/{t}/insider-dealing?page=0&size=30",
              "company/{t}/sub-companies?page=0&size=30", "ticker/{t}/stockratio", "company/{t}/overview", "ticker/{t}/events-news?page=0&size=10"):
        tr(f"tcbs:{tk}:{p.split('?')[0]}", lambda p=p, tk=tk: get("TCBS", f"{TC}/tcanalysis/v1/" + p.format(t=tk), timeout=20))
    gq = ("query Q($ticker: String!, $lang: String!) { "
          "CompanyListingInfo(ticker: $ticker) { id issueShare history companyProfile icbName2 icbName3 icbName4 } "
          "OrganizationManagers(ticker: $ticker) { id ticker fullName positionName positionShortName enPositionName updateDate percentage quantity } "
          "OrganizationResignedManagers(ticker: $ticker) { id ticker fullName positionName updateDate percentage quantity } "
          "OrganizationShareHolders(ticker: $ticker) { id ticker ownerFullName ownerCode percentage quantity updateDate } }")
    tr(f"gql:{tk}", lambda tk=tk: post("VCI", vci.GRAPHQL, {"query": gq, "variables": {"ticker": tk, "lang": "vi"}}), 12000)
    for p in ("shareholder", "shareholders", "shareholder-structure", "ownership", "managers", "officers", "board", "insider-transaction", "insider-transactions",
              "major-shareholders", "employees", "profile", "overview", "details"):
        u = f"{vci.IQ}/v1/company/{tk}/{p}" if p != "details" else f"{vci.IQ}/v1/company/details?ticker={tk}"
        tr(f"iq:{tk}:{p}", lambda u=u: get("VCI", u, timeout=20), 4000)
    tr(f"iq:{tk}:events_all", lambda tk=tk: get("VCI_EVENTS", f"{vci.IQ}/v1/events", params={"ticker": tk, "fromDate": "20240101", "toDate": "20261030", "page": 0, "size": 50}, timeout=20), 8000)
# chỉ tiêu BCTC: tên các dòng (để ánh xạ khấu hao, phải trả, thay đổi vốn lưu động…)
def metrics_names():
    m = vci.metrics("PVS", "CT_PVS")
    return {sec: [[r.field, r.en, r.vi, r.level] for r in m[m.section.str.contains(sec)].itertuples()] for sec in ("CASH", "BALANCE", "INCOME")}
tr("metrics:PVS", metrics_names, 60000)
def stm():
    st = {s: vci.statement("PVS", s) for s in ("CF", "BS")}
    return {s: v["quarters"].sort_values(["yearReport", "lengthReport"]).tail(2).to_dict("records") for s, v in st.items()}
tr("stmt:PVS", stm, 60000)
save()
