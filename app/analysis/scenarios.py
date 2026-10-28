"""Kịch bản đường giá tương lai theo từng cách chơi (Elliott, Fibonacci, SMC, xu hướng, thống kê) – để HÌNH DUNG điểm vào / chốt / cắt lỗ.

Mỗi kịch bản trả về: đường giá dự kiến (các mốc [số phiên tới, giá]), điểm vào, mục tiêu, mức sai (cắt lỗ), số phiên dự kiến.
Cùng một hàm dùng cho trang mã (build) và cho kiểm chứng lịch sử (research/scenarios_test.py) – con số kiểm chứng
hiện cạnh từng kịch bản là đo trên chính hàm này, trên dữ liệu VN. Đây là MINH HOẠ có điều kiện ("nếu đi theo cách đếm này
thì…"), không phải dự báo – thị trường không có nghĩa vụ đi theo.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import mtf as mtf_
from . import patterns as pt
from . import smc as smc_

TF_DAYS = {"D": 1, "W": 5}          # số phiên giao dịch cho 1 nến


def vn(x: float) -> str:
    return f"{x:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _bars_between(df: pd.DataFrame, d0, d1) -> int:
    try:
        return int(abs(df.index.get_loc(pd.Timestamp(d1)) - df.index.get_loc(pd.Timestamp(d0))))
    except KeyError:
        return 0


def _mk(kind, tf, last, path, target, stop, horizon, why, extra=None):
    """path: [(số nến tới, giá)] → quy về số PHIÊN; mục tiêu/cắt lỗ theo hướng của mục tiêu."""
    k = TF_DAYS[tf]
    up = target > last
    cap = 180 if tf == "D" else 375              # mốc cuối đường tối đa ~9 tháng (ngày) / ~1,5 năm (tuần)
    end = max(b for b, _ in path) * k
    if end > cap:                                # sóng quá dài → nén thời gian, giữ hình dạng
        f = cap / end
        path = [(b * f, p) for b, p in path]
        horizon = horizon * f
    out = {"kind": kind, "tf": tf, "dir": 1 if up else -1, "entry": round(last, 2), "target": round(float(target), 2),
           "stop": round(float(stop), 2) if stop is not None else None, "horizon": int(max(5, horizon * k)),
           "path": [[int(round(b * k)), round(float(p), 2)] for b, p in path], "why": why}
    if stop is not None:
        rw, rk = abs(target - last), abs(last - stop)
        out["rr"] = round(rw / rk, 2) if rk > 0 else None
        if (up and stop >= last) or (not up and stop <= last):
            return None                                   # mức sai nằm sai phía → bỏ
    if extra:
        out.update(extra)
    return out


# ------------------------------------------------------------------ Elliott
def elliott(df: pd.DataFrame, tf: str = "D") -> dict | None:
    e = pt.elliott(df)
    if not e.get("ok"):
        return None
    m = e["main"]
    last = float(df["close"].iloc[-1])
    tg, inv = m.get("targets") or [], m.get("invalidation")
    sgn = np.sign(m.get("bias") or 0)
    if sgn:                                   # chỉ giữ mục tiêu đúng hướng của kịch bản (vd. 5 sóng xong → mục tiêu điều chỉnh phía dưới giá)
        tg = sorted([t for t in tg if np.sign(t - last) == sgn], key=lambda t: abs(t - last))
    if not tg:
        return None
    pts = m["points"]
    lens = [_bars_between(df, pts[i]["date"], pts[i + 1]["date"]) for i in range(len(pts) - 1)]
    lens = [x for x in lens if x > 0] or [20]
    since = _bars_between(df, pts[-1]["date"], df.index[-1])
    t1 = tg[0]
    # thời gian: sóng đẩy dài ~ sóng 1 × 1,4; sóng điều chỉnh ~ ½ sóng trước
    impulse_leg = m["type"] == "impulse" and ("sóng 3" in m["where"] or "sóng 5" in m["where"])
    d1 = max(5, int((lens[0] * 1.4 if impulse_leg else lens[-1] * 0.6)) - since)
    path = [(0, last), (d1, t1)]
    if m["type"] == "impulse" and "sóng 3" in m["where"]:
        p = [x["price"] for x in pts]
        w3 = t1 - p[2]
        w4 = t1 - 0.382 * w3
        w5 = w4 + (p[1] - p[0])
        path += [(d1 + max(3, int(d1 * 0.5)), w4), (d1 + max(3, int(d1 * 0.5)) + max(5, lens[0]), w5)]
    elif m["type"] == "impulse" and "sóng 4" in m["where"]:
        p = [x["price"] for x in pts]
        w5 = t1 + (p[1] - p[0])
        path += [(d1 + max(5, lens[0]), w5)]
    stop = inv if inv else (last * (1 - 0.08) if t1 > last else last * 1.08)
    return _mk("elliott", tf, last, path, t1, stop, d1 * 2,
               f"{m['where']} – mục tiêu đầu {vn(t1)}, sai nếu {'thủng' if t1 > last else 'vượt'} {vn(stop)}",
               {"conf": m.get("confidence")})


# ------------------------------------------------------------------ Fibonacci
def fibonacci(df: pd.DataFrame, tf: str = "D") -> dict | None:
    f = pt.fibonacci(df)
    if not f:
        return None
    last = float(df["close"].iloc[-1])
    sw = f["swing"]
    lo, hi = sw["low"], sw["high"]
    rng = hi - lo
    if rng <= 0:
        return None
    up = sw["direction"] == "tăng"
    n_sw = max(5, _bars_between(df, sw["from"], sw["to"]))
    r = lambda k: hi - k * rng if up else lo + k * rng  # noqa: E731   mức thoái lui
    x = lambda k: lo + k * rng if up else hi - k * rng  # noqa: E731   mức mở rộng
    if up:
        if last >= hi:                                   # đang vượt đỉnh sóng → mục tiêu mở rộng 1,618
            return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.8), x(1.272)), (int(n_sw * 1.3), x(1.618))], x(1.618), r(0.382), n_sw * 1.6,
                       "Vượt đỉnh sóng tăng – mục tiêu mở rộng Fibonacci 1,272 → 1,618; sai nếu về dưới thoái lui 0,382")
        pos = (hi - last) / rng                          # đã thoái lui bao nhiêu
        if pos < 0.382:                                  # chưa về vùng mua → chờ về 0,5–0,618 rồi lên lại đỉnh
            return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.5), r(0.5)), (int(n_sw * 1.2), hi), (int(n_sw * 1.7), x(1.272))], hi, r(0.786), n_sw * 1.8,
                       "Sóng tăng chưa điều chỉnh đủ – kịch bản về vùng 0,5–0,618 rồi quay lại đỉnh, mở rộng 1,272; sai nếu thủng 0,786",
                       {"wait": round(r(0.5), 2)})
        if pos <= 0.786:                                 # đang ở vùng mua 0,382–0,786 → bật lên đỉnh cũ
            return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.8), hi), (int(n_sw * 1.3), x(1.272))], hi, lo + (r(0.786) - lo) * 0.5, n_sw * 1.5,
                       f"Đang ở vùng thoái lui {pos:.2f} của sóng tăng – kịch bản bật lại đỉnh sóng rồi mở rộng 1,272; sai nếu thủng giữa 0,786 và đáy sóng".replace(".", ","))
        return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.6), lo)], lo, r(0.618), n_sw,
                   "Đã thủng 0,786 – sóng tăng trước có thể hỏng, kịch bản về đáy sóng; sai nếu lấy lại 0,618")
    # sóng giảm
    if last <= lo:
        return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.8), x(1.272))], x(1.272), r(0.382), n_sw * 1.5,
                   "Thủng đáy sóng giảm – mục tiêu mở rộng 1,272; sai nếu hồi quá 0,382")
    pos = (last - lo) / rng
    if pos < 0.382:
        return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.6), r(0.382)), (int(n_sw * 1.2), r(0.618))], r(0.618), lo - 0.1 * rng, n_sw * 1.5,
                   "Sóng giảm – kịch bản hồi kỹ thuật lên 0,382 → 0,618 (thường gặp kháng cự); sai nếu thủng đáy sóng")
    return _mk("fib", tf, last, [(0, last), (int(n_sw * 0.6), lo)], lo, r(0.786), n_sw,
               f"Đã hồi {pos:.2f} sóng giảm – vùng kháng cự 0,5–0,618, kịch bản quay lại đáy; sai nếu vượt 0,786".replace(".", ","))


# ------------------------------------------------------------------ SMC (dòng tiền lớn)
def smc(df: pd.DataFrame, tf: str = "D") -> dict | None:
    s = smc_.analyze(df if tf == "D" else df.iloc[-156:])      # khung tuần: 3 năm gần nhất
    if not s.get("ok"):
        return None
    last = float(df["close"].iloc[-1])
    rg, liq = s["range"], s.get("liquidity") or {}
    n = 20 if tf == "D" else 8
    if s["bias"] >= 0.2:
        tgt = (liq.get("buy_side") or [{}])[0].get("price") or (rg["high"] if rg["high"] > last * 1.01 else last * 1.1)
        ob = s.get("bull_ob")
        ob = ob if ob and ob["bottom"] > last * 0.8 else None
        tgt = min(tgt, last * 1.4)
        stop = (ob["bottom"] * 0.99) if ob and ob["bottom"] < last else max(rg["low"] * 0.99, last * 0.8)
        path = [(0, last)]
        if ob and ob["top"] < last * 0.985:                  # về test OB mua rồi mới đi lên
            path.append((int(n * 0.4), ob["top"]))
        path.append((n, tgt))
        return _mk("smc", tf, last, path, tgt, stop, n * 2,
                   f"Cấu trúc tăng / vùng discount – dòng tiền lớn thường kéo tới thanh khoản phía trên ({vn(tgt)}); sai nếu thủng {'OB mua' if ob else 'đáy vùng giá'} ({vn(stop)})")
    if s["bias"] <= -0.2:
        tgt = (liq.get("sell_side") or [{}])[0].get("price") or (rg["low"] if rg["low"] < last * 0.99 else last * 0.9)
        ob = s.get("bear_ob")
        ob = ob if ob and ob["top"] < last * 1.2 else None
        tgt = max(tgt, last * 0.6)
        stop = (ob["top"] * 1.01) if ob and ob["top"] > last else min(rg["high"] * 1.01, last * 1.2)
        path = [(0, last)]
        if ob and ob["bottom"] > last * 1.015:
            path.append((int(n * 0.4), ob["bottom"]))
        path.append((n, tgt))
        return _mk("smc", tf, last, path, tgt, stop, n * 2,
                   f"Cấu trúc giảm / vùng premium – kịch bản quét thanh khoản phía dưới ({vn(tgt)}); sai nếu vượt {'OB bán' if ob else 'đỉnh vùng giá'} ({vn(stop)})")
    return None


# ------------------------------------------------------------------ Xu hướng (MA) – kéo dài đà hiện tại, giảm dần
def trend(df: pd.DataFrame, tf: str = "D") -> dict | None:
    c = df["close"]
    n = 60 if tf == "D" else 26
    if len(c) < n * 2:
        return None
    ma_s, ma_l = c.rolling(50 if tf == "D" else 10).mean(), c.rolling(200 if tf == "D" else 40).mean()
    last = float(c.iloc[-1])
    if not (np.isfinite(ma_s.iloc[-1]) and np.isfinite(ma_l.iloc[-1])):
        return None
    y = np.log(c.iloc[-n:].values)
    slope = float(np.polyfit(np.arange(n), y, 1)[0])            # log-giá / nến
    upt = last > ma_s.iloc[-1] > ma_l.iloc[-1]
    dnt = last < ma_s.iloc[-1] < ma_l.iloc[-1]
    if not (upt or dnt) or (upt and slope <= 0) or (dnt and slope >= 0):
        return None
    h = n
    pts = [(0, last)]
    acc = 0.0
    for b in range(1, h + 1):
        acc += slope * (1 - b / (2 * h))                         # đà giảm dần một nửa sau h nến
        if b % (h // 4) == 0:
            pts.append((b, last * np.exp(acc)))
    tgt = pts[-1][1]
    stop = float(ma_s.iloc[-1]) * (0.97 if upt else 1.03)
    return _mk("trend", tf, last, pts, tgt, stop, h,
               f"Giá {'trên' if upt else 'dưới'} MA50 {'>' if upt else '<'} MA200 – kéo dài đà {n} {'phiên' if tf == 'D' else 'tuần'} qua (giảm dần); sai nếu đóng cửa {'dưới' if upt else 'trên'} MA50 ±3%")


# ------------------------------------------------------------------ Thống kê: dải xác suất từ lịch sử biến động của chính mã
def cone(df: pd.DataFrame, horizons=(20, 60, 120)) -> dict | None:
    c = df["close"].iloc[-1260:]                                 # ~5 năm
    if len(c) < 260:
        return None
    lr = np.log(c).diff().dropna().values
    last = float(c.iloc[-1])
    out = {"kind": "cone", "entry": round(last, 2), "bands": []}
    rng = np.random.default_rng(7)
    # khối 5 phiên (giữ tương quan ngắn hạn), 2.000 đường
    blocks = np.lib.stride_tricks.sliding_window_view(lr, 5)
    H = max(horizons)
    sims = np.zeros((2000, H))
    for i in range(2000):
        pick = blocks[rng.integers(0, len(blocks), size=H // 5 + 1)].ravel()[:H]
        sims[i] = np.cumsum(pick)
    for b in list(range(5, H + 1, 5)):
        q = np.quantile(sims[:, b - 1], [0.1, 0.25, 0.5, 0.75, 0.9])
        out["bands"].append([b] + [round(last * float(np.exp(x)), 2) for x in q])
    out["prob_up"] = {str(h): round(float((sims[:, h - 1] > 0).mean()) * 100, 0) for h in horizons}
    return out


METHODS = {"elliott": elliott, "fib": fibonacci, "smc": smc, "trend": trend}


def all_for(df: pd.DataFrame) -> dict:
    """Kịch bản cho trang mã: khung ngày + khung tuần cho từng cách chơi, cộng dải thống kê."""
    out = {}
    w = mtf_.resample(df, "W")
    for k, fn in METHODS.items():
        for tf, d in (("D", df.iloc[-600:]), ("W", w.iloc[-260:])):
            try:
                sc = fn(d, tf) if len(d) >= 60 else None
            except Exception:  # noqa: BLE001
                sc = None
            if sc and not (tf == "W" and out.get(f"{k}_D", {}).get("target") == sc["target"]):
                out[f"{k}_{tf}"] = sc
    try:
        cn = cone(df)
        if cn:
            out["cone"] = cn
    except Exception:  # noqa: BLE001
        pass
    return out
