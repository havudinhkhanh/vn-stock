"""Sóng & mô hình giá: ZigZag, Elliott, Wyckoff, mô hình kinh điển, Harmonic, Dow, Fibonacci,
hỗ trợ / kháng cự.

Mọi nhận diện ở đây là THAM KHẢO. Độ tin cậy thực tế được đo ở backtest (pattern_stats)
và hiển thị kèm trên web.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .indicators import atr

FIB_RET = [0.236, 0.382, 0.5, 0.618, 0.786]
FIB_EXT = [1.0, 1.272, 1.618, 2.0, 2.618]


@dataclass
class Pivot:
    i: int          # vị trí trong DataFrame
    price: float
    kind: str       # "H" đỉnh / "L" đáy
    date: str = ""
    provisional: bool = False


# ------------------------------------------------------------------ ZigZag
def zigzag(df: pd.DataFrame, pct: float | None = None, atr_mult: float = 3.0,
           min_pct: float = 0.05) -> list[Pivot]:
    """Đỉnh/đáy đảo chiều khi giá đi ngược ít nhất `pct` (mặc định theo ATR)."""
    hi, lo, close = df["high"].values, df["low"].values, df["close"].values
    n = len(df)
    if n < 10:
        return []
    if pct is None:
        a = atr(df, 14).iloc[-120:].mean()
        pct = max(min_pct, atr_mult * a / np.nanmean(close[-120:])) if a == a else min_pct
    dates = df.index if isinstance(df.index, pd.DatetimeIndex) else df.get("date", pd.Series(range(n)))
    piv: list[Pivot] = []
    trend = 0
    hi_i, lo_i = 0, 0
    for i in range(1, n):
        if trend == 0:
            if hi[i] > hi[hi_i]:
                hi_i = i
            if lo[i] < lo[lo_i]:
                lo_i = i
            if hi[i] >= lo[lo_i] * (1 + pct) and lo_i < i:
                piv.append(Pivot(lo_i, float(lo[lo_i]), "L"))
                trend, hi_i = 1, i
            elif lo[i] <= hi[hi_i] * (1 - pct) and hi_i < i:
                piv.append(Pivot(hi_i, float(hi[hi_i]), "H"))
                trend, lo_i = -1, i
        elif trend == 1:
            if hi[i] >= hi[hi_i]:
                hi_i = i
            elif lo[i] <= hi[hi_i] * (1 - pct):
                piv.append(Pivot(hi_i, float(hi[hi_i]), "H"))
                trend, lo_i = -1, i
        else:
            if lo[i] <= lo[lo_i]:
                lo_i = i
            elif hi[i] >= lo[lo_i] * (1 + pct):
                piv.append(Pivot(lo_i, float(lo[lo_i]), "L"))
                trend, hi_i = 1, i
    # đỉnh/đáy đang hình thành (chưa xác nhận)
    if trend == 1:
        piv.append(Pivot(hi_i, float(hi[hi_i]), "H", provisional=True))
    elif trend == -1:
        piv.append(Pivot(lo_i, float(lo[lo_i]), "L", provisional=True))
    # loại trùng loại liên tiếp
    clean: list[Pivot] = []
    for p in piv:
        if clean and clean[-1].kind == p.kind:
            better = (p.price > clean[-1].price) if p.kind == "H" else (p.price < clean[-1].price)
            if better:
                clean[-1] = p
            continue
        clean.append(p)
    for p in clean:
        d = dates[p.i] if p.i < len(dates) else None
        p.date = str(pd.Timestamp(d).date()) if d is not None and not isinstance(d, (int, np.integer)) else str(p.i)
    return clean


def _p(pv: list[Pivot]) -> list[dict]:
    return [{"date": p.date, "price": round(p.price, 2), "kind": p.kind, "prov": p.provisional} for p in pv]


# ------------------------------------------------------------------ Elliott
def _near(x, target, tol):
    return abs(x - target) <= tol * target if target else False


def _impulse_score(pts: list[float], up: bool) -> tuple[bool, float, list[str]]:
    """pts: giá 4..6 điểm (p0..pk). Kiểm tra quy tắc cứng + chấm điểm hướng dẫn."""
    s = 1 if up else -1
    p = [s * x for x in pts]  # đưa về dạng sóng tăng
    k = len(p) - 1
    notes = []
    w = [p[i + 1] - p[i] for i in range(k)]
    # hướng sóng: 1,3,5 dương; 2,4 âm
    for j, wj in enumerate(w):
        if (j % 2 == 0 and wj <= 0) or (j % 2 == 1 and wj >= 0):
            return False, 0, []
    if k >= 2 and p[2] <= p[0]:
        return False, 0, []                       # sóng 2 không vượt đáy sóng 1
    if k >= 4 and p[4] <= p[1]:
        return False, 0, []                       # sóng 4 không chồng sóng 1
    if k >= 5 and w[2] < min(w[0], w[4]):
        return False, 0, []                       # sóng 3 không ngắn nhất
    if k == 4 and w[2] < w[0]:
        notes.append("sóng 3 ngắn hơn sóng 1 → sóng 5 phải ngắn hơn sóng 3")
    score = 1.0
    r2 = -w[1] / w[0]
    if 0.382 <= r2 <= 0.786:
        score += 1 - abs(r2 - 0.618) * 2
        notes.append(f"sóng 2 hồi {r2:.0%} sóng 1")
    if k >= 3:
        e3 = w[2] / w[0]
        score += max(0, 1 - abs(e3 - 1.618) / 1.618)
        notes.append(f"sóng 3 = {e3:.2f}× sóng 1")
    if k >= 4:
        r4 = -w[3] / w[2]
        if 0.236 <= r4 <= 0.5:
            score += 1 - abs(r4 - 0.382) * 3
        notes.append(f"sóng 4 hồi {r4:.0%} sóng 3")
        # luân phiên: sóng 2 sâu thì sóng 4 nông và ngược lại
        if (r2 > 0.5) != (r4 > 0.5):
            score += 0.3
    if k >= 5:
        e5 = w[4] / w[0]
        score += max(0, 1 - min(abs(e5 - 1), abs(e5 - 0.618)))
        notes.append(f"sóng 5 = {e5:.2f}× sóng 1")
    return True, score, notes


def _abc_score(pts: list[float], down: bool) -> tuple[bool, float, list[str]]:
    s = -1 if down else 1
    p = [s * x for x in pts]
    k = len(p) - 1
    w = [p[i + 1] - p[i] for i in range(k)]
    for j, wj in enumerate(w):
        if (j % 2 == 0 and wj <= 0) or (j % 2 == 1 and wj >= 0):
            return False, 0, []
    score = 0.8
    notes = []
    rb = -w[1] / w[0]
    if rb >= 1.0:
        return False, 0, []
    score += max(0, 1 - abs(rb - 0.5) * 2)
    notes.append(f"B hồi {rb:.0%} của A")
    if k >= 3:
        rc = w[2] / w[0]
        score += max(0, 1 - min(abs(rc - 1), abs(rc - 1.618)))
        notes.append(f"C = {rc:.2f}× A")
    return True, score, notes


def elliott(df: pd.DataFrame) -> dict:
    """Đếm sóng Elliott tự động: kịch bản chính + kịch bản thay thế."""
    piv = zigzag(df, atr_mult=3.5, min_pct=0.07)
    last_close = float(df["close"].iloc[-1])
    if len(piv) < 4:
        return {"ok": False, "reason": "Chưa đủ đỉnh/đáy để đếm sóng"}
    cands = []
    for k in (5, 4, 3):  # số sóng đã có
        for end in (len(piv), len(piv) - 1):
            st = end - (k + 1)
            if st < 0:
                continue
            seg = piv[st:end]
            prices = [p.price for p in seg]
            up = seg[0].kind == "L"
            ok, sc, notes = _impulse_score(prices, up)
            if ok:
                cands.append({"type": "impulse", "up": up, "waves": k, "seg": seg,
                              "score": sc + (0.5 if end == len(piv) else 0) + k * 0.15,
                              "notes": notes})
    for k in (3, 2):
        for end in (len(piv), len(piv) - 1):
            st = end - (k + 1)
            if st < 0:
                continue
            seg = piv[st:end]
            prices = [p.price for p in seg]
            down = seg[0].kind == "H"
            ok, sc, notes = _abc_score(prices, down)
            if ok:
                cands.append({"type": "abc", "up": not down, "waves": k, "seg": seg,
                              "score": sc + (0.5 if end == len(piv) else 0), "notes": notes})
    if not cands:
        return {"ok": False, "reason": "Không có cách đếm nào thoả 3 quy tắc cứng của Elliott",
                "pivots": _p(piv[-8:])}
    cands.sort(key=lambda c: -c["score"])

    def describe(c):
        seg = c["seg"]
        lab = (["0", "1", "2", "3", "4", "5"] if c["type"] == "impulse" else ["0", "A", "B", "C"])
        pts = [{"label": lab[i], "date": p.date, "price": round(p.price, 2)} for i, p in enumerate(seg)]
        pr = [p.price for p in seg]
        s = 1 if c["up"] else -1
        dir_vi = "tăng" if c["up"] else "giảm"
        targets, invalid, where = [], None, ""
        if c["type"] == "impulse":
            w1 = pr[1] - pr[0]
            k = c["waves"]
            if k == 2:
                where = f"Đang ở sóng 3 {dir_vi} (thường mạnh nhất)"
                targets = [pr[2] + w1 * 1.618, pr[2] + w1 * 2.618]
                invalid = pr[0]
            elif k == 3:
                where = f"Đang ở sóng 4 (điều chỉnh) trong xu hướng {dir_vi}"
                w3 = pr[3] - pr[2]
                targets = [pr[3] - w3 * 0.236, pr[3] - w3 * 0.382, pr[3] - w3 * 0.5]
                invalid = pr[1]
            elif k == 4:
                where = f"Đang ở sóng 5 {dir_vi} (sóng cuối)"
                targets = [pr[4] + w1 * 0.618, pr[4] + w1, pr[4] + (pr[3] - pr[0]) * 0.618]
                invalid = pr[4]
            else:
                where = f"Đã hoàn tất 5 sóng {dir_vi} → khả năng điều chỉnh A-B-C"
                tot = pr[5] - pr[0]
                targets = [pr[5] - tot * 0.382, pr[5] - tot * 0.5, pr[5] - tot * 0.618]
                invalid = None
        else:
            a = pr[1] - pr[0]
            if c["waves"] == 2:
                where = f"Đang ở sóng C của nhịp điều chỉnh ({'hồi' if c['up'] else 'giảm'})"
                targets = [pr[2] + a, pr[2] + a * 1.618]
                invalid = pr[0]
            else:
                where = "Nhịp điều chỉnh A-B-C có thể đã xong → chờ xu hướng mới"
                targets = []
        bias = 0
        if c["type"] == "impulse":
            bias = s * (1 if c["waves"] in (2, 4) else (-1 if c["waves"] == 5 else 0.5))
        else:
            bias = (s if c["waves"] == 2 else -s) * 0.5
        return {"type": c["type"], "where": where, "points": pts,
                "targets": [round(t, 2) for t in targets if t > 0],
                "invalidation": round(invalid, 2) if invalid else None,
                "notes": c["notes"], "bias": float(np.clip(bias, -1, 1)),
                "confidence": round(min(1.0, c["score"] / 5.5), 2)}

    main = describe(cands[0])
    alt = None
    for c in cands[1:]:
        if c["type"] != cands[0]["type"] or c["waves"] != cands[0]["waves"] or c["up"] != cands[0]["up"]:
            alt = describe(c)
            break
    return {"ok": True, "main": main, "alt": alt, "price": last_close, "pivots": _p(piv[-10:])}


# ------------------------------------------------------------------ Wyckoff
def wyckoff(df: pd.DataFrame) -> dict:
    if len(df) < 150:
        return {"phase": "Chưa đủ dữ liệu", "code": "na", "events": []}
    c, h, l, v = df["close"], df["high"], df["low"], df["volume"]
    win = 60
    rng_hi = h.iloc[-win:-5].max()
    rng_lo = l.iloc[-win:-5].min()
    width = (rng_hi - rng_lo) / rng_lo
    prior = c.iloc[-win - 120:-win]
    prior_ret = prior.iloc[-1] / prior.iloc[0] - 1 if len(prior) > 20 else 0
    vma = v.rolling(50).mean()
    last = c.iloc[-1]
    events = []
    sma200 = c.rolling(200, min_periods=120).mean()
    slope = sma200.iloc[-1] / sma200.iloc[-21] - 1 if sma200.notna().iloc[-21] else 0
    # sự kiện trong 15 phiên gần nhất
    rec = df.iloc[-15:]
    for d, row in rec.iterrows():
        vr = row["volume"] / vma.loc[d] if vma.loc[d] else 1
        if row["low"] < rng_lo and row["close"] > rng_lo:
            events.append({"date": str(pd.Timestamp(d).date()), "event": "Spring (rũ bỏ dưới đáy nền rồi kéo lên)"})
        if row["close"] > rng_hi and vr > 1.5:
            events.append({"date": str(pd.Timestamp(d).date()), "event": "SOS (bứt phá khỏi nền với khối lượng lớn)"})
        if row["high"] > rng_hi and row["close"] < rng_hi and vr > 1.3:
            events.append({"date": str(pd.Timestamp(d).date()), "event": "Upthrust (vượt đỉnh nền rồi bị bán xuống)"})
        if row["close"] < rng_lo and vr > 1.5:
            events.append({"date": str(pd.Timestamp(d).date()), "event": "SOW (thủng nền với khối lượng lớn)"})
    in_range = width < 0.30
    if in_range and prior_ret < -0.15:
        code, phase = "accum", "Tích luỹ (Accumulation) – nền giá sau xu hướng giảm"
        if any("Spring" in e["event"] for e in events):
            phase += " · giai đoạn C (Spring)"
        if any("SOS" in e["event"] for e in events):
            code, phase = "markup_start", "Tích luỹ hoàn tất → bắt đầu tăng giá (SOS)"
    elif in_range and prior_ret > 0.20:
        code, phase = "distrib", "Phân phối (Distribution) – nền giá sau xu hướng tăng"
        if any("Upthrust" in e["event"] for e in events):
            phase += " · có Upthrust (cảnh báo)"
        if any("SOW" in e["event"] for e in events):
            code, phase = "markdown_start", "Phân phối hoàn tất → bắt đầu giảm (SOW)"
    elif last > sma200.iloc[-1] and slope > 0.01:
        code, phase = "markup", "Tăng giá (Markup)"
    elif last < sma200.iloc[-1] and slope < -0.01:
        code, phase = "markdown", "Giảm giá (Markdown)"
    elif in_range:
        code, phase = "range", "Đi ngang tái tích luỹ"
    else:
        code, phase = "transition", "Chuyển tiếp, chưa rõ giai đoạn"
    bias = {"accum": 0.4, "markup_start": 0.9, "markup": 0.6, "distrib": -0.5,
            "markdown_start": -0.9, "markdown": -0.7, "range": 0, "transition": 0, "na": 0}[code]
    return {"phase": phase, "code": code, "events": events[-4:], "bias": bias,
            "range": [round(rng_lo, 2), round(rng_hi, 2)], "width_pct": round(width * 100, 1)}


# ------------------------------------------------------------------ mô hình giá
def chart_patterns(df: pd.DataFrame) -> list[dict]:
    out = []
    c, h, l = df["close"], df["high"], df["low"]
    last = float(c.iloc[-1])
    piv = zigzag(df, atr_mult=2.0, min_pct=0.04)
    n = len(df)

    def recent(p, days=60):
        return n - 1 - p.i <= days

    # Hai đáy / hai đỉnh
    if len(piv) >= 4:
        a, b, cc, d = piv[-4], piv[-3], piv[-2], piv[-1]
        for x, mid, y in ((a, b, cc), (b, cc, d)):
            if x.kind == "L" and y.kind == "L" and recent(y, 40):
                if abs(x.price - y.price) / x.price < 0.04 and mid.price > max(x.price, y.price) * 1.08:
                    neck = mid.price
                    status = "đã phá vỡ" if last > neck else "chờ vượt đường viền cổ"
                    out.append({"name": "Hai đáy (Double Bottom)", "bias": 1, "status": status,
                                "trigger": round(neck, 2), "target": round(neck + (neck - min(x.price, y.price)), 2),
                                "stop": round(min(x.price, y.price) * 0.98, 2)})
            if x.kind == "H" and y.kind == "H" and recent(y, 40):
                if abs(x.price - y.price) / x.price < 0.04 and mid.price < min(x.price, y.price) * 0.92:
                    neck = mid.price
                    status = "đã thủng" if last < neck else "cảnh báo, chưa thủng viền cổ"
                    out.append({"name": "Hai đỉnh (Double Top)", "bias": -1, "status": status,
                                "trigger": round(neck, 2), "target": round(neck - (max(x.price, y.price) - neck), 2),
                                "stop": None})
    # Vai - đầu - vai (thuận & ngược)
    if len(piv) >= 6:
        s = piv[-6:]
        for off in (0, 1):
            seg = s[off:off + 5]
            if len(seg) < 5:
                continue
            ls, n1, hd, n2, rs_ = seg
            if ls.kind == "H" and hd.price > ls.price * 1.03 and hd.price > rs_.price * 1.03 \
                    and abs(ls.price - rs_.price) / ls.price < 0.06 and recent(rs_, 40):
                neck = (n1.price + n2.price) / 2
                out.append({"name": "Vai - Đầu - Vai (đảo chiều giảm)", "bias": -1,
                            "status": "đã thủng viền cổ" if last < neck else "đang hình thành",
                            "trigger": round(neck, 2), "target": round(neck - (hd.price - neck), 2), "stop": None})
            if ls.kind == "L" and hd.price < ls.price * 0.97 and hd.price < rs_.price * 0.97 \
                    and abs(ls.price - rs_.price) / ls.price < 0.06 and recent(rs_, 40):
                neck = (n1.price + n2.price) / 2
                out.append({"name": "Vai - Đầu - Vai ngược (đảo chiều tăng)", "bias": 1,
                            "status": "đã phá vỡ" if last > neck else "chờ vượt viền cổ",
                            "trigger": round(neck, 2), "target": round(neck + (neck - hd.price), 2),
                            "stop": round(rs_.price * 0.98, 2)})
    # Cốc tay cầm
    if n >= 80:
        w = df.iloc[-160:] if n >= 160 else df
        hh = w["high"].values
        li = int(np.argmax(hh[: max(10, len(hh) - 25)]))
        lip = hh[li]
        after = w.iloc[li:]
        if len(after) > 35:
            bottom = after["low"].min()
            depth = 1 - bottom / lip
            right = after["high"].iloc[-25:].max()
            handle_low = after["low"].iloc[-10:].min()
            if 0.12 <= depth <= 0.40 and right >= lip * 0.93 and handle_low >= right * 0.88 \
                    and after["low"].values.argmin() < len(after) - 15:
                out.append({"name": "Cốc tay cầm (Cup with Handle)", "bias": 1,
                            "status": "đã vượt điểm mua" if last > lip else "chờ vượt miệng cốc",
                            "trigger": round(lip, 2), "target": round(lip * (1 + depth), 2),
                            "stop": round(handle_low * 0.98, 2)})
    # Nền phẳng
    if n >= 120:
        base = df.iloc[-30:]
        rng = base["high"].max() / base["low"].min() - 1
        prior = c.iloc[-90] if n > 90 else c.iloc[0]
        if rng < 0.15 and c.iloc[-30] > prior * 1.2:
            top = base["high"].max()
            out.append({"name": "Nền giá phẳng (Flat Base)", "bias": 1,
                        "status": "bứt phá" if last >= top * 0.995 else "đang tích luỹ",
                        "trigger": round(top, 2), "target": round(top * 1.2, 2),
                        "stop": round(base["low"].min() * 0.98, 2)})
    # Tam giác
    if len(piv) >= 5:
        hs = [p for p in piv[-6:] if p.kind == "H"]
        ls_ = [p for p in piv[-6:] if p.kind == "L"]
        if len(hs) >= 2 and len(ls_) >= 2:
            hslope = (hs[-1].price - hs[0].price) / hs[0].price
            lslope = (ls_[-1].price - ls_[0].price) / ls_[0].price
            top, bot = hs[-1].price, ls_[-1].price
            height = hs[0].price - ls_[0].price
            if hslope < -0.03 and lslope > 0.03:
                out.append({"name": "Tam giác cân", "bias": 0, "status": "chờ phá vỡ",
                            "trigger": round(top, 2), "target": round(top + height, 2), "stop": round(bot, 2)})
            elif abs(hslope) <= 0.02 and lslope > 0.03:
                out.append({"name": "Tam giác tăng (đỉnh ngang, đáy nâng)", "bias": 1,
                            "status": "bứt phá" if last > top else "chờ vượt đỉnh ngang",
                            "trigger": round(top, 2), "target": round(top + height, 2), "stop": round(bot, 2)})
            elif hslope < -0.03 and abs(lslope) <= 0.02:
                out.append({"name": "Tam giác giảm (đáy ngang, đỉnh hạ)", "bias": -1,
                            "status": "thủng" if last < bot else "cảnh báo",
                            "trigger": round(bot, 2), "target": round(bot - height, 2), "stop": None})
    # Đỉnh 52 tuần
    hi52 = h.iloc[-250:].max()
    if last >= hi52 * 0.98:
        out.append({"name": "Vượt / sát đỉnh 52 tuần", "bias": 1, "status": "mạnh",
                    "trigger": round(hi52, 2), "target": None, "stop": None})
    return out


# ------------------------------------------------------------------ Harmonic
HARMONICS = {
    "Gartley": {"AB": (0.618, 0.618), "AD": (0.786, 0.786), "BC": (0.382, 0.886), "CD": (1.272, 1.618)},
    "Bat": {"AB": (0.382, 0.5), "AD": (0.886, 0.886), "BC": (0.382, 0.886), "CD": (1.618, 2.618)},
    "Butterfly": {"AB": (0.786, 0.786), "AD": (1.272, 1.618), "BC": (0.382, 0.886), "CD": (1.618, 2.24)},
    "Crab": {"AB": (0.382, 0.618), "AD": (1.618, 1.618), "BC": (0.382, 0.886), "CD": (2.24, 3.618)},
}


def harmonics(df: pd.DataFrame, tol: float = 0.06) -> list[dict]:
    piv = zigzag(df, atr_mult=2.5, min_pct=0.05)
    out = []
    if len(piv) < 5:
        return out
    X, A, B, C, D = [p.price for p in piv[-5:]]
    if len(df) - 1 - piv[-1].i > 20:
        return out
    xa, ab, bc, cd = abs(A - X), abs(B - A), abs(C - B), abs(D - C)
    if min(xa, ab, bc) == 0:
        return out
    r = {"AB": ab / xa, "BC": bc / ab, "CD": cd / bc, "AD": abs(A - D) / xa}
    bull = piv[-1].kind == "L"
    for name, spec in HARMONICS.items():
        ok = all(spec[k][0] * (1 - tol) <= r[k] <= spec[k][1] * (1 + tol) for k in spec)
        if ok:
            out.append({"name": f"Harmonic {name} {'tăng' if bull else 'giảm'}", "bias": 1 if bull else -1,
                        "prz": round(D, 2), "ratios": {k: round(v, 3) for k, v in r.items()},
                        "target": round(D + (0.382 * abs(A - D)) * (1 if bull else -1), 2),
                        "stop": round(D * (0.97 if bull else 1.03), 2),
                        "status": "D vừa hình thành – vùng đảo chiều tiềm năng"})
    return out


# ------------------------------------------------------------------ Dow
def dow(df: pd.DataFrame) -> dict:
    big = zigzag(df, atr_mult=5, min_pct=0.10)
    small = zigzag(df, atr_mult=2, min_pct=0.04)

    def trend(piv):
        hs = [p.price for p in piv if p.kind == "H"][-3:]
        ls_ = [p.price for p in piv if p.kind == "L"][-3:]
        if len(hs) >= 2 and len(ls_) >= 2:
            if hs[-1] > hs[-2] and ls_[-1] > ls_[-2]:
                return 1, "Tăng (đỉnh sau cao hơn, đáy sau cao hơn)"
            if hs[-1] < hs[-2] and ls_[-1] < ls_[-2]:
                return -1, "Giảm (đỉnh sau thấp hơn, đáy sau thấp hơn)"
        return 0, "Đi ngang / chưa xác nhận"

    p, ptxt = trend(big)
    s, stxt = trend(small)
    return {"primary": ptxt, "secondary": stxt, "primary_dir": p, "secondary_dir": s,
            "bias": 0.7 * p + 0.3 * s}


# ------------------------------------------------------------------ Fibonacci
def fibonacci(df: pd.DataFrame) -> dict:
    piv = zigzag(df, atr_mult=4, min_pct=0.08)
    if len(piv) < 2:
        return {}
    a, b = piv[-2], piv[-1]
    lo, hi = min(a.price, b.price), max(a.price, b.price)
    up = b.kind == "H"
    rng = hi - lo
    ret = {f"{r:.3f}": round(hi - r * rng if up else lo + r * rng, 2) for r in FIB_RET}
    ext = {f"{e:.3f}": round(lo + e * rng if up else hi - e * rng, 2) for e in FIB_EXT}
    return {"swing": {"from": a.date, "to": b.date, "low": round(lo, 2), "high": round(hi, 2),
                      "direction": "tăng" if up else "giảm"},
            "retracement": ret, "extension": ext}


# ------------------------------------------------------------------ Hỗ trợ / kháng cự
def support_resistance(df: pd.DataFrame, lookback: int = 500, max_levels: int = 4) -> dict:
    w = df.iloc[-lookback:]
    piv = zigzag(w, atr_mult=1.5, min_pct=0.03)
    if not piv:
        return {"support": [], "resistance": []}
    a = float(atr(w).iloc[-1]) if len(w) > 20 else w["close"].iloc[-1] * 0.02
    last = float(w["close"].iloc[-1])
    levels = sorted(p.price for p in piv)
    clusters: list[list[float]] = []
    for x in levels:
        if clusters and x - clusters[-1][-1] <= a * 0.8:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    zones = [{"price": round(float(np.mean(c)), 2), "touches": len(c)} for c in clusters]
    sup = sorted([z for z in zones if z["price"] < last * 0.995], key=lambda z: -z["price"])[:max_levels]
    res = sorted([z for z in zones if z["price"] > last * 1.005], key=lambda z: z["price"])[:max_levels]
    return {"support": sup, "resistance": res}


def analyze(df: pd.DataFrame) -> dict:
    """Gói toàn bộ phân tích sóng & mô hình cho 1 mã."""
    res = {}
    for name, fn in (("elliott", elliott), ("wyckoff", wyckoff), ("patterns", chart_patterns),
                     ("harmonics", harmonics), ("dow", dow), ("fib", fibonacci),
                     ("levels", support_resistance)):
        try:
            res[name] = fn(df)
        except Exception as e:  # noqa: BLE001  — một mô-đun lỗi không làm hỏng cả mã
            res[name] = {"error": str(e)}
    return res
