"""Trích tín hiệu (tên, hướng ±1) từ các phương pháp sóng/mô hình/tạo lập.

Dùng chung cho: (1) đo độ tin cậy trên dữ liệu VN (backtest.pattern_stats) và
(2) cộng/trừ điểm kỹ thuật hằng ngày – chỉ tín hiệu đã chứng minh có lợi thế mới được tính.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import patterns, smc, vsa

RECENT_DAYS = 7


def _recent(date_str: str, last: pd.Timestamp, days: int = RECENT_DAYS) -> bool:
    try:
        return (last - pd.Timestamp(date_str)).days <= days
    except Exception:  # noqa: BLE001
        return False


def from_results(pat: dict, last: pd.Timestamp) -> list[tuple[str, int]]:
    sig: list[tuple[str, int]] = []
    el = pat.get("elliott") or {}
    if el.get("ok") and abs(el["main"]["bias"]) >= 0.5:
        sig.append(("Elliott", int(np.sign(el["main"]["bias"]))))
    wy = pat.get("wyckoff") or {}
    if abs(wy.get("bias", 0)) >= 0.4:
        sig.append(("Wyckoff", int(np.sign(wy["bias"]))))
    dw = pat.get("dow") or {}
    if abs(dw.get("bias", 0)) >= 0.7:
        sig.append(("Dow", int(np.sign(dw["bias"]))))
    for p in pat.get("patterns") or []:
        if p.get("bias"):
            sig.append((p["name"], int(p["bias"])))
    for p in pat.get("harmonics") or []:
        sig.append(("Harmonic", int(p["bias"])))
    s = pat.get("smc") or {}
    if s.get("ok"):
        if abs(s.get("bias", 0)) >= 0.4:
            sig.append(("SMC – tổng hợp", int(np.sign(s["bias"]))))
        ev = (s.get("events") or [])[-1:] or []
        for e in ev:
            if _recent(e["date"], last):
                sig.append((f"SMC – {e['type']}", int(e["dir"])))
        for sw in (s.get("sweeps") or [])[-1:]:
            if _recent(sw["date"], last):
                sig.append(("SMC – quét thanh khoản", int(sw["dir"])))
        ob = s.get("bull_ob")
        if ob and ob["bottom"] <= pat.get("_last", 0) <= ob["top"] * 1.01:
            sig.append(("SMC – về Order Block mua", 1))
        ob = s.get("bear_ob")
        if ob and ob["bottom"] * 0.99 <= pat.get("_last", 0) <= ob["top"]:
            sig.append(("SMC – về Order Block bán", -1))
    v = pat.get("vsa") or {}
    if v.get("ok"):
        if abs(v.get("bias", 0)) >= 0.4:
            sig.append(("VSA – tổng hợp", int(np.sign(v["bias"]))))
        for x in (v.get("signals") or [])[-3:]:
            if _recent(x["date"], last, 4):
                sig.append((f"VSA – {x['signal']}", int(x["bias"])))
    w2 = pat.get("wyckoff2") or {}
    if w2.get("ok") and abs(w2.get("bias", 0)) >= 0.5:
        sig.append(("Wyckoff – sự kiện (SC/Spring/SOS/UTAD…)", int(np.sign(w2["bias"]))))
    # loại trùng tên
    seen, out = set(), []
    for n, b in sig:
        if n not in seen and b != 0:
            seen.add(n)
            out.append((n, b))
    return out


def compute(hist: pd.DataFrame) -> list[tuple[str, int]]:
    """Tính toàn bộ phương pháp trên dữ liệu đến thời điểm hist[-1] rồi trích tín hiệu."""
    pat = {
        "elliott": patterns.elliott(hist.iloc[-500:]),
        "wyckoff": patterns.wyckoff(hist.iloc[-300:]),
        "dow": patterns.dow(hist.iloc[-500:]),
        "patterns": patterns.chart_patterns(hist.iloc[-300:]),
        "harmonics": patterns.harmonics(hist.iloc[-300:]),
        "smc": smc.analyze(hist.iloc[-400:]),
        "vsa": vsa.analyze(hist.iloc[-200:]),
        "wyckoff2": vsa.wyckoff_events(hist.iloc[-300:]),
        "_last": float(hist["close"].iloc[-1]),
    }
    return from_results(pat, pd.Timestamp(hist.index[-1]))
