"""Smart Money Concepts (SMC) trên nến ngày.

- Cấu trúc: đỉnh/đáy swing (fractal N nến), BOS (phá cấu trúc cùng xu hướng), CHoCH (đổi tính chất).
- Order Block (OB): nến ngược chiều cuối cùng trước cú bứt phá tạo BOS/CHoCH; còn hiệu lực nếu giá chưa
  đóng cửa xuyên qua.
- Fair Value Gap (FVG): khoảng trống giữa nến 1 và nến 3 của một cú đi mạnh; theo dõi đã lấp hay chưa.
- Liquidity Sweep: giá đâm qua đỉnh/đáy swing cũ (nơi tập trung lệnh dừng) rồi đóng cửa quay lại.
- Premium / Discount: vị trí giá trong biên dao động swing gần nhất (trên 50% = đắt, dưới 50% = rẻ).
- Vùng thanh khoản: các đỉnh/đáy bằng nhau (equal highs/lows) chưa bị quét.

Mọi kết luận là tham khảo; độ tin cậy được đo ở backtest.pattern_stats.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import atr


def _d(idx, i) -> str:
    try:
        return str(pd.Timestamp(idx[i]).date())
    except Exception:  # noqa: BLE001
        return str(i)


def swings(df: pd.DataFrame, n: int = 3) -> tuple[list[int], list[int]]:
    """Đỉnh/đáy fractal: cao/thấp nhất trong n nến mỗi bên (chỉ dùng nến đã xác nhận)."""
    h, l = df["high"].values, df["low"].values
    hs, ls = [], []
    for i in range(n, len(df) - n):
        if h[i] == h[i - n:i + n + 1].max():
            hs.append(i)
        if l[i] == l[i - n:i + n + 1].min():
            ls.append(i)
    return hs, ls


def structure(df: pd.DataFrame, n: int = 3) -> dict:
    """Duyệt nến, ghi lại BOS/CHoCH khi giá đóng cửa vượt swing gần nhất."""
    c, h, l, o = df["close"].values, df["high"].values, df["low"].values, df["open"].values
    hs, ls = swings(df, n)
    hs_set, ls_set = set(hs), set(ls)
    last_h = last_l = None
    trend = 0
    events, obs = [], []
    a = atr(df, 14).values
    for i in range(len(df)):
        # swing chỉ được xác nhận sau n nến
        j = i - n
        if j >= 0 and j in hs_set:
            last_h = j
        if j >= 0 and j in ls_set:
            last_l = j
        if last_h is not None and c[i] > h[last_h] and (not events or events[-1]["level_i"] != last_h):
            kind = "BOS" if trend == 1 else "CHoCH"
            trend = 1
            events.append({"i": i, "date": _d(df.index, i), "type": kind, "dir": 1, "level": float(h[last_h]),
                           "level_i": last_h})
            # Order block tăng: nến giảm cuối cùng trước cú bứt phá (tìm lùi từ i về đáy gần nhất)
            k0 = last_l if last_l is not None and last_l < i else max(0, i - 15)
            for k in range(i - 1, max(k0 - 1, 0), -1):
                if c[k] < o[k]:
                    obs.append({"i": k, "date": _d(df.index, k), "dir": 1, "top": float(h[k]),
                                "bottom": float(l[k]), "origin": kind})
                    break
            last_h = None
        if last_l is not None and c[i] < l[last_l] and (not events or events[-1]["level_i"] != last_l):
            kind = "BOS" if trend == -1 else "CHoCH"
            trend = -1
            events.append({"i": i, "date": _d(df.index, i), "type": kind, "dir": -1, "level": float(l[last_l]),
                           "level_i": last_l})
            k0 = last_h if last_h is not None and last_h < i else max(0, i - 15)
            for k in range(i - 1, max(k0 - 1, 0), -1):
                if c[k] > o[k]:
                    obs.append({"i": k, "date": _d(df.index, k), "dir": -1, "top": float(h[k]),
                                "bottom": float(l[k]), "origin": kind})
                    break
            last_l = None
    # trạng thái OB: bị phá (đóng cửa xuyên qua) hay còn hiệu lực; đã được giá quay lại test chưa
    live = []
    for ob in obs:
        after = slice(ob["i"] + 1, len(df))
        cc, ll, hh = c[after], l[after], h[after]
        if ob["dir"] == 1:
            broken = bool((cc < ob["bottom"]).any())
            tested = bool((ll <= ob["top"]).any())
        else:
            broken = bool((cc > ob["top"]).any())
            tested = bool((hh >= ob["bottom"]).any())
        ob.update({"broken": broken, "tested": tested})
        if not broken:
            live.append(ob)
    return {"trend": trend, "events": events, "obs": obs, "live_obs": live, "swings_h": hs, "swings_l": ls,
            "atr": a}


def fvgs(df: pd.DataFrame, lookback: int = 120, min_atr: float = 0.3) -> list[dict]:
    h, l, c = df["high"].values, df["low"].values, df["close"].values
    a = atr(df, 14).values
    out = []
    start = max(2, len(df) - lookback)
    for i in range(start, len(df)):
        aa = a[i] if a[i] == a[i] else (h[i] - l[i])
        if l[i] > h[i - 2] and (l[i] - h[i - 2]) >= min_atr * aa:     # FVG tăng
            top, bot = float(l[i]), float(h[i - 2])
            fut = l[i + 1:]
            filled = float(min(1.0, max(0.0, (top - fut.min()) / (top - bot)))) if len(fut) else 0.0
            out.append({"date": _d(df.index, i - 1), "dir": 1, "top": top, "bottom": bot, "filled": round(filled, 2)})
        if h[i] < l[i - 2] and (l[i - 2] - h[i]) >= min_atr * aa:     # FVG giảm
            top, bot = float(l[i - 2]), float(h[i])
            fut = h[i + 1:]
            filled = float(min(1.0, max(0.0, (fut.max() - bot) / (top - bot)))) if len(fut) else 0.0
            out.append({"date": _d(df.index, i - 1), "dir": -1, "top": top, "bottom": bot, "filled": round(filled, 2)})
    return out


def sweeps(df: pd.DataFrame, hs: list[int], ls: list[int], lookback: int = 60) -> list[dict]:
    """Quét thanh khoản: nến đâm qua swing cũ rồi đóng cửa quay lại phía trong."""
    h, l, c, v = df["high"].values, df["low"].values, df["close"].values, df["volume"].values
    vma = pd.Series(v).rolling(20, min_periods=5).mean().values
    out = []
    n = len(df)
    for i in range(max(1, n - lookback), n):
        prev_h = [k for k in hs if k < i - 1 and i - k <= 80]
        prev_l = [k for k in ls if k < i - 1 and i - k <= 80]
        if prev_h:
            k = max(prev_h, key=lambda x: h[x])
            if h[i] > h[k] and c[i] < h[k]:
                out.append({"date": _d(df.index, i), "dir": -1, "level": float(h[k]),
                            "vol_ratio": round(float(v[i] / vma[i]), 2) if vma[i] else None,
                            "text": "Quét thanh khoản phía trên (đâm qua đỉnh cũ rồi đóng cửa dưới) – cảnh báo đảo chiều giảm"})
        if prev_l:
            k = min(prev_l, key=lambda x: l[x])
            if l[i] < l[k] and c[i] > l[k]:
                out.append({"date": _d(df.index, i), "dir": 1, "level": float(l[k]),
                            "vol_ratio": round(float(v[i] / vma[i]), 2) if vma[i] else None,
                            "text": "Quét thanh khoản phía dưới (thủng đáy cũ rồi kéo lên) – dấu hiệu gom hàng"})
    return out[-6:]


def equal_levels(df: pd.DataFrame, hs: list[int], ls: list[int], tol: float = 0.006) -> dict:
    h, l = df["high"].values, df["low"].values
    last = float(df["close"].iloc[-1])

    def cluster(idx, arr, above):
        pts = sorted(((arr[i], i) for i in idx[-30:]), key=lambda x: x[0])
        res = []
        for p, i in pts:
            if res and abs(p / res[-1]["price"] - 1) <= tol:
                res[-1]["n"] += 1
                res[-1]["price"] = (res[-1]["price"] + p) / 2
            else:
                res.append({"price": float(p), "n": 1})
        res = [r for r in res if r["n"] >= 2 and ((r["price"] > last) if above else (r["price"] < last))]
        return sorted(res, key=lambda r: abs(r["price"] - last))[:3]

    return {"buy_side": cluster(hs, h, True), "sell_side": cluster(ls, l, False)}


def analyze(df: pd.DataFrame) -> dict:
    if len(df) < 60:
        return {"ok": False}
    d = df.iloc[-400:]
    st = structure(d, n=3)
    last = float(d["close"].iloc[-1])
    hs, ls = st["swings_h"], st["swings_l"]
    fv = fvgs(d)
    open_fvg = [f for f in fv if f["filled"] < 1.0][-6:]
    sw = sweeps(d, hs, ls)
    eq = equal_levels(d, hs, ls)
    # biên swing gần nhất -> premium/discount
    rng_hi = float(d["high"].values[hs[-1]]) if hs else float(d["high"].max())
    rng_lo = float(d["low"].values[ls[-1]]) if ls else float(d["low"].min())
    if hs and ls:
        rng_hi = float(max(d["high"].values[hs[-1]], d["high"].iloc[-20:].max()))
        rng_lo = float(min(d["low"].values[ls[-1]], d["low"].iloc[-20:].min()))
    pos = (last - rng_lo) / (rng_hi - rng_lo) if rng_hi > rng_lo else 0.5
    zone = "Premium (vùng đắt – ưu tiên chốt lời/chờ)" if pos > 0.62 else (
        "Discount (vùng rẻ – ưu tiên tìm điểm mua)" if pos < 0.38 else "Cân bằng (equilibrium)")
    live = sorted(st["live_obs"], key=lambda o: -o["i"])
    bull_ob = next((o for o in live if o["dir"] == 1 and o["top"] <= last * 1.02), None)
    bear_ob = next((o for o in live if o["dir"] == -1 and o["bottom"] >= last * 0.98), None)
    ev = st["events"][-6:]
    last_ev = ev[-1] if ev else None
    # điểm thiên hướng (-1..1)
    bias = 0.0
    bias += 0.45 * st["trend"]
    if last_ev and len(d) - 1 - last_ev["i"] <= 15:
        bias += (0.25 if last_ev["type"] == "CHoCH" else 0.15) * last_ev["dir"]
    recent_sw = [s for s in sw if (pd.Timestamp(d.index[-1]) - pd.Timestamp(s["date"])).days <= 20]
    if recent_sw:
        bias += 0.2 * recent_sw[-1]["dir"]
    bias += 0.15 * (0.5 - pos) * 2   # discount -> dương
    if bull_ob and bull_ob["bottom"] <= last <= bull_ob["top"] * 1.01:
        bias += 0.15
    if bear_ob and bear_ob["bottom"] * 0.99 <= last <= bear_ob["top"]:
        bias -= 0.15
    bias = float(np.clip(bias, -1, 1))
    trend_vi = {1: "Tăng (đỉnh/đáy sau cao hơn, BOS lên)", -1: "Giảm (BOS xuống)", 0: "Chưa rõ"}[st["trend"]]
    summary = []
    if last_ev:
        summary.append(f"{last_ev['type']} {'tăng' if last_ev['dir'] > 0 else 'giảm'} ngày {last_ev['date']} "
                       f"(đóng cửa {'vượt' if last_ev['dir'] > 0 else 'thủng'} {last_ev['level']:.2f})")
    if bull_ob:
        summary.append(f"OB mua gần nhất {bull_ob['bottom']:.2f}–{bull_ob['top']:.2f} ({bull_ob['date']})")
    if bear_ob:
        summary.append(f"OB bán gần nhất {bear_ob['bottom']:.2f}–{bear_ob['top']:.2f} ({bear_ob['date']})")
    if open_fvg:
        f = open_fvg[-1]
        summary.append(f"FVG {'tăng' if f['dir'] > 0 else 'giảm'} chưa lấp {f['bottom']:.2f}–{f['top']:.2f}")
    return {
        "ok": True, "trend": st["trend"], "trend_vi": trend_vi, "bias": round(bias, 2),
        "events": [{k: e[k] for k in ("date", "type", "dir", "level")} for e in ev],
        "order_blocks": [{k: o[k] for k in ("date", "dir", "top", "bottom", "tested", "origin")} for o in live[:6]],
        "fvg": open_fvg, "sweeps": sw, "liquidity": eq,
        "range": {"high": round(rng_hi, 2), "low": round(rng_lo, 2), "eq": round((rng_hi + rng_lo) / 2, 2),
                  "pos_pct": round(100 * pos, 0), "zone": zone},
        "bull_ob": bull_ob and {k: bull_ob[k] for k in ("date", "top", "bottom")},
        "bear_ob": bear_ob and {k: bear_ob[k] for k in ("date", "top", "bottom")},
        "summary": summary,
    }
