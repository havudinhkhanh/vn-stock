"""Nguồn KBS (KB Securities) – dự phòng cho báo cáo tài chính và giá."""
from __future__ import annotations

from datetime import datetime, timedelta

import pandas as pd

from .http import FetchError, get

IIS = "https://kbbuddywts.kbsec.com.vn/iis-server/investment"
REPORTS = {"IS": "KQKD", "BS": "CDKT", "CF": "LCTT"}


def finance(symbol: str, kind: str, yearly: bool, periods: int = 8) -> dict:
    """kind: IS | BS | CF. Trả về response gốc (Head, Content)."""
    term = 1 if yearly else 2
    params = {"page": 1, "pageSize": periods, "type": REPORTS[kind], "unit": 1000, "termtype": term}
    if kind == "CF":
        params.update({"code": symbol, "termType": term})
    else:
        params["languageid"] = 1
    data = get("KBS", f"{IIS}/stock/finance-info/{symbol}", params=params)
    if not data or not (data.get("Content") or {}):
        raise FetchError(f"KBS {kind} {symbol}: rỗng")
    return data


def prices(symbol: str, days: int = 4000, is_index: bool = False) -> pd.DataFrame:
    end = datetime.now()
    start = end - timedelta(days=days)
    kind = "index" if is_index else "stocks"
    data = get("KBS", f"{IIS}/{kind}/{symbol}/data_day",
               params={"sdate": start.strftime("%d-%m-%Y"), "edate": end.strftime("%d-%m-%Y")})
    rows = data.get("data_day") if isinstance(data, dict) else data
    if not rows:
        raise FetchError(f"KBS prices {symbol}: rỗng")
    df = pd.DataFrame(rows)
    ren = {"t": "date", "o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"}
    df = df.rename(columns=ren)
    if not {"date", "close"} <= set(df.columns):
        raise FetchError(f"KBS prices {symbol}: cột lạ {list(df.columns)[:10]}")
    df["date"] = pd.to_datetime(df["date"], errors="coerce").dt.normalize()
    df = df[["date", "open", "high", "low", "close", "volume"]].dropna(subset=["date", "close"])
    if not is_index and df["close"].median() > 300:
        df[["open", "high", "low", "close"]] /= 1000.0
    return df.sort_values("date")
