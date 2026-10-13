"""Mã "có sự kiện" (giá sụt mạnh kèm chuỗi phiên giảm sàn) và điểm vào SAU sự kiện.

Cờ sự kiện: giá ≤ −45% so với đỉnh 120 phiên VÀ ≥ 3 phiên giảm ≥ 6,5% trong 60 phiên.
Kiểm chứng 560 đợt (2016–2026, mã GTGD ≥ 1 tỷ), lợi nhuận vượt VN-Index, so với nhóm chứng = mọi mã thanh khoản mua cùng ngày:
  - mua ngay khi có cờ: 120 phiên sau −3,7% so với nhóm chứng (t −2,7); sau đó còn sụt thêm TB −35%;
  - mua nhịp hồi sớm (bật +25% từ đáy, lên lại MA20 sau ~35 phiên, lên MA50 sau ~70 phiên): vẫn thua nhóm chứng (−1,5% … −3,2% / 120 phiên);
  - mua khi sự kiện đã "nguội": ≥ 120 phiên từ lúc có cờ VÀ ≥ 60 phiên liền không có phiên giảm sàn (thường ~150 phiên ≈ 7 tháng):
        mọi mã: +2,3% / 60 phiên (t 2,3), +4,7% / 250 phiên; sụt sâu nhất sau khi mua TB −16% (so với −35% nếu mua ngay);
        DN có lãi & nợ vay/vốn < 1,5, giai đoạn 2022–2026: +3,2% / 120 phiên (t 2,1), +7,2% / 250 phiên (t 2,6), 31% số lần lãi ≥ 30% trong 1 năm;
        DN đang lỗ: không có lợi thế (≈ 0%).
  - chỉ 23% số đợt quay lại được ≥ 90% đỉnh trước sự kiện trong 1 năm → mục tiêu thận trọng.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

DD, DOWN, N_DOWN = -0.45, -0.065, 3
COOL_SINCE, COOL_QUIET, WINDOW_END = 120, 60, 300


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def episode(close: pd.Series | None) -> dict | None:
    """Đợt sự kiện gần nhất (trong ~330 phiên) và giai đoạn hiện tại: active (đang / chưa nguội) hoặc window (đã nguội – vùng vào)."""
    if close is None:
        return None
    c = close.dropna()
    c = c[c > 0]
    if len(c) < 140:
        return None
    r = c.pct_change()
    dd = c / c.rolling(120, min_periods=60).max() - 1
    ldn = (r <= DOWN).astype(float).rolling(60, min_periods=20).sum()
    flag = ((dd <= DD) & (ldn >= N_DOWN)).values
    n = len(c)
    lo_i = max(0, n - 330)
    on = np.where(flag[lo_i:])[0] + lo_i
    if not len(on):
        return None
    st = on[0]
    for a, b in zip(on[:-1], on[1:]):
        if b - a >= 60:
            st = b
    since = n - 1 - st
    dn = np.where((r <= DOWN).values)[0]
    last_dn = dn[-1] if len(dn) else st
    quiet = n - 1 - last_dn
    seg = c.iloc[st:]
    pre_hi = float(c.iloc[max(0, st - 120):st + 1].max())
    low = float(seg.min())
    if since > WINDOW_END and not flag[-1]:
        return None          # quá ~14 tháng mà vẫn chưa "nguội" (hay biến động mạnh) → không còn coi là đợt sự kiện này
    active = bool(flag[-1]) or since < COOL_SINCE or quiet < COOL_QUIET
    if active:
        phase = "active"
    elif since <= WINDOW_END:
        phase = "window"
    else:
        return None
    return {"phase": phase, "start": str(c.index[st].date()), "since": int(since), "quiet": int(quiet), "flag_now": bool(flag[-1]),
            "pre_hi": _r(pre_hi), "low": _r(low), "low_date": str(seg.idxmin().date()), "price": _r(float(c.iloc[-1])),
            "dd_now": _r(100 * (float(c.iloc[-1]) / pre_hi - 1), 1), "from_low": _r(100 * (float(c.iloc[-1]) / low - 1), 1),
            "n_down": int(((r.iloc[st:] <= DOWN)).sum()),
            "wait_since": max(0, COOL_SINCE - int(since)), "wait_quiet": max(0, COOL_QUIET - int(quiet)),
            **({"cool": str(c.index[n - 1 - min(since - COOL_SINCE, quiet - COOL_QUIET)].date())} if phase == "window" else {})}


def entry_plan(ep: dict, quality: bool, fair: float | None) -> dict:
    """Kế hoạch cho mã đã qua giai đoạn nguội (phase = window)."""
    px = ep["price"]
    tgt = [x for x in (fair, ep["pre_hi"] * 0.9 if ep.get("pre_hi") else None) if x and x > px]
    t1 = round(min(tgt), 2) if tgt else round(px * 1.25, 2)
    return {"zone": [round(px * 0.97, 2), round(px * 1.02, 2)], "stop": round(px * 0.85, 2), "t1": t1, "t1_pct": _r(100 * (t1 / px - 1), 0),
            "split": "Mua 1/2 ngay, 1/2 khi giá chỉnh về vùng dưới (trong 20 phiên); nắm 6–12 tháng",
            "quality": quality,
            "edge": ("Lịch sử VN 2022–2026, DN có lãi & nợ thấp: 120 phiên sau hơn nhóm chứng +3,2%, 250 phiên +7,2%; 31% số lần lãi ≥ 30% trong 1 năm; "
                     "sụt sâu nhất sau khi mua TB −13%." if quality else
                     "DN đang lỗ hoặc nợ cao: lịch sử không có lợi thế sau sự kiện (≈ 0% so với nhóm chứng) – chỉ theo dõi.")}


def history(close: pd.Series | None, vni: pd.Series | None = None, max_n: int = 10) -> list[dict]:
    """Mọi đợt sự kiện trong lịch sử của mã (để đánh dấu lên biểu đồ và xem sau đó giá đi đâu).
    Mỗi đợt: ngày có cờ, đáy, ngày "nguội" (điểm vào theo quy tắc ≥ 120 phiên & ≥ 60 phiên liền không giảm sàn),
    và % giá sau 60 / 120 / 250 phiên tính từ điểm vào (kèm chênh lệch so với VN-Index)."""
    if close is None:
        return []
    c = close.dropna()
    c = c[c > 0]
    if len(c) < 140:
        return []
    r = c.pct_change()
    dd = c / c.rolling(120, min_periods=60).max() - 1
    dnm = (r <= DOWN).values
    ldn = pd.Series(dnm.astype(float), index=c.index).rolling(60, min_periods=20).sum()
    flag = ((dd <= DD) & (ldn >= N_DOWN)).values
    on = np.where(flag)[0]
    if not len(on):
        return []
    starts = [on[0]] + [b for a, b in zip(on[:-1], on[1:]) if b - a >= 60]
    n = len(c)
    cs = np.concatenate([[0], np.cumsum(dnm)])           # cs[i+1] = số phiên giảm sàn tới i
    v = vni.reindex(c.index).ffill() if vni is not None else None
    px = c.values
    out = []
    for k, st in enumerate(starts):
        nxt = starts[k + 1] if k + 1 < len(starts) else n
        cool = None
        for i in range(st + COOL_SINCE, min(n, st + WINDOW_END + 1, nxt)):
            if cs[i + 1] - cs[i + 1 - COOL_QUIET] == 0 and not flag[i]:
                cool = i
                break
        end = cool if cool is not None else min(n, nxt, st + WINDOW_END + 1) - 1
        seg = px[st:end + 1]
        lo_i = st + int(np.argmin(seg))
        pre_hi = float(px[max(0, st - 120):st + 1].max())
        e = {"start": str(c.index[st].date()), "px_start": _r(px[st]), "pre_hi": _r(pre_hi), "low_date": str(c.index[lo_i].date()), "low": _r(px[lo_i]),
             "dd_low": _r(100 * (px[lo_i] / pre_hi - 1), 0), "n_down": int(cs[end + 1] - cs[st])}
        # mua ngay khi có cờ → 120 phiên sau (để thấy vì sao không nên bắt dao rơi)
        if st + 120 < n:
            e["r_start120"] = _r(100 * (px[st + 120] / px[st] - 1), 1)
        if cool is not None:
            e["cool"] = str(c.index[cool].date())
            e["px_cool"] = _r(px[cool])
            for h in (60, 120, 250):
                if cool + h < n:
                    e[f"r{h}"] = _r(100 * (px[cool + h] / px[cool] - 1), 1)
                    if v is not None and pd.notna(v.iloc[cool]) and pd.notna(v.iloc[cool + h]) and v.iloc[cool] > 0:
                        e[f"x{h}"] = _r(e[f"r{h}"] - 100 * (float(v.iloc[cool + h]) / float(v.iloc[cool]) - 1), 1)
            w = px[cool:min(n, cool + 251)]
            e["mdd"] = _r(100 * (w.min() / px[cool] - 1), 0)
            e["mx"] = _r(100 * (w.max() / px[cool] - 1), 0)
            e["days"] = int(n - 1 - cool)
        else:
            e["open"] = bool(n - 1 - st <= WINDOW_END)     # đợt còn đang diễn ra (chưa nguội)
        out.append(e)
    return out[-max_n:]
