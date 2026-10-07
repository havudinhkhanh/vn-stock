"""Nguồn TCBS (Techcombank Securities) — API công khai của tcinvest.

Dùng làm nguồn chính cho BCTC (số liệu gọn, đơn vị tỷ đồng) và cổ tức,
nguồn dự phòng cho giá.
"""
from __future__ import annotations

from datetime import datetime

import pandas as pd

from .http import FetchError, get

BASE = "https://apipubaws.tcbs.com.vn"


def prices(symbol: str, count_back: int = 2600, is_index: bool = False) -> pd.DataFrame:
    to = int(datetime.now().timestamp())
    url = f"{BASE}/stock-insight/v2/stock/bars-long-term"
    params = {"resolution": "D", "ticker": symbol, "type": "index" if is_index else "stock",
              "to": to, "countBack": count_back}
    data = get("TCBS", url, params=params).get("data") or []
    if not data:
        raise FetchError(f"TCBS prices {symbol}: rỗng")
    df = pd.DataFrame(data)
    df["date"] = pd.to_datetime(df["tradingDate"].astype(str).str[:10])
    df = df[["date", "open", "high", "low", "close", "volume"]].copy()
    if not is_index:
        df[["open", "high", "low", "close"]] /= 1000.0  # đồng -> nghìn đồng
    return df


def statement(symbol: str, kind: str, yearly: bool) -> pd.DataFrame:
    """kind: incomestatement | balancesheet | cashflow | financialratio"""
    url = f"{BASE}/tcanalysis/v1/finance/{symbol}/{kind}"
    data = get("TCBS", url, params={"yearly": 1 if yearly else 0, "isAll": "true"})
    df = pd.DataFrame(data or [])
    if df.empty:
        raise FetchError(f"TCBS {kind} {symbol}: rỗng")
    return df


def dividends(symbol: str) -> pd.DataFrame:
    url = f"{BASE}/tcanalysis/v1/company/{symbol}/dividend-payment-histories"
    data = get("TCBS", url, params={"page": 0, "size": 60})
    rows = (data or {}).get("listDividendPaymentHis") or []
    df = pd.DataFrame(rows)
    if df.empty:
        return pd.DataFrame(columns=["symbol", "ex_date", "year", "cash_pct", "method"])
    df["ex_date"] = pd.to_datetime(df["exerciseDate"], format="%d/%m/%y", errors="coerce")
    out = pd.DataFrame({
        "symbol": symbol,
        "ex_date": df["ex_date"],
        "year": pd.to_numeric(df.get("cashYear"), errors="coerce"),
        "cash_pct": pd.to_numeric(df.get("cashDividendPercentage"), errors="coerce"),
        "method": df.get("issueMethod", "cash").astype(str).str.lower(),
    })
    return out


def overview(symbol: str) -> dict:
    return get("TCBS", f"{BASE}/tcanalysis/v1/ticker/{symbol}/overview") or {}
