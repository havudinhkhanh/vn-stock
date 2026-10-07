"""Triển vọng ngành: ngành nào ĐÁNG đầu tư, ngành nào NÊN TRÁNH – cho 2 tầm nhìn.

Các yếu tố (mỗi yếu tố xếp hạng so với các ngành khác, 0–100):
  val      P/E trung vị của ngành ở phân vị nào trong lịch sử của CHÍNH NGÀNH (rẻ → điểm cao)
  earn     tăng trưởng lợi nhuận 12 tháng (trung vị các DN trong ngành)
  accel    tăng trưởng quý này so với quý trước (lợi nhuận đang tốt lên hay xấu đi)
  mom      giá ngành 6 tháng so với VN-Index;  mom3: 3 tháng
  breadth  % cổ phiếu trong ngành trên MA200
  rev12    ngành giảm mạnh nhất 12 tháng qua (đảo chiều trung bình) → điểm cao

Trọng số chọn theo KIỂM CHỨNG trên dữ liệu VN (2016–nay, đo lại mỗi lần chạy, xuất kèm):
  - 3–6 tháng: độ rộng và đà giá/lợi nhuận có tương quan dương nhẹ với lợi nhuận ngành 3–6 tháng sau;
    ngành "rẻ so với lịch sử" lại thường TIẾP TỤC kém trong 3–6 tháng (bẫy giá trị) nên không đưa vào điểm.
  - 12 tháng: ngành tụt mạnh 12 tháng qua thường hồi lại (đảo chiều), cộng tăng trưởng lợi nhuận.
Dữ liệu lúc nào dùng đúng lúc đó: BCTC quý coi như công bố sau 45 ngày (quý 4: 75 ngày).
Tất cả tương quan đều nhỏ (|IC| ≈ 0,03–0,1) và đổi theo giai đoạn – đây là xác suất nghiêng, không phải chắc chắn.
Lưu ý: dùng phân ngành hiện tại cho cả quá khứ (thiên lệch sống sót nhẹ)."""
from __future__ import annotations

import numpy as np
import pandas as pd

_LAST = {}
HORIZONS = {
    "m3": {"label": "3–6 tháng", "h": 3, "w": {"breadth": 0.35, "earn": 0.25, "mom": 0.25, "mom3": 0.15}},
    "m12": {"label": "12 tháng", "h": 12, "w": {"rev12": 0.5, "earn": 0.35, "val": 0.15}},
}
W = HORIZONS["m3"]["w"]
NAMES = {"val": "Định giá so với lịch sử", "earn": "Tăng trưởng lợi nhuận", "accel": "Lợi nhuận tăng tốc", "mom": "Động lượng giá 6 tháng",
         "mom3": "Động lượng giá 3 tháng", "breadth": "Độ rộng (trên MA200)", "rev12": "Đảo chiều 12 tháng (ngành tụt mạnh)"}


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _avail(y, q):
    end = pd.Timestamp(year=int(y), month=int(q) * 3, day=1) + pd.offsets.MonthEnd(0)
    return end + pd.Timedelta(days=75 if int(q) == 4 else 45)


def _quarterly(fq: pd.DataFrame, groups: dict) -> dict:
    """Theo từng ngành, theo quý: P/E trung vị, tăng trưởng LN 12T trung vị, tăng tốc."""
    if fq is None or fq.empty:
        return {}
    q = fq[["symbol", "year", "quarter", "ni_parent", "pe_src"]].dropna(subset=["year", "quarter"]).copy()
    q = q.sort_values(["symbol", "year", "quarter"]).drop_duplicates(["symbol", "year", "quarter"], keep="last")
    q["k"] = q["year"].astype(int) * 4 + q["quarter"].astype(int) - 1
    q["ttm"] = q.groupby("symbol")["ni_parent"].transform(lambda s: s.rolling(4, min_periods=4).sum())
    # chỉ tính TTM khi 4 quý liền nhau
    q["kgap"] = q.groupby("symbol")["k"].transform(lambda s: s - s.shift(3))
    q.loc[q["kgap"] != 3, "ttm"] = np.nan
    prev = q[["symbol", "k", "ttm"]].assign(k=q["k"] + 4).rename(columns={"ttm": "ttm_prev"})
    q = q.merge(prev, on=["symbol", "k"], how="left")
    ok = (q["ttm_prev"] > 0) & q["ttm"].notna()
    q["g"] = np.where(ok, (q["ttm"] / q["ttm_prev"] - 1).clip(-1, 2), np.nan)
    q.loc[~((q["pe_src"] > 0) & (q["pe_src"] < 80)), "pe_src"] = np.nan
    out = {}
    for name, syms in groups.items():
        g = q[q["symbol"].isin(syms)]
        if g.empty:
            continue
        agg = g.groupby("k").agg(pe=("pe_src", "median"), g=("g", "median"), n=("g", "count"), npe=("pe_src", "count"),
                                 y=("year", "first"), qq=("quarter", "first"))
        agg = agg[(agg["npe"] >= 2) | (agg["n"] >= 2)]
        if agg.empty:
            continue
        agg["pe_pctl"] = [100 * float((agg["pe"].iloc[:i + 1].dropna() < v).mean()) if i >= 7 and v == v else np.nan
                          for i, v in enumerate(agg["pe"].values)]
        agg["accel"] = agg["g"] - agg["g"].shift(1)
        agg["avail"] = [_avail(y, qq) for y, qq in zip(agg["y"], agg["qq"])]
        out[name] = agg
    return out


def _asof(agg: pd.DataFrame, dates: pd.DatetimeIndex, col: str) -> pd.Series:
    s = agg.set_index("avail")[col].sort_index()
    s = s[~s.index.duplicated(keep="last")]
    return s.reindex(s.index.union(dates)).ffill().reindex(dates)


def _rank(df: pd.DataFrame) -> pd.DataFrame:
    n = df.notna().sum(axis=1)
    r = df.rank(axis=1, pct=True) * 100
    return r.where(n >= 5, np.nan)


def _spearman(a: pd.Series, b: pd.Series):
    m = a.notna() & b.notna()
    if m.sum() < 5:
        return np.nan
    return float(a[m].rank().corr(b[m].rank()))


def run(u: pd.DataFrame, wide: pd.DataFrame, idx_close: pd.Series, fq: pd.DataFrame, level: str = "sector", min_n: int = 3) -> dict:
    groups = {name: [s for s in g.index if s in wide.columns] for name, g in u.groupby(level)}
    groups = {k: v for k, v in groups.items() if len(v) >= min_n}
    if len(groups) < 5:
        return {}
    px = wide[[s for v in groups.values() for s in v]]
    mclose = px.resample("ME").last()
    mret = mclose.pct_change(fill_method=None).clip(-0.6, 1.5)
    ma200 = px.rolling(200, min_periods=150).mean().resample("ME").last()
    vni = idx_close.resample("ME").last().pct_change(fill_method=None)
    dates = mclose.index
    sec_ret = pd.DataFrame({k: mret[v].mean(axis=1, skipna=True).where(mret[v].notna().sum(axis=1) >= 3) for k, v in groups.items()})
    breadth = pd.DataFrame({k: 100 * (mclose[v] > ma200[v]).sum(axis=1) / (ma200[v].notna() & mclose[v].notna()).sum(axis=1).replace(0, np.nan)
                            for k, v in groups.items()})
    lr = np.log1p(sec_ret)
    mom = lr.rolling(6, min_periods=5).sum().sub(np.log1p(vni).rolling(6, min_periods=5).sum(), axis=0) * 100
    Q = _quarterly(fq, groups)
    val = pd.DataFrame({k: 100 - _asof(Q[k], dates, "pe_pctl") for k in groups if k in Q})
    earn = pd.DataFrame({k: _asof(Q[k], dates, "g") * 100 for k in groups if k in Q})
    acc = pd.DataFrame({k: _asof(Q[k], dates, "accel") * 100 for k in groups if k in Q})
    raw = {"val": val.reindex(columns=sec_ret.columns), "earn": earn.reindex(columns=sec_ret.columns), "accel": acc.reindex(columns=sec_ret.columns),
           "mom": mom, "mom3": lr.rolling(3, min_periods=3).sum().sub(np.log1p(vni).rolling(3, min_periods=3).sum(), axis=0) * 100,
           "breadth": breadth, "rev12": -(lr.rolling(12, min_periods=11).sum().sub(np.log1p(vni).rolling(12, min_periods=11).sum(), axis=0) * 100)}
    rk = {k: _rank(v) for k, v in raw.items()}
    fwd = {}
    for h in (3, 6, 12):
        f = lr[::-1].rolling(h, min_periods=h).sum()[::-1].shift(-1)
        fwd[h] = f.sub(f.mean(axis=1), axis=0) * 100
    global _LAST
    _LAST = {"rk": rk, "raw": raw, "lr": lr, "dates": dates}
    # tương quan từng yếu tố với lợi nhuận tương lai (cả 2 nửa giai đoạn để thấy độ ổn định)
    ics = {}
    for k in rk:
        ics[k] = {"name": NAMES[k]}
        for h in (3, 12):
            ds = [d for d in dates if rk[k].loc[d].notna().sum() >= 5 and fwd[h].loc[d].notna().sum() >= 5]
            v = pd.Series([_spearman(rk[k].loc[d], fwd[h].loc[d]) for d in ds], index=ds, dtype=float).dropna()
            if len(v) >= 12:
                mid = v.index[len(v) // 2]
                ics[k][f"ic{h}"] = _r(v.mean(), 3)
                ics[k][f"t{h}"] = _r(v.mean() / v.std() * np.sqrt(len(v) / h) if v.std() else None, 2)  # t chỉnh theo chồng lấn
                ics[k][f"ic{h}_a"] = _r(v[v.index < mid].mean(), 3)
                ics[k][f"ic{h}_b"] = _r(v[v.index >= mid].mean(), 3)
                ics[k][f"n{h}"] = len(v)
    out_h, cur = {}, {}
    for key, H in HORIZONS.items():
        w, h = H["w"], H["h"]
        num = sum(rk[k].fillna(0) * x for k, x in w.items())
        den = sum(rk[k].notna() * x for k, x in w.items())
        score = (num / den.replace(0, np.nan)).where(den >= 0.65)
        bt = _backtest(score, fwd[h], fwd.get(h * 2) if h * 2 in fwd else None, sec_ret, dates, h)
        out_h[key] = {"label": H["label"], "h": h, "weights": w, "bt": bt}
        last = dates[-1]
        bk = {b["key"]: b for b in bt.get("buckets", [])}
        for name in groups:
            sc = score.loc[last].get(name)
            if sc is None or sc != sc:
                continue
            verdict = "buy" if sc >= 65 else "avoid" if sc < 35 else "neutral"
            c = cur.setdefault(name, {"factors": {k: {"rank": _r(rk[k].loc[last].get(name), 0), "raw": _r(raw[k].loc[last].get(name), 1), "name": NAMES[k]} for k in rk}})
            c[key] = {"score": _r(sc, 0), "verdict": verdict, "exp": (bk.get(verdict) or {}).get("f"), "win": (bk.get(verdict) or {}).get("win"),
                      "trend": [_r(x, 0) for x in score[name].dropna().iloc[-12:].values]}
    for name, c in cur.items():
        pos, neg = [], []
        F = {k: v["raw"] for k, v in c["factors"].items()}
        if F.get("breadth") is not None:
            (pos if F["breadth"] >= 55 else neg if F["breadth"] <= 30 else []).append(f"{F['breadth']:.0f}% mã trên MA200")
        if F.get("earn") is not None:
            (pos if F["earn"] >= 15 else neg if F["earn"] <= -5 else []).append(f"lợi nhuận 12 tháng (trung vị) {F['earn']:+.0f}%")
        if F.get("accel") is not None and abs(F["accel"]) >= 5:
            (pos if F["accel"] > 0 else neg).append(f"lợi nhuận {'tăng tốc' if F['accel'] > 0 else 'chậm lại'} {F['accel']:+.0f} điểm % so với quý trước")
        if F.get("mom") is not None and abs(F["mom"]) >= 3:
            (pos if F["mom"] > 0 else neg).append(f"giá 6 tháng {'mạnh' if F['mom'] > 0 else 'yếu'} hơn VN-Index {abs(F['mom']):.0f}%")
        if F.get("rev12") is not None and abs(F["rev12"]) >= 10:
            (pos if F["rev12"] > 0 else neg).append(f"12 tháng qua {'kém' if F['rev12'] > 0 else 'hơn'} VN-Index {abs(F['rev12']):.0f}% – " +
                                                   ("dư địa hồi nếu cơ bản không xấu" if F["rev12"] > 0 else "đã tăng nhiều, dễ chững lại trong 12 tháng"))
        if F.get("val") is not None:
            ph = 100 - F["val"]
            if ph <= 30 or ph >= 70:
                (pos if ph <= 30 else neg).append(f"P/E ở phân vị {ph:.0f}% lịch sử của ngành – {'rẻ' if ph <= 30 else 'đắt'}")
        c["pos"], c["neg"] = pos, neg
    return {"current": cur, "horizons": out_h, "ic": ics, "names": NAMES, "date": str(dates[-1].date()), "n_groups": len(groups), "level": level}


def _backtest(score, fwd, fwd2, sec_ret, dates, h) -> dict:
    ds = [d for d in dates if score.loc[d].notna().sum() >= 6 and fwd.loc[d].notna().sum() >= 6]
    if len(ds) < 18:
        return {"ok": False}
    sp, hit, ic = [], [], []
    for d in ds:
        s_ = score.loc[d].dropna()
        f_ = fwd.loc[d].reindex(s_.index)
        m = f_.notna()
        s_, f_ = s_[m], f_[m]
        n3 = max(2, len(s_) // 3)
        top, bot = f_[s_.nlargest(n3).index].mean(), f_[s_.nsmallest(n3).index].mean()
        sp.append(top - bot)
        hit.append(top > bot)
        ic.append(_spearman(s_, f_))
    sp, hit, ic = pd.Series(sp, index=ds), pd.Series(hit, index=ds), pd.Series(ic, index=ds)
    mid = ds[len(ds) // 2]
    allp = pd.DataFrame({"s": score.loc[ds].stack(), "f": fwd.loc[ds].stack()}).dropna()
    buckets = []
    for lo, hi, key, lab in ((0, 35, "avoid", "Nên tránh (< 35)"), (35, 65, "neutral", "Trung tính (35–65)"), (65, 101, "buy", "Đáng đầu tư (≥ 65)")):
        g = allp[(allp["s"] >= lo) & (allp["s"] < hi)]
        if len(g):
            buckets.append({"key": key, "label": lab, "n": int(len(g)), "f": _r(g["f"].mean(), 2), "win": _r(100 * (g["f"] > 0).mean(), 0)})
    # danh mục giấy: mỗi tháng nắm 1/3 ngành điểm cao nhất (giữ h tháng, chia lớp chồng lên nhau) – đơn giản hoá: cân bằng hàng tháng
    nav, navb, curve = 1.0, 1.0, []
    for d in [d for d in dates if score.loc[d].notna().sum() >= 6]:
        i = dates.get_loc(d)
        if i + 1 >= len(dates):
            continue
        s_ = score.loc[d].dropna()
        nxt = sec_ret.iloc[i + 1].reindex(s_.index)
        if nxt.notna().sum() < 5:
            continue
        n3 = max(2, len(s_) // 3)
        nav *= 1 + float(np.nan_to_num(nxt[s_.nlargest(n3).index].mean()))
        navb *= 1 + float(np.nan_to_num(nxt.mean()))
        curve.append({"d": str(dates[i + 1].date()), "top": _r(nav * 100, 2), "all": _r(navb * 100, 2)})
    yrs = len(curve) / 12
    return {"ok": True, "start": str(ds[0].date()), "end": str(ds[-1].date()), "n": len(ds),
            "spread": _r(sp.mean(), 2), "hit": _r(100 * hit.mean(), 0), "ic": _r(ic.mean(), 3),
            "spread_a": _r(sp[sp.index < mid].mean(), 2), "spread_b": _r(sp[sp.index >= mid].mean(), 2),
            "hit_a": _r(100 * hit[hit.index < mid].mean(), 0), "hit_b": _r(100 * hit[hit.index >= mid].mean(), 0), "mid": str(mid.date()),
            "buckets": buckets, "curve": curve[-120:] if h <= 3 else [], "in_sample": True,
            "cagr_top": _r(100 * (nav ** (1 / yrs) - 1), 1) if yrs >= 1 and h <= 3 else None, "cagr_all": _r(100 * (navb ** (1 / yrs) - 1), 1) if yrs >= 1 and h <= 3 else None}
