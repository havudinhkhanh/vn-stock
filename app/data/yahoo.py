"""Nguồn dự phòng cuối: Yahoo Finance (chủ yếu mã HOSE, hậu tố .VN)."""
from __future__ import annotations

import pandas as pd

from .http import FetchError, get

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
INDEX = {"VNINDEX": "^VNINDEX.VN"}


def prices(symbol: str, years: int = 10) -> pd.DataFrame:
    ysym = INDEX.get(symbol, f"{symbol}.VN")
    data = get("OTHER", URL.format(sym=ysym),
               params={"range": f"{years}y", "interval": "1d", "events": "div,splits"})
    try:
        res = data["chart"]["result"][0]
        q = res["indicators"]["quote"][0]
        adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose")
    except (KeyError, IndexError, TypeError) as e:
        raise FetchError(f"Yahoo {symbol}: {e}") from e
    df = pd.DataFrame({
        "date": pd.to_datetime(res["timestamp"], unit="s", utc=True)
        .tz_convert("Asia/Ho_Chi_Minh").tz_localize(None).normalize(),
        "open": q["open"], "high": q["high"], "low": q["low"], "close": q["close"],
        "volume": q["volume"],
        "adj": adj if adj is not None else q["close"],
    }).dropna(subset=["close", "adj"])
    f = df["adj"] / df["close"]
    for c in ("open", "high", "low", "close"):
        df[c] = df[c] * f
    df = df.drop(columns="adj")
    if symbol not in INDEX:
        df[["open", "high", "low", "close"]] /= 1000.0  # đồng -> nghìn đồng
    return df
