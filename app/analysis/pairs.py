"""Mã liên quan: đồng pha (né mã này thì né mã kia) và dẫn dắt (mã này chạy trước, mã kia theo sau L tuần).

Dữ liệu: giá đóng cửa tuần (thứ 6), lợi nhuận VƯỢT VN-Index (bỏ phần cả thị trường cùng lên xuống).
Đồng pha   tương quan lợi nhuận vượt VNI theo tuần: 2 năm gần nhất và dài hạn (2016–nay); beta (Y đi bao nhiêu % khi X đi 1%);
           xác suất Y cũng sụt ≥ 10% trong cùng cửa sổ 4 tuần khi X sụt ≥ 10%; tương quan trễ −8…+8 tuần (biểu đồ lệch pha).
Dẫn dắt    tương quan trễ L tuần (L = 1…13): lợi nhuận vượt VNI của mã dẫn ở tuần t−L với mã theo ở tuần t.
           Chỉ xét cặp có liên hệ kinh tế (cùng ngành, hoặc đồng pha ≥ 0,35) để tránh "tìm thấy" quan hệ ngẫu nhiên.
           Chọn trên 2016–2022 (|t| ≥ 3), KIỂM CHỨNG NGOÀI MẪU 2023–nay (cùng dấu, |t| ≥ 2,5). Ước lượng số cặp sai do may rủi.
           Dự báo: tổng các lag đã kiểm chứng, hệ số co về 50% (thận trọng), cho 1…8 tuần tới.
validate() kiểm chứng gộp (nhiều cặp cùng lúc → đủ mẫu) các giả thuyết hay gặp: mã dẫn chạy trước K tuần → mã theo H tuần sau;
           mã tụt lại so với mã đồng pha có bắt kịp không; mã lớn dẫn mã nhỏ cùng ngành 1 phiên; X đã sụt mà Y chưa sụt thì Y có sụt theo không;
           đồng pha có bền không. Kết quả dùng để viết chiến thuật (không khuyên điều dữ liệu không ủng hộ).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

LAGS = [1, 2, 3, 4, 5, 6, 8, 10, 13]
CCF = list(range(-8, 9))
SPLIT = pd.Timestamp("2023-01-01")
START = pd.Timestamp("2016-01-01")


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _tstat(s):
    s = pd.Series(s).dropna()
    if len(s) < 8 or s.std() == 0:
        return None
    return float(s.mean() / s.std() * np.sqrt(len(s)))


def weekly_excess(C: pd.DataFrame, idx: pd.Series) -> pd.DataFrame:
    w = C.where(C > 0).resample("W-FRI").last()
    b = idx.reindex(C.index).ffill().resample("W-FRI").last()
    r = np.log(w / w.shift(1))
    rb = np.log(b / b.shift(1))
    x = r.sub(rb, axis=0)
    return x.where(x.abs() < 0.5)


def _mcorr(A: pd.DataFrame, B: pd.DataFrame, min_n: int):
    """Tương quan (và beta của B theo A) từng cặp cột (A_i, B_j) trên các tuần cả hai cùng có số liệu."""
    a, b = A.values, B.values
    ma, mb = ~np.isnan(a), ~np.isnan(b)
    a0, b0 = np.where(ma, a, 0.0), np.where(mb, b, 0.0)
    fa, fb = ma.astype(float), mb.astype(float)
    n = fa.T @ fb
    sa, sb = a0.T @ fb, fa.T @ b0
    saa, sbb = (a0 ** 2).T @ fb, fa.T @ (b0 ** 2)
    sab = a0.T @ b0
    with np.errstate(invalid="ignore", divide="ignore"):
        cov = sab - sa * sb / n
        va, vb = saa - sa ** 2 / n, sbb - sb ** 2 / n
        rho = cov / np.sqrt(va * vb)
        beta = cov / va
    rho[n < min_n] = np.nan
    beta[n < min_n] = np.nan
    return rho, n, beta


def _sec(industry: pd.Series, syms: list[str]) -> np.ndarray:
    return np.asarray(industry.reindex(syms).astype(object).fillna("").astype(str).values, dtype=object)


def analyze(C: pd.DataFrame, idx: pd.Series, industry: pd.Series, liq_syms: list[str]) -> dict:
    X = weekly_excess(C[liq_syms], idx)
    X = X[X.index >= START]
    syms = list(X.columns)
    sec = _sec(industry, syms)
    same = (sec[:, None] == sec[None, :]) & (sec[:, None] != "")
    # ---- đồng pha: 2 năm gần nhất + dài hạn; beta theo lợi nhuận thô 2 năm
    R2 = X.iloc[-104:]
    rc, _, _ = _mcorr(R2, R2, 60)
    rl, _, _ = _mcorr(X, X, 150)
    raw_w = C[liq_syms].where(C[liq_syms] > 0).resample("W-FRI").last()
    rr = np.log(raw_w / raw_w.shift(1))
    rr = rr.where(rr.abs() < 0.5).iloc[-104:]
    _, _, beta = _mcorr(rr, rr, 60)                    # beta[i, j]: Y=j theo X=i
    # sụt cùng nhau: lợi nhuận 4 tuần (không chồng, neo vào tuần gần nhất) ≤ −10%
    r4 = (raw_w / raw_w.shift(4) - 1).iloc[::-1].iloc[::4].iloc[::-1]
    r4 = r4[r4.index >= START]
    dd = (r4 <= -0.10).astype(float).where(r4.notna())
    d0 = np.where(dd.notna().values, dd.values, 0.0)
    m0 = dd.notna().values.astype(float)
    both = d0.T @ d0
    nx = d0.T @ m0
    with np.errstate(invalid="ignore", divide="ignore"):
        p_cond = both / nx
        p_base = (m0.T @ d0) / (m0.T @ m0)
    # tương quan trễ (toàn mẫu): ccf[L][i, j] = corr(X_i(t−L), X_j(t)); L > 0 → i đi trước j
    ccf = {}
    for L in CCF:
        if L >= 0:
            ccf[L] = _mcorr(X.shift(L), X, 150)[0]
    for L in CCF:
        if L < 0:
            ccf[L] = ccf[-L].T
    # ---- dẫn dắt
    tr, te = X[X.index < SPLIT], X[X.index >= SPLIT]
    cand = same | (np.nan_to_num(rc) >= 0.35)
    np.fill_diagonal(cand, False)
    n_tests = int(cand.sum()) * len(LAGS)
    found = {}
    stats = []
    for L in LAGS:
        r_tr, n_tr, _ = _mcorr(tr.shift(L), tr, 100)
        r_te, n_te, _ = _mcorr(te.shift(L), te, 60)
        with np.errstate(invalid="ignore", divide="ignore"):
            t_tr = r_tr * np.sqrt((n_tr - 2) / (1 - r_tr ** 2))
            t_te = r_te * np.sqrt((n_te - 2) / (1 - r_te ** 2))
        ok = cand & (np.abs(t_tr) >= 3) & (np.sign(t_te) == np.sign(t_tr)) & (np.abs(t_te) >= 2.5)
        stats.append({"L": L, "tested": int(cand.sum()), "pass_train": int((cand & (np.abs(t_tr) >= 3)).sum()), "pass_both": int(ok.sum())})
        for i, j in zip(*np.where(ok)):
            found.setdefault((syms[i], syms[j]), []).append({"L": L, "r_tr": _r(r_tr[i, j], 3), "r_te": _r(r_te[i, j], 3), "n_te": int(n_te[i, j])})
    # xác suất một kiểm định "qua cả hai" do ngẫu nhiên: P(|t|≥3)·P(cùng dấu, |t|≥2,5) ≈ 0,0027 × 0,0062
    exp_false = n_tests * 0.0027 * 0.0062
    pairs = []
    for (a, b), lags in found.items():
        xa, yb = X[a], X[b]
        for g in lags:
            d = pd.concat([xa.shift(g["L"]), yb], axis=1).dropna()
            g["b"] = _r(0.5 * np.polyfit(d.iloc[:, 0], d.iloc[:, 1], 1)[0], 3) if len(d) > 50 else None
        # kiểm chứng tổng hợp ngoài mẫu: dự báo = Σ b_tr·x(t−L) với hệ số ước lượng trên giai đoạn đầu
        f_te = pd.Series(0.0, index=te.index)
        for g in lags:
            d = pd.concat([tr[a].shift(g["L"]), tr[b]], axis=1).dropna()
            btr = np.polyfit(d.iloc[:, 0], d.iloc[:, 1], 1)[0] if len(d) > 50 else 0
            f_te = f_te + btr * te[a].shift(g["L"]).fillna(0)
        dd_ = pd.concat([f_te, te[b]], axis=1).dropna()
        dd_ = dd_[dd_.iloc[:, 0] != 0]
        oos = dd_.iloc[:, 0].corr(dd_.iloc[:, 1]) if len(dd_) > 30 else None
        hit = None
        if len(dd_) > 30:
            big = dd_.iloc[:, 0].abs() > dd_.iloc[:, 0].abs().median()
            hit = (np.sign(dd_.iloc[:, 0]) == np.sign(dd_.iloc[:, 1]))[big].mean()
        i, j = syms.index(a), syms.index(b)
        pairs.append({"lead": a, "follow": b, "lags": lags, "same": bool(same[i, j]), "corr": _r(rc[i, j], 2),
                      "oos_r": _r(oos, 3), "oos_hit": _r(100 * hit, 0) if hit is not None else None})
    pairs.sort(key=lambda p: -(p["oos_r"] or 0))
    # ---- dự báo hiện tại cho mã theo (1…8 tuần tới) từ chuyển động gần đây của mã dẫn
    last = X.index[-1]
    for p in pairs:
        xa = X[p["lead"]]
        path, cum = [], 0.0
        for h in range(1, 9):
            v = 0.0
            for g in p["lags"]:
                k = g["L"] - h            # tuần t+h dùng x(t+h−L) → đã biết khi t+h−L ≤ t
                if k >= 0 and g.get("b") is not None and len(xa) > k:
                    xv = xa.iloc[-1 - k]
                    if xv == xv:
                        v += g["b"] * xv
            cum += v
            path.append(_r(100 * cum, 2))
        p["fc"] = path
        p["lead_4w"] = _r(100 * xa.iloc[-4:].sum(), 1)
        p["lead_13w"] = _r(100 * xa.iloc[-13:].sum(), 1)
        p["max_lag"] = max(g["L"] for g in p["lags"])
    # ---- danh sách đồng pha cho từng mã
    r13 = raw_w.iloc[-1] / raw_w.iloc[-14] - 1
    r4n = raw_w.iloc[-1] / raw_w.iloc[-5] - 1
    co = {}
    for i, a in enumerate(syms):
        lst = []
        for j in range(len(syms)):
            c2, cl = rc[i, j], rl[i, j]
            if i == j or c2 != c2:
                continue
            if not ((c2 >= 0.3 and (cl != cl or cl >= 0.2)) or c2 >= 0.45):
                continue
            lst.append((0.6 * c2 + 0.4 * (cl if cl == cl else c2), j))
        lst.sort(key=lambda z: -z[0])
        out = []
        for _, j in lst[:8]:
            b = syms[j]
            pc, pb, nx_ = p_cond[i, j], p_base[i, j], nx[i, j]
            out.append({"s": b, "rc": _r(rc[i, j], 2), "rc_l": _r(rl[i, j], 2), "beta": _r(beta[i, j], 2),
                        "p_dd": _r(100 * pc, 0) if nx_ >= 5 and pc == pc else None, "p_base": _r(100 * pb, 0) if pb == pb else None,
                        "n_dd": int(nx_), "same": bool(same[i, j]),
                        "ccf": [_r(ccf[L][i, j], 3) for L in CCF],
                        "r13_x": _r(100 * r13.get(a), 1), "r13_y": _r(100 * r13.get(b), 1), "r4_x": _r(100 * r4n.get(a), 1), "r4_y": _r(100 * r4n.get(b), 1)})
        co[a] = out
    return {"date": str(last.date()), "pairs": pairs, "co": co, "stats": stats, "n_tests": n_tests, "exp_false": _r(exp_false, 1),
            "n_syms": len(syms), "split": str(SPLIT.date()), "ccf_lags": CCF, "ccf_band": _r(2 / np.sqrt(max(len(X) - 8, 10)), 3), "weeks": int(len(X))}


def validate(C: pd.DataFrame, idx: pd.Series, industry: pd.Series, liq_syms: list[str], value: pd.Series) -> dict:
    """Kiểm chứng gộp các giả thuyết "mã này chạy trước mã kia". Huấn luyện 2016–2022, kiểm tra 2023–nay."""
    X = weekly_excess(C[liq_syms], idx)
    X = X[X.index >= START]
    syms = list(X.columns)
    tr = X[X.index < SPLIT]
    rc_tr, _, _ = _mcorr(tr, tr, 100)
    np.fill_diagonal(rc_tr, np.nan)
    sec = _sec(industry, syms)
    same = (sec[:, None] == sec[None, :]) & (sec[:, None] != "")
    out = {"split": str(SPLIT.date()), "start": str(START.date()), "n_syms": len(syms)}

    def halves(R):
        return R[R.index < SPLIT], R[R.index >= SPLIT]

    # 1) mã dẫn chạy K tuần → mã theo H tuần sau (cặp đồng pha ≥ 0,4 theo giai đoạn huấn luyện), kiểm soát đà của chính mã theo
    cs = X.fillna(0).cumsum()
    m = np.nan_to_num(rc_tr) >= 0.4
    np.fill_diagonal(m, False)
    I, J = np.where(m)
    res = {}
    for K, H in ((13, 4), (8, 8), (4, 4)):
        Pa, Fw = (cs - cs.shift(K)).values, (cs.shift(-H) - cs).values
        rows = []
        for t in range(K, len(X) - H, H):
            xa, yp, yf = Pa[t, I], Pa[t, J], Fw[t, J]
            ok = ~(np.isnan(xa) | np.isnan(yp) | np.isnan(yf))
            if ok.sum() < 20:
                continue
            A = np.c_[np.ones(ok.sum()), xa[ok], yp[ok]]
            rows.append((X.index[t], np.linalg.lstsq(A, yf[ok], rcond=None)[0][1]))
        R = pd.DataFrame(rows, columns=["d", "b"]).set_index("d")["b"]
        a, b = halves(R)
        res[f"{K}_{H}"] = {"K": K, "H": H, "pairs": int(len(I)), "b_tr": _r(a.mean(), 3), "t_tr": _r(_tstat(a), 1), "b_te": _r(b.mean(), 3), "t_te": _r(_tstat(b), 1)}
    out["lead_pool"] = res

    # 2) mã tụt lại so với mã đồng pha (|z| ≥ 2 của chênh lệch log giá 60 phiên) có bắt kịp trong 20 phiên?
    Cl = C[syms][C.index >= START - pd.Timedelta(days=120)]
    LC = np.log(Cl.where(Cl > 0))
    I, J = np.where(np.triu(np.nan_to_num(rc_tr) >= 0.45, 1))
    lt, le = [], []
    for i, j in zip(I, J):
        s = LC.iloc[:, j] - LC.iloc[:, i]
        z = (s - s.rolling(60).mean()) / s.rolling(60).std()
        f = s.shift(-20) - s
        for zz, sign in ((z <= -2, 1), (z >= 2, -1)):      # dương = mã tụt lại bắt kịp mã kia
            d = (sign * f)[zz.fillna(False)].dropna()
            d = d[d.index >= START].iloc[::10]
            lt.append(d[d.index < SPLIT].values)
            le.append(d[d.index >= SPLIT].values)
    lt = np.concatenate(lt) if lt else np.array([])
    le = np.concatenate(le) if le else np.array([])
    out["catchup"] = {"pairs": int(len(I)), "n_tr": int(len(lt)), "n_te": int(len(le)), "h": 20,
                      "r_tr": _r(100 * lt.mean()) if len(lt) else None, "r_te": _r(100 * le.mean()) if len(le) else None,
                      "hit_tr": _r(100 * (lt > 0).mean(), 0) if len(lt) else None, "hit_te": _r(100 * (le > 0).mean(), 0) if len(le) else None}

    # 3) mã thanh khoản lớn dẫn mã nhỏ cùng ngành 1 phiên (theo ngày)
    Cd = C[syms][C.index >= START]
    bx = idx.reindex(Cd.index).ffill()
    xd = np.log(Cd.where(Cd > 0) / Cd.where(Cd > 0).shift(1)).sub(np.log(bx / bx.shift(1)), axis=0)
    xd = xd.where(xd.abs() < 0.2).values
    lv = value.reindex(syms).fillna(0).values
    m = same & (lv[:, None] > 2 * lv[None, :])
    np.fill_diagonal(m, False)
    I, J = np.where(m)
    rows = []
    for t in range(1, len(Cd) - 1):
        xa, yp, yf = xd[t, I], xd[t, J], xd[t + 1, J]
        ok = ~(np.isnan(xa) | np.isnan(yp) | np.isnan(yf))
        if ok.sum() < 30:
            continue
        A = np.c_[np.ones(ok.sum()), xa[ok], yp[ok]]
        rows.append((Cd.index[t], np.linalg.lstsq(A, yf[ok], rcond=None)[0][1]))
    R = pd.DataFrame(rows, columns=["d", "b"]).set_index("d")["b"]
    a, b2 = halves(R)
    out["daily_lead"] = {"pairs": int(len(I)), "b_tr": _r(a.mean(), 3), "t_tr": _r(_tstat(a), 1), "b_te": _r(b2.mean(), 3), "t_te": _r(_tstat(b2), 1)}

    # 4) X đã sụt ≥ 10%/4 tuần mà Y chưa sụt (> −3%) → Y 4 tuần sau (2023–nay)
    W = C[syms].where(C[syms] > 0).resample("W-FRI").last()
    W = W[W.index >= START]
    r4, f4 = (W / W.shift(4) - 1).values, (W.shift(-4) / W - 1).values
    later = []
    for lo, hi in ((-1, 0.15), (0.15, 0.4), (0.4, 1.1)):
        rcn = np.nan_to_num(rc_tr, nan=-9)
        mm = (rcn >= lo) & (rcn < hi)
        np.fill_diagonal(mm, False)
        I, J = np.where(mm)
        o, bs = [], []
        for t in range(4, len(W) - 4, 4):
            if W.index[t] < SPLIT:
                continue
            xa, yp, yf = r4[t, I], r4[t, J], f4[t, J]
            okb = (yp > -0.03) & ~np.isnan(yf) & ~np.isnan(xa)
            o.append(yf[okb & (xa <= -0.10)])
            bs.append(yf[okb])
        o = np.concatenate(o) if o else np.array([])
        bs = np.concatenate(bs) if bs else np.array([])
        later.append({"lo": lo, "hi": hi, "n": int(len(o)), "p": _r(100 * (o <= -0.10).mean(), 0) if len(o) else None,
                      "p_base": _r(100 * (bs <= -0.10).mean(), 0) if len(bs) else None, "r": _r(100 * o.mean(), 2) if len(o) else None,
                      "r_base": _r(100 * bs.mean(), 2) if len(bs) else None})
    out["follow_dd"] = later

    # 5) đồng pha có bền: chọn theo 2021–2022, đo lại 2023–nay
    a = X[(X.index >= "2021-01-01") & (X.index < SPLIT)]
    bq = X[X.index >= SPLIT]
    ra, _, _ = _mcorr(a, a, 60)
    rb, _, _ = _mcorr(bq, bq, 60)
    np.fill_diagonal(ra, np.nan)
    mm = np.isfinite(ra) & np.isfinite(rb)
    tri = np.triu(mm, 1)
    stab = {"cc": _r(np.corrcoef(ra[tri], rb[tri])[0, 1], 2) if tri.sum() > 30 else None, "buckets": []}
    r4s = (W / W.shift(4) - 1)
    r4s = r4s[r4s.index >= SPLIT].iloc[::4].values
    for lo, hi in ((-1, 0.1), (0.1, 0.25), (0.25, 0.4), (0.4, 1.1)):
        s_ = mm & (ra >= lo) & (ra < hi)
        I, J = np.where(s_)
        xa, y = r4s[:, I], r4s[:, J]
        ok = ~np.isnan(xa) & ~np.isnan(y)
        c = (xa <= -0.1) & ok
        stab["buckets"].append({"lo": lo, "hi": hi, "pairs": int(s_.sum() // 2), "later": _r(np.nanmean(rb[s_]), 2) if s_.any() else None,
                                "p_dd": _r(100 * (y[c] <= -0.1).mean(), 0) if c.sum() else None, "p_base": _r(100 * (y[ok] <= -0.1).mean(), 0) if ok.sum() else None})
    out["stability"] = stab
    return out


# ---------------------------------------------------------------- chiến thuật cho mã Y khi đang xem mã X

def entry_state(lv: dict | None, timing: tuple | None, in_plan: bool) -> dict:
    """Bản Python của entryState() trên web."""
    if not lv:
        return {"k": "none", "t": "Chưa có kế hoạch", "c": ""}
    if timing and not timing[0]:
        return {"k": "trend", "t": "Chưa đến lúc", "c": "ref", "why": timing[1]}
    if lv.get("state") == "wait":
        return {"k": "wait", "t": "Chờ giá", "c": "ref"}
    if lv.get("no_val") and not in_plan:
        return {"k": "noval", "t": "Chưa định giá được", "c": "ref"}
    if not in_plan:
        return {"k": "notplan", "t": "Đạt giá – ngoài danh sách MUA", "c": "ref"}
    if lv.get("ext"):
        return {"k": "split", "t": "Mua được – chia 2 lệnh", "c": "up"}
    return {"k": "now", "t": "Mua được", "c": "up"}


def _n(x, nd=2):
    if x is None or x != x:
        return "–"
    return f"{x:,.{nd}f}".replace(",", " ").replace(".", ",").replace(" ", ".")


def _p(x, nd=1):
    if x is None or x != x:
        return "–"
    return f"{x:+.{nd}f}".replace(".", ",") + "%"


def state_of(r: dict) -> dict:
    weak = []
    if r.get("trend") == "down":
        weak.append("xu hướng giảm")
    if r.get("ta_label") in ("Bán", "Bán mạnh"):
        weak.append(f"kỹ thuật {r.get('ta_label')}")
    if "dist" in (r.get("flow_st") or []):
        weak.append("đang bị xả âm thầm")
    hot = []
    if (r.get("rsi") or 0) > 75:
        hot.append(f"RSI {r['rsi']:.0f}")
    if (r.get("chg1m") or 0) > 25:
        hot.append(f"1 tháng {_p(r['chg1m'], 0)}")
    return {"weak": weak, "hot": hot, "exp": r.get("verdict") == "Đắt", "buy": r.get("es_k") in ("now", "split")}


TREND_VN = {"up": "tăng", "down": "giảm", "side": "đi ngang"}


def strategy(x: str, y: str, c: dict, xr: dict, yr: dict, tests: dict | None, lead: dict | None, follow: dict | None, held: set) -> list[dict]:
    """Chiến thuật cho mã Y (liên quan với X). Chỉ khuyên điều số liệu kiểm chứng ủng hộ."""
    out = []
    xs = state_of(xr)
    tests = tests or {}
    fd = tests.get("follow_dd") or []
    fd_lo = fd[0] if fd else {}
    fd_hi = (fd[-1] if (c.get("rc") or 0) >= 0.4 else fd[1] if len(fd) > 1 else {}) if fd else {}
    cu = tests.get("catchup") or {}
    ylv = yr.get("lv") or {}
    plan_y = (f"vùng mua {_n(ylv['zone'][0])}–{_n(ylv['zone'][1])}, cắt lỗ {_n(ylv.get('stop'))}, mục tiêu {_n(ylv.get('t1'))}"
              if ylv.get("zone") else "chưa có vùng mua (thiếu định giá/kỹ thuật)")
    # 1) dẫn dắt đã kiểm chứng
    if lead:
        fc = lead.get("fc") or [None] * 8
        f4, f8 = fc[3], fc[-1]
        lg = ", ".join(f"{g['L']} tuần" for g in lead["lags"])
        tone = "up" if (f8 or 0) >= 2 else "down" if (f8 or 0) <= -2 else ""
        act = (f"Căn mua {y} trong {lead['max_lag']} tuần tới khi giá về vùng của hệ thống: {plan_y}." if tone == "up" else
               f"Thận trọng với {y} trong {lead['max_lag']} tuần tới; nếu đang cầm, giữ kỷ luật cắt lỗ {_n(ylv.get('stop'))}." if tone == "down" else
               "Tín hiệu hiện yếu – chưa hành động theo cặp này.")
        fdr = lead.get("fdr")
        if fdr is not None and fdr > 0.2:
            act = (f"Lưu ý: cả thị trường chỉ có vài cặp qua kiểm chứng, gần với số cặp kỳ vọng do may rủi (≈ {fdr * 100:.0f}% khả năng là ngẫu nhiên) "
                   f"→ chỉ dùng làm chỉ báo phụ, quyết định mua/bán {y} theo kế hoạch riêng của {y}: {plan_y}.")
            tone = ""
        out.append({"k": "lead", "tone": tone, "title": f"{x} đi trước {y} ({lg})",
                    "text": f"Đã kiểm chứng ngoài mẫu (r = {_n(lead.get('oos_r'), 2)}, đúng hướng {_n(lead.get('oos_hit'), 0)}% khi tín hiệu mạnh). "
                            f"{x} 4 tuần qua {_p(lead.get('lead_4w'))} so với VN-Index → dự báo {y} vượt VN-Index {_p(f4)} sau 4 tuần, {_p(f8)} sau 8 tuần (đã co 50%). {act}"})
    if follow:
        f8 = (follow.get("fc") or [None] * 8)[-1]
        out.append({"k": "follow", "tone": "", "title": f"{y} đi trước {x}",
                    "text": f"Đã kiểm chứng ngoài mẫu (r = {_n(follow.get('oos_r'), 2)}). {y} 4 tuần qua {_p(follow.get('lead_4w'))} so với VN-Index → {x} dự báo {_p(f8)} trong 8 tuần. "
                            f"Dùng {y} làm chỉ báo sớm cho {x}."})
    # 2) rủi ro riêng của cặp: chỉ khi X đang yếu hoặc anh nắm cả hai (phần "né cả nhóm" nằm ở group())
    ph, pl = fd_hi.get("p"), fd_lo.get("p")
    if xs["weak"] and ph is not None and pl is not None:
        if ph - pl >= 5 and (c.get("rc") or 0) >= 0.4:
            out.append({"k": "risk", "tone": "down", "title": f"{x} đang yếu – {y} dễ sụt theo",
                        "text": f"Mã đồng pha mạnh đã yếu mà mã kia chưa giảm: lịch sử 4 tuần sau sụt ≥ 10% {ph:.0f}% (mã không liên quan {pl:.0f}%). Đang cầm {y} thì siết cắt lỗ {_n(ylv.get('stop'))}, chưa mua thêm."})
    if x in held and y in held:
        out.append({"k": "conc", "tone": "down", "title": "Anh đang nắm cả hai",
                    "text": f"Cùng sụt {_n(c.get('p_dd'), 0)}% số lần – coi như MỘT vị thế, tổng tỷ trọng {x} + {y} không vượt hạn mức một ngành."})
    # 3) thay thế / chọn mã tốt hơn trong cặp / chờ
    yb = yr.get("es_k") in ("now", "split")
    if yb and (xs["exp"] or xs["hot"] or not xs["buy"]):
        why = []
        if xs["exp"]:
            why.append(f"{x} đắt so với giá trị hợp lý")
        if xs["hot"]:
            why.append(f"{x} đang nóng ({', '.join(xs['hot'])})")
        if not why:
            why.append(f"{x} chưa đạt điều kiện mua ({xr.get('es_t')})")
        out.append({"k": "swap", "tone": "up", "title": f"Thay thế: cùng nhịp, {y} vào được",
                    "text": f"{'; '.join(why)}. {y} đi cùng nhịp (tương quan {_n(c.get('rc'), 2)}, beta {_n(c.get('beta'), 2)}) và đang “{yr.get('es_t')}”"
                            + (f", định giá {yr.get('verdict')}" if yr.get("verdict") else "") + f": {plan_y}."
                            + (" Đang kéo giãn – mua 1/2, 1/2 đặt LO thấp hơn 1 ATR." if yr.get("es_k") == "split" else "")})
    elif yb and xs["buy"]:
        hi_, lo_ = (y, x) if (yr.get("composite") or 0) > (xr.get("composite") or 0) else (x, y)
        sc = {x: xr.get("composite") or 0, y: yr.get("composite") or 0}
        out.append({"k": "pick", "tone": "up", "title": "Cả hai đều mua được – chọn một",
                    "text": f"Mua cả {x} và {y} gần như nhân đôi cùng một rủi ro. Ưu tiên {hi_} (điểm tổng hợp {_n(sc[hi_], 0)} so với {_n(sc[lo_], 0)} của {lo_}), "
                            f"hoặc chia đôi tỷ trọng dành cho nhóm. {y}: {plan_y}."})
    else:
        tr = TREND_VN.get(yr.get("trend"), "–")
        z = ylv.get("zone")
        gap = (yr["price"] / z[1] - 1) * 100 if z and yr.get("price") else None
        why = {"trend": f"xu hướng {tr}, chưa qua hàng rào kỹ thuật", "wait": "giá còn trên vùng mua", "noval": "chưa định giá được",
               "notplan": "đạt giá nhưng ngoài danh sách MUA", "none": "thiếu định giá/kỹ thuật"}.get(yr.get("es_k"), "")
        out.append({"k": "wait", "tone": "", "title": f"Chưa vào {y}: {why}",
                    "text": (f"Giá cách vùng mua {_p(gap, 0)}. " if gap is not None and gap > 0.5 else "")
                            + (f"Đặt cảnh báo ở {_n(z[0])}–{_n(z[1])}" if z else "Theo dõi") + f" thay vì mua theo {x}."})
    return out


def group(x: str, co: list[dict], xr: dict, tests: dict | None, held: set) -> list[dict]:
    """Chiến thuật chung khi mở mã X: né cả nhóm, mã thay thế vào được, bẫy "bắt kịp"."""
    out = []
    if not co:
        return out
    tests = tests or {}
    xs = state_of(xr)
    cu = tests.get("catchup") or {}
    fd = tests.get("follow_dd") or []
    syms = [c["s"] for c in co]
    pd_ = [c["p_dd"] for c in co if c.get("p_dd") is not None]
    pb_ = [c["p_base"] for c in co if c.get("p_base") is not None]
    if pd_:
        txt = (f"{x} đi cùng nhịp với {', '.join(syms)}. Khi {x} sụt ≥ 10% trong 4 tuần, trung bình {np.mean(pd_):.0f}% số lần các mã này cũng sụt ≥ 10% "
               f"TRONG CÙNG 4 tuần (bình thường {np.mean(pb_):.0f}%). → Né {x} vì lý do ngành / vĩ mô thì né cả nhóm; nắm 2 mã trong nhóm không phải là đa dạng hoá.")
        if fd and len(fd) >= 3 and fd[-1].get("p") is not None:
            txt += (f" Rủi ro đến chủ yếu cùng lúc: mã đồng pha mạnh đã sụt mà mã kia chưa thì 4 tuần sau mã kia sụt ≥ 10% {fd[-1]['p']:.0f}% "
                    f"(so với {fd[0].get('p') or 0:.0f}% ở mã không liên quan) – có lan truyền nhưng không lớn.")
        out.append({"k": "grp_risk", "tone": "down" if xs["weak"] else "", "title": "Né cùng nhau" + (f" – {x} đang yếu: {', '.join(xs['weak'])}" if xs["weak"] else ""), "text": txt})
    buy = sorted([c for c in co if c.get("es_k") in ("now", "split")], key=lambda c: -(c.get("composite") or 0))
    if buy:
        lst = "; ".join(f"{c['s']} ({c['es_t'].lower()}, vùng mua {_n((c.get('lv') or {}).get('zone', [None])[0])}–{_n((c.get('lv') or {}).get('zone', [None, None])[1])}, "
                        f"cắt lỗ {_n((c.get('lv') or {}).get('stop'))}, điểm {_n(c.get('composite'), 0)})" for c in buy[:3])
        why = []
        if xs["exp"]:
            why.append(f"{x} đắt")
        if xs["hot"]:
            why.append(f"{x} đang nóng ({', '.join(xs['hot'])})")
        if not xs["buy"]:
            why.append(f"{x} chưa vào được ({(xr.get('es_t') or '').lower()})")
        out.append({"k": "grp_buy", "tone": "up", "title": "Mã cùng nhịp vào được" + (" thay " + x if why else ""),
                    "text": ("; ".join(why) + ". " if why else f"{x} cũng mua được – chọn MỘT mã tốt nhất thay vì mua cả nhóm. ") + f"Theo hệ thống: {lst}."})
    else:
        near = []
        for c in co:
            z = (c.get("lv") or {}).get("zone")
            if z and c.get("price"):
                near.append(((c["price"] / z[1] - 1) * 100, c))
        near.sort(key=lambda t: t[0])
        txt = f"Chưa mã nào trong nhóm đạt điều kiện mua của hệ thống."
        if near:
            txt += " Gần vùng mua nhất: " + "; ".join(f"{c['s']} {_n(c['lv']['zone'][0])}–{_n(c['lv']['zone'][1])} (cách {_p(g, 0)}, {c.get('es_t', '').lower()})" for g, c in near[:3]) + " – đặt cảnh báo giá."
        out.append({"k": "grp_wait", "tone": "", "title": "Mã cùng nhịp: chưa có mã vào được", "text": txt})
    gx = xr.get("r13") if xr.get("r13") is not None else (co[0].get("r13_x"))
    lag = [c for c in co if c.get("r13_y") is not None and gx is not None and gx - c["r13_y"] >= 15]
    ahead = [c for c in co if c.get("r13_y") is not None and gx is not None and c["r13_y"] - gx >= 15]
    weak_now = cu.get("r_te") is not None and cu["r_te"] <= 0.5
    if (lag or ahead) and weak_now:
        parts = []
        if lag:
            parts.append(f"tụt lại so với {x} ({_p(gx, 0)} 3 tháng): " + ", ".join(f"{c['s']} {_p(c['r13_y'], 0)}" for c in lag))
        if ahead:
            parts.append(f"chạy hơn {x}: " + ", ".join(f"{c['s']} {_p(c['r13_y'], 0)}" for c in ahead))
        out.append({"k": "grp_catch", "tone": "ref", "title": "Đừng mua chỉ vì “mã kia đã chạy”",
                    "text": "Trong nhóm, " + "; ".join(parts) + f". Kiểm chứng {cu.get('pairs') or '–'} cặp đồng pha: mã tụt lại ≥ 2 độ lệch chuẩn thu hẹp khoảng cách "
                            f"{_p(cu.get('r_tr'))}/20 phiên giai đoạn 2016–2022 nhưng chỉ {_p(cu.get('r_te'))} từ 2023 (đúng hướng {_n(cu.get('hit_te'), 0)}%) → "
                            f"hiệu ứng “bắt kịp” không còn; chỉ mua mã tụt lại khi chính nó có tín hiệu."})
    return out
