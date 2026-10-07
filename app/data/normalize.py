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


# ------------------------------------------------------------------ VCI
# (chỉ tiêu chuẩn, mẫu tên tiếng Anh, mẫu loại trừ)
_VCI_RULES = [
    ("revenue", r"^net (sales|revenue)$|^revenue$|^net operating revenue", r"growth|yoy|deduction"),
    ("cogs", r"^cost of (goods )?sold|^cost of sales", r""),
    ("gross_profit", r"^gross (profit|margin)$", r"%"),
    ("selling_exp", r"^selling expenses", r""),
    ("admin_exp", r"^general (&|and) admin", r""),
    ("fin_income", r"^financial (income|revenue)", r""),
    ("fin_exp", r"^financial expenses", r""),
    ("interest_exp", r"interest expenses", r"of which.*income|loans"),
    ("operating_profit", r"^operating profit|^net operating profit|^profit from business activities", r""),
    ("pbt", r"^profit before tax|^accounting profit before tax", r""),
    ("tax", r"business income tax( -)? current|^corporate income tax", r"deferred"),
    ("net_income", r"^net profit for the (year|period)|^net profit after tax", r"parent|minority"),
    ("ni_parent", r"attribut\w* to (the )?parent|parent company", r""),
    ("nii", r"^net interest income", r""),
    ("toi", r"^total operating income", r""),
    ("provision", r"provision for credit losses|^provision expenses", r""),
    ("total_assets", r"^total assets", r""),
    ("current_assets", r"^current assets|^short-term assets", r"other"),
    ("cash", r"^cash and cash equivalents", r""),
    ("st_invest", r"^short-term (financial )?investments", r""),
    ("receivables", r"^(short-term )?accounts receivable$|^short-term receivables", r""),
    ("inventory", r"^inventor(y|ies)", r"provision|allowance"),
    ("fixed_assets", r"^fixed assets", r""),
    ("total_liab", r"^liabilities$|^total liabilities", r""),
    ("current_liab", r"^current liabilities|^short-term liabilities", r""),
    ("st_debt", r"^short-term borrowings", r""),
    ("lt_debt", r"^long-term borrowings", r""),
    ("equity", r"^owner'?s'? equity|^total equity|^capital and reserves", r"other"),
    ("minority", r"^minority interest", r"profit|income"),
    ("loans", r"^loans (and advances )?to customers", r"provision|net"),
    ("deposits", r"^deposits from customers", r""),
    ("cfo", r"net cash (inflows?/outflows?|flows?) from operating", r""),
    ("capex", r"^purchase of fixed assets|^acquisition of fixed assets", r""),
    ("dividends_paid", r"^dividends paid", r""),
    ("cfi", r"net cash (inflows?/outflows?|flows?) from investing", r""),
    ("cff", r"net cash (inflows?/outflows?|flows?) from financing", r""),
]

_VCI_TOP = {"revenue": "revenue_top", "netProfit": "ni_top", "roe": "roe_src", "pe": "pe_src",
            "pb": "pb_src", "eps": "eps", "bvps": "bvps", "ev": "ev_src", "ebitda": "ebitda",
            "ebit": "ebit", "issueShare": "shares_raw", "dividend": "dividend_src",
            "epsTTM": "eps_ttm_src"}


def _clean(name: str) -> str:
    name = (name or "").lower()
    name = re.sub(r"\(.*?\)", "", name)
    return re.sub(r"\s+", " ", name).strip(" .:-")


def build_vci_map(mapping: pd.DataFrame, ctype: str) -> dict[str, str]:
    """Trả về {mã trường VCI -> chỉ tiêu chuẩn} cho loại doanh nghiệp ctype."""
    m = mapping.copy()
    m["clean"] = m["en_Name"].map(_clean)
    m["pri"] = np.where(m["comTypeCode"] == ctype, 0, np.where(m["comTypeCode"] == "CT", 1, 2))
    m = m[m["pri"] < 2].sort_values(["pri", "order"])
    res: dict[str, str] = {}
    used = set()
    for canon, pat, excl in _VCI_RULES:
        for _, row in m.iterrows():
            if row["fieldName"] in res:
                continue
            c = row["clean"]
            if re.search(pat, c) and not (excl and re.search(excl, c)):
                res[row["fieldName"]] = canon
                used.add(canon)
                break
    return res


def normalize_vci(symbol: str, raw: pd.DataFrame, mapping: pd.DataFrame, ctype: str,
                  yearly: bool) -> pd.DataFrame:
    if raw is None or raw.empty:
        return pd.DataFrame()
    fmap = build_vci_map(mapping, ctype)
    out = pd.DataFrame({
        "year": pd.to_numeric(raw["yearReport"], errors="coerce").astype("Int64"),
        "quarter": 0 if yearly else pd.to_numeric(raw["lengthReport"], errors="coerce").astype("Int64"),
    })
    for field, canon in fmap.items():
        if field in raw.columns and canon not in out:
            out[canon] = pd.to_numeric(raw[field], errors="coerce")
    for field, canon in _VCI_TOP.items():
        if field in raw.columns:
            out[canon] = pd.to_numeric(raw[field], errors="coerce")
    # Đơn vị: VCI trả theo đồng -> tỷ đồng
    money = [c for c in CANON if c in out and c not in
             ("shares", "eps", "bvps", "roe_src", "pe_src", "pb_src")] + \
            [c for c in ("revenue_top", "ni_top") if c in out]
    ref = out.get("total_assets", out.get("revenue_top"))
    if ref is not None and ref.abs().median() > 1e6:
        out[money] = out[money] / 1e9
    if "revenue" not in out and "revenue_top" in out:
        out["revenue"] = out["revenue_top"]
    if "ni_parent" not in out and "ni_top" in out:
        out["ni_parent"] = out["ni_top"]
    for c in ("cogs", "selling_exp", "admin_exp", "fin_exp", "interest_exp", "tax", "provision"):
        if c in out:
            out[c] = out[c].abs()
    for c in ("capex", "dividends_paid"):
        if c in out:
            out[c] = -out[c].abs()
    if "shares_raw" in out:
        s = out.pop("shares_raw")
        out["shares"] = np.where(s > 1e5, s / 1e6, s)  # về triệu cổ phiếu
    out.insert(0, "symbol", symbol)
    out["source"] = "VCI"
    return out.dropna(subset=["year"]).drop_duplicates(["year", "quarter"])


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
