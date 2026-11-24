"""Kiểm chứng vòng 2 (sau rà soát): giá đi trước thật hay không, doanh thu có thêm gì ngoài lợi nhuận, tương quan TRONG ngành,
độ bền của tương quan từng mã (để co về ngành), kiểm tra dữ liệu ngân hàng / nhảy đơn vị.
Chạy: research.yml script=fundcorr_test2 → research_out/fundcorr2.json + log."""
from __future__ import annotations

import json
import os

import numpy as np
import pandas as pd

from app.analysis import fundcorr as fc
from app.analysis import peers as pr_
from app.data import store

os.makedirs("research_out", exist_ok=True)
OUT: dict = {}


def save():
    with open("research_out/fundcorr2.json", "w", encoding="utf-8") as f:
        json.dump(OUT, f, ensure_ascii=False, indent=1, default=lambda o: None if isinstance(o, float) and not np.isfinite(o) else str(o))


def pr(*a):
    print(*a, flush=True)


prices = store.read("prices"); fin_q = store.read("fin_q"); listing = store.read("listing")
prices["date"] = pd.to_datetime(prices["date"])
idx = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"].sort_index()
wide = prices[~prices["symbol"].isin(["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX", "HNX30"])].pivot_table(index="date", columns="symbol", values="close").sort_index().ffill(limit=5)
lst = listing.set_index("symbol")
for c in ("sector", "industry", "subindustry", "name", "com_type"):
    if c not in lst:
        lst[c] = None
lst["sector"] = lst["sector"].fillna("Khác"); lst["industry"] = lst["industry"].fillna(lst["sector"])
lst = pr_.assign_all(lst); lst["peer_label"] = lst["peer"].map(pr_.label)
ctype = lst["com_type"].fillna("CT").to_dict()

# ---- 0) dữ liệu: quý đầu tiên có BCTC, ngân hàng
fq = fin_q.copy(); fq["qi"] = fq["year"] * 4 + fq["quarter"] - 1
first = fq.groupby("symbol")["qi"].min()
OUT["fin_first_q_dist"] = (first // 4).value_counts().sort_index().to_dict()
pr("Năm có quý BCTC đầu tiên (số mã):", OUT["fin_first_q_dist"])
banks = [s for s, t in ctype.items() if t == "NH"]
for s in ("VCB", "TCB", "MBB", "ACB"):
    d = fq[fq["symbol"] == s].sort_values("qi").tail(4)
    if len(d):
        pr("NH", s, d[["year", "quarter", "revenue", "toi", "nii", "ni_parent"]].round(0).to_dict("records"))

ttm = fc.ttm_frame(fin_q, ctype)
P = fc.panel(wide, idx, ttm)
P = P.merge(lst[["peer_label", "sector"]], left_on="symbol", right_index=True, how="left")
pr("panel", P.shape, "mã", P["symbol"].nunique(), "quý từ", P["qi"].min() // 4)
# tăng trưởng vượt mâm (mã − trung vị mâm cùng quý)
for f in ("np", "rev"):
    med = P.groupby(["lag", "qi", "peer_label"])["g_" + f].transform("median")
    P["gx_" + f] = P["g_" + f] - med
    pmed = P.groupby(["lag", "qi", "peer_label"])["dp"].transform("mean")
P["dpp"] = P["dp"] - P.groupby(["lag", "qi", "peer_label"])["dp"].transform("mean")      # giá vượt bình quân mâm


def ic_series(d, gcol, pcol, minn=30):
    v = []
    for q, dq in d.groupby("qi"):
        if len(dq) >= minn:
            v.append(fc._sp(dq[gcol].to_numpy(float), dq[pcol].to_numpy(float)))
    return np.array([x for x in v if np.isfinite(x)])


def ic_sum(v):
    if not len(v):
        return None
    h = len(v) // 2
    return {"q": int(len(v)), "mean": round(float(v.mean()), 3), "pos": round(float((v > 0).mean()), 2), "h1": round(float(v[:h].mean()), 3), "h2": round(float(v[h:].mean()), 3)}


# ---- 1) giá đi trước? IC theo lệch – TTM và RIÊNG QUÝ (riêng quý: ở k ≥ 1 thị trường CHƯA biết số đó)
OUT["ic_lag"] = {}
for k in fc.LAGS:
    d = P[P["lag"] == k]
    for g in ("g_np", "g_rev", "g_np1", "g_rev1"):
        OUT["ic_lag"][f"k{k}|{g}"] = ic_sum(ic_series(d, g, "dpx"))
for k_, v in OUT["ic_lag"].items():
    pr("IC", k_, v)
save()

# ---- 2) doanh thu có thêm gì ngoài lợi nhuận? hồi quy thứ hạng từng quý: giá vượt TT ~ hạng LN + hạng DT
OUT["incr"] = {}
for k in (0, 1, 2):
    bn, br, pic = [], [], []
    for q, dq in P[P["lag"] == k].dropna(subset=["g_np", "g_rev", "dpx"]).groupby("qi"):
        if len(dq) < 50:
            continue
        y = dq["dpx"].rank(pct=True).to_numpy() - .5
        X = np.column_stack([dq["g_np"].rank(pct=True) - .5, dq["g_rev"].rank(pct=True) - .5, np.ones(len(dq))])
        b = np.linalg.lstsq(X, y, rcond=None)[0]
        bn.append(b[0]); br.append(b[1])
        # IC riêng phần DT không trùng LN (phần dư của hạng DT sau khi bỏ hạng LN)
        xr = X[:, 1] - np.polyval(np.polyfit(X[:, 0], X[:, 1], 1), X[:, 0])
        pic.append(fc._sp(xr, y))
    bn, br, pic = map(np.array, (bn, br, pic))
    OUT["incr"][f"k{k}"] = {"q": len(bn), "b_np": round(float(bn.mean()), 3), "t_np": round(float(bn.mean() / (bn.std(ddof=1) / np.sqrt(len(bn))) / 2), 2),
                           "b_rev": round(float(br.mean()), 3), "t_rev": round(float(br.mean() / (br.std(ddof=1) / np.sqrt(len(br))) / 2), 2),
                           "partial_ic_rev": round(float(np.nanmean(pic)), 3), "pos_b_rev": round(float((br > 0).mean()), 2)}
    pr("Thêm DT ngoài LN", k, OUT["incr"][f"k{k}"], "(t đã chia 2 vì chồng cửa sổ)")
save()

# ---- 3) TRONG mâm: cắt ngang từng quý, giá vượt bình quân mâm ~ tăng trưởng (thô) – theo mâm, lệch 0 & 1
OUT["within"] = {}
for (name, k), d in P[P["lag"].isin([0, 1])].groupby(["peer_label", "lag"]):
    r = {f: ic_sum(ic_series(d, "g_" + f, "dp", 5)) for f in ("np", "rev")}
    if r["np"] and r["np"]["q"] >= 12:
        r["m"] = int(d["symbol"].nunique())
        OUT["within"][f"{name}|k{k}"] = r
for k_, v in sorted(OUT["within"].items(), key=lambda t: -t[1]["np"]["mean"]):
    pr("TRONG MÂM", f"{k_:48s} m={v['m']:3d} LN {v['np']} DT {v['rev']}")
# độ bền giữa 2 nửa của IC trong mâm (mâm nào nửa đầu theo LN mạnh, nửa sau còn mạnh?)
for k in (0, 1):
    for f in ("np", "rev"):
        a = [(v[f]["h1"], v[f]["h2"]) for k_, v in OUT["within"].items() if k_.endswith(f"|k{k}") and v.get(f)]
        if len(a) > 8:
            a = np.array(a)
            OUT[f"within_persist_k{k}_{f}"] = round(fc._sp(a[:, 0], a[:, 1]), 3)
            pr("Độ bền IC trong mâm 2 nửa", k, f, OUT[f"within_persist_k{k}_{f}"], "n mâm", len(a))
save()

# ---- 4) từng mã: độ bền (để co về mâm). 3 cách đo: thô/thô, giá vượt TT/thô, giá vượt mâm/tăng trưởng vượt mâm
OUT["persist"] = {}
for k in (0, 1, 2):
    d0 = P[P["lag"] == k].sort_values("qi")
    for nm, pc, gc in (("raw", "dp", "g_"), ("x", "dpx", "g_"), ("peer", "dpp", "gx_")):
        for f in ("np", "rev"):
            c, c1, c2 = [], [], []
            for s, d in d0.groupby("symbol"):
                g = d[gc + f].to_numpy(float); y = d[pc].to_numpy(float)
                ok = np.isfinite(g) & np.isfinite(y)
                if ok.sum() < fc.MIN_Q:
                    continue
                g, y = g[ok], y[ok]; h = len(g) // 2
                c.append(fc._sp(g, y)); c1.append(fc._sp(g[:h], y[:h])); c2.append(fc._sp(g[h:], y[h:]))
            c, c1, c2 = map(np.array, (c, c1, c2))
            m = np.isfinite(c1) & np.isfinite(c2)
            rho = fc._sp(c1[m], c2[m]) if m.sum() > 20 else np.nan
            OUT["persist"][f"k{k}|{nm}|{f}"] = {"n": int(len(c)), "med": round(float(np.nanmedian(c)), 3), "iqr": [round(float(np.nanpercentile(c, 25)), 3), round(float(np.nanpercentile(c, 75)), 3)],
                                                 "rho_halves": round(float(rho), 3) if np.isfinite(rho) else None}
for k_, v in OUT["persist"].items():
    pr("BỀN", f"{k_:18s}", v)
save()

# ---- 5) toàn thị trường theo lệch (chuỗi TB đều) – để vẽ "giá đi trước"
G = fc.group_series(P, ttm, list(P["symbol"].unique()))
OUT["market_ts"] = {int(k): {"np": round(fc._sp(d["g_np"].to_numpy(float), d["dp"].to_numpy(float)), 3), "rev": round(fc._sp(d["g_rev"].to_numpy(float), d["dp"].to_numpy(float)), 3), "n": len(d)}
                    for k, d in G.groupby("lag")}
pr("Thị trường (chuỗi):", OUT["market_ts"])
save()
pr("XONG")
