"""Chỉ số hướng TƯƠNG LAI và chỉ số hướng QUÁ KHỨ – trọng số riêng cho từng mã, có kiểm định.

Mỗi chỉ số có "tỷ lệ tương lai" f (0 = thuần quá khứ, 1 = thuần tương lai). Chỉ số hỗn hợp góp vào cả hai điểm:
  điểm tương lai = Σ f·hạng ÷ Σ f        điểm quá khứ = Σ (1−f)·hạng ÷ Σ (1−f)
(hạng = phân vị 0–100 của chỉ số so với mọi mã cùng tháng, đã đổi chiều để cao = tốt).

Kiểm định (dữ liệu từng cuối tháng, chỉ dùng thông tin đã có lúc đó, BCTC trễ 45 ngày – quý 4 trễ 75 ngày):
  1. Với từng mã: tương quan theo thời gian giữa điểm tương lai / quá khứ và lợi nhuận 3 tháng sau (so với bình quân
     thị trường) → IC tương lai, IC quá khứ, chênh lệch Δ và sai số chuẩn.
  2. Giả thuyết "trọng số tốt nhất khác nhau giữa các mã": đo Δ ở nửa đầu và nửa sau giai đoạn; nếu khác biệt là thật
     thì mã nào nửa đầu nghiêng tương lai, nửa sau cũng phải nghiêng tương lai (tương quan > 0, kiểm định hoán vị).
  3. Empirical Bayes: Δ của từng mã được kéo về Δ chung theo độ tin cậy (nhiều nhiễu → kéo mạnh).
     Trọng số tương lai của mã = 0,5 + 2,5 × Δ đã kéo, giới hạn 10–90%.
  4. Walk-forward: mỗi năm chỉ ước lượng trọng số từ các năm TRƯỚC rồi áp cho năm đó; so sánh 50/50, trọng số chung,
     trọng số riêng từng mã, chỉ tương lai, chỉ quá khứ.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# key: (tên, f tương lai, chiều (+1 cao tốt / -1 thấp tốt), giải thích ngắn)
IND = {
    "fpe": ("P/E dự phóng", 0.85, -1, "giá ÷ lợi nhuận năm tới ước tính (EPS 12 tháng × (1 + tăng trưởng ước tính))"),
    "sector": ("Triển vọng ngành 3–6 tháng", 0.9, 1, "điểm triển vọng của ngành chứa mã"),
    "season": ("Mùa vụ tháng tới", 0.8, 1, "trung bình các năm TRƯỚC: tháng tới mã hơn/kém thị trường bao nhiêu"),
    "accel": ("Lợi nhuận tăng tốc", 0.7, 1, "tăng trưởng LN quý gần nhất trừ tăng trưởng quý trước đó"),
    "peg": ("PEG", 0.6, -1, "P/E ÷ tăng trưởng lợi nhuận ước tính (%)"),
    "cmf": ("Dòng tiền tích luỹ (CMF 60 phiên)", 0.6, 1, "tiền vào/ra theo vị trí giá đóng cửa trong biên độ × khối lượng"),
    "pepct": ("P/E so với lịch sử của mã", 0.5, -1, "phân vị P/E hiện tại trong lịch sử của chính mã"),
    "mom": ("Đà giá 12–1 tháng", 0.35, 1, "giá 1 tháng trước ÷ giá 12 tháng trước − 1"),
    "pe": ("P/E hiện tại", 0.3, -1, "giá ÷ lợi nhuận 12 tháng đã qua"),
    "ma200": ("Giá so với MA200", 0.25, 1, "giá ÷ trung bình 200 phiên − 1"),
    "gni": ("Tăng trưởng LN 12 tháng", 0.25, 1, "LN 4 quý gần nhất ÷ 4 quý trước đó − 1"),
    "grev": ("Tăng trưởng DT 12 tháng", 0.2, 1, "doanh thu 4 quý gần nhất ÷ 4 quý trước đó − 1"),
    "roe": ("ROE 12 tháng", 0.15, 1, "LN 12 tháng ÷ vốn chủ"),
    "margin": ("Biên LN ròng", 0.1, 1, "LN 12 tháng ÷ doanh thu 12 tháng"),
    "de": ("Nợ vay / vốn chủ", 0.1, -1, "nợ vay ÷ vốn chủ sở hữu"),
}
H = 3  # tháng


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _avail(y, q):
    end = pd.Timestamp(year=int(y), month=int(q) * 3, day=1) + pd.offsets.MonthEnd(0)
    return end + pd.Timedelta(days=75 if int(q) == 4 else 45)


def _quarterly(fq: pd.DataFrame, syms) -> pd.DataFrame:
    q = fq[fq["symbol"].isin(syms)][["symbol", "year", "quarter", "ni_parent", "revenue", "equity", "debt", "pe_src"]].dropna(subset=["year", "quarter"]).copy()
    q = q.sort_values(["symbol", "year", "quarter"]).drop_duplicates(["symbol", "year", "quarter"], keep="last")
    q["k"] = q["year"].astype(int) * 4 + q["quarter"].astype(int) - 1
    g = q.groupby("symbol")
    cont = (q["k"] - g["k"].shift(3)) == 3
    q["ttm"] = g["ni_parent"].transform(lambda s: s.rolling(4, min_periods=4).sum()).where(cont)
    q["ttm_rev"] = g["revenue"].transform(lambda s: s.rolling(4, min_periods=4).sum()).where(cont)
    lag = lambda col, n: q.merge(q[["symbol", "k", col]].assign(k=q["k"] + n), on=["symbol", "k"], how="left", suffixes=("", "_l"))[col + "_l"].values  # noqa: E731
    q["ttm_p"], q["rev_p"], q["niq_p"], q["ttm_p12"] = lag("ttm", 4), lag("ttm_rev", 4), lag("ni_parent", 4), lag("ttm", 12)
    q["gni"] = np.where(q["ttm_p"] > 0, (q["ttm"] / q["ttm_p"] - 1).clip(-1, 3), np.nan)
    q["grev"] = np.where(q["rev_p"] > 0, (q["ttm_rev"] / q["rev_p"] - 1).clip(-1, 3), np.nan)
    q["qy"] = np.where(q["niq_p"] > 0, (q["ni_parent"] / q["niq_p"] - 1).clip(-1, 3), np.nan)
    q["accel"] = q["qy"] - q.merge(q[["symbol", "k", "qy"]].assign(k=q["k"] + 1), on=["symbol", "k"], how="left", suffixes=("", "_l"))["qy_l"].values
    c3 = np.where((q["ttm_p12"] > 0) & (q["ttm"] > 0), (q["ttm"] / q["ttm_p12"]) ** (1 / 3) - 1, np.nan)
    q["ghat"] = np.where(np.isnan(c3), q["gni"], 0.5 * q["gni"] + 0.5 * c3)
    q["ghat"] = q["ghat"].clip(-0.5, 1.0)
    q["roe"] = np.where(q["equity"] > 0, q["ttm"] / q["equity"], np.nan)
    q["margin"] = np.where(q["ttm_rev"] > 0, q["ttm"] / q["ttm_rev"], np.nan)
    q["de"] = np.where(q["equity"] > 0, q["debt"] / q["equity"], np.nan)
    q.loc[~((q["pe_src"] > 0) & (q["pe_src"] < 150)), "pe_src"] = np.nan
    q["pepct"] = g["pe_src"].transform(lambda s: s.expanding(8).apply(lambda a: 100 * np.mean(a[:-1] < a[-1]) if np.isfinite(a[-1]) else np.nan, raw=True))
    q["avail"] = [_avail(y, qq) for y, qq in zip(q["year"], q["quarter"])]
    q["qend"] = [pd.Timestamp(year=int(y), month=int(qq) * 3, day=1) + pd.offsets.MonthEnd(0) for y, qq in zip(q["year"], q["quarter"])]
    return q


def _asof_panel(q: pd.DataFrame, col: str, dates: pd.DatetimeIndex) -> pd.DataFrame:
    out = {}
    for s, g in q.groupby("symbol"):
        ser = g.set_index("avail")[col].sort_index()
        ser = ser[~ser.index.duplicated(keep="last")]
        out[s] = ser.reindex(ser.index.union(dates)).ffill().reindex(dates)
    return pd.DataFrame(out)


def _rank(df: pd.DataFrame, direction: int) -> pd.DataFrame:
    r = (df * direction).rank(axis=1, pct=True) * 100
    ok = df.notna().sum(axis=1) >= 30
    return r.where(pd.DataFrame(np.repeat(ok.values[:, None], df.shape[1], axis=1), index=df.index, columns=df.columns))


def build_panels(u, wide, hi, lo, vol, idx_close, fq, sector_score: pd.DataFrame | None, level="sector"):
    syms = [s for s in u.index[u["has_fin"].fillna(False)] if s in wide.columns]
    px = wide[syms]
    dates = px.resample("ME").last().index
    dates = dates[dates >= pd.Timestamp("2019-06-30")]
    mclose = px.resample("ME").last().reindex(dates)
    q = _quarterly(fq, syms)
    raw = {}
    for col in ("gni", "grev", "accel", "roe", "margin", "de", "pepct", "ghat"):
        raw[col] = _asof_panel(q, col, dates).reindex(columns=syms)
    pe_q = _asof_panel(q, "pe_src", dates).reindex(columns=syms)
    # P/E tại cuối tháng = P/E cuối quý × giá hiện tại / giá cuối quý
    qend = _asof_panel(q.assign(qe=q["year"].astype(int) * 12 + q["quarter"].astype(int) * 3 - 1), "qe", dates).reindex(columns=syms)
    ms = px.resample("ME").last()
    def _px_at(qe_ns: pd.DataFrame):
        out = pd.DataFrame(index=dates, columns=syms, dtype=float)
        for s in syms:
            v = qe_ns[s]
            ok = v.notna()
            if ok.any():
                ym = v[ok].astype(int)
                t = pd.DatetimeIndex([pd.Timestamp(year=int(x // 12), month=int(x % 12) + 1, day=1) + pd.offsets.MonthEnd(0) for x in ym])
                out.loc[ok, s] = ms[s].reindex(t).values
        return out
    pq = _px_at(qend)
    raw["pe"] = pe_q * mclose / pq
    raw["pe"] = raw["pe"].where((raw["pe"] > 0) & (raw["pe"] < 150))
    raw["fpe"] = (raw["pe"] / (1 + raw["ghat"].clip(lower=-0.4))).where(raw["pe"].notna())
    raw["peg"] = (raw["pe"] / (100 * raw["ghat"])).where(raw["ghat"] > 0.03)
    c = px
    raw["mom"] = (c.shift(21) / c.shift(252) - 1).resample("ME").last().reindex(dates)
    raw["ma200"] = (c / c.rolling(200, min_periods=150).mean() - 1).resample("ME").last().reindex(dates)
    h, l_, v = hi.reindex(columns=syms), lo.reindex(columns=syms), vol.reindex(columns=syms)
    mfm = ((c - l_) - (h - c)) / (h - l_).replace(0, np.nan)
    raw["cmf"] = ((mfm * v).rolling(60, min_periods=40).sum() / v.rolling(60, min_periods=40).sum()).resample("ME").last().reindex(dates)
    # mùa vụ: trung bình các năm trước của tháng dương lịch kế tiếp (so với VN-Index)
    mret = px.resample("ME").last().pct_change(fill_method=None) * 100
    vret = idx_close.resample("ME").last().pct_change(fill_method=None) * 100
    rel = mret.sub(vret.reindex(mret.index), axis=0)
    prior = rel.groupby(rel.index.month).transform(lambda d: d.expanding().mean().shift(1))
    cnt = rel.groupby(rel.index.month).transform(lambda d: d.expanding().count().shift(1))
    prior = prior.where(cnt >= 4)
    nxt = prior.shift(-1)  # giá trị của tháng kế tiếp (đã chỉ dùng các năm trước tháng đó)
    raw["season"] = nxt.reindex(dates)
    if sector_score is not None and not sector_score.empty:
        sec_of = u[level].reindex(syms)
        ss = sector_score.reindex(dates).ffill(limit=1)
        raw["sector"] = pd.DataFrame({s: ss[sec_of[s]] if sec_of[s] in ss.columns else np.nan for s in syms}, index=dates)
    else:
        raw["sector"] = pd.DataFrame(np.nan, index=dates, columns=syms)
    raw.pop("ghat", None)
    ranks = {k: _rank(raw[k].astype(float), IND[k][2]) for k in IND}
    # mục tiêu: lợi nhuận 3 tháng sau so với bình quân các mã (log)
    lr = np.log(mclose / mclose.shift(1))
    fwd = lr[::-1].rolling(H, min_periods=H).sum()[::-1].shift(-1)
    target = fwd.sub(fwd.mean(axis=1), axis=0) * 100
    return {"dates": dates, "syms": syms, "raw": raw, "ranks": ranks, "target": target}


def scores(ranks: dict, a: dict | None = None) -> tuple[pd.DataFrame, pd.DataFrame]:
    """a: trọng số của từng chỉ số (mặc định 1). Chỉ số hỗn hợp chia theo f vào hai điểm."""
    a = a or {k: 1.0 for k in IND}
    nf = df = None
    tot_f = tot_b = 0.0
    for k, (_, f, _, _) in IND.items():
        ak = float(a.get(k, 0) or 0)
        if ak <= 0:
            continue
        r = ranks[k]
        x1, x2 = r.fillna(0) * f * ak, r.fillna(0) * (1 - f) * ak
        w1, w2 = r.notna() * f * ak, r.notna() * (1 - f) * ak
        nf = (x1, w1) if nf is None else (nf[0] + x1, nf[1] + w1)
        df = (x2, w2) if df is None else (df[0] + x2, df[1] + w2)
        tot_f += f * ak
        tot_b += (1 - f) * ak
    F = (nf[0] / nf[1].replace(0, np.nan)).where(nf[1] >= 0.4 * tot_f)
    B = (df[0] / df[1].replace(0, np.nan)).where(df[1] >= 0.4 * tot_b)
    return F, B


def _ic_series(R: pd.DataFrame, T: pd.DataFrame, dates) -> pd.Series:
    out = {}
    for d in dates:
        r_, t_ = R.loc[d], T.loc[d]
        m = r_.notna() & t_.notna()
        if m.sum() >= 50:
            out[d] = float(r_[m].rank().corr(t_[m].rank()))
    return pd.Series(out, dtype=float)


def ind_weights(ICS: dict, upto) -> dict:
    """Trọng số chỉ số = IC trung bình dương đến thời điểm 'upto' (chỉ số dự báo ngược chiều hoặc không có tác dụng → 0)."""
    a = {}
    for k, ser in ICS.items():
        v = ser[ser.index <= upto] if upto is not None else ser
        a[k] = max(0.0, float(v.mean())) if len(v) >= 12 else 0.0
    if sum(a.values()) <= 0:
        a = {k: 1.0 for k in ICS}
    return a


def group_w(F, B, T, dates) -> float:
    icf, icb = _ic_series(F, T, dates).mean(), _ic_series(B, T, dates).mean()
    icf, icb = max(0.0, icf if icf == icf else 0), max(0.0, icb if icb == icb else 0)
    if icf + icb <= 0:
        return 0.5
    return float(np.clip(icf / (icf + icb), 0.2, 0.8))


def _ts_ic(x: pd.Series, y: pd.Series):
    m = x.notna() & y.notna()
    n = int(m.sum())
    if n < 18:
        return None, n
    return float(x[m].rank().corr(y[m].rank())), n


def per_stock(F, B, T, mask=None):
    rows = {}
    for s in F.columns:
        f, b, t = F[s], B[s], T[s]
        if mask is not None:
            f, b, t = f[mask], b[mask], t[mask]
        icf, n = _ts_ic(f, t)
        icb, _ = _ts_ic(b, t)
        if icf is None or icb is None:
            continue
        rho, _ = _ts_ic(f, b)
        neff = max(4.0, n / H)
        se = 1 / np.sqrt(max(1.0, neff - 3))
        se_d = se * np.sqrt(max(0.05, 2 * (1 - (rho or 0))))
        rows[s] = {"icf": icf, "icb": icb, "d": icf - icb, "se": se_d, "n": n}
    return pd.DataFrame(rows).T


def eb(st: pd.DataFrame) -> tuple[pd.Series, dict]:
    d, se = st["d"].astype(float), st["se"].astype(float)
    dbar = float(d.mean())
    tau2 = max(0.0, float(d.var()) - float((se ** 2).mean()))
    lam = tau2 / (tau2 + se ** 2) if tau2 > 0 else se * 0
    dhat = dbar + lam * (d - dbar)
    return dhat, {"dbar": dbar, "tau2": tau2, "lam_mean": float(lam.mean()) if len(lam) else 0.0}


def wmap(dhat):
    return np.clip(0.5 + 2.5 * dhat, 0.1, 0.9)


def _xs_eval(S: pd.DataFrame, T: pd.DataFrame, dates) -> dict:
    ics, spreads = [], []
    for d in dates:
        s_, t_ = S.loc[d], T.loc[d]
        m = s_.notna() & t_.notna()
        if m.sum() < 50:
            continue
        ics.append(float(s_[m].rank().corr(t_[m].rank())))
        q5 = s_[m].rank(pct=True)
        spreads.append(float(t_[m][q5 >= 0.8].mean() - t_[m][q5 <= 0.2].mean()))
    if not ics:
        return {}
    ic, sp = np.array(ics), np.array(spreads)
    return {"ic": _r(ic.mean(), 3), "t": _r(ic.mean() / ic.std() * np.sqrt(len(ic) / H), 2) if ic.std() else None, "spread": _r(sp.mean(), 2),
            "hit": _r(100 * (sp > 0).mean(), 0), "n": len(ic)}


def run(u, wide, hi, lo, vol, idx_close, fq, sector_score=None, level="sector") -> dict:
    P = build_panels(u, wide, hi, lo, vol, idx_close, fq, sector_score, level)
    T, dates, R = P["target"], P["dates"], P["ranks"]
    valid = [d for d in dates if T.loc[d].notna().sum() >= 50]
    res = {"start": str(valid[0].date()) if valid else None, "end": str(valid[-1].date()) if valid else None}
    if len(valid) < 30:
        return {"summary": {"ok": False, **res}, "current": {}, "ind": {}}
    ICS = {k: _ic_series(R[k], T, valid) for k in IND}
    res["ind_ic"] = {k: {"ic": _r(v.mean(), 3), "t": _r(v.mean() / v.std() * np.sqrt(len(v) / H), 2) if v.std() else None, "pos": _r(100 * (v > 0).mean(), 0),
                         "n": len(v), "ic_a": _r(v.iloc[: len(v) // 2].mean(), 3), "ic_b": _r(v.iloc[len(v) // 2:].mean(), 3)} for k, v in ICS.items()}
    # ---- walk-forward: mỗi năm chỉ dùng các năm trước để chọn trọng số chỉ số, trọng số nhóm và trọng số riêng
    years = sorted({d.year for d in valid})
    S = {k: pd.DataFrame(np.nan, index=dates, columns=T.columns) for k in ("naive", "eq", "glob", "stock", "fwd", "back")}
    wf = []
    sec_of = u[level].reindex(T.columns)
    for y in years:
        cut = pd.Timestamp(year=y, month=1, day=1) - pd.offsets.MonthEnd(H)
        tr = [d for d in valid if d <= cut]
        if len(tr) < 24:
            continue
        a = ind_weights(ICS, cut)
        F, B = scores(R, a)
        wg = group_w(F, B, T, tr)
        mtr = pd.Series([d <= cut for d in dates], index=dates)
        stt = per_stock(F, B, T, mtr.values)
        ws = pd.Series(wg, index=T.columns)
        if len(stt) >= 30:
            dh, ei = eb(stt)
            ws.loc[dh.index] = np.clip(wg + 2.5 * (dh.astype(float) - ei["dbar"]).values, 0.1, 0.9)
        rows = [d for d in dates if d.year == y]
        F0, B0 = scores(R)
        S["naive"].loc[rows] = 0.5 * F0.loc[rows] + 0.5 * B0.loc[rows]
        S["eq"].loc[rows] = 0.5 * F.loc[rows] + 0.5 * B.loc[rows]
        S["glob"].loc[rows] = wg * F.loc[rows] + (1 - wg) * B.loc[rows]
        S["stock"].loc[rows] = F.loc[rows].mul(ws, axis=1) + B.loc[rows].mul(1 - ws, axis=1)
        S["fwd"].loc[rows], S["back"].loc[rows] = F.loc[rows], B.loc[rows]
        wf.append({"year": y, "w": _r(wg, 2), "used": [k for k, v in a.items() if v > 0]})
    test_dates = [d for d in valid if S["stock"].loc[d].notna().sum() >= 50]
    res["walk"] = {k: _xs_eval(S[k], T, test_dates) for k in S}
    res["walk_years"] = wf
    al = pd.DataFrame({"s": S["stock"].loc[test_dates].stack(), "t": T.loc[test_dates].stack()}).dropna()
    cal = []
    for lo_, hi_, key in ((0, 35, "sell"), (35, 45, "lean_sell"), (45, 55, "neutral"), (55, 65, "lean_buy"), (65, 101, "buy")):
        g = al[(al["s"] >= lo_) & (al["s"] < hi_)]
        if len(g):
            cal.append({"key": key, "lo": lo_, "hi": min(hi_, 100), "n": int(len(g)), "ret": _r(g["t"].mean(), 2), "win": _r(100 * (g["t"] > 0).mean(), 0)})
    res["calib"] = cal
    # ---- toàn bộ lịch sử: trọng số hiện hành + kiểm định giả thuyết
    a = ind_weights(ICS, None)
    res["ind_w"] = {k: _r(v / max(1e-9, sum(a.values())) * 100, 1) for k, v in a.items()}
    F, B = scores(R, a)
    wg = group_w(F, B, T, valid)
    res["w_glob"] = _r(wg, 2)
    res["xs_fwd"], res["xs_back"] = _xs_eval(F, T, valid), _xs_eval(B, T, valid)
    st = per_stock(F, B, T)
    res["n_stocks"] = int(len(st))
    dhat, ebi = eb(st) if len(st) >= 30 else (pd.Series(dtype=float), {"dbar": 0.0, "tau2": 0.0, "lam_mean": 0.0})
    res.update({"dbar": _r(ebi["dbar"], 3), "tau": _r(np.sqrt(ebi["tau2"]), 3), "lam": _r(ebi["lam_mean"], 2),
                "icf_mean": _r(st["icf"].mean(), 3) if len(st) else None, "icb_mean": _r(st["icb"].mean(), 3) if len(st) else None})
    mid = valid[len(valid) // 2]
    m1 = np.array([d < mid for d in dates])
    s1, s2 = per_stock(F, B, T, m1), per_stock(F, B, T, ~m1)
    both = s1.index.intersection(s2.index)
    rng = np.random.default_rng(7)
    if len(both) >= 30:
        x1, x2 = s1.loc[both, "d"].astype(float), s2.loc[both, "d"].astype(float)
        rho = float(x1.rank().corr(x2.rank()))
        perm = [float(x1.rank().corr(pd.Series(rng.permutation(x2.values), index=x2.index).rank())) for _ in range(1000)]
        res["halves"] = {"rho": _r(rho, 3), "p": _r(float(np.mean(np.array(perm) >= rho)), 3), "n": int(len(both)), "mid": str(mid.date())}
        g1 = x1.groupby(sec_of.reindex(both)).agg(["mean", "count"])
        g2 = x2.groupby(sec_of.reindex(both)).agg(["mean", "count"])
        gg = g1.join(g2, lsuffix="1", rsuffix="2")
        gg = gg[(gg["count1"] >= 4) & (gg["count2"] >= 4)]
        if len(gg) >= 8:
            rho_s = float(gg["mean1"].rank().corr(gg["mean2"].rank()))
            perm = [float(gg["mean1"].rank().corr(pd.Series(rng.permutation(gg["mean2"].values), index=gg.index).rank())) for _ in range(2000)]
            res["halves_sector"] = {"rho": _r(rho_s, 3), "p": _r(float(np.mean(np.array(perm) >= rho_s)), 3), "n": int(len(gg))}
    sec_dhat = pd.Series(dtype=float)
    if len(st):
        gs = st.assign(sec=sec_of.reindex(st.index).values).groupby("sec")
        sd = gs["d"].mean().astype(float)
        sse = np.sqrt(gs["se"].apply(lambda x: float((x.astype(float) ** 2).mean())) / gs["d"].count())
        tau_s2 = max(0.0, float(sd.var()) - float((sse ** 2).mean()))
        lam_s = tau_s2 / (tau_s2 + sse ** 2) if tau_s2 > 0 else sse * 0
        sec_dhat = ebi["dbar"] + lam_s * (sd - ebi["dbar"])
        res["sector_tau"] = _r(np.sqrt(tau_s2), 3)
        res["sector_w"] = {k: {"w": _r(float(np.clip(wg + 2.5 * (sec_dhat[k] - ebi["dbar"]), 0.1, 0.9)), 2), "d": _r(float(sd[k]), 3), "lam": _r(float(lam_s[k]), 2),
                               "n": int(gs["d"].count()[k])} for k in sd.index}
    dev = pd.Series(0.0, index=T.columns)
    dev = dev + (sec_dhat - ebi["dbar"]).reindex(sec_of.values).fillna(0).values if len(sec_dhat) else dev
    if len(dhat):
        dev.loc[dhat.index] = dev.loc[dhat.index] + (dhat.astype(float) - ebi["dbar"]).values
    w_now = np.clip(wg + 2.5 * dev, 0.1, 0.9)
    last = dates[-1]
    calk = {c["key"]: c for c in cal}
    cur = {}
    for s_ in T.columns:
        f, b = F.loc[last, s_], B.loc[last, s_]
        if not (np.isfinite(f) or np.isfinite(b)):
            continue
        w = float(w_now[s_])
        tot = w * f + (1 - w) * b if np.isfinite(f) and np.isfinite(b) else (f if np.isfinite(f) else b)
        stx = st.loc[s_] if s_ in st.index else None
        z = (float(stx["d"]) - ebi["dbar"]) / float(stx["se"]) if stx is not None and float(stx["se"]) > 0 else None
        v = verdict(tot)
        cur[s_] = {"fwd": _r(f, 0), "back": _r(b, 0), "w": _r(w, 2), "total": _r(tot, 0), "w_glob": _r(wg, 2),
                   "w_raw": _r(float(np.clip(wg + 2.5 * (float(stx["d"]) - ebi["dbar"]), 0.1, 0.9)), 2) if stx is not None else None,
                   "w_sec": (res.get("sector_w", {}).get(sec_of.get(s_)) or {}).get("w"),
                   "v_fwd": verdict(f), "v_back": verdict(b), "v_total": v, "exp": (calk.get(v) or {}).get("ret"), "win": (calk.get(v) or {}).get("win"),
                   "icf": _r(stx["icf"], 3) if stx is not None else None, "icb": _r(stx["icb"], 3) if stx is not None else None,
                   "n": int(stx["n"]) if stx is not None else None, "z": _r(z, 2),
                   "ind": {k: {"raw": _r(P["raw"][k].loc[last, s_], 4), "rank": _r(R[k].loc[last, s_], 0)} for k in IND},
                   "hist": {"f": [_r(x, 0) for x in F[s_].iloc[-24:].values], "b": [_r(x, 0) for x in B[s_].iloc[-24:].values],
                            "t": [str(d.date())[:7] for d in dates[-24:]]}}
    res["ok"] = True
    res["date"] = str(last.date())
    return {"summary": res, "current": cur, "ind": {k: {"name": v[0], "f": v[1], "dir": v[2], "why": v[3]} for k, v in IND.items()}}


def verdict(x):
    if x is None or not np.isfinite(x):
        return None
    return "buy" if x >= 65 else "lean_buy" if x >= 55 else "neutral" if x >= 45 else "lean_sell" if x >= 35 else "sell"
