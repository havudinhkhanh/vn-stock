"""Kiểm chứng kịch bản giá (app/analysis/scenarios.py) trên dữ liệu VN – khung ngày & tuần.

Mỗi tháng (20 phiên) từ 2017, với mỗi mã đủ thanh khoản (GTGD TB 60 phiên ≥ 3 tỷ): dựng kịch bản đúng như trang mã,
rồi xem giá THẬT sau đó chạm mục tiêu trước hay chạm mức sai (cắt lỗ) trước trong số phiên dự kiến.
So với "giả dược": cùng mã, cùng khoảng cách mục tiêu / cắt lỗ (%), đặt vào một thời điểm ngẫu nhiên khác của mã đó
→ khử được xu hướng chung của thị trường và độ biến động riêng của mã. Lợi thế = tỷ lệ trúng − tỷ lệ trúng giả dược.
Dải xác suất (cone): kiểm tra hiệu chỉnh – giá thật 60 phiên sau nằm trong dải 10–90% bao nhiêu lần (lý tưởng 80%).
Chạy: python -m research.scenarios_test  (cần data/prices.parquet – chạy trên GitHub qua research.yml)."""
from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.analysis import mtf as mtf_  # noqa: E402
from app.analysis import scenarios as sc  # noqa: E402
from app.data import store  # noqa: E402

OUT = os.environ.get("RS_OUT", "research_out")
STEP = int(os.environ.get("RS_STEP", "20"))
MIN_VAL = float(os.environ.get("RS_MINVAL", "3"))
START = pd.Timestamp(os.environ.get("RS_START", "2017-01-01"))
LOG = []


def log(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


def outcome(fut: pd.DataFrame, entry: float, target: float, stop: float, up: bool):
    """1 = chạm mục tiêu trước, 0 = chạm mức sai trước (cùng phiên → tính là sai), nan = hết hạn; kèm lợi nhuận cuối kỳ theo hướng."""
    h, l = fut["high"].values, fut["low"].values
    for i in range(len(fut)):
        hit_t = h[i] >= target if up else l[i] <= target
        hit_s = l[i] <= stop if up else h[i] >= stop
        if hit_s:
            return 0.0, i + 1
        if hit_t:
            return 1.0, i + 1
    return np.nan, len(fut)


def one(args):
    sym, df = args
    rng = np.random.default_rng(abs(hash(sym)) % 2**32)
    df = df.sort_index()
    val = (df["close"] * df["volume"] / 1e6).rolling(60).mean()
    idx = df.index
    cuts = [i for i in range(260, len(df) - 30, STEP) if idx[i] >= START and val.iloc[i] >= MIN_VAL]
    rows, cones = [], []
    for i in cuts:
        d = df.iloc[: i + 1]
        w = mtf_.resample(d, "W")
        for k, fn in sc.METHODS.items():
            for tf, dd in (("D", d.iloc[-600:]), ("W", w.iloc[-260:])):
                if len(dd) < 60:
                    continue
                try:
                    s = fn(dd, tf)
                except Exception:  # noqa: BLE001
                    s = None
                if not s or s.get("stop") is None:
                    continue
                H = min(250, s["horizon"])
                fut = df.iloc[i + 1: i + 1 + H]
                if len(fut) < min(H, 20):
                    continue
                up = s["dir"] > 0
                e, t, st = s["entry"], s["target"], s["stop"]
                o, n_ = outcome(fut, e, t, st, up)
                ret = (fut["close"].iloc[-1] / e - 1) * (1 if up else -1)
                # giả dược: cùng khoảng cách %, thời điểm ngẫu nhiên khác của chính mã
                j = int(rng.integers(260, len(df) - H - 1)) if len(df) - H - 1 > 260 else None
                po = pret = np.nan
                if j is not None and abs(j - i) > 20 and float(df["close"].iloc[j]) > 0:
                    e2 = float(df["close"].iloc[j]); f2 = df.iloc[j + 1: j + 1 + H]
                    po, _ = outcome(f2, e2, e2 * t / e, e2 * st / e, up)
                    pret = (f2["close"].iloc[-1] / e2 - 1) * (1 if up else -1)
                rows.append({"s": sym, "d": idx[i], "m": k, "tf": tf, "dir": s["dir"], "rr": s.get("rr"), "dist_t": abs(t / e - 1), "dist_s": abs(st / e - 1),
                             "H": H, "o": o, "n": n_, "ret": ret, "po": po, "pret": pret, "sub": s["why"][:40]})
        if i % (STEP * 3) == 0 and i + 60 < len(df):
            try:
                cn = sc.cone(d)
                b = next(x for x in cn["bands"] if x[0] == 60)
                real = float(df["close"].iloc[i + 60])
                cones.append({"in80": b[1] <= real <= b[5], "in50": b[2] <= real <= b[4], "above_med": real > b[3]})
            except Exception:  # noqa: BLE001
                pass
    return rows, cones


def summarize(r: pd.DataFrame) -> dict:
    res = r.dropna(subset=["o"])
    pl = r.dropna(subset=["po"])
    both = r.dropna(subset=["o", "po"])
    diff = both["o"] - both["po"]
    t = float(diff.mean() / (diff.std(ddof=1) / np.sqrt(len(diff)))) if len(diff) > 30 and diff.std() > 0 else None
    base = (r["dist_s"] / (r["dist_s"] + r["dist_t"])).mean()
    return {"n": int(len(r)), "resolved": round(100 * len(res) / max(1, len(r)), 0), "hit": round(100 * res["o"].mean(), 1) if len(res) else None,
            "placebo": round(100 * pl["po"].mean(), 1) if len(pl) else None, "edge": round(100 * diff.mean(), 1) if len(diff) else None, "t": round(t, 1) if t else None,
            "rw": round(100 * base, 1), "ret": round(100 * r["ret"].mean(), 2), "pret": round(100 * r["pret"].mean(), 2),
            "rr": round(float(r["rr"].median()), 2) if r["rr"].notna().any() else None, "days": int(res["n"].median()) if len(res) else None}


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    t0 = time.time()
    p = store.read("prices")
    p = p[~p["symbol"].isin(["VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"])]
    p["date"] = pd.to_datetime(p["date"])
    v = (p["close"] * p["volume"] / 1e6).groupby(p["symbol"]).mean()
    syms = [s for s in v.index if v[s] >= 1.0]
    log(f"{len(syms)} mã có thanh khoản (TB ≥ 1 tỷ/phiên) · bước {STEP} phiên · từ {START.date()}")
    jobs = [(s, g.set_index("date")[["open", "high", "low", "close", "volume"]]) for s, g in p[p["symbol"].isin(syms)].groupby("symbol")]
    rows, cones = [], []
    with ProcessPoolExecutor(max(1, os.cpu_count() or 2)) as ex:
        for k, (r, c) in enumerate(ex.map(one, jobs, chunksize=4), 1):
            rows += r; cones += c
            if k % 50 == 0:
                log(f"  {k}/{len(jobs)} mã · {len(rows)} kịch bản · {time.time() - t0:.0f}s")
    R = pd.DataFrame(rows)
    R.to_csv(os.path.join(OUT, "scen_trials.csv.gz"), index=False)
    log(f"\n{len(R)} kịch bản đã kiểm chứng ({R['d'].min()} → {R['d'].max()})")
    out = {"generated": pd.Timestamp.now().isoformat(timespec="seconds"), "n": int(len(R)), "methods": {}}
    for (m, tf), g in R.groupby(["m", "tf"]):
        S = summarize(g)
        S["by_dir"] = {("tang" if d_ > 0 else "giam"): summarize(gg) for d_, gg in g.groupby("dir")}
        g2 = g.assign(half=np.where(pd.to_datetime(g["d"]) < pd.Timestamp("2021-07-01"), "2017-21", "2021-26"))
        S["by_half"] = {h: summarize(gg) for h, gg in g2.groupby("half")}
        out["methods"][f"{m}_{tf}"] = S
        log(f"{m:8s} {tf}: n={S['n']:6d} trúng {S['hit']}% · giả dược {S['placebo']}% · lợi thế {S['edge']} điểm % (t={S['t']}) · ngẫu nhiên lý thuyết {S['rw']}% · "
            f"LN cuối kỳ {S['ret']}% vs {S['pret']}% · R:R tv {S['rr']} · {S['resolved']}% có kết quả trong hạn")
        for dk, ds in S["by_dir"].items():
            log(f"           {dk}: n={ds['n']} trúng {ds['hit']}% · giả dược {ds['placebo']}% · lợi thế {ds['edge']} (t={ds['t']}) · LN {ds['ret']}% vs {ds['pret']}%")
        for hk, hs in S["by_half"].items():
            log(f"           {hk}: n={hs['n']} lợi thế {hs['edge']} (t={hs['t']}) · LN {hs['ret']}% vs {hs['pret']}%")
    if cones:
        C = pd.DataFrame(cones)
        out["cone"] = {"n": int(len(C)), "in80": round(100 * C["in80"].mean(), 1), "in50": round(100 * C["in50"].mean(), 1), "above_med": round(100 * C["above_med"].mean(), 1)}
        log(f"\nDải thống kê 60 phiên: giá thật nằm trong dải 10–90% {out['cone']['in80']}% số lần (lý tưởng 80%), trong 25–75% {out['cone']['in50']}% (lý tưởng 50%) · n={len(C)}")
    json.dump(out, open(os.path.join(OUT, "scen_stats.json"), "w"), ensure_ascii=False, indent=1, default=str)
    open(os.path.join(OUT, "scen.log"), "w").write("\n".join(LOG))
    log(f"xong trong {time.time() - t0:.0f}s")
