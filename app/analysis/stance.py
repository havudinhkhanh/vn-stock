"""Đèn thị trường theo thời gian (dựng lại từng ngày, chỉ dùng số liệu đã có tại ngày đó) và kiểm chứng:
sau mỗi màu đèn, VN-Index và cổ phiếu thanh khoản đi đâu 20 / 60 / 120 phiên sau; sụt sâu nhất trong 60 phiên.
Dùng để trả lời "nên đứng ngoài hay vào" bằng số liệu, không bằng cảm giác."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import market as mk


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def history(idx: pd.DataFrame, C: pd.DataFrame, V: pd.DataFrame) -> pd.DataFrame:
    c, v = idx["close"], idx["volume"]
    s50, s200 = c.rolling(50).mean(), c.rolling(200).mean()
    hi52 = c.rolling(250, min_periods=120).max()
    dist = ((c.pct_change() < -0.002) & (v > v.shift())).astype(float).rolling(25).sum()
    C = C.reindex(c.index)
    val = (C * V.reindex(c.index) / 1e6).rolling(20, min_periods=10).mean()
    liq = val >= 3
    m50, m200 = C.rolling(50, min_periods=40).mean(), C.rolling(200, min_periods=150).mean()
    b50 = 100 * ((C > m50) & liq).sum(axis=1) / (m50.notna() & liq).sum(axis=1).replace(0, np.nan)
    b200 = 100 * ((C > m200) & liq).sum(axis=1) / (m200.notna() & liq).sum(axis=1).replace(0, np.nan)
    score = ((c > s200).astype(int) + (c > s50).astype(int) + (s50 > s200).astype(int) + (b50 > 50).astype(int)
             + (b200 > 50).astype(int) + (dist < 5).astype(int) + (c / hi52 - 1 > -0.15).astype(int))
    light = pd.Series(np.where(score >= 5, "green", np.where(score >= 3, "yellow", "red")), index=c.index)
    lr = np.log(C.where(C > 0) / C.shift(1).where(C.shift(1) > 0))
    ew = lr.where(liq.shift(1, fill_value=False) & (lr.abs() < 0.2)).mean(axis=1)    # bình quân cổ phiếu thanh khoản (log)
    H = pd.DataFrame({"score": score, "light": light, "b50": b50, "close": c, "ew": ew.fillna(0).cumsum()})
    return H[H.index >= "2015-06-01"].dropna(subset=["b50"])


def test(H: pd.DataFrame) -> dict:
    c, ew = H["close"], H["ew"]
    out = {"from": str(H.index[0].date()), "to": str(H.index[-1].date()), "lights": {}}
    for k in (20, 60, 120):
        H[f"vn{k}"] = c.shift(-k) / c - 1
        H[f"ew{k}"] = np.exp(ew.shift(-k) - ew) - 1
    fut_min = pd.concat([c.shift(-i) for i in range(1, 61)], axis=1).min(axis=1)
    H["mdd60"] = fut_min / c - 1
    base = H.iloc[::5]
    for lt in ("green", "yellow", "red"):
        g = base[base["light"] == lt]
        if len(g) < 10:
            continue
        out["lights"][lt] = {"days_share": _r(100 * (H["light"] == lt).mean(), 0), "n": int(len(g)),
                             **{f"vn{k}": _r(100 * g[f"vn{k}"].mean(), 1) for k in (20, 60, 120)},
                             **{f"hit{k}": _r(100 * (g[f"vn{k}"] > 0).mean(), 0) for k in (20, 60, 120)},
                             **{f"ew{k}": _r(100 * g[f"ew{k}"].mean(), 1) for k in (20, 60, 120)},
                             "mdd60": _r(100 * g["mdd60"].mean(), 1), "p_dd10": _r(100 * (g["mdd60"] <= -0.10).mean(), 0),
                             "p_dd20": _r(100 * (g["mdd60"] <= -0.20).mean(), 0), "worst60": _r(100 * g["mdd60"].min(), 1)}
    out["all"] = {f"vn{k}": _r(100 * base[f"vn{k}"].mean(), 1) for k in (20, 60, 120)} | {"mdd60": _r(100 * base["mdd60"].mean(), 1),
                                                                                        "p_dd10": _r(100 * (base["mdd60"] <= -0.10).mean(), 0)}
    # đèn Đỏ nhưng đang cải thiện (điểm tăng ≥ 2 so với 20 phiên trước) – có phải lúc bắt đầu vào?
    imp = base[(base["light"] == "red") & (H["score"].diff(10).reindex(base.index) >= 1)]
    if len(imp) >= 10:
        out["red_improving"] = {"n": int(len(imp)), **{f"vn{k}": _r(100 * imp[f"vn{k}"].mean(), 1) for k in (20, 60, 120)},
                                "mdd60": _r(100 * imp["mdd60"].mean(), 1)}
    # chuỗi đèn hiện tại
    L = H["light"]
    run = 1
    for i in range(len(L) - 2, -1, -1):
        if L.iloc[i] != L.iloc[-1]:
            break
        run += 1
    out["now"] = {"light": L.iloc[-1], "score": int(H["score"].iloc[-1]), "days": run, "score_20": int(H["score"].iloc[-21]) if len(H) > 21 else None,
                  "since": str(L.index[-run].date())}
    out["hist"] = {"t": [str(d.date()) for d in H.index[-500:]], "s": [int(x) for x in H["score"].iloc[-500:]]}
    return out


def build(idx: pd.DataFrame, prices: pd.DataFrame) -> dict:
    C = prices.pivot_table(index="date", columns="symbol", values="close").sort_index()
    V = prices.pivot_table(index="date", columns="symbol", values="volume").sort_index()
    return test(history(idx, C, V))


__all__ = ["history", "test", "build", "mk"]
