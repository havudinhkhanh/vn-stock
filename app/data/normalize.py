"""Chuẩn hoá BCTC từ các nguồn khác nhau về một bộ chỉ tiêu chung (đơn vị: tỷ đồng).

Khoá: symbol, year, quarter (quarter = 0 nghĩa là số liệu cả năm).
"""
from __future__ import annotations

import re

import numpy as np
import pandas as pd

CANON = [
    # Kết quả kinh doanh
    "revenue", "cogs", "gross_profit", "selling_exp", "admin_exp", "fin_income", "fin_exp",
    "interest_exp", "operating_profit", "pbt", "tax", "net_income", "ni_parent",
    # Ngân hàng / CTCK
    "nii", "toi", "provision",
    # Cân đối kế toán
    "total_assets", "current_assets", "cash", "st_invest", "receivables", "inventory",
    "fixed_assets", "total_liab", "current_liab", "st_debt", "lt_debt", "equity", "minority",
    "loans", "deposits",
    # Lưu chuyển tiền tệ
    "cfo", "capex", "dividends_paid", "cfi", "cff",
    # Trên mỗi cổ phần / chỉ số nguồn cung cấp
    "shares", "eps", "bvps", "roe_src", "pe_src", "pb_src", "ev_src", "ebitda", "ebit",
]


# ------------------------------------------------------------------ TCBS
_TCBS_IS = {
    "revenue": "revenue", "costOfGoodSold": "cogs", "grossProfit": "gross_profit",
    "operationExpense": "opex", "operationProfit": "operating_profit",
    "interestExpense": "interest_exp", "preTaxProfit": "pbt", "postTaxProfit": "net_income",
    "shareHolderIncome": "ni_parent", "ebitda": "ebitda", "operationIncome": "toi",
    "provisionExpense": "provision", "investProfit": "fin_income",
}
_TCBS_BS = {
    "shortAsset": "current_assets", "cash": "cash", "shortInvest": "st_invest",
    "shortReceivable": "receivables", "inventory": "inventory", "fixedAsset": "fixed_assets",
    "asset": "total_assets", "debt": "total_liab", "shortDebt": "st_debt", "longDebt": "lt_debt",
    "equity": "equity", "minorShareHolderProfit": "minority", "customerLoan": "loans",
    "deposit": "deposits", "payable": "current_liab_part",
}
_TCBS_CF = {"fromSale": "cfo", "investCost": "capex", "fromInvest": "cfi",
            "fromFinancial": "cff"}
_TCBS_RATIO = {"earningPerShare": "eps", "bookValuePerShare": "bvps", "roe": "roe_src",
               "priceToEarning": "pe_src", "priceToBook": "pb_src", "dividend": "div_yield_src",
               "interestMargin": "nim", "badDebtPercentage": "npl"}


def _tcbs_part(df: pd.DataFrame | None, mapping: dict) -> pd.DataFrame:
    if df is None or df.empty:
        return pd.DataFrame(columns=["year", "quarter"])
    keep = {k: v for k, v in mapping.items() if k in df.columns}
    out = df[["year", "quarter"] + list(keep)].rename(columns=keep).copy()
    out["year"] = pd.to_numeric(out["year"], errors="coerce").astype("Int64")
    out["quarter"] = pd.to_numeric(out["quarter"], errors="coerce").fillna(0).astype("Int64")
    out.loc[out["quarter"] > 4, "quarter"] = 0
    return out.dropna(subset=["year"]).drop_duplicates(["year", "quarter"])


def normalize_tcbs(symbol: str, is_df, bs_df, cf_df, ratio_df, yearly: bool) -> pd.DataFrame:
    parts = [_tcbs_part(is_df, _TCBS_IS), _tcbs_part(bs_df, _TCBS_BS),
             _tcbs_part(cf_df, _TCBS_CF), _tcbs_part(ratio_df, _TCBS_RATIO)]
    out = parts[0]
    for p in parts[1:]:
        out = out.merge(p, on=["year", "quarter"], how="outer")
    if yearly:
        out["quarter"] = 0
    # TCBS ghi chi phí âm -> đưa về dương cho dễ đọc
    for c in ("cogs", "opex", "interest_exp", "provision"):
        if c in out:
            out[c] = out[c].abs()
    if "capex" in out:
        out["capex"] = -out["capex"].abs()
    if "opex" in out:
        out["selling_exp"] = np.nan
        out["admin_exp"] = out.pop("opex")
    out.pop("current_liab_part") if "current_liab_part" in out else None
    if "ni_parent" not in out and "net_income" in out:
        out["ni_parent"] = out["net_income"]
    if "eps" in out and "ni_parent" in out:
        pass
    if {"equity", "bvps"} <= set(out):
        out["shares"] = out["equity"] * 1e9 / out["bvps"].replace(0, np.nan) / 1e6
    out.insert(0, "symbol", symbol)
    out["source"] = "TCBS"
    return out


# ------------------------------------------------------------------ nhận diện chỉ tiêu theo tên
# (chỉ tiêu chuẩn, mẫu tên tiếng Anh, mẫu tên tiếng Việt, mẫu loại trừ)  – so khớp trên tên đã làm sạch
RULES = [
    ("revenue", r"^net (sales|revenue)s?$|^revenue$|^net revenue from sales|^net (operating )?revenue$|^net sales from insurance business$",
     r"^doanh thu thuần( về bán hàng và cung cấp dịch vụ| về hoạt động kinh doanh| từ hoạt động kinh doanh bảo hiểm)?$",
     r"growth|tăng trưởng"),
    ("cogs", r"^cost of (goods sold|sales)$", r"^giá vốn hàng bán$", r""),
    ("gross_profit", r"^gross profit$", r"^lợi nhuận gộp( về bán hàng và cung cấp dịch vụ)?$", r""),
    ("selling_exp", r"^selling expenses?$", r"^chi phí bán hàng$", r""),
    ("admin_exp", r"^general (and|&) admin\w* expenses?$", r"^chi phí quản lý doanh nghiệp$", r""),
    ("fin_income", r"^financial (income|revenue)$", r"^doanh thu hoạt động tài chính$", r""),
    ("fin_exp", r"^financial expenses?$", r"^chi phí tài chính$", r""),
    ("interest_exp", r"^(of which,? )?interest expenses?$", r"^(trong đó:? )?chi phí lãi vay$", r""),
    ("operating_profit", r"^(net )?operating profit$|^net profit from operating activities$",
     r"^lợi nhuận thuần từ hoạt động kinh doanh$", r""),
    ("pbt", r"^(total )?(net )?(accounting )?profit before tax$",
     r"^(tổng )?(lợi nhuận|lãi) (thuần |kế toán )?trước thuế$", r""),
    ("tax", r"^(current )?corporate income tax expenses?$|^business income tax.*current$",
     r"^chi phí thuế (thu nhập doanh nghiệp|tndn) hiện hành$", r""),
    ("net_income", r"^(net )?profit after tax$|^net profit for the (year|period)$",
     r"^(lợi nhuận|lãi) (thuần )?sau thuế( thu nhập doanh nghiệp)?$", r"parent|minority|mẹ|không kiểm soát"),
    ("ni_parent", r"attributable to (the )?(shareholders of the )?parent|parent company|attributable to (the )?owners",
     r"(công ty|cổ đông( của)? công ty) mẹ|phân bổ cho chủ sở hữu", r"minority|không kiểm soát|thiểu số"),
    ("nii", r"^net interest income$", r"^thu nhập lãi thuần$", r""),
    ("toi", r"^total operating income$", r"^tổng thu nhập hoạt động$", r""),
    ("provision", r"^(credit )?provision (for credit losses|expenses?)$|^provision for credit losses$",
     r"^(chi phí dự phòng rủi ro tín dụng|trích lập dự phòng tổn thất tín dụng)$", r""),
    ("total_assets", r"^total assets$", r"^tổng (cộng )?tài sản$", r""),
    ("current_assets", r"^(current|short-term) assets$", r"^tài sản ngắn hạn$", r""),
    ("cash", r"^cash and cash equivalents$", r"^tiền và (các khoản )?tương đương tiền$", r""),
    ("st_invest", r"^short-term (financial )?investments$", r"^(các khoản )?đầu tư tài chính ngắn hạn$", r""),
    ("receivables", r"^(short-term )?(accounts )?receivables?$|^short-term receivables$",
     r"^(các khoản )?phải thu ngắn hạn$", r""),
    ("inventory", r"^inventor(y|ies)$", r"^hàng tồn kho$", r""),
    ("fixed_assets", r"^fixed assets$", r"^tài sản cố định$", r""),
    ("total_liab", r"^(total )?liabilities$", r"^(tổng )?nợ phải trả$", r""),
    ("current_liab", r"^(current|short-term) liabilities$", r"^nợ ngắn hạn$", r""),
    ("st_debt", r"^short-term (borrowings|loans)( and finance lease liabilities)?$",
     r"^vay (và nợ thuê tài chính )?ngắn hạn$", r""),
    ("lt_debt", r"^long-term (borrowings|loans)( and finance lease liabilities)?$",
     r"^vay (và nợ thuê tài chính )?dài hạn$", r""),
    ("equity", r"^(total )?(owners?'? |owner's |shareholders'? )?equity$|^capital and reserves$",
     r"^(tổng )?(cộng )?vốn chủ sở hữu$", r""),
    ("minority", r"^(minority interests?|non-controlling interests?)$",
     r"^lợi ích (của )?cổ đông (không kiểm soát|thiểu số)$", r""),
    ("loans", r"^loans (and advances )?to customers$", r"^cho vay khách hàng$", r""),
    ("deposits", r"^deposits from customers$", r"^tiền gửi của khách hàng$", r""),
    ("cfo", r"^net cash.*(from|used in) operating activities$",
     r"^lưu chuyển tiền (tệ )?(thuần|ròng) (từ|sử dụng vào|trong) (các )?hoạt động (sản xuất )?kinh doanh$", r"before"),
    ("capex", r"^(purchases?|acquisitions?) of fixed assets", r"^(tiền chi để )?mua sắm.*tài sản cố định", r""),
    ("dividends_paid", r"^dividends?.*paid", r"^cổ tức.*(đã trả|cho chủ sở hữu)", r""),
    ("cfi", r"^net cash.*(from|used in) investing activities$",
     r"^lưu chuyển tiền (tệ )?(thuần|ròng) (từ|sử dụng vào|trong) (các )?hoạt động đầu tư$", r""),
    ("cff", r"^net cash.*(from|used in) financing activities$",
     r"^lưu chuyển tiền (tệ )?(thuần|ròng) (từ|sử dụng vào|trong) (các )?hoạt động tài chính$", r""),
]

_PREFIX = re.compile(r"^\s*(([a-z]|[ivx]+|\d+(\.\d+)*)\s*[.\-)/:]\s*)+", re.I)


def _clean(name) -> str:
    name = str(name or "").lower().strip()
    name = re.sub(r"\(.*?\)", "", name)          # bỏ "(loss)", "(outflows)", "(Before 2015)"...
    name = name.replace("/", " ").replace("’", "'")
    name = _PREFIX.sub("", name)
    return re.sub(r"\s+", " ", name).strip(" .:-*,")


def match_items(items: list[dict]) -> dict[str, str]:
    """items: [{'key':..., 'en':..., 'vi':...}] theo thứ tự trên báo cáo -> {key: chỉ tiêu chuẩn}."""
    out, used = {}, set()
    cleaned = [(it["key"], _clean(it.get("en")), _clean(it.get("vi"))) for it in items]
    for canon, pen, pvi, excl in RULES:
        for key, en, vi in cleaned:
            if key in out:
                continue
            hit = (en and re.search(pen, en)) or (vi and re.search(pvi, vi))
            if hit and not (excl and (re.search(excl, en) or re.search(excl, vi))):
                out[key] = canon
                used.add(canon)
                break
    return out


MONEY = [c for c in CANON if c not in ("shares", "eps", "bvps", "roe_src", "pe_src", "pb_src")]


def _to_bn(df: pd.DataFrame, div: float | None = None) -> pd.DataFrame:
    """Quy tiền về tỷ đồng. div=None: tự đoán (nguồn trả theo đồng hoặc đã là tỷ)."""
    if div is not None:
        cols = [c for c in MONEY if c in df]
        df[cols] = df[cols] / div
        return df
    ref = None
    for c in ("total_assets", "revenue", "equity"):
        if c in df and df[c].notna().any():
            ref = df[c].abs().median()
            break
    if ref is None:
        return df
    div = 1e9 if ref > 1e8 else (1e6 if ref > 1e5 else 1)
    cols = [c for c in MONEY if c in df]
    df[cols] = df[cols] / div
    return df


def _signs(df: pd.DataFrame) -> pd.DataFrame:
    for c in ("cogs", "selling_exp", "admin_exp", "fin_exp", "interest_exp", "tax", "provision"):
        if c in df:
            df[c] = df[c].abs()
    for c in ("capex", "dividends_paid"):
        if c in df:
            df[c] = -df[c].abs()
    return df


# ------------------------------------------------------------------ Vietcap IQ
def normalize_iq(symbol: str, stmts: dict[str, dict[str, pd.DataFrame]], metrics: pd.DataFrame,
                 ratios: pd.DataFrame | None) -> pd.DataFrame:
    """stmts: {'IS': {'years': df, 'quarters': df}, 'BS': ..., 'CF': ...}"""
    parts = []
    for sec, by in stmts.items():
        m = metrics[metrics["section"].str.contains({"IS": "INCOME", "BS": "BALANCE", "CF": "CASH"}[sec])]
        if m.empty:
            m = metrics
        fmap = match_items([{"key": r.field, "en": r.en, "vi": r.vi} for r in m.itertuples()])
        for kind, df in by.items():
            if df is None or df.empty:
                continue
            ycol = next((c for c in ("yearReport", "year", "fiscalYear") if c in df), None)
            qcol = next((c for c in ("lengthReport", "quarter", "quarterReport") if c in df), None)
            if ycol is None:
                continue
            o = pd.DataFrame({"year": pd.to_numeric(df[ycol], errors="coerce")})
            o["quarter"] = 0 if kind == "years" or qcol is None else pd.to_numeric(df[qcol], errors="coerce")
            for field, canon in fmap.items():
                if field in df and canon not in o:
                    o[canon] = pd.to_numeric(df[field], errors="coerce")
            parts.append(o)
    if not parts:
        return pd.DataFrame()
    out = parts[0]
    for p_ in parts[1:]:
        out = out.merge(p_, on=["year", "quarter"], how="outer", suffixes=("", "_dup"))
        for c in [c for c in out.columns if c.endswith("_dup")]:
            base = c[:-4]
            out[base] = out[base].fillna(out[c]) if base in out else out[c]
            out = out.drop(columns=c)
    out = out.dropna(subset=["year"])
    out.loc[out["quarter"].fillna(0) > 4, "quarter"] = 0
    out = _signs(_to_bn(out))
    # số cổ phiếu & chỉ số từ bảng statistics-financial
    if ratios is not None and not ratios.empty:
        r = ratios.copy()
        ycol = next((c for c in ("year", "yearReport") if c in r), None)
        qcol = next((c for c in ("quarter", "lengthReport") if c in r), None)
        if ycol:
            rr = pd.DataFrame({"year": pd.to_numeric(r[ycol], errors="coerce"),
                               "quarter": pd.to_numeric(r[qcol], errors="coerce").fillna(0) if qcol else 0})
            for src, canon in (("numberOfSharesMktCap", "shares"), ("marketCap", "mcap_src"), ("pe", "pe_src"), ("pb", "pb_src"),
                               ("roe", "roe_src"), ("ebitda", "ebitda"), ("ebit", "ebit"),
                               ("netInterestMargin", "nim"), ("npl", "npl")):
                if src in r:
                    rr[canon] = pd.to_numeric(r[src], errors="coerce")
            if "shares" in rr and rr["shares"].median() > 1e5:
                rr["shares"] = rr["shares"] / 1e6
            for c in ("ebitda", "ebit", "mcap_src"):
                if c in rr and rr[c].abs().median() > 1e8:
                    rr[c] = rr[c] / 1e9
            rr.loc[rr["quarter"] > 4, "quarter"] = 0
            out = out.merge(rr.drop_duplicates(["year", "quarter"]), on=["year", "quarter"], how="left",
                            suffixes=("", "_r"))
            for c in [c for c in out.columns if c.endswith("_r")]:
                out[c[:-2]] = out[c[:-2]].fillna(out[c])
                out = out.drop(columns=c)
    out["year"] = out["year"].astype("Int64")
    out["quarter"] = out["quarter"].fillna(0).astype("Int64")
    out.insert(0, "symbol", symbol)
    out["source"] = "VCI"
    return out.drop_duplicates(["year", "quarter"])


# ------------------------------------------------------------------ KBS
def normalize_kbs(symbol: str, reports: list[dict], yearly: bool) -> pd.DataFrame:
    """reports: các response finance-info (KQKD, CDKT, LCTT) của cùng 1 loại kỳ."""
    frames = []
    for resp in reports:
        if not resp:
            continue
        head = sorted(resp.get("Head") or [], key=lambda h: h.get("ID", 0))
        periods = []
        for h in head:
            y = pd.to_numeric(h.get("YearPeriod"), errors="coerce")
            term = str(h.get("TermName") or "")
            q = 0
            mq = re.search(r"(\d)", term) if ("Quý" in term or "Q" in term) else None
            if mq and not yearly:
                q = int(mq.group(1))
            periods.append((y, q))
        content = resp.get("Content") or {}
        recs = [r for v in content.values() if isinstance(v, list) for r in v]
        items = [{"key": i, "en": r.get("NameEn"), "vi": r.get("Name")} for i, r in enumerate(recs)]
        fmap = match_items(items)
        rows = {}
        for i, canon in fmap.items():
            r = recs[i]
            for j, (y, q) in enumerate(periods, 1):
                v = pd.to_numeric(r.get(f"Value{j}"), errors="coerce")
                rows.setdefault((y, q), {})[canon] = v
        if rows:
            df = pd.DataFrame([{"year": y, "quarter": q, **v} for (y, q), v in rows.items()])
            frames.append(df)
    if not frames:
        return pd.DataFrame()
    out = frames[0]
    for f in frames[1:]:
        out = out.merge(f, on=["year", "quarter"], how="outer")
    out = out.dropna(subset=["year"])
    out = _signs(_to_bn(out, div=1e6))   # KBS (unit=1000) trả theo nghìn đồng -> tỷ đồng
    out["year"] = out["year"].astype("Int64")
    out["quarter"] = out["quarter"].astype("Int64")
    out.insert(0, "symbol", symbol)
    out["source"] = "KBS"
    return out


def finalize(df: pd.DataFrame) -> pd.DataFrame:
    """Bổ sung chỉ tiêu suy ra, đảm bảo đủ cột."""
    if df.empty:
        return df
    for c in CANON:
        if c not in df:
            df[c] = np.nan
    if df["gross_profit"].isna().all() and df["revenue"].notna().any():
        df["gross_profit"] = df["revenue"] - df["cogs"]
    df["ni_parent"] = df["ni_parent"].fillna(df["net_income"])
    df["net_income"] = df["net_income"].fillna(df["ni_parent"])
    df["debt"] = df[["st_debt", "lt_debt"]].sum(axis=1, min_count=1)
    df["fcf"] = df["cfo"] + df["capex"].fillna(0)
    df["year"] = df["year"].astype(int)
    df["quarter"] = df["quarter"].astype(int)
    return df.sort_values(["symbol", "year", "quarter"]).reset_index(drop=True)
