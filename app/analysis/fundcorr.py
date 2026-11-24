"""Giá chạy theo LỢI NHUẬN hay theo DOANH THU? – tương quan giữa thay đổi giá và thay đổi kết quả kinh doanh, cho từng mã / ngành / toàn thị trường.

Cách đo (mỗi quý một điểm; BCTC quý hiện có từ khoảng 2019):
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
MIN_Q = 20                 # tối thiểu 20 quý có cả giá & tăng trưởng (≈ 5 năm "độc lập") mới tính cho 1 mã
MIN_HALF = 10              # mỗi nửa giai đoạn ≥ 10 quý mới so 2 nửa
LAGS = (-1, 0, 1, 2, 3, 4)  # k quý: >0 cửa sổ giá kết thúc sớm hơn (k ≥ 2 với TTM mới thật sự là "giá đi trước")
GCLIP = 2.0


def _qend(y, q) -> pd.Timestamp:
    return pd.Timestamp(int(y), int(q) * 3, 1) + pd.offsets.MonthEnd(0)


def sym_growth(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    den = (np.abs(a) + np.abs(b)) / 2
    with np.errstate(invalid="ignore", divide="ignore"):
        g = np.where(den > 0, (a - b) / den, np.nan)
    return np.clip(g, -GCLIP, GCLIP)


def ttm_frame(fin_q: pd.DataFrame, ctype: dict | None = None) -> pd.DataFrame:
    """symbol, qend, np_ttm, rev_ttm (+ tăng trưởng so cùng kỳ, + tăng trưởng riêng quý so cùng quý năm trước). Chỉ cộng 4 quý LIÊN TIẾP.
    ctype: {mã: "NH" | "CK" | "CT"} – ngân hàng luôn dùng TỔNG THU NHẬP HOẠT ĐỘNG làm doanh thu."""
    if fin_q is None or fin_q.empty:
        return pd.DataFrame()
    f = fin_q.copy()
    f = f[(f["quarter"] >= 1) & (f["quarter"] <= 4)]
    prof = f["ni_parent"] if "ni_parent" in f else f["net_income"]
    if "net_income" in f:
        prof = prof.fillna(f["net_income"])
    rev = f["revenue"] if "revenue" in f else pd.Series(np.nan, index=f.index)
    for alt in ("toi", "nii"):      # thiếu doanh thu → tổng thu nhập hoạt động (hoặc thu nhập lãi thuần)
        if alt in f:
            rev = rev.where(rev.notna() & (rev != 0), f[alt])
    if ctype and "toi" in f:        # ngân hàng: nguồn có khi điền "doanh thu" = thu nhập lãi gộp → luôn dùng tổng thu nhập hoạt động
        bank = f["symbol"].map(ctype).eq("NH") & f["toi"].notna() & (f["toi"] != 0)
        rev = rev.where(~bank, f["toi"])
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
        o["g_np1"] = sym_growth(d["np"].values, d["np"].shift(4).values)          # riêng quý vs cùng quý năm trước
        rq = d["rev"].where(d["rev"] > 0)
        o["g_rev1"] = sym_growth(rq.values, rq.shift(4).values)
        # nhảy đơn vị (×1000) do nguồn: TTM đổi > 50 lần trong 1 năm → bỏ điểm đó
        for c_ in ("np_ttm", "rev_ttm"):
            with np.errstate(invalid="ignore", divide="ignore"):
                ra = (o[c_] / o[c_].shift(4)).abs()
            o.loc[(ra > 50) | (ra < 1 / 50), ["g_" + c_.split("_")[0], "l_" + c_.split("_")[0]]] = np.nan
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
        D = D.join(T[["g_np", "g_rev", "l_np", "l_rev", "g_np1", "g_rev1"]], how="inner")
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
            r["c1_" + f], r["c2_" + f] = (_sp(g[:h], y[:h]), _sp(g[h:], y[h:])) if h >= MIN_HALF else (np.nan, np.nan)
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
    """Chuỗi của 1 nhóm: giá = TB log-thay-đổi các mã (cùng trọng số), tăng trưởng = TRUNG VỊ tăng trưởng các mã (cùng trọng số với giá –
    trước cộng tổng TTM nên vài mã rất lớn quyết định cả nhóm, lệch với giá bình quân đều)."""
    m = p[p["symbol"].isin(members)]
    if m.empty:
        return m
    P = m.groupby(["lag", "qi"]).agg(dp=("dp", "mean"), dpx=("dpx", "mean"), g_np=("g_np", "median"), g_rev=("g_rev", "median"),
                                      l_np=("l_np", "median"), l_rev=("l_rev", "median"), k=("symbol", "size")).reset_index()
    return P[P["k"] >= 3]


def chart_series(p: pd.DataFrame, sym_or_none=None, g: pd.DataFrame | None = None) -> list:
    """Chuỗi cho biểu đồ (lệch 0): [quý 'YYYY-Qn', giá 12T %, LN 12T %, DT 12T %].
    Tăng trưởng: % thật khi cả 2 năm cùng dương, không thì thang đối xứng (±200%) để lỗ ↔ lãi vẫn vẽ được."""
    d = g if g is not None else p[p["symbol"] == sym_or_none]
    d = d[d["lag"] == 0].sort_values("qi")
    rd = lambda v: None if v is None or not np.isfinite(v) else round(float(v), 1)  # noqa: E731
    gp = lambda l_, g_: rd((np.exp(l_) - 1) * 100) if np.isfinite(l_) else rd(g_ * 100)  # noqa: E731
    return [[f"{r.qi // 4}-Q{r.qi % 4 + 1}", rd((np.exp(r.dp) - 1) * 100), gp(r.l_np, r.g_np), gp(r.l_rev, r.g_rev)] for r in d.itertuples()]


def _ic(d: pd.DataFrame, gcol: str, pcol: str, minn: int) -> np.ndarray:
    v = []
    for _, dq in d.groupby("qi"):
        if len(dq) >= minn:
            v.append(_sp(dq[gcol].to_numpy(float), dq[pcol].to_numpy(float)))
    return np.array([x for x in v if np.isfinite(x)])


def _ics(v: np.ndarray, qmin: int = 8) -> dict | None:
    if len(v) < qmin:
        return None
    h = len(v) // 2
    return {"ic": round(float(v.mean()), 3), "pos": round(float((v > 0).mean()), 2), "q": int(len(v)), "h1": round(float(v[:h].mean()), 3), "h2": round(float(v[h:].mean()), 3)}


def _r(v, n=3):
    return None if v is None or not np.isfinite(v) else round(float(v), n)


def _tscorr(d: pd.DataFrame, pcol: str = "dp") -> dict:
    """Tương quan chuỗi thời gian theo từng lệch k: {k: [LN, DT, số quý]}."""
    out = {}
    for k, dk in d.groupby("lag"):
        y = dk[pcol].to_numpy(float)
        out[int(k)] = [_r(_sp(dk["g_np"].to_numpy(float), y)), _r(_sp(dk["g_rev"].to_numpy(float), y)), int(np.isfinite(y).sum())]
    return out


def verdict2(s_np, s_rev) -> str:
    """Kết luận trên ước tính ĐÃ CO về ngành (số thô của 1 mã nhiễu quá, xem module docstring)."""
    a = s_np if s_np is not None and np.isfinite(s_np) else -9
    b = s_rev if s_rev is not None and np.isfinite(s_rev) else -9
    if max(a, b) < 0.1:
        return "weak"
    if a >= 0.2 and b >= 0.2 and abs(a - b) < 0.06:
        return "both"
    if a >= 0.25 and a - b >= 0.06:
        return "np"
    if b >= 0.2 and b - a >= 0.06:
        return "rev"
    return "peer"


def build(wide: pd.DataFrame, idx_close: pd.Series, fin_q: pd.DataFrame, u: pd.DataFrame) -> tuple[dict, list, dict]:
    """→ (bảng chung cho trang Ngành: thị trường + từng mâm / ngành, các dòng từng mã cho bảng Pro, chi tiết từng mã cho trang mã).
    u: chỉ mục = mã, cột peer_label, sector, ctype/com_type."""
    ct_col = "ctype" if "ctype" in u else "com_type" if "com_type" in u else None
    ctype = u[ct_col].fillna("CT").to_dict() if ct_col else None
    ttm = ttm_frame(fin_q, ctype)
    P = panel(wide, idx_close, ttm)
    if P.empty:
        return {}, [], {}
    P = P.merge(u[["peer_label", "sector"]], left_on="symbol", right_index=True, how="inner")
    key = ["lag", "qi", "peer_label"]
    P["dpp"] = P["dp"] - P.groupby(key)["dp"].transform("mean")
    for f in ("np", "rev"):
        P["gx_" + f] = P["g_" + f] - P.groupby(key)["g_" + f].transform("median")
    P0 = P[P["lag"] == 0]

    # --- thị trường: cắt ngang từng quý (giá vượt VN-Index ~ tăng trưởng) theo lệch; riêng quý ở k ≥ 1 = phần thị trường đoán trước
    mk = {"ic": {}, "ic_q": {}}
    for k, d in P.groupby("lag"):
        mk["ic"][int(k)] = {f: _ics(_ic(d, "g_" + f, "dpx", 30)) for f in ("np", "rev")}
        mk["ic_q"][int(k)] = {f: _ics(_ic(d, "g_" + f + "1", "dpx", 30)) for f in ("np", "rev")}
    # doanh thu thêm gì ngoài lợi nhuận: IC phần dư hạng DT sau khi bỏ hạng LN (lệch 0)
    pic = []
    for _, dq in P0.dropna(subset=["g_np", "g_rev", "dpx"]).groupby("qi"):
        if len(dq) >= 50:
            x0, x1 = dq["g_np"].rank(pct=True).to_numpy(), dq["g_rev"].rank(pct=True).to_numpy()
            pic.append(_sp(x1 - np.polyval(np.polyfit(x0, x1, 1), x0), dq["dpx"].to_numpy(float)))
    mk["rev_extra"] = _ics(np.array([x for x in pic if np.isfinite(x)]))
    w_mkt = _ic(P0, "gx_np", "dpp", 30), _ic(P0, "gx_rev", "dpp", 30)      # TRONG mâm, gộp cả thị trường
    mk["within"] = {"np": _ics(w_mkt[0]), "rev": _ics(w_mkt[1])}
    G = group_series(P, ttm, list(P["symbol"].unique()))
    mk["ts"] = _tscorr(G)
    mk["chart"] = chart_series(None, None, G)
    mk["n"] = int(P0["symbol"].nunique())
    mk["q_from"] = f"{int(P0['qi'].min()) // 4}-Q{int(P0['qi'].min()) % 4 + 1}"

    # --- từng mâm / ngành: IC TRONG nhóm (vững, ổn định giữa 2 nửa) + chuỗi thời gian (ít điểm – chỉ tham khảo)
    prior = {f: (mk["within"][f] or {}).get("ic") or 0.0 for f in ("np", "rev")}
    groups = {"peer": [], "sector": []}
    w_of = {}
    for lv, col in (("peer", "peer_label"), ("sector", "sector")):
        for name, d in P.groupby(col):
            mem = sorted(d["symbol"].unique())
            if len(mem) < 3:
                continue
            d0 = d[d["lag"] == 0]
            wi = {f: _ics(_ic(d0, "g_" + f, "dp", 5)) for f in ("np", "rev")}
            Gs = group_series(P, ttm, mem)
            rec = {"name": name, "m": len(mem), "w_np": wi["np"], "w_rev": wi["rev"], "ts": _tscorr(Gs) if not Gs.empty else {}, "chart": chart_series(None, None, Gs) if not Gs.empty else []}
            # IC trong nhóm co về mức chung của thị trường theo cỡ nhóm (nhóm nhỏ ít tin)
            for f in ("np", "rev"):
                v = (wi[f] or {}).get("ic")
                wt = len(mem) / (len(mem) + 10)
                rec["s_" + f] = _r(prior[f] + wt * (v - prior[f])) if v is not None else _r(prior[f])
                rec["st_" + f] = bool(wi[f] and wi[f]["h1"] > 0.05 and wi[f]["h2"] > 0.05)
            groups[lv].append(rec)
            if lv == "peer":
                w_of[name] = {f: rec["s_" + f] for f in ("np", "rev")}

    # --- từng mã: tương quan chuỗi của riêng mã (thô, vượt VN-Index, so với mâm), độ bền giữa 2 nửa → hệ số co về mâm
    per, halves = {}, {"np": [], "rev": []}
    for s, d in P.groupby("symbol"):
        d0 = d[d["lag"] == 0].sort_values("qi")
        if len(d0) < MIN_Q:
            continue
        r = {"n": int(len(d0)), "peer": d0["peer_label"].iloc[0]}
        for f in ("np", "rev"):
            g, gx = d0["g_" + f].to_numpy(float), d0["gx_" + f].to_numpy(float)
            r["c_" + f] = _r(_sp(g, d0["dp"].to_numpy(float)))
            r["x_" + f] = _r(_sp(g, d0["dpx"].to_numpy(float)))
            y = d0["dpp"].to_numpy(float)
            r["p_" + f] = _r(_sp(gx, y))
            h = len(d0) // 2
            if h >= MIN_HALF:
                a_, b_ = _sp(gx[:h], y[:h]), _sp(gx[h:], y[h:])
                r["p1_" + f], r["p2_" + f] = _r(a_), _r(b_)
                if np.isfinite(a_) and np.isfinite(b_):
                    halves[f].append((a_, b_))
        r["lags"] = _tscorr(d)
        per[s] = r
    rel = {}
    for f in ("np", "rev"):
        hv = np.array(halves[f]) if halves[f] else np.zeros((0, 2))
        rho = _sp(hv[:, 0], hv[:, 1]) if len(hv) > 30 else np.nan
        rho = max(0.0, rho) if np.isfinite(rho) else 0.0
        rel[f] = {"rho": _r(rho), "w": _r(min(0.35, 2 * rho / (1 + rho)))}      # Spearman–Brown: độ tin của cả chuỗi từ độ bền 2 nửa
    rows, detail = [], {}
    for s, r in per.items():
        pw = w_of.get(r["peer"]) or {}
        for f in ("np", "rev"):
            pr_ = pw.get(f) if pw.get(f) is not None else prior[f]
            r["s_" + f] = _r(pr_ + rel[f]["w"] * ((r["p_" + f] if r["p_" + f] is not None else pr_) - pr_))
        r["v"] = verdict2(r["s_np"], r["s_rev"])
        rows.append([s, r["peer"], r["n"], r["c_np"], r["c_rev"], r["p_np"], r["p_rev"], r["s_np"], r["s_rev"], r["v"], r["x_np"], r["x_rev"]])
        detail[s] = {**r, "chart": chart_series(P, s), "peer_w": pw}
    vc = pd.Series([x[9] for x in rows]).value_counts().to_dict() if rows else {}
    log.info("Giá ~ LN/DT: %d mã, %d quý từ %s · độ bền 2 nửa LN %.2f DT %.2f (hệ số co %.2f / %.2f) · kết luận %s · IC cắt ngang LN %.3f DT %.3f",
             len(rows), P0["qi"].nunique(), mk["q_from"], rel["np"]["rho"] or 0, rel["rev"]["rho"] or 0, rel["np"]["w"] or 0, rel["rev"]["w"] or 0, vc,
             ((mk["ic"].get(0) or {}).get("np") or {}).get("ic") or 0, ((mk["ic"].get(0) or {}).get("rev") or {}).get("ic") or 0)
    pub = {"market": mk, "groups": groups, "rel": rel, "verdicts": {k: int(v) for k, v in vc.items()}, "min_q": MIN_Q, "lag_days": REPORT_LAG_D}
    cols = ["s", "peer", "n", "c_np", "c_rev", "p_np", "p_rev", "s_np", "s_rev", "v", "x_np", "x_rev"]
    return pub, [cols] + rows, detail
