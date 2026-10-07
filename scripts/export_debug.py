"""Xuất bản dữ liệu thật thu gọn (BCTC + giá ~80 mã lớn) để kiểm tra/sửa lỗi ngoài GitHub."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.data import store  # noqa: E402

out = Path("data/debug")
out.mkdir(parents=True, exist_ok=True)
for name in ("fin_q", "fin_y", "listing", "dividends", "shares_now", "adjust_events", "div_meta"):
    df = store.read(name)
    if not df.empty:
        df.to_parquet(out / f"{name}.parquet", index=False)
pr = store.read("prices")
if not pr.empty:
    pr["date"] = pd.to_datetime(pr["date"])
    rec = pr[pr["date"] >= pr["date"].max() - pd.Timedelta(days=45)]
    val = (rec["close"] * rec["volume"]).groupby(rec["symbol"]).mean().sort_values(ascending=False)
    fin_syms = set(store.read("fin_q")["symbol"].unique()) if not store.read("fin_q").empty else set()
    keep = set(val.index[:90]) | {"VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"} | fin_syms
    sub = pr[pr["symbol"].isin(keep)][["symbol", "date", "close", "volume", "high", "low", "open"]]
    sub = sub.astype({"close": "float32", "high": "float32", "low": "float32", "open": "float32", "volume": "float64"})
    sub.to_parquet(out / "prices_top.parquet", index=False, compression="zstd")
print("exported", sorted(p.name for p in out.iterdir()))
