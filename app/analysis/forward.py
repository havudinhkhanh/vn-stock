"""Theo dõi tín hiệu thực tế (forward test).

Mỗi lượt chạy ghi lại danh sách MUA (và danh sách chờ) của ngày hôm đó vào data/fwd_log.parquet.
Các lượt sau đo lại: mã được báo mua đã đi thế nào sau 5/20/60 phiên, so với VN-Index,
và một "danh mục giấy" làm đúng theo hệ thống (vào lệnh ở giá đóng cửa ngày báo,
thoát khi đóng cửa dưới điểm cắt lỗ, chạm mục tiêu 1, hoặc sau 60 phiên).

Khác backtest: đây là kết quả *sau* thời điểm ra tín hiệu, không thể tối ưu ngược – thước đo trung thực nhất.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

HOLD_MAX = 60
HORIZONS = (5, 20, 60)


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def log_rows(plan: dict, regime: dict, date) -> pd.DataFrame:
    rows = []
    for kind, lst in (("pick", plan.get("picks") or []), ("watch", plan.get("watch") or [])):
        for p in lst:
            z = p.get("zone") or [None, None]
            rows.append({"date": pd.Timestamp(date).normalize(), "symbol": p["symbol"], "kind": kind,
                         "basket": p.get("basket"), "price": p.get("price"), "zone_lo": z[0], "zone_hi": z[1],
                         "stop": p.get("stop"), "t1": p.get("t1"), "weight": p.get("weight") if kind == "pick" else 0.0,
                         "score": p.get("score"), "light": regime.get("light"), "exposure": regime.get("exposure")})
    return pd.DataFrame(rows)


def evaluate(log: pd.DataFrame, wide: pd.DataFrame, idx: pd.Series) -> dict:
    if log is None or log.empty:
        return {"ok": False, "reason": "Chưa có tín hiệu nào được ghi lại – bắt đầu từ lượt chạy kế tiếp."}
    log = log.copy()
    log["date"] = pd.to_datetime(log["date"])
    days = wide.index
    pos_of = {d: i for i, d in enumerate(days)}
    idx = idx.reindex(days).ffill()

    def at(d):
        i = days.searchsorted(d)
        return min(i, len(days) - 1)

    # ---- các "lượt" mua: cùng mã được báo nhiều ngày liền khi vị thế còn mở thì tính là 1 lượt
    picks = log[log["kind"] == "pick"].sort_values(["date", "symbol"])
    eps, open_until = [], {}
    for r in picks.itertuples():
        s = r.symbol
        if s not in wide.columns:
            continue
        i0 = at(r.date)
        if open_until.get(s, -1) >= i0:
            continue
        c = wide[s]
        entry = float(r.price) if r.price and r.price == r.price else float(c.iloc[i0])
        exit_i, why = None, None
        for j in range(i0 + 1, min(len(days), i0 + 1 + HOLD_MAX)):
            px = c.iloc[j]
            if px != px:
                continue
            if r.stop and px <= r.stop:
                exit_i, why = j, "Cắt lỗ"
                break
            if r.t1 and px >= r.t1:
                exit_i, why = j, "Chốt lời (mục tiêu 1)"
                break
        last_i = len(days) - 1
        if exit_i is None:
            if i0 + HOLD_MAX <= last_i:
                exit_i, why = i0 + HOLD_MAX, "Hết 60 phiên"
            else:
                exit_i, why = last_i, "Đang giữ"
        px_exit = float(c.iloc[exit_i]) if c.iloc[exit_i] == c.iloc[exit_i] else entry
        ret = px_exit / entry - 1
        bret = float(idx.iloc[exit_i] / idx.iloc[i0] - 1) if idx.iloc[i0] else 0.0
        hz = {}
        for h in HORIZONS:
            if i0 + h <= last_i and c.iloc[i0 + h] == c.iloc[i0 + h]:
                a = float(c.iloc[i0 + h] / entry - 1)
                b = float(idx.iloc[i0 + h] / idx.iloc[i0] - 1)
                hz[f"r{h}"], hz[f"x{h}"] = _r(100 * a, 1), _r(100 * (a - b), 1)
        seg = c.iloc[i0:exit_i + 1]
        mae = float(seg.min() / entry - 1) if len(seg) else 0.0
        open_until[s] = exit_i if why != "Đang giữ" else 10 ** 9
        eps.append({"symbol": s, "date": str(days[i0].date()), "basket": r.basket, "light": r.light, "weight": _r(r.weight, 1),
                    "entry": _r(entry), "stop": _r(r.stop), "t1": _r(r.t1), "score": _r(r.score, 0),
                    "exit_date": str(days[exit_i].date()), "status": why, "days": int(exit_i - i0),
                    "ret": _r(100 * ret, 1), "bench": _r(100 * bret, 1), "excess": _r(100 * (ret - bret), 1),
                    "mae": _r(100 * mae, 1), "_i0": i0, "_ie": exit_i, **hz})

    # ---- danh mục giấy
    nav = []
    if eps:
        first = min(e["_i0"] for e in eps)
        rets = wide.pct_change(fill_method=None)
        v, vb = 1.0, 1.0
        for t in range(first, len(days)):
            if t > first:
                act = [e for e in eps if e["_i0"] < t <= e["_ie"]]
                w = np.array([(e["weight"] or 0) / 100 for e in act])
                if w.sum() > 1:
                    w = w / w.sum()
                rr = np.array([rets[e["symbol"]].iloc[t] for e in act], dtype=float)
                rr = np.nan_to_num(rr)
                v *= 1 + float((w * rr).sum())
                vb *= float(idx.iloc[t] / idx.iloc[t - 1]) if idx.iloc[t - 1] else 1.0
                inv = float(w.sum())
            else:
                inv = 0.0
            nav.append({"d": str(days[t].date()), "v": round(v, 4), "b": round(vb, 4), "inv": round(100 * inv, 0)})

    def summ(lst):
        done = [e for e in lst if e["status"] != "Đang giữ"]
        out = {"n": len(lst), "closed": len(done), "open": len(lst) - len(done)}
        for key, arr in (("all", lst), ("closed", done)):
            if arr:
                out[f"{key}_win"] = _r(100 * np.mean([e["ret"] > 0 for e in arr if e["ret"] is not None]), 0)
                out[f"{key}_beat"] = _r(100 * np.mean([e["excess"] > 0 for e in arr if e["excess"] is not None]), 0)
                out[f"{key}_ret"] = _r(np.mean([e["ret"] for e in arr if e["ret"] is not None]), 1)
                out[f"{key}_excess"] = _r(np.mean([e["excess"] for e in arr if e["excess"] is not None]), 1)
        for h in HORIZONS:
            xs = [e[f"x{h}"] for e in lst if e.get(f"x{h}") is not None]
            if xs:
                out[f"x{h}_n"], out[f"x{h}_avg"], out[f"x{h}_hit"] = len(xs), _r(np.mean(xs), 1), _r(100 * np.mean([x > 0 for x in xs]), 0)
        return out

    by_basket = {}
    for e in eps:
        by_basket.setdefault(e["basket"] or "?", []).append(e)
    by_light = {}
    for e in eps:
        by_light.setdefault(e["light"] or "?", []).append(e)
    # danh sách chờ: nếu mua ngay thay vì chờ thì sau 20 phiên ra sao (đánh giá giá trị của việc "chờ giá")
    w20 = []
    for r in log[log["kind"] == "watch"].drop_duplicates("symbol", keep="first").itertuples():
        if r.symbol not in wide.columns:
            continue
        i0 = at(r.date)
        if i0 + 20 < len(days):
            a = wide[r.symbol].iloc[i0 + 20] / wide[r.symbol].iloc[i0] - 1
            b = idx.iloc[i0 + 20] / idx.iloc[i0] - 1
            if a == a:
                w20.append(100 * float(a - b))
    for e in eps:
        e.pop("_i0", None); e.pop("_ie", None)
    v_last = nav[-1] if nav else None
    return {"ok": True, "start": str(log["date"].min().date()), "last": str(days[-1].date()),
            "days_logged": int(log["date"].nunique()), "episodes": sorted(eps, key=lambda e: e["date"], reverse=True)[:300],
            "summary": summ(eps), "by_basket": {k: summ(v) for k, v in by_basket.items()},
            "by_light": {k: summ(v) for k, v in by_light.items()},
            "watch20": {"n": len(w20), "avg_excess": _r(np.mean(w20), 1) if w20 else None},
            "nav": nav, "nav_ret": _r(100 * (v_last["v"] - 1), 1) if v_last else None,
            "bench_ret": _r(100 * (v_last["b"] - 1), 1) if v_last else None}
