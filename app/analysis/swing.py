"""Hành vi giá: biên độ, đảo chiều, dấu hiệu bị "lái", kiểu chơi của dòng tiền lớn.

Dữ liệu
  - nến ngày từ 2014 (mọi mã) → các kiểu phiên đảo chiều, chạm trần/sàn rồi rời, KL đột biến, biên độ, độ giằng co;
  - nến giờ (≈ 3 năm) và nến phút (≈ 6 tháng) → buổi sáng / buổi chiều / ATC của từng phiên;
  - lệnh khớp theo nhóm Cá mập / Sói / Cừu (chỉ các mã anh nắm, từ ngày bắt đầu lưu).

Các kiểu phiên (đều so với biên độ quen thuộc của chính mã – trung vị 20 phiên trước, tối thiểu 2,5%)
  đẩy rồi xả   giá lên ≥ 1 biên độ quen thuộc so với tham chiếu nhưng đóng cửa trả lại ≥ 65% mức tăng
  đạp rồi kéo  giá xuống ≥ 1 biên độ quen thuộc nhưng đóng cửa hồi lại ≥ 65% mức giảm
  + KL đột biến (≥ 2,5 lần trung vị 20 phiên) → "phân phối" / "rũ bỏ – gom"
  chạm trần rồi rời / chạm sàn rồi kéo  chạm giá trần (sàn) trong phiên nhưng đóng cửa cách ≥ 1,5%
Mỗi kiểu đều được đo lại trên toàn bộ lịch sử từ 2016: sau phiên như vậy 1 / 5 / 20 phiên giá đi đâu so với VN-Index.

Điểm bất thường (0–100): xếp hạng trong các mã thanh khoản theo biên độ so với thị trường, tần suất phiên đảo chiều,
chạm trần/sàn rồi rời, độ giằng co (tự tương quan âm), KL thất thường, xác suất sáng–chiều ngược chiều, biến động ATC,
thanh khoản thấp. Điểm cao = giá hay bị đẩy/đạp bất thường, KHÔNG phải bằng chứng thao túng.
Kiểm chứng: điểm tính tại từng cuối tháng (chỉ dữ liệu trước đó) so với biến động và lợi nhuận 20 phiên sau.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

LIMIT = {"HOSE": 0.07, "HNX": 0.10, "UPCOM": 0.15}
W = 120                 # cửa sổ hồ sơ (phiên)
EV_START = "2016-01-01"
M_UP, M_DN = 0.015, -0.015   # buổi sáng tăng / giảm đáng kể
ATC_BIG = 0.005

EVENTS = {
    "pump_spike": ("Đẩy rồi xả + KL đột biến", "Giá lên mạnh trong phiên rồi bị bán xuống, KL ≥ 2,5 lần bình thường – dấu hiệu phân phối"),
    "pump": ("Đẩy rồi xả", "Giá lên ≥ 1 biên độ quen thuộc nhưng đóng cửa trả lại ≥ 65% mức tăng"),
    "dump_spike": ("Đạp rồi kéo + KL đột biến", "Giá bị đạp mạnh rồi được kéo lên, KL lớn – dấu hiệu rũ bỏ / gom hàng"),
    "dump": ("Đạp rồi kéo", "Giá xuống ≥ 1 biên độ quen thuộc nhưng đóng cửa hồi ≥ 65% mức giảm"),
    "leave_c": ("Chạm trần rồi rời", "Chạm giá trần trong phiên nhưng đóng cửa thấp hơn đỉnh ≥ 1,5%"),
    "rec_f": ("Chạm sàn rồi kéo", "Chạm giá sàn trong phiên nhưng đóng cửa cao hơn đáy ≥ 1,5%"),
    "push": ("Tăng mạnh đóng cửa cao + KL lớn", "Biên độ ≥ 2 lần bình thường, đóng cửa sát đỉnh, KL đột biến – lực mua thật (để so sánh)"),
    "flush": ("Giảm mạnh đóng cửa thấp + KL lớn", "Biên độ ≥ 2 lần bình thường, đóng cửa sát đáy, KL đột biến – bán tháo (để so sánh)"),
    "wide": ("Biên độ bất thường", "Biên độ ≥ 2,5 lần biên độ quen thuộc"),
    "spike": ("KL đột biến, giá đứng", "KL ≥ 2,5 lần bình thường nhưng giá thay đổi < 2%"),
}
EVKEY = {"wide": "wide_ev", "spike": "spike_ev"}


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------- nến ngày
def panels(prices: pd.DataFrame, syms: list[str]) -> dict[str, pd.DataFrame]:
    p = prices[prices["symbol"].isin(syms)]
    out = {}
    for k, c in (("O", "open"), ("H", "high"), ("L", "low"), ("C", "close"), ("V", "volume")):
        out[k] = p.pivot_table(index="date", columns="symbol", values=c).sort_index()
    cols = out["C"].columns
    for k in out:
        out[k] = out[k].reindex(columns=cols)
    return out


def daily_events(P: dict, limits: pd.Series) -> dict[str, pd.DataFrame]:
    O, H, L, C, V = P["O"], P["H"], P["L"], P["C"], P["V"]
    c1 = C.shift(1)
    ok = (c1 > 0) & (H >= L) & (L > 0)
    rng = ((H - L) / c1).where(ok)
    up, dn, ret = (H / c1 - 1).where(ok), (L / c1 - 1).where(ok), (C / c1 - 1).where(ok)
    typ = rng.rolling(20, min_periods=10).median().shift(1)
    thr = typ.clip(lower=0.025)
    lim = pd.DataFrame(np.broadcast_to(limits.reindex(C.columns).fillna(0.07).values, C.shape), index=C.index, columns=C.columns)
    vmed = V.rolling(20, min_periods=10).median().shift(1)
    spike = (V >= 2.5 * vmed) & (vmed > 0)
    pump = (up >= thr) & ((C - c1) <= 0.35 * (H - c1))
    dump = (dn <= -thr) & ((C - L) >= 0.65 * (c1 - L))
    touch_c = up >= lim - 0.006
    touch_f = dn <= -(lim - 0.006)
    leave_c = touch_c & (C <= H * 0.985)
    rec_f = touch_f & (C >= L * 1.015)
    wide = rng >= 2 * typ
    clv = ((C - L) / (H - L)).where(H > L)
    push = wide & spike & (clv >= 0.8) & (ret > 0)
    flush = wide & spike & (clv <= 0.2) & (ret < 0)
    return {"rng": rng, "ret": ret, "typ": typ, "up": up, "dn": dn, "spike": spike, "pump": pump & ~touch_f, "dump": dump & ~touch_c,
            "pump_spike": pump & spike, "dump_spike": dump & spike, "leave_c": leave_c, "rec_f": rec_f, "push": push, "flush": flush,
            "clv": clv, "wide_ev": rng >= 2.5 * typ, "spike_ev": spike & (ret.abs() < 0.02)}


def event_study(E: dict, C: pd.DataFrame, bench: pd.Series, liq: pd.DataFrame) -> dict:
    """Sau mỗi kiểu phiên: lợi nhuận 1/5/20 phiên so với VN-Index (toàn thị trường, từ 2016)."""
    b = bench.reindex(C.index).ffill()
    res, own = {}, {}
    start = pd.Timestamp(EV_START)
    fw = {}
    for k in (1, 5, 20):
        f = C.shift(-k) / C - 1
        fb = b.shift(-k) / b - 1
        fw[k] = f.sub(fb, axis=0).replace([np.inf, -np.inf], np.nan)
        fw[k] = fw[k].where(fw[k].abs() < 3)
    mid = pd.Timestamp("2021-07-01")
    base_mask = liq.copy()
    base_mask.loc[base_mask.index < start] = False
    base5 = fw[5].where(base_mask)
    res["_base"] = {"r5": _r(100 * np.nanmean(base5.values), 2), "hit5": _r(100 * np.nanmean((base5.values > 0)[~np.isnan(base5.values)]), 0)}
    for key in EVENTS:
        m = E[EVKEY.get(key, key)] & base_mask
        rec = {"name": EVENTS[key][0], "desc": EVENTS[key][1]}
        for k in (1, 5, 20):
            x = fw[k].where(m)
            vals = x.values[~np.isnan(x.values)]
            if len(vals) < 30:
                continue
            # sai số chuẩn theo ngày (các mã cùng ngày tương quan nhau)
            per_day = x.mean(axis=1).dropna()
            se = per_day.std(ddof=1) / np.sqrt(max(len(per_day), 2)) if len(per_day) > 2 else np.nan
            rec[f"r{k}"] = _r(100 * vals.mean(), 2)
            rec[f"med{k}"] = _r(100 * np.median(vals), 2)
            rec[f"hit{k}"] = _r(100 * (vals > 0).mean(), 0)
            rec[f"t{k}"] = _r(per_day.mean() / se, 1) if se and se > 0 else None
            if k == 5:
                rec["n"] = int(len(vals))
                a, bb = x[x.index < mid].values, x[x.index >= mid].values
                a, bb = a[~np.isnan(a)], bb[~np.isnan(bb)]
                rec["r5_a"] = _r(100 * a.mean(), 2) if len(a) >= 20 else None
                rec["r5_b"] = _r(100 * bb.mean(), 2) if len(bb) >= 20 else None
        rec["useful"] = bool(rec.get("t5") is not None and abs(rec["t5"]) >= 2 and rec.get("r5_a") is not None and rec.get("r5_b") is not None
                             and np.sign(rec["r5_a"]) == np.sign(rec["r5_b"]) == np.sign(rec.get("r5") or 0))
        res[key] = rec
        # theo từng mã
        x5 = fw[5].where(m)
        own[key] = {"n": x5.notna().sum(), "mean": x5.mean()}
    return {"market": res, "own": own}


def score_validation(E: dict, V: pd.DataFrame, C: pd.DataFrame, liq: pd.DataFrame, bench: pd.Series) -> dict:
    """Điểm bất thường (chỉ phần tính được từ nến ngày) tại mỗi cuối tháng → biến động & lợi nhuận 20 phiên sau."""
    ret = E["ret"]
    mk_rng = E["rng"].where(liq).median(axis=1)
    rng_rel = E["rng"].div(mk_rng, axis=0).rolling(W, min_periods=60).median()
    rev = (E["pump"] | E["dump"]).astype(float).where(E["rng"].notna()).rolling(W, min_periods=60).mean()
    lv = (E["leave_c"] | E["rec_f"]).astype(float).where(E["rng"].notna()).rolling(W, min_periods=60).mean()
    ac1 = ret.rolling(W, min_periods=60).corr(ret.shift(1))
    val = (V * C)
    vcv = val.rolling(60, min_periods=30).std() / val.rolling(60, min_periods=30).mean()
    illq = -np.log(val.rolling(20, min_periods=10).mean().clip(lower=1))
    me = C.resample("ME").last().index
    me = [C.index[C.index.get_indexer([d], method="ffill")[0]] for d in me if d >= pd.Timestamp("2017-01-01")]
    b = bench.reindex(C.index).ffill()
    f20 = (C.shift(-20) / C - 1).sub(b.shift(-20) / b - 1, axis=0)
    fvol = ret[::-1].rolling(20, min_periods=15).std()[::-1].shift(-1)
    rows, ic_v, ic_r = [], [], []
    for d in me[:-1]:
        m = liq.loc[d]
        if m.sum() < 50:
            continue
        parts = [(rng_rel.loc[d], 1.0), (rev.loc[d], 1.5), (lv.loc[d], 1.0), (-ac1.loc[d], 0.5), (vcv.loc[d], 1.0), (illq.loc[d], 0.5)]
        sc, wsum = 0, 0
        for s_, w_ in parts:
            s_ = s_[m]
            sc = sc + w_ * s_.rank(pct=True).fillna(0.5)
            wsum += w_
        sc = sc / wsum
        fv, fr = fvol.loc[d][m], f20.loc[d][m]
        ok = sc.notna() & fv.notna() & fr.notna()
        if ok.sum() < 50:
            continue
        ic_v.append(sc[ok].rank().corr(fv[ok].rank()))
        ic_r.append(sc[ok].rank().corr(fr[ok].rank()))
        q = pd.qcut(sc[ok].rank(method="first"), 5, labels=False)
        rows.append(pd.DataFrame({"q": q, "fv": fv[ok], "fr": fr[ok]}))
    if not ic_v:
        return {"ok": False}
    allq = pd.concat(rows)
    qt = allq.groupby("q").agg(fv=("fv", "mean"), fr=("fr", "mean"))
    icv, icr = np.array(ic_v), np.array(ic_r)
    n = len(icv)
    return {"ok": True, "n_months": n, "ic_vol": _r(icv.mean(), 3), "t_vol": _r(icv.mean() / (icv.std(ddof=1) / np.sqrt(n)), 1),
            "ic_ret": _r(icr.mean(), 3), "t_ret": _r(icr.mean() / (icr.std(ddof=1) / np.sqrt(n / 1.0)), 1),
            "quint": [{"q": int(q) + 1, "vol": _r(100 * r.fv * np.sqrt(250), 1), "ret": _r(100 * r.fr, 2)} for q, r in qt.iterrows()]}


# ----------------------------------------------------------------- phiên (sáng / chiều / ATC)
def session_table(isess: pd.DataFrame, cal: pd.DatetimeIndex) -> pd.DataFrame:
    if isess is None or isess.empty:
        return pd.DataFrame()
    d = isess.copy()
    d["date"] = pd.to_datetime(d["date"]).dt.normalize()
    d = d.sort_values(["symbol", "date"])
    pos = pd.Series(np.arange(len(cal)), index=cal.normalize())
    d["k"] = d["date"].map(pos)
    g = d.groupby("symbol")
    d["pc"] = g["c"].shift(1)
    d["kprev"] = g["k"].shift(1)
    d = d[(d["k"] - d["kprev"] == 1) & (d["pc"] > 0)].copy()
    pre = d["pre_atc"].where(d["pre_atc"].notna() & (d["src"] == "m"), d["c"])
    d["m_ret"] = d["m_c"] / d["pc"] - 1
    d["a_ret"] = pre / d["m_c"] - 1
    d["atc_ret"] = (d["c"] / d["pre_atc"] - 1).where(d["src"] == "m")
    d["day_ret"] = d["c"] / d["pc"] - 1
    d["from_hi"] = d["c"] / d["h"] - 1
    d["rng"] = (d["h"] - d["l"]) / d["pc"]
    bad = d["day_ret"].abs() > 0.16
    return d[~bad]


def session_stats(s: pd.DataFrame, n: int = 250) -> dict:
    s = s.tail(n)
    if len(s) < 20:
        return {"n": int(len(s))}
    up, dn = s[s["m_ret"] >= M_UP], s[s["m_ret"] <= M_DN]
    out = {"n": int(len(s)), "n_up": int(len(up)), "n_dn": int(len(dn)),
           "p_fade": _r(100 * (up["a_ret"] < -0.003).mean(), 0) if len(up) >= 8 else None,
           "a_after_up": _r(100 * up["a_ret"].mean(), 2) if len(up) >= 8 else None,
           "p_bounce": _r(100 * (dn["a_ret"] > 0.003).mean(), 0) if len(dn) >= 8 else None,
           "a_after_dn": _r(100 * dn["a_ret"].mean(), 2) if len(dn) >= 8 else None,
           "corr_ma": _r(s["m_ret"].corr(s["a_ret"]), 2),
           "m_mean": _r(100 * s["m_ret"].mean(), 2), "a_mean": _r(100 * s["a_ret"].mean(), 2),
           "hi_early": _r(100 * (s["hi_t"] <= 9 * 60 + 45).mean(), 0), "lo_early": _r(100 * (s["lo_t"] <= 9 * 60 + 45).mean(), 0),
           "hi_late": _r(100 * (s["hi_t"] >= 14 * 60).mean(), 0), "lo_late": _r(100 * (s["lo_t"] >= 14 * 60).mean(), 0)}
    a = s["atc_ret"].dropna()
    if len(a) >= 30:
        out.update({"n_atc": int(len(a)), "atc_mean": _r(100 * a.mean(), 2), "atc_abs": _r(100 * a.abs().mean(), 2),
                    "atc_up": _r(100 * (a >= ATC_BIG).mean(), 0), "atc_dn": _r(100 * (a <= -ATC_BIG).mean(), 0)})
    return out


def path_profile(ibk: pd.DataFrame, pcs: pd.Series, n: int = 60) -> dict:
    """Đường đi trung bình trong phiên (lợi nhuận luỹ kế từ giá tham chiếu tới cuối mỗi khung 30 phút) + nhịp khối lượng."""
    if ibk is None or ibk.empty:
        return {}
    d = ibk.copy()
    d["date"] = pd.to_datetime(d["date"]).dt.normalize()
    dates = sorted(d["date"].unique())[-n:]
    d = d[d["date"].isin(dates)]
    d["pc"] = d["date"].map(pcs)
    d = d[d["pc"] > 0]
    if d["date"].nunique() < 15:
        return {}
    d["cr"] = d["c"] / d["pc"] - 1
    d["cr"] = d["cr"].where(d["cr"].abs() < 0.16)
    tot = d.groupby("date")["v"].transform("sum")
    d["vs"] = d["v"] / tot.replace(0, np.nan)
    g = d.groupby("b")
    path = g["cr"].mean()
    vs = g["vs"].mean()
    vs = vs / vs.sum()
    return {"n": int(d["date"].nunique()), "path": [_r(100 * path.get(i, np.nan), 2) for i in range(9)],
            "vshare": [_r(100 * vs.get(i, np.nan), 1) for i in range(9)]}


# ----------------------------------------------------------------- hồ sơ từng mã + điểm
def profiles(E: dict, P: dict, liq_last: pd.Series, ses: pd.DataFrame, ibk: pd.DataFrame, own: dict, mkt: dict) -> pd.DataFrame:
    C, V = P["C"], P["V"]
    syms = list(C.columns)
    tail = slice(-W, None)
    rng = E["rng"].iloc[tail]
    lc = [c for c in C.columns if bool(liq_last.get(c, False))] or list(C.columns)
    mk_rng_day = E["rng"][lc].iloc[tail].median(axis=1)
    rows = []
    ses_by = {s: d for s, d in ses.groupby("symbol")} if ses is not None and not ses.empty else {}
    ibk_by = {s: d for s, d in ibk.groupby("symbol")} if ibk is not None and not ibk.empty else {}
    ret = E["ret"].iloc[tail]
    for s in syms:
        r = rng[s].dropna()
        if len(r) < 60:
            continue
        rr = ret[s].dropna()
        val = (V[s] * C[s]).iloc[-60:] / 1e6
        rec = {"symbol": s, "rng_med": 100 * float(r.median()), "rng_rel": float((rng[s] / mk_rng_day).median()),
               "pump": int(E["pump"][s].iloc[tail].sum()), "dump": int(E["dump"][s].iloc[tail].sum()),
               "pump_spike": int(E["pump_spike"][s].iloc[tail].sum()), "dump_spike": int(E["dump_spike"][s].iloc[tail].sum()),
               "leave_c": int(E["leave_c"][s].iloc[tail].sum()), "rec_f": int(E["rec_f"][s].iloc[tail].sum()),
               "spikes": int(E["spike"][s].iloc[tail].sum()),
               "ac1": float(rr.corr(rr.shift(1))) if len(rr) > 30 else np.nan,
               "flips": float((np.sign(rr) != np.sign(rr.shift(1))).iloc[-60:].mean()),
               "vcv": float(val.std() / val.mean()) if val.mean() > 0 else np.nan,
               "val_bn": float(val.iloc[-20:].mean())}
        rec["rev_rate"] = 100 * (rec["pump"] + rec["dump"]) / W
        st = session_stats(ses_by[s]) if s in ses_by else {"n": 0}
        rec.update({f"s_{k}": v for k, v in st.items()})
        pcs = ses_by[s].set_index("date")["pc"] if s in ses_by else pd.Series(dtype=float)
        if s in ibk_by and len(pcs):
            pp = path_profile(ibk_by[s], pcs)
            rec["path"], rec["vshare"], rec["path_n"] = pp.get("path"), pp.get("vshare"), pp.get("n")
        for k in ("pump_spike", "pump", "dump_spike", "dump", "leave_c", "rec_f"):
            o = own.get(k)
            if o is not None:
                n_, m_ = o["n"].get(s, 0), o["mean"].get(s, np.nan)
                rec[f"o_{k}_n"] = int(n_)
                mk = (mkt.get(k) or {}).get("r5")
                if n_ and not np.isnan(m_) and mk is not None:
                    rec[f"o_{k}_r5"] = (n_ * 100 * m_ + 10 * mk) / (n_ + 10)   # kéo về trung bình thị trường khi ít mẫu
        rows.append(rec)
    df = pd.DataFrame(rows).set_index("symbol")
    if df.empty:
        return df
    base = df[df["val_bn"] >= 1]
    pf_m = base["s_p_fade"].median() if "s_p_fade" in base else np.nan
    pb_m = base["s_p_bounce"].median() if "s_p_bounce" in base else np.nan
    df["x_fade"] = df.get("s_p_fade", pd.Series(np.nan, index=df.index)) - pf_m
    df["x_bounce"] = df.get("s_p_bounce", pd.Series(np.nan, index=df.index)) - pb_m
    df["x_rev"] = df[["x_fade", "x_bounce"]].max(axis=1)
    parts = [("rng_rel", 1.0, 1), ("rev_rate", 1.5, 1), ("lv", 1.0, 1), ("ac1", 0.5, -1), ("vcv", 1.0, 1), ("x_rev", 1.5, 1),
             ("s_atc_abs", 1.0, 1), ("val_bn", 0.5, -1)]
    df["lv"] = df["leave_c"] + df["rec_f"]
    sc, ws = pd.Series(0.0, index=df.index), pd.Series(0.0, index=df.index)
    for c, w, sgn in parts:
        if c not in df:
            continue
        rk = (sgn * df[c]).rank(pct=True)
        has = rk.notna()
        sc[has] += w * rk[has]
        ws[has] += w
    df["score"] = (100 * sc / ws.replace(0, np.nan)).round(0)
    df["tags"] = [tags(r) for _, r in df.iterrows()]
    return df


def tags(r) -> list[str]:
    t = []
    g = lambda k: r.get(k) if k in r and r.get(k) == r.get(k) else None  # noqa: E731
    if (g("s_p_fade") or 0) >= 60 and (g("s_n_up") or 0) >= 12 and (g("x_fade") or 0) >= 8:
        t.append("Đẩy sáng – xả chiều")
    if (g("s_p_bounce") or 0) >= 60 and (g("s_n_dn") or 0) >= 12 and (g("x_bounce") or 0) >= 8:
        t.append("Đạp sáng – kéo chiều")
    if (g("s_atc_up") or 0) >= 30 and (g("s_atc_mean") or 0) >= 0.2:
        t.append("Hay kéo ATC")
    if (g("s_atc_dn") or 0) >= 30 and (g("s_atc_mean") or 0) <= -0.2:
        t.append("Hay đạp ATC")
    if (g("leave_c") or 0) >= 3:
        t.append("Kéo trần rồi xả")
    if (g("rec_f") or 0) >= 3:
        t.append("Đạp sàn rồi kéo")
    if (g("pump_spike") or 0) >= 3:
        t.append("Nhiều phiên phân phối")
    if (g("dump_spike") or 0) >= 3:
        t.append("Nhiều phiên rũ bỏ")
    if (g("rng_rel") or 0) >= 1.6 and (g("flips") or 0) >= 0.58:
        t.append("Biên độ rộng, giằng co")
    if (g("score") or 100) < 30:
        t.append("Đi đều, ít nhiễu")
    return t


# ----------------------------------------------------------------- tín hiệu phiên gần nhất
MEANING = {
    "pump_spike": "Bị đẩy lên rồi bán xuống với KL lớn – có người tranh thủ giá cao để bán ra.",
    "pump": "Lên cao trong phiên nhưng không giữ được – lực bán chặn ở giá cao.",
    "dump_spike": "Bị bán mạnh rồi được mua lại với KL lớn – có người đỡ giá ở vùng thấp.",
    "dump": "Bị đạp nhưng được kéo lại trước khi đóng cửa.",
    "leave_c": "Kéo lên trần nhưng không giữ được – lực bán chờ sẵn ở giá trần.",
    "rec_f": "Chạm sàn rồi được đỡ lên.",
    "push": "Tăng mạnh, đóng cửa sát đỉnh, KL lớn – lực mua chủ động thật.",
    "flush": "Giảm mạnh, đóng cửa sát đáy, KL lớn – bán tháo.",
    "fade_today": "Sáng đẩy, chiều xả – người đẩy giá buổi sáng có thể đã thoát hàng buổi chiều.",
    "bounce_today": "Sáng đạp, chiều kéo – có lực mua vào buổi chiều.",
    "atc_up": "Giá bị kéo lên trong phiên ATC – giá đóng cửa có thể 'đẹp' hơn cung cầu trong phiên.",
    "atc_dn": "Giá bị đạp trong phiên ATC – giá đóng cửa có thể xấu hơn cung cầu trong phiên.",
    "wide": "Biên độ gấp nhiều lần bình thường – có thông tin hoặc có tay to vào/ra.",
    "spike": "KL đột biến dù giá ít thay đổi – có thể đang gom hoặc xả lặng lẽ.",
}


def advice_for(k: str, mk: dict, lo=None, hi=None) -> str:
    """Hành động suy ra từ chính lịch sử của kiểu phiên này (không phải cảm tính)."""
    st = mk.get(k) or {}
    r5, hit, n = st.get("r5"), st.get("hit5"), st.get("n")
    if r5 is None:
        return "Chưa đủ lịch sử để biết sau đó giá thường đi đâu – chỉ coi là cảnh báo biến động."
    v = lambda x: f"{x:+.1f}".replace(".", ",")  # noqa: E731
    lo_t = f" {lo:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") if lo else ""
    hi_t = f" {hi:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".") if hi else ""
    n_t = f"{int(n or 0):,}".replace(",", ".")
    if st.get("useful") and r5 <= -0.3:
        return (f"Lịch sử ({n_t} lần từ 2016): 5 phiên sau trung bình {v(r5)}% so với VN-Index, {100 - (hit or 50):.0f}% số lần kém hơn. "
                f"Chưa nắm: đừng mua theo trong vài phiên tới. Đang nắm: siết điểm dừng ngay dưới đáy phiên{lo_t}, hồi lên thì cân nhắc bán bớt.")
    if st.get("useful") and r5 >= 0.3:
        return (f"Lịch sử ({n_t} lần từ 2016): 5 phiên sau trung bình {v(r5)}% so với VN-Index, {hit or 50:.0f}% số lần hơn. "
                f"Nếu mã đang trong xu hướng tăng có thể theo một phần, dừng lỗ dưới đáy phiên{lo_t}.")
    return (f"Lịch sử ({n_t} lần): sau phiên kiểu này giá không có xu hướng rõ ({v(r5)}% so với VN-Index sau 5 phiên) – "
            f"chỉ là cảnh báo biến động, không phải tín hiệu mua/bán. Đừng mua đuổi, đừng bán tháo theo.")


def session_event_study(ses: pd.DataFrame, C: pd.DataFrame, bench: pd.Series, liq_syms: list[str]) -> dict:
    """Kiểu phiên nhìn từ nến phút/giờ: sáng đẩy–chiều xả, sáng đạp–chiều kéo, kéo/đạp ATC → 1 và 5 phiên sau."""
    if ses is None or ses.empty:
        return {}
    b = bench.reindex(C.index).ffill()
    fw = {}
    for k in (1, 5):
        f = (C.shift(-k) / C - 1).sub(b.shift(-k) / b - 1, axis=0).replace([np.inf, -np.inf], np.nan)
        fw[k] = f.where(f.abs() < 3).stack().rename(f"f{k}")
    s = ses[ses["symbol"].isin(liq_syms)].set_index(["date", "symbol"])
    for k in (1, 5):
        s = s.join(fw[k], how="left")
    defs = {"fade_today": (s["m_ret"] >= 0.02) & (s["a_ret"] <= -0.015), "bounce_today": (s["m_ret"] <= -0.02) & (s["a_ret"] >= 0.015),
            "atc_up": s["atc_ret"] >= 0.01, "atc_dn": s["atc_ret"] <= -0.01}
    names = {"fade_today": "Sáng đẩy ≥ 2%, chiều xả ≥ 1,5%", "bounce_today": "Sáng đạp ≥ 2%, chiều kéo ≥ 1,5%",
             "atc_up": "Kéo ATC ≥ 1%", "atc_dn": "Đạp ATC ≥ 1%"}
    out = {}
    for k, m in defs.items():
        x = s[m.fillna(False)]
        rec = {"name": names[k], "desc": MEANING[k], "n": int(len(x))}
        for h in (1, 5):
            v = x[f"f{h}"].dropna()
            if len(v) >= 30:
                pdy = v.groupby(level=0).mean()
                se = pdy.std(ddof=1) / np.sqrt(len(pdy)) if len(pdy) > 2 else np.nan
                rec[f"r{h}"], rec[f"hit{h}"] = _r(100 * v.mean(), 2), _r(100 * (v > 0).mean(), 0)
                rec[f"t{h}"] = _r(pdy.mean() / se, 1) if se and se > 0 else None
        rec["useful"] = bool(rec.get("t5") is not None and abs(rec["t5"]) >= 2)
        rec["n"] = int(x["f5"].notna().sum())
        out[k] = rec
    return out


def today_signals(E: dict, P: dict, ses: pd.DataFrame, prof: pd.DataFrame, mkt: dict, last_date) -> list[dict]:
    C, H, L = P["C"], P["H"], P["L"]
    out = []
    d = C.index[-1]
    if pd.Timestamp(d).normalize() != pd.Timestamp(last_date).normalize():
        return out
    ses_t = ses[ses["date"] == pd.Timestamp(d).normalize()].set_index("symbol") if ses is not None and not ses.empty else pd.DataFrame()
    for s in prof.index:
        if s not in C.columns:
            continue
        sig = []
        for k in ("pump_spike", "dump_spike", "leave_c", "rec_f", "push", "flush"):
            if bool(E[k][s].iloc[-1]):
                sig.append(k)
        if not ({"pump_spike", "leave_c"} & set(sig)) and bool(E["pump"][s].iloc[-1]):
            sig.append("pump")
        if not ({"dump_spike", "rec_f"} & set(sig)) and bool(E["dump"][s].iloc[-1]):
            sig.append("dump")
        rng, typ = E["rng"][s].iloc[-1], E["typ"][s].iloc[-1]
        if rng == rng and typ == typ and typ > 0 and rng >= 2.5 * typ and not sig:
            sig.append("wide")
        if bool(E["spike"][s].iloc[-1]) and not sig and abs(E["ret"][s].iloc[-1] or 0) < 0.02:
            sig.append("spike")
        if s in ses_t.index:
            x = ses_t.loc[s]
            if x["m_ret"] >= 0.02 and x["a_ret"] <= -0.015:
                sig.append("fade_today")
            if x["m_ret"] <= -0.02 and x["a_ret"] >= 0.015:
                sig.append("bounce_today")
            if x.get("atc_ret") == x.get("atc_ret") and x.get("atc_ret") is not None:
                if x["atc_ret"] >= 0.01:
                    sig.append("atc_up")
                elif x["atc_ret"] <= -0.01:
                    sig.append("atc_dn")
        if not sig:
            continue
        p = prof.loc[s]
        rec = {"symbol": s, "sig": sig, "ret": _r(100 * E["ret"][s].iloc[-1], 2), "rng": _r(100 * rng, 1), "typ": _r(100 * typ, 1),
               "vol_x": _r(P["V"][s].iloc[-1] / max(P["V"][s].iloc[-21:-1].median(), 1), 1),
               "hi": _r(H[s].iloc[-1]), "lo": _r(L[s].iloc[-1]), "close": _r(C[s].iloc[-1]), "score": _r(p.get("score"), 0)}
        if s in ses_t.index:
            x = ses_t.loc[s]
            rec.update({"m_ret": _r(100 * x["m_ret"], 2), "a_ret": _r(100 * x["a_ret"], 2), "atc_ret": _r(100 * x["atc_ret"], 2) if x["atc_ret"] == x["atc_ret"] else None})
        hist = []
        for k in sig:
            mk = mkt.get(k) or {}
            if mk.get("r5") is not None:
                hist.append({"k": k, "r5": mk.get("r5"), "hit5": mk.get("hit5"), "n": mk.get("n"), "useful": mk.get("useful"),
                             "own_n": int(p.get(f"o_{k}_n") or 0) if f"o_{k}_n" in p else None,
                             "own_r5": _r(p.get(f"o_{k}_r5"), 2) if f"o_{k}_r5" in p else None})
        rec["hist"] = hist
        sev = {"pump_spike": 3, "leave_c": 3, "flush": 3, "fade_today": 2, "dump_spike": 2, "rec_f": 2, "pump": 2, "wide": 2,
               "atc_up": 1, "atc_dn": 1, "dump": 1, "push": 1, "bounce_today": 1, "spike": 1}
        rec["sev"] = max(sev.get(k, 1) for k in sig)
        main0 = max(sig, key=lambda k: sev.get(k, 1))
        st0 = mkt.get(main0) or {}
        if st0.get("useful") and (st0.get("r5") or 0) <= -0.3:
            rec["dir"] = -1
        elif st0.get("useful") and (st0.get("r5") or 0) >= 0.3:
            rec["dir"] = 1
        else:
            rec["dir"] = 0
        rec["meaning"] = " ".join(dict.fromkeys(MEANING[k] for k in sig[:2] if k in MEANING))
        main = max(sig, key=lambda k: sev.get(k, 1))
        rec["advice"] = advice_for(main, mkt, rec["lo"], rec["hi"])
        out.append(rec)
    out.sort(key=lambda x: (-x["sev"], -(x.get("score") or 0)))
    return out


def market_baseline(ses: pd.DataFrame, ibk: pd.DataFrame, liq_syms: list[str]) -> dict:
    out = {}
    if ses is not None and not ses.empty:
        s = ses[ses["symbol"].isin(liq_syms)]
        s = s[s["date"] >= s["date"].max() - pd.Timedelta(days=400)]
        st = session_stats(s, n=10 ** 9)
        out.update(st)
        out["first"] = str(ses["date"].min().date())
        out["n_sym_h"] = int(ses.loc[ses["src"] == "h", "symbol"].nunique())
        out["n_sym_m"] = int(ses.loc[ses["src"] == "m", "symbol"].nunique())
    if ibk is not None and not ibk.empty and ses is not None and not ses.empty:
        pcs = ses.set_index(["symbol", "date"])["pc"]
        d = ibk[ibk["symbol"].isin(liq_syms)].copy()
        d["date"] = pd.to_datetime(d["date"]).dt.normalize()
        d = d[d["date"] >= d["date"].max() - pd.Timedelta(days=100)]
        d["pc"] = pcs.reindex(pd.MultiIndex.from_arrays([d["symbol"], d["date"]])).values
        d = d[d["pc"] > 0]
        if not d.empty:
            d["cr"] = (d["c"] / d["pc"] - 1).where(lambda x: x.abs() < 0.16)
            tot = d.groupby(["symbol", "date"])["v"].transform("sum")
            d["vs"] = d["v"] / tot.replace(0, np.nan)
            vs = d.groupby("b")["vs"].mean()
            vs = vs / vs.sum()
            out["vshare"] = [_r(100 * vs.get(i, np.nan), 1) for i in range(9)]
            out["path"] = [_r(100 * d.groupby("b")["cr"].mean().get(i, np.nan), 2) for i in range(9)]
    return out
