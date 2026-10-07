"""Order Flow / Footprint từ dữ liệu khớp lệnh theo bước giá của phiên (mua chủ động vs bán chủ động).

- Delta = KL mua chủ động − KL bán chủ động; Delta% = Delta / (mua + bán).
- POC (Point of Control): mức giá khớp nhiều nhất phiên. Value Area: vùng giá chứa 70% khối lượng.
- CVD (Cumulative Volume Delta) qua các phiên: so với giá để tìm phân kỳ
  (giá tăng nhưng CVD giảm = tăng thiếu lực mua thật; giá giảm nhưng CVD tăng = có người gom).
- Imbalance theo bước giá: mức giá có mua chủ động ≥ 3 lần bán (hoặc ngược lại).

Lưu ý: dữ liệu miễn phí chỉ có từ ngày hệ thống bắt đầu lưu (không tải được lịch sử cũ),
và không có sổ lệnh (DOM) sau giờ giao dịch.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def session_stats(fp: pd.DataFrame) -> dict:
    fp = fp[fp["vol"] > 0].sort_values("price")
    if fp.empty:
        return {}
    tot = float(fp["vol"].sum())
    buy, sell, und = float(fp["buy"].sum()), float(fp["sell"].sum()), float(fp["undef"].sum())
    poc_i = int(fp["vol"].values.argmax())
    poc = float(fp["price"].iloc[poc_i])
    # value area 70% mở rộng từ POC
    v = fp["vol"].values
    lo = hi = poc_i
    acc = v[poc_i]
    while acc < 0.7 * tot and (lo > 0 or hi < len(v) - 1):
        left = v[lo - 1] if lo > 0 else -1
        right = v[hi + 1] if hi < len(v) - 1 else -1
        if right >= left:
            hi += 1
            acc += v[hi]
        else:
            lo -= 1
            acc += v[lo]
    vwap = float((fp["price"] * fp["vol"]).sum() / tot)
    imb_buy = fp[(fp["buy"] >= 3 * fp["sell"].clip(lower=1)) & (fp["vol"] >= 0.03 * tot)]["price"].tolist()
    imb_sell = fp[(fp["sell"] >= 3 * fp["buy"].clip(lower=1)) & (fp["vol"] >= 0.03 * tot)]["price"].tolist()
    return {"buy": buy, "sell": sell, "undef": und, "delta": buy - sell,
            "delta_pct": (buy - sell) / (buy + sell) if (buy + sell) else 0.0,
            "poc": poc, "val": float(fp["price"].iloc[lo]), "vah": float(fp["price"].iloc[hi]), "vwap": vwap,
            "imb_buy": imb_buy[:6], "imb_sell": imb_sell[:6]}


def analyze(daily: pd.DataFrame | None, fp_latest: pd.DataFrame | None, close: pd.Series) -> dict:
    """daily: các dòng orderflow của 1 mã (date, buy, sell, delta, delta_pct, poc, val, vah, vwap)."""
    out = {"ok": False, "days": 0}
    if fp_latest is not None and not fp_latest.empty:
        st = session_stats(fp_latest)
        out["latest"] = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in st.items()}
        out["footprint"] = fp_latest.sort_values("price")[["price", "buy", "sell", "undef"]].round(2).to_dict("records")
        out["ok"] = True
    if daily is not None and not daily.empty:
        d = daily.sort_values("date").tail(60).copy()
        d["cvd"] = d["delta"].cumsum()
        out["days"] = int(len(d))
        out["history"] = [{"d": str(pd.Timestamp(r.date).date()), "delta": float(r.delta), "dp": round(float(r.delta_pct), 3),
                           "cvd": float(r.cvd), "poc": float(r.poc)} for r in d.itertuples()]
        last5 = d.tail(5)
        out["delta5_pct"] = round(float(last5["delta"].sum() / (last5["buy"] + last5["sell"]).sum()), 3) \
            if (last5["buy"] + last5["sell"]).sum() else None
        div = None
        if len(d) >= 8:
            px = close.reindex(pd.to_datetime(d["date"])).ffill()
            dp = px.iloc[-1] / px.iloc[-8] - 1 if px.iloc[-8] else 0
            dc = d["cvd"].iloc[-1] - d["cvd"].iloc[-8]
            if dp > 0.03 and dc < 0:
                div = "Giá tăng nhưng CVD giảm – lực mua chủ động yếu, cẩn trọng"
            elif dp < -0.03 and dc > 0:
                div = "Giá giảm nhưng CVD tăng – có lực mua chủ động đỡ giá (gom)"
        out["divergence"] = div
        out["ok"] = True
    # thiên hướng
    b = 0.0
    if out.get("delta5_pct") is not None:
        b += float(np.tanh(out["delta5_pct"] * 6)) * 0.6
    elif out.get("latest"):
        b += float(np.tanh(out["latest"]["delta_pct"] * 6)) * 0.4
    if out.get("latest") and len(close):
        last = float(close.iloc[-1])
        b += 0.2 if last > out["latest"]["vah"] else (-0.2 if last < out["latest"]["val"] else 0)
    if out.get("divergence"):
        b += 0.3 if "gom" in out["divergence"] else -0.3
    out["bias"] = round(float(np.clip(b, -1, 1)), 2)
    return out
