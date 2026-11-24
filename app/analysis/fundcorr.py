"""Giá chạy theo LỢI NHUẬN hay theo DOANH THU? – tương quan giữa thay đổi giá và thay đổi kết quả kinh doanh, cho từng mã / ngành / toàn thị trường.

Cách đo (mỗi quý một điểm, từ 2014):
  • Kết quả kinh doanh: lợi nhuận sau thuế cổ đông mẹ 12 tháng (TTM) và doanh thu 12 tháng (ngân hàng: tổng thu nhập hoạt động).
    Tăng trưởng so cùng kỳ = (TTM_q − TTM_{q−4}) ÷ trung bình |TTM_q|, |TTM_{q−4}| → nằm trong [−200%, +200%], dùng được cả khi lỗ ↔ lãi
    (tăng trưởng % thường nổ tung khi lợi nhuận gốc gần 0).
  • Giá: thay đổi 12 tháng (log) đo tới "ngày đã biết kết quả" = cuối quý + 45 ngày (hạn nộp BCTC hợp nhất).
    Lệch k quý: k > 0 = cửa sổ giá kết thúc SỚM HƠN k quý (giá đi trước lợi nhuận – thị trường đoán trước), k < 0 = giá đi sau.
  • Thô: giá nguyên bản. Vượt thị trường: trừ thay đổi VN-Index cùng cửa sổ (bỏ phần cả thị trường cùng lên / xuống).
  • Hệ số tương quan Spearman (theo thứ hạng – ít bị 1 quý đột biến kéo lệch), độ co giãn = hệ số góc khi cả 2 năm đều có lãi
    ("lợi nhuận +10% thì giá TB +x%"), độ ổn định = tương quan nửa đầu và nửa sau cùng dấu.
  • Các điểm quý chồng lên nhau (cửa sổ 12 tháng trượt từng quý) → số điểm "độc lập" ≈ số quý ÷ 4; nhãn tin cậy tính theo số đó.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

REPORT_LAG_D = 45          # cuối quý + 45 ngày ≈ ngày cuối cùng phải công bố BCTC quý hợp nhất
MIN_Q = 12                 # tối thiểu 12 quý có cả giá & tăng trưởng (≈ 3 năm "độc lập") mới tính cho 1 mã
LAGS = (-1, 0, 1, 2)       # k quý: >0 giá đi trước
GCLIP = 2.0


def _qend(y, q) -> pd.Timestamp:
    return pd.Timestamp(int(y), int(q) * 3, 1) + pd.offsets.MonthEnd(0)


def sym_growth(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    den = (np.abs(a) + np.abs(b)) / 2
    with np.errstate(invalid="ignore", divide="ignore"):
        g = np.where(den > 0, (a - b) / den, np.nan)
    return np.clip(g, -GCLIP, GCLIP)


def ttm_frame(fin_q: pd.DataFrame) -> pd.DataFrame:
    """symbol, qend, np_ttm, rev_ttm (+ tăng trưởng so cùng kỳ). Chỉ cộng 4 quý LIÊN TIẾP."""
    if fin_q is None or fin_q.empty:
        return pd.DataFrame()
    f = fin_q.copy()
    f = f[(f["quarter"] >= 1) & (f["quarter"] <= 4)]
    prof = f["ni_parent"] if "ni_parent" in f else f["net_income"]
    if "net_income" in f:
        prof = prof.fillna(f["net_income"])
    rev = f["revenue"] if "revenue" in f else pd.Series(np.nan, index=f.index)
    for alt in ("toi", "nii"):      # ngân hàng: doanh thu = tổng thu nhập hoạt động (hoặc thu nhập lãi thuần)
        if alt in f:
            rev = rev.where(rev.notna() & (rev != 0), f[alt])
    f = pd.DataFrame({"symbol": f["symbol"], "qi": f["year"].astype(int) * 4 + f["quarter"].astype(int) - 1, "np": prof.astype(float), "rev": rev.astype(float)})
    f = f.drop_duplicates(["symbol", "qi"], keep="last").sort_values(["symbol", "qi"])
    out = []
    for s, d in f.groupby("symbol", sort=False):
        d = d.set_index("qi").reindex(range(int(d["qi"].min()), int(d["qi"].max()) + 1))
        npt = d["np"].rolling(4, min_periods=4).sum()
        rvt = d["rev"].rolling(4, min_periods=4).sum()
        rvt = rvt.where(rvt > 0)
        o = pd.DataFrame({"symbol": s, "qi": d.index, "np_ttm": npt.values, "rev_ttm": rvt.values})
        o["g_np"] = sym_growth(o["np_ttm"], o["np_ttm"].shift(4))
        o["g_rev"] = sym_growth(o["rev_ttm"], o["rev_ttm"].shift(4))
        # log-tăng trưởng chỉ khi cả 2 đầu cùng dương (cho độ co giãn)
        with np.errstate(invalid="ignore", divide="ignore"):
            o["l_np"] = np.where((o["np_ttm"] > 0) & (o["np_ttm"].shift(4) > 0), np.log(o["np_ttm"] / o["np_ttm"].shift(4)), np.nan)
            o["l_rev"] = np.where((o["rev_ttm"] > 0) & (o["rev_ttm"].shift(4) > 0), np.log(o["rev_ttm"] / o["rev_ttm"].shift(4)), np.nan)
        out.append(o)
    t = pd.concat(out, ignore_index=True) if out else pd.DataFrame()
    if t.empty:
        return t
    t["qend"] = [_qend(q // 4, q % 4 + 1) for q in t["qi"]]
    return t.dropna(subset=["g_np", "g_rev"], how="all")


def _asof(wide: pd.DataFrame, dates) -> pd.DataFrame:
    """Giá đóng cửa gần nhất ≤ mỗi ngày trong dates (hàng = dates)."""
    ix = wide.index.searchsorted(pd.DatetimeIndex(dates), side="right") - 1
    v = wide.to_numpy()[np.clip(ix, 0, len(wide) - 1)]
    v[ix < 0] = np.nan
    return pd.DataFrame(v, index=pd.DatetimeIndex(dates), columns=wide.columns)


def panel(wide: pd.DataFrame, idx_close: pd.Series, ttm: pd.DataFrame, lags=LAGS) -> pd.DataFrame:
    """Mỗi dòng: symbol, qi, lag, dp (log giá 12T), dpx (vượt VN-Index), g_np, g_rev, l_np, l_rev."""
    if ttm.empty or wide.empty:
        return pd.DataFrame()
    last = wide.index.max()
    qs = sorted(ttm["qi"].unique())
    rows = []
    syms = [s for s in ttm["symbol"].unique() if s in wide.columns]
    W = wide[syms]
    ix = idx_close.reindex(W.index).ffill()
    T = ttm[ttm["symbol"].isin(syms)].set_index(["qi", "symbol"])
    for k in lags:
        ends = {q: _qend((q - k) // 4, (q - k) % 4 + 1) + pd.Timedelta(days=REPORT_LAG_D) for q in qs}
        ok = [q for q in qs if ends[q] <= last]
        if not ok:
            continue
        e1 = [ends[q] for q in ok]
        e0 = [ends[q] - pd.DateOffset(years=1) for q in ok]
        P1, P0 = _asof(W, e1), _asof(W, e0)
        I1 = _asof(ix.to_frame("i"), e1)["i"].to_numpy(); I0 = _asof(ix.to_frame("i"), e0)["i"].to_numpy()
        with np.errstate(invalid="ignore", divide="ignore"):
            dp = np.log(P1.to_numpy() / P0.to_numpy())
            di = np.log(I1 / I0)
        D = pd.DataFrame(dp, index=ok, columns=syms).stack(future_stack=True).rename("dp").to_frame()
        D.index.names = ["qi", "symbol"]
        D["dpx"] = D["dp"] - pd.Series(di, index=ok).reindex(D.index.get_level_values(0)).to_numpy()
        D = D.join(T[["g_np", "g_rev", "l_np", "l_rev"]], how="inner")
        D["lag"] = k
        rows.append(D.reset_index())
    p = pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
    if p.empty:
        return p
    p = p[np.isfinite(p["dp"]) & (p["dp"].abs() < 3)]
    return p


def _sp(x, y):
    m = np.isfinite(x) & np.isfinite(y)
    if m.sum() < 6:
        return np.nan
    a, b = pd.Series(x[m]).rank().to_numpy(), pd.Series(y[m]).rank().to_numpy()
    if a.std() == 0 or b.std() == 0:
        return np.nan
    return float(np.corrcoef(a, b)[0, 1])


def _slope(lx, dy):
    """Độ co giãn: hệ số góc Theil–Sen rút gọn (trung vị các độ dốc cặp) – ít bị điểm lạ kéo."""
    m = np.isfinite(lx) & np.isfinite(dy) & (np.abs(lx) > 1e-3)
    x, y = lx[m], dy[m]
    if len(x) < 8:
        return np.nan
    i, j = np.triu_indices(len(x), 1)
    dx = x[j] - x[i]
    ok = np.abs(dx) > 0.02
    if ok.sum() < 10:
        return np.nan
    return float(np.median((y[j] - y[i])[ok] / dx[ok]))


def stats(d: pd.DataFrame, pcol: str = "dp") -> dict:
    """Tương quan giá ~ LN / DT cho 1 chuỗi (1 mã hoặc 1 ngành), ở mọi độ lệch."""
    out = {}
    for k, dk in d.groupby("lag"):
        dk = dk.sort_values("qi")
        y = dk[pcol].to_numpy(float)
        r = {"n": int(np.isfinite(y).sum())}
        for f in ("np", "rev"):
            g = dk["g_" + f].to_numpy(float)
            r["c_" + f] = _sp(g, y)
            h = len(dk) // 2
            r["c1_" + f], r["c2_" + f] = (_sp(g[:h], y[:h]), _sp(g[h:], y[h:])) if h >= 6 else (np.nan, np.nan)
            r["e_" + f] = _slope(dk["l_" + f].to_numpy(float), y)
        out[int(k)] = r
    return out


def verdict(c_np, c_rev) -> str:
    a, b = (c_np if np.isfinite(c_np) else -9), (c_rev if np.isfinite(c_rev) else -9)
    top = max(a, b)
    if top < 0.25:
        return "none"
    if a >= 0.25 and b >= 0.25 and abs(a - b) < 0.12:
        return "both"
    return "np" if a > b else "rev"


def conf(n_q, c) -> str:
    """Tin cậy theo số điểm độc lập ≈ n_q / 4: |r| cần ≥ 2/√(n_eff) mới khác 0 rõ (≈ 95%)."""
    if not np.isfinite(c) or n_q < MIN_Q:
        return "low"
    ne = n_q / 4
    t = abs(c) * np.sqrt(ne)
    return "high" if t >= 2.5 else "mid" if t >= 1.6 else "low"


def summarize(st: dict, n_min: int = MIN_Q) -> dict | None:
    """Gọn cho web: lệch 0 (giá 12T tới ngày công bố) là chính; kèm lệch tốt nhất."""
    b = st.get(0)
    if not b or b["n"] < n_min:
        return None
    best = {}
    for f in ("np", "rev"):
        ks = [(k, v["c_" + f]) for k, v in st.items() if np.isfinite(v.get("c_" + f, np.nan)) and v["n"] >= n_min]
        if ks:
            k, c = max(ks, key=lambda t: t[1])
            best[f] = [k, round(c, 3)]
    stab = {f: bool(np.isfinite(b["c1_" + f]) and np.isfinite(b["c2_" + f]) and (b["c1_" + f] > 0.1) and (b["c2_" + f] > 0.1)) for f in ("np", "rev")}
    rd = lambda v, n=3: None if v is None or not np.isfinite(v) else round(float(v), n)  # noqa: E731
    return {"n": b["n"], "c_np": rd(b["c_np"]), "c_rev": rd(b["c_rev"]), "e_np": rd(b["e_np"], 2), "e_rev": rd(b["e_rev"], 2),
            "c1_np": rd(b["c1_np"]), "c2_np": rd(b["c2_np"]), "c1_rev": rd(b["c1_rev"]), "c2_rev": rd(b["c2_rev"]),
            "st_np": stab["np"], "st_rev": stab["rev"], "best": best, "v": verdict(b["c_np"], b["c_rev"]),
            "cf_np": conf(b["n"], b["c_np"]), "cf_rev": conf(b["n"], b["c_rev"])}


def group_series(p: pd.DataFrame, ttm: pd.DataFrame, members: list[str]) -> pd.DataFrame:
    """Chuỗi của 1 nhóm: giá = TB log-thay-đổi các mã (cùng trọng số), tăng trưởng = tổng TTM các mã có đủ 2 đầu (không bị mã lớn lỗ/lãi đột biến…
    nhưng phản ánh cả ngành như một doanh nghiệp)."""
    m = p[p["symbol"].isin(members)]
    if m.empty:
        return m
    T = ttm[ttm["symbol"].isin(members)][["symbol", "qi", "np_ttm", "rev_ttm"]].copy()
    T0 = T.assign(qi=T["qi"] + 4).rename(columns={"np_ttm": "np0", "rev_ttm": "rev0"})
    TT = T.merge(T0, on=["symbol", "qi"], how="inner")
    agg = []
    for f in ("np", "rev"):
        x = TT.dropna(subset=[f + "_ttm", f + "0"]).groupby("qi").agg(a=(f + "_ttm", "sum"), b=(f + "0", "sum"), k=("symbol", "size"))
        x = x[x["k"] >= 3]
        x["g_" + f] = sym_growth(x["a"], x["b"])
        with np.errstate(invalid="ignore", divide="ignore"):
            x["l_" + f] = np.where((x["a"] > 0) & (x["b"] > 0), np.log(x["a"] / x["b"]), np.nan)
        agg.append(x[["g_" + f, "l_" + f]])
    G = agg[0].join(agg[1], how="outer")
    P = m.groupby(["lag", "qi"]).agg(dp=("dp", "mean"), dpx=("dpx", "mean"), k=("symbol", "size")).reset_index()
    P = P[P["k"] >= 3]
    return P.merge(G.reset_index(), on="qi", how="inner")


def chart_series(p: pd.DataFrame, sym_or_none=None, g: pd.DataFrame | None = None) -> list:
    """Chuỗi cho biểu đồ (lệch 0): [quý 'YYYY-Qn', giá 12T %, LN 12T %, DT 12T %]."""
    d = g if g is not None else p[p["symbol"] == sym_or_none]
    d = d[d["lag"] == 0].sort_values("qi")
    out = []
    for r in d.itertuples():
        pr = (np.exp(r.dp) - 1) * 100 if np.isfinite(r.dp) else None
        out.append([f"{r.qi // 4}-Q{r.qi % 4 + 1}", None if pr is None else round(pr, 1),
                    None if not np.isfinite(r.g_np) else round(r.g_np * 100, 1), None if not np.isfinite(r.g_rev) else round(r.g_rev * 100, 1)])
    return out
