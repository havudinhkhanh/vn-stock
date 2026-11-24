"""Kiểm chứng: giá cổ phiếu VN chạy theo LỢI NHUẬN hay DOANH THU, mạnh tới đâu, giá đi trước hay đi sau, có ổn định không.
Chạy trên GitHub qua research.yml với script=fundcorr_test. Kết quả: research_out/fundcorr.json (+ log tóm tắt)."""
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
    with open("research_out/fundcorr.json", "w", encoding="utf-8") as f:
        json.dump(OUT, f, ensure_ascii=False, indent=1, default=lambda o: None if isinstance(o, float) and not np.isfinite(o) else str(o))


prices = store.read("prices"); fin_q = store.read("fin_q"); listing = store.read("listing")
prices["date"] = pd.to_datetime(prices["date"])
idx = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"].sort_index()
wide = prices[~prices["symbol"].isin(["VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX", "HNX30"])].pivot_table(index="date", columns="symbol", values="close").sort_index().ffill(limit=5)
val = (prices.assign(v=prices["close"] * prices["volume"] / 1e6).pivot_table(index="date", columns="symbol", values="v").reindex(wide.index).fillna(0))
avg_val = val.iloc[-60:].mean()
liquid = set(avg_val[avg_val >= 3].index)
print("giá", wide.shape, "BCTC quý", fin_q.shape, "niêm yết", listing.shape, "thanh khoản ≥3 tỷ", len(liquid), flush=True)

ttm = fc.ttm_frame(fin_q)
P = fc.panel(wide, idx, ttm)
OUT["sizes"] = {"ttm": len(ttm), "panel": len(P), "syms": int(P["symbol"].nunique()), "q_from": int(P["qi"].min()) if len(P) else None}
print(OUT["sizes"], flush=True)

lst = listing.set_index("symbol")
for c in ("sector", "industry", "subindustry", "name"):
    if c not in lst:
        lst[c] = None
lst["sector"] = lst["sector"].fillna("Khác"); lst["industry"] = lst["industry"].fillna(lst["sector"])
lst = pr_.assign_all(lst)
lst["peer_label"] = lst["peer"].map(pr_.label)
lst["peer_parent"] = [pr_.PARENT_OF.get(k, "Khác") for k in lst["peer"]]

# ---------- 1) từng mã
per = {}
for s, d in P.groupby("symbol"):
    per[s] = {"raw": fc.stats(d, "dp"), "x": fc.stats(d, "dpx")}
OUT["n_stocks"] = len(per)


def dist(keyset, pc, k, f, sub=None):
    v = [per[s][pc][k]["c_" + f] for s in per if (sub is None or s in sub) and k in per[s][pc] and per[s][pc][k]["n"] >= fc.MIN_Q]
    v = np.array([x for x in v if np.isfinite(x)])
    if not len(v):
        return None
    st = [s for s in per if (sub is None or s in sub) and k in per[s][pc] and per[s][pc][k]["n"] >= fc.MIN_Q
          and np.isfinite(per[s][pc][k]["c1_" + f]) and np.isfinite(per[s][pc][k]["c2_" + f])]
    same = np.mean([np.sign(per[s][pc][k]["c1_" + f]) == np.sign(per[s][pc][k]["c2_" + f]) for s in st]) if st else np.nan
    both = np.mean([(per[s][pc][k]["c1_" + f] > 0.2) and (per[s][pc][k]["c2_" + f] > 0.2) for s in st]) if st else np.nan
    # tương quan giữa 2 nửa (mã nào nửa đầu theo LN mạnh thì nửa sau có còn mạnh?)
    a = np.array([per[s][pc][k]["c1_" + f] for s in st]); b = np.array([per[s][pc][k]["c2_" + f] for s in st])
    persist = fc._sp(a, b) if len(st) > 20 else np.nan
    return {"n": int(len(v)), "med": float(np.median(v)), "mean": float(v.mean()), "p25": float(np.percentile(v, 25)), "p75": float(np.percentile(v, 75)),
            "gt03": float((v > 0.3).mean()), "gt05": float((v > 0.5).mean()), "lt0": float((v < 0).mean()), "sign_same_halves": float(same), "both_halves_gt02": float(both),
            "persist_rank_corr": float(persist) if np.isfinite(persist) else None}


OUT["dist"] = {}
for nm, sub in (("all", None), ("liquid", liquid)):
    for pc in ("raw", "x"):
        for k in fc.LAGS:
            for f in ("np", "rev"):
                OUT["dist"][f"{nm}|{pc}|k{k}|{f}"] = dist(None, pc, k, f, sub)
save()
for key, v in OUT["dist"].items():
    if v:
        print(f"{key:28s} n={v['n']:4d} med={v['med']:+.3f} >0.3={v['gt03']:.0%} <0={v['lt0']:.0%} cùng dấu 2 nửa={v['sign_same_halves']:.0%} bền={v['persist_rank_corr']}", flush=True)

# NP thắng REV ở bao nhiêu mã (lệch 0, thô / vượt TT)
for pc in ("raw", "x"):
    ok = [s for s in per if 0 in per[s][pc] and per[s][pc][0]["n"] >= fc.MIN_Q and np.isfinite(per[s][pc][0]["c_np"]) and np.isfinite(per[s][pc][0]["c_rev"])]
    w = np.mean([per[s][pc][0]["c_np"] > per[s][pc][0]["c_rev"] for s in ok]) if ok else np.nan
    vd = pd.Series([fc.verdict(per[s][pc][0]["c_np"], per[s][pc][0]["c_rev"]) for s in ok]).value_counts(normalize=True).round(3).to_dict()
    OUT[f"np_beats_rev_{pc}"] = {"n": len(ok), "share": float(w), "verdict": vd}
    print(pc, "LN > DT ở", f"{w:.0%}", "số mã;", vd, flush=True)

# ---------- 2) cắt ngang từng quý: mã tăng trưởng LN/DT cao hơn thì giá 12T (vượt TT) cao hơn? (IC theo quý)
ic = {}
for k in fc.LAGS:
    for f in ("np", "rev"):
        v = []
        for q, d in P[P["lag"] == k].groupby("qi"):
            if len(d) >= 30:
                v.append(fc._sp(d["g_" + f].to_numpy(float), d["dpx"].to_numpy(float)))
        v = np.array([x for x in v if np.isfinite(x)])
        if len(v):
            ic[f"k{k}|{f}"] = {"q": int(len(v)), "mean": float(v.mean()), "t_naive": float(v.mean() / (v.std(ddof=1) / np.sqrt(len(v)))), "pos": float((v > 0).mean()),
                               "first_half": float(v[: len(v) // 2].mean()), "second_half": float(v[len(v) // 2:].mean())}
OUT["ic"] = ic
for k_, v in ic.items():
    print("IC", k_, {a: round(b, 3) if isinstance(b, float) else b for a, b in v.items()}, flush=True)
save()

# ---------- 3) nhóm: mâm so sánh, mâm cha, ngành ICB cấp 2, toàn thị trường
grp = {}
for lv, col in (("peer", "peer_label"), ("parent", "peer_parent"), ("sector", "sector")):
    for name, mem in lst.groupby(col).groups.items():
        mem = [m for m in mem if m in per]
        if len(mem) < 3:
            continue
        G = fc.group_series(P, ttm, mem)
        if G.empty:
            continue
        sm = fc.summarize(fc.stats(G, "dp"))
        smx = fc.summarize(fc.stats(G, "dpx"))
        if sm:
            med_np = np.nanmedian([per[s]["raw"][0]["c_np"] for s in mem if 0 in per[s]["raw"] and per[s]["raw"][0]["n"] >= fc.MIN_Q] or [np.nan])
            med_rev = np.nanmedian([per[s]["raw"][0]["c_rev"] for s in mem if 0 in per[s]["raw"] and per[s]["raw"][0]["n"] >= fc.MIN_Q] or [np.nan])
            grp[f"{lv}|{name}"] = {"m": len(mem), "raw": sm, "x": smx, "med_stock_np": float(med_np), "med_stock_rev": float(med_rev)}
G = fc.group_series(P, ttm, list(per))
grp["market|Toàn thị trường"] = {"m": len(per), "raw": fc.summarize(fc.stats(G, "dp")), "x": None, "med_stock_np": np.nan, "med_stock_rev": np.nan}
OUT["groups"] = grp
for k_, v in sorted(grp.items(), key=lambda t: -(t[1]["raw"]["c_np"] or -9)):
    r = v["raw"]
    print(f"{k_:45s} m={v['m']:3d} LN={r['c_np']} DT={r['c_rev']} e_LN={r['e_np']} e_DT={r['e_rev']} 2nửa LN {r['c1_np']}/{r['c2_np']} best={r['best']} v={r['v']} | TV mã LN={v['med_stock_np']:.2f} DT={v['med_stock_rev']:.2f}", flush=True)
save()

# ---------- 4) mã thanh khoản: top / đáy
rows = []
for s in per:
    sm = fc.summarize(per[s]["raw"]); smx = fc.summarize(per[s]["x"])
    if sm:
        rows.append({"s": s, "liq": s in liquid, "peer": lst["peer_label"].get(s), **{k: sm[k] for k in ("n", "c_np", "c_rev", "e_np", "e_rev", "c1_np", "c2_np", "c1_rev", "c2_rev", "v", "best")},
                     "x_np": smx["c_np"] if smx else None, "x_rev": smx["c_rev"] if smx else None})
R = pd.DataFrame(rows)
OUT["stocks_liquid"] = R[R["liq"]].sort_values("c_np", ascending=False).to_dict("records")
print("\nTOP LN (thanh khoản):\n", R[R["liq"]].sort_values("c_np", ascending=False).head(25).to_string(), flush=True)
print("\nĐÁY LN (thanh khoản):\n", R[R["liq"]].sort_values("c_np").head(15).to_string(), flush=True)
print("\nTOP DT (thanh khoản):\n", R[R["liq"]].sort_values("c_rev", ascending=False).head(15).to_string(), flush=True)
# độ co giãn
for f in ("np", "rev"):
    e = R.loc[R["liq"], "e_" + f].dropna()
    OUT[f"elasticity_{f}"] = {"n": int(len(e)), "med": float(e.median()) if len(e) else None, "p25": float(e.quantile(.25)) if len(e) else None, "p75": float(e.quantile(.75)) if len(e) else None}
print("co giãn", OUT["elasticity_np"], OUT["elasticity_rev"], flush=True)

# ---------- 5) chuỗi biểu đồ mẫu (để kiểm tra trực quan)
OUT["chart_market"] = fc.chart_series(None, None, G)
for s in ("FPT", "HPG", "VCB", "MWG", "VHM", "DGC", "SSI", "PNJ"):
    if s in per:
        OUT[f"chart_{s}"] = fc.chart_series(P, s)
save()
print("XONG", flush=True)
