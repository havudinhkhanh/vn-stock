"""Mùa vụ: "ngày này các năm trước" và "tháng này các năm trước".

- same_date: nếu mua đúng ngày này (cùng ngày/tháng) ở mỗi năm trước, sau 1 / 2 / 3 tháng (21 / 42 / 63 phiên)
  lãi lỗ bao nhiêu %, hơn/kém VN-Index bao nhiêu, bao nhiêu năm có lãi.
- monthly: lợi nhuận theo từng tháng dương lịch (trung bình, % năm tăng, so với VN-Index).
- oos: KIỂM CHỨNG NGOÀI MẪU – với mỗi năm chỉ dùng các năm TRƯỚC đó để đoán tháng mạnh/yếu (hoặc 1 tháng tới từ
  cùng ngày), rồi so với kết quả thật năm đó. Cho biết mùa vụ là thật hay chỉ trùng hợp.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

H = {1: 21, 2: 42, 3: 63}


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _anchor(idx: pd.DatetimeIndex, y: int, m: int, d: int):
    try:
        t = pd.Timestamp(year=y, month=m, day=d)
    except ValueError:
        t = pd.Timestamp(year=y, month=m, day=28)
    i = idx.searchsorted(t)
    if i >= len(idx) or (idx[i] - t).days > 7:
        return None
    return i


def same_date(close: pd.Series, bench: pd.Series | None, today: pd.Timestamp, min_years: int = 4) -> dict:
    c = close.dropna()
    if len(c) < 300:
        return {"ok": False}
    b = bench.reindex(c.index).ffill() if bench is not None else None
    rows = []
    for y in range(c.index[0].year, today.year):
        i = _anchor(c.index, y, today.month, today.day)
        if i is None or i < 5:
            continue
        rec = {"year": y, "date": str(c.index[i].date())}
        for k, n in H.items():
            if i + n < len(c) and c.index[i + n] < today:
                if not (c.iloc[i] > 0 and c.iloc[i + n] > 0):
                    continue
                r = 100 * (c.iloc[i + n] / c.iloc[i] - 1)
                rec[f"r{k}"] = _r(r, 1)
                if b is not None and b.iloc[i] and b.iloc[i + n]:
                    rec[f"rel{k}"] = _r(r - 100 * (b.iloc[i + n] / b.iloc[i] - 1), 1)
        rows.append(rec)
    out = {"ok": True, "years": rows}
    for k in H:
        v = [x[f"r{k}"] for x in rows if x.get(f"r{k}") is not None]
        rv = [x[f"rel{k}"] for x in rows if x.get(f"rel{k}") is not None]
        if len(v) >= min_years:
            out[f"h{k}"] = {"n": len(v), "mean": _r(np.mean(v), 2), "med": _r(np.median(v), 2), "hit": _r(100 * np.mean(np.array(v) > 0), 0),
                            "best": _r(max(v), 1), "worst": _r(min(v), 1),
                            "rel": _r(np.mean(rv), 2) if rv else None, "relhit": _r(100 * np.mean(np.array(rv) > 0), 0) if rv else None}
    out["ok"] = "h1" in out
    return out


def _monthly_table(close: pd.Series, bench: pd.Series | None, today: pd.Timestamp) -> pd.DataFrame:
    m = close.dropna().resample("ME").last()
    r = m.pct_change(fill_method=None) * 100
    df = pd.DataFrame({"r": r})
    if bench is not None:
        bm = bench.dropna().resample("ME").last().pct_change(fill_method=None) * 100
        df["rel"] = df["r"] - bm.reindex(df.index)
    df = df[df.index < pd.Timestamp(today.year, today.month, 1)].dropna(subset=["r"])
    df["y"], df["m"] = df.index.year, df.index.month
    return df


def monthly(close: pd.Series, bench: pd.Series | None, today: pd.Timestamp) -> list[dict]:
    df = _monthly_table(close, bench, today)
    out = []
    for mth in range(1, 13):
        g = df[df["m"] == mth]
        if len(g) < 3:
            out.append({"m": mth, "n": len(g)})
            continue
        rec = {"m": mth, "n": int(len(g)), "mean": _r(g["r"].mean(), 2), "hit": _r(100 * (g["r"] > 0).mean(), 0)}
        if "rel" in g and g["rel"].notna().any():
            rec["rel"] = _r(g["rel"].mean(), 2)
            rec["relhit"] = _r(100 * (g["rel"] > 0).mean(), 0)
        out.append(rec)
    return out


STRONG = {"rel": 3.0, "hit": 75, "n": 8}  # ngưỡng chặt: kiểm chứng ngoài mẫu cho thấy ngưỡng lỏng hơn không có tác dụng


def is_strong(x: dict) -> bool:
    return bool(x and (x.get("n") or 0) >= STRONG["n"] and (x.get("rel") or 0) >= STRONG["rel"] and (x.get("relhit") or 0) >= STRONG["hit"])


def is_weak(x: dict) -> bool:
    return bool(x and (x.get("n") or 0) >= STRONG["n"] and (x.get("rel") or 0) <= -STRONG["rel"] and (x.get("relhit") or 100) <= 100 - STRONG["hit"])


def profile(close: pd.Series, bench: pd.Series | None, today: pd.Timestamp) -> dict:
    sd = same_date(close, bench, today)
    mo = monthly(close, bench, today)
    nxt = [(today.month + i - 1) % 12 + 1 for i in (0, 1, 2)]
    windows = [{"m": m, **{k: v for k, v in mo[m - 1].items() if k != "m"}, "strong": is_strong(mo[m - 1]), "weak": is_weak(mo[m - 1])} for m in nxt]
    return {"same": sd, "months": mo, "next": windows, "date": str(today.date())}


def oos(series: dict[str, pd.Series], bench: pd.Series, today: pd.Timestamp, min_prior: int = 4, th_rel: float = 1.0, th_hit: float = 60) -> dict:
    """Kiểm chứng ngoài mẫu trên nhiều chuỗi (ngành): mỗi năm chỉ dùng các năm trước để đoán."""
    rows = []
    for name, c in series.items():
        df = _monthly_table(c, bench, today)
        if df.empty or "rel" not in df:
            continue
        for (y, mth), g in df.groupby(["y", "m"]):
            prior = df[(df["m"] == mth) & (df["y"] < y)]["rel"].dropna()
            if len(prior) < min_prior:
                continue
            mean, hit = prior.mean(), 100 * (prior > 0).mean()
            pred = 1 if (mean >= th_rel and hit >= th_hit) else -1 if (mean <= -th_rel and hit <= 100 - th_hit) else 0
            rows.append({"name": name, "y": y, "m": mth, "pred": pred, "act": float(g["rel"].iloc[0])})
    if not rows:
        return {"ok": False}
    t = pd.DataFrame(rows)
    res = {"ok": True, "n": int(len(t)), "years": [int(t["y"].min()), int(t["y"].max())]}
    for p, k in ((1, "strong"), (-1, "weak"), (0, "none")):
        g = t[t["pred"] == p]
        res[k] = {"n": int(len(g)), "rel": _r(g["act"].mean(), 2), "pos": _r(100 * (g["act"] > 0).mean(), 0)} if len(g) else {"n": 0}
    sg = t[t["pred"] != 0]
    res["hit"] = _r(100 * (np.sign(sg["act"]) == sg["pred"]).mean(), 0) if len(sg) else None
    # theo từng nửa giai đoạn để xem có ổn định không
    mid = int(np.median(t["y"]))
    for lab, g in (("a", t[t["y"] < mid]), ("b", t[t["y"] >= mid])):
        s_ = g[g["pred"] == 1]
        res[f"strong_{lab}"] = _r(s_["act"].mean(), 2) if len(s_) else None
        w_ = g[g["pred"] == -1]
        res[f"weak_{lab}"] = _r(w_["act"].mean(), 2) if len(w_) else None
    res["mid"] = mid
    return res


def support(o: dict | None, mt: dict | None, extra: list | None = None) -> dict:
    """Năm nay số liệu có ủng hộ mùa vụ không: đà giá đa khung, triển vọng ngành, lợi nhuận, độ rộng."""
    pros, cons = [], []
    if o:
        m3 = o.get("m3") or {}
        if m3.get("score") is not None:
            (pros if m3["score"] >= 55 else cons if m3["score"] < 40 else []).append(f"triển vọng 3–6 tháng {m3['score']:.0f}/100")
        f = o.get("factors") or {}
        e = (f.get("earn") or {}).get("raw")
        if e is not None:
            (pros if e >= 10 else cons if e <= -5 else []).append(f"lợi nhuận 12 tháng {e:+.0f}%")
        b = (f.get("breadth") or {}).get("raw")
        if b is not None:
            (pros if b >= 50 else cons if b <= 30 else []).append(f"{b:.0f}% mã trên MA200")
    if mt and mt.get("summary"):
        sg = mt["summary"].get("signs") or {}
        if sg.get("W") == 1 or sg.get("M") == 1:
            pros.append("khung tuần/tháng đang tăng")
        if sg.get("W") == -1 and sg.get("M") == -1:
            cons.append("khung tuần và tháng đều giảm")
    for cond, pro, con in (extra or []):
        if cond is True:
            pros.append(pro)
        elif cond is False:
            cons.append(con)
    ok = len(pros) >= 2 and len(pros) > len(cons)
    bad = len(cons) >= 2 and len(cons) > len(pros)
    return {"verdict": "yes" if ok else "no" if bad else "mixed", "pros": pros, "cons": cons}
