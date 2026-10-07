"""Bức tranh toàn thị trường: đèn Xanh/Vàng/Đỏ, độ rộng thị trường, bản đồ ngành."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ind


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def breadth(wide_close: pd.DataFrame, liquid: list[str]) -> pd.DataFrame:
    """Tỷ lệ mã trên MA50/MA200 và số mã tăng/giảm theo ngày (chỉ mã thanh khoản)."""
    w = wide_close[[s for s in liquid if s in wide_close]].iloc[-400:]
    ma50 = w.rolling(50, min_periods=40).mean()
    ma200 = w.rolling(200, min_periods=150).mean()
    valid50 = ma50.notna().sum(axis=1).replace(0, np.nan)
    valid200 = ma200.notna().sum(axis=1).replace(0, np.nan)
    chg = w.pct_change(fill_method=None)
    out = pd.DataFrame({
        "above50": 100 * (w > ma50).sum(axis=1) / valid50,
        "above200": 100 * (w > ma200).sum(axis=1) / valid200,
        "adv": (chg > 0).sum(axis=1),
        "dec": (chg < 0).sum(axis=1),
        "new_hi": (w >= w.rolling(250, min_periods=120).max()).sum(axis=1),
        "new_lo": (w <= w.rolling(250, min_periods=120).min()).sum(axis=1),
    })
    out["ad_line"] = (out["adv"] - out["dec"]).cumsum()
    return out


def distribution_days(idx: pd.DataFrame, n: int = 25) -> int:
    c, v = idx["close"], idx["volume"]
    dd = (c.pct_change() < -0.002) & (v > v.shift())
    return int(dd.iloc[-n:].sum())


def regime(idx: pd.DataFrame, br: pd.DataFrame) -> dict:
    c = idx["close"]
    s50, s200 = c.rolling(50).mean(), c.rolling(200).mean()
    last = float(c.iloc[-1])
    hi52 = float(c.iloc[-250:].max())
    dd = last / hi52 - 1
    dist = distribution_days(idx)
    b50 = float(br["above50"].iloc[-1]) if not br.empty else 50
    b200 = float(br["above200"].iloc[-1]) if not br.empty else 50
    checks = [
        ("VN-Index trên MA200", last > s200.iloc[-1], 1),
        ("VN-Index trên MA50", last > s50.iloc[-1], 1),
        ("MA50 trên MA200", s50.iloc[-1] > s200.iloc[-1], 1),
        (f"{b50:.0f}% cổ phiếu trên MA50 (cần > 50%)", b50 > 50, 1),
        (f"{b200:.0f}% cổ phiếu trên MA200 (cần > 50%)", b200 > 50, 1),
        (f"{dist} ngày phân phối trong 25 phiên (cần < 5)", dist < 5, 1),
        (f"Cách đỉnh 52 tuần {dd * 100:.1f}% (cần > -15%)", dd > -0.15, 1),
    ]
    score = sum(w for _, ok, w in checks if ok)
    if score >= 5:
        light, exposure, text = "green", 100, "Thị trường thuận lợi – được giải ngân tối đa theo kế hoạch."
    elif score >= 3:
        light, exposure, text = "yellow", 60, "Thị trường trung tính – giải ngân từng phần, ưu tiên mã mạnh, cổ tức."
    else:
        light, exposure, text = "red", 30, ("Thị trường xấu – hạn chế mua mới, chỉ giữ/mua mã cổ tức & phòng thủ "
                                            "định giá rất rẻ, giữ nhiều tiền mặt.")
    return {"light": light, "exposure": exposure, "score": score, "max_score": len(checks),
            "text": text, "checks": [{"name": n, "ok": bool(ok)} for n, ok, _ in checks],
            "index": {"close": _r(last), "chg1d": _r(100 * c.pct_change().iloc[-1]),
                      "chg1m": _r(100 * (last / c.iloc[-22] - 1)), "chgytd": _r(
                    100 * (last / c[c.index.year < c.index[-1].year].iloc[-1] - 1)) if (c.index.year < c.index[-1].year).any() else None,
                      "sma50": _r(s50.iloc[-1]), "sma200": _r(s200.iloc[-1]), "from_hi52": _r(dd * 100, 1),
                      "rsi": _r(ind.rsi(c).iloc[-1], 1)},
            "breadth_now": {"above50": _r(b50, 1), "above200": _r(b200, 1),
                            "adv": int(br["adv"].iloc[-1]) if not br.empty else None,
                            "dec": int(br["dec"].iloc[-1]) if not br.empty else None,
                            "new_hi": int(br["new_hi"].iloc[-1]) if not br.empty else None,
                            "new_lo": int(br["new_lo"].iloc[-1]) if not br.empty else None},
            "distribution_days": dist}


def sector_map(wide_close: pd.DataFrame, wide_value: pd.DataFrame, listing: pd.DataFrame,
               liquid: list[str]) -> list[dict]:
    """Hiệu suất từng ngành (bình quân gia quyền theo giá trị giao dịch)."""
    w = wide_close.iloc[-260:]
    val = wide_value.iloc[-20:].mean()
    sec = listing.set_index("symbol")["sector"].dropna()
    out = []
    for name, syms in sec.groupby(sec).groups.items():
        syms = [s for s in syms if s in w.columns and s in liquid]
        if len(syms) < 2:
            continue
        wt = val.reindex(syms).fillna(0)
        if wt.sum() <= 0:
            continue
        wt = wt / wt.sum()

        def ret(n):
            if len(w) <= n:
                return None
            r = (w[syms].iloc[-1] / w[syms].iloc[-1 - n] - 1).fillna(0)
            return _r(100 * float((r * wt).sum()), 1)

        ma50 = w[syms].rolling(50).mean().iloc[-1]
        out.append({"sector": name, "n": len(syms), "r1d": ret(1), "r1w": ret(5), "r1m": ret(21),
                    "r3m": ret(63), "r1y": ret(250),
                    "above50": _r(100 * float((w[syms].iloc[-1] > ma50).mean()), 0),
                    "value_bn": _r(float(val.reindex(syms).sum()), 0)})
    return sorted(out, key=lambda x: -(x["r1m"] or -999))
