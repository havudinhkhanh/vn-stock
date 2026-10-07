"""Phân tích theo ngành: bức tranh ngành, định giá ngành so với lịch sử, xoay vòng ngành (RRG),
và xếp hạng doanh nghiệp trong ngành."""
from __future__ import annotations

import numpy as np
import pandas as pd


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _wret(w: pd.DataFrame, syms, wt, n):
    if len(w) <= n:
        return None
    r = (w[syms].iloc[-1] / w[syms].iloc[-1 - n] - 1)
    ok = r.notna()
    if not ok.any():
        return None
    ww = wt[ok] / wt[ok].sum()
    return float((r[ok] * ww).sum() * 100)


def index_series(w: pd.DataFrame, syms: list[str], wt: pd.Series) -> pd.Series:
    """Chỉ số ngành tự tính: lợi nhuận ngày gia quyền theo giá trị giao dịch (đổi trọng số hằng tháng là
    lý tưởng; ở đây dùng trọng số hiện tại cho đơn giản), chuẩn hoá 100."""
    rets = w[syms].pct_change(fill_method=None)
    ww = wt.reindex(syms).fillna(0)
    ww = ww / ww.sum() if ww.sum() > 0 else pd.Series(1 / len(syms), index=syms)
    valid = rets.notna()
    num = (rets.fillna(0) * ww).sum(axis=1)
    den = (valid * ww).sum(axis=1).replace(0, np.nan)
    daily = (num / den).fillna(0)
    return 100 * (1 + daily).cumprod()


def valuation_block(f: pd.DataFrame) -> dict:
    """Định giá gộp của một tập doanh nghiệp (có BCTC):
    - pe_w: P/E gia quyền vốn hoá = tổng vốn hoá / tổng LN 12 tháng (tính cả DN lỗ – giống P/E của chỉ số)
    - pe_w_pos: như trên nhưng chỉ DN có lãi (cùng cơ sở với lịch sử để so sánh)
    - pb_w: tổng vốn hoá / tổng vốn chủ; roe_w: tổng LN / tổng vốn chủ
    - pe_med, pb_med: trung vị (đại diện "doanh nghiệp điển hình")."""
    out = {}
    if f is None or f.empty:
        return out
    mc = pd.to_numeric(f["mcap_bn"], errors="coerce")
    ni = pd.to_numeric(f.get("ni_ttm"), errors="coerce") if "ni_ttm" in f else pd.Series(np.nan, index=f.index)
    pb = pd.to_numeric(f["pb"], errors="coerce")
    pe = pd.to_numeric(f["pe"], errors="coerce")
    ok = mc.notna() & ni.notna()
    if ok.sum() >= 2 and ni[ok].sum() > 0:
        out["pe_w"] = _r(mc[ok].sum() / ni[ok].sum(), 1)
    pos = ok & (ni > 0)
    if pos.sum() >= 2:
        out["pe_w_pos"] = _r(mc[pos].sum() / ni[pos].sum(), 1)
    okb = mc.notna() & (pb > 0)
    if okb.sum() >= 2:
        book = (mc[okb] / pb[okb]).sum()
        out["pb_w"] = _r(mc[okb].sum() / book, 2)
        both = okb & ni.notna()
        if both.sum() >= 2:
            out["roe_w"] = _r(100 * ni[both].sum() / (mc[both] / pb[both]).sum(), 1)
    out["pe_med"] = _r(pe[pe > 0].median(), 1)
    out["pb_med"] = _r(pb[pb > 0].median(), 2)
    out["ey_w"] = _r(100 / out["pe_w"], 2) if out.get("pe_w") else None
    out["loss_share"] = _r(100 * float((ni[ok] <= 0).mean()), 0) if ok.any() else None
    g = pd.to_numeric(f["ni_yoy"], errors="coerce") if "ni_yoy" in f else None
    if g is not None:
        peg = pe / g
        peg = peg[(pe > 0) & (g > 0)]
        out["peg_med"] = _r(peg.median(), 2) if len(peg) >= 2 else None
    return out


def history_block(q: pd.DataFrame, cur: dict, n: int = 24) -> dict:
    """Lịch sử P/E, P/B theo quý (q: các dòng fq của tập DN, có pe_src/pb_src/mcap_src, đã lọc ngoại lai)."""
    out = {}
    if q is None or q.empty:
        return out
    g = q.groupby(["year", "quarter"])
    med_pe = g["pe_src"].median().tail(n)
    med_pb = g["pb_src"].median().tail(n) if "pb_src" in q else None
    w_pe = None
    if "mcap_src" in q:
        qq = q[(q["mcap_src"] > 0)]
        e = (qq["mcap_src"] / qq["pe_src"]).groupby([qq["year"], qq["quarter"]]).sum()
        m = qq.groupby(["year", "quarter"])["mcap_src"].sum()
        w_pe = (m / e).replace([np.inf, -np.inf], np.nan).reindex(med_pe.index)
        qb = qq[qq["pb_src"] > 0] if "pb_src" in qq else qq.iloc[0:0]
        bk = (qb["mcap_src"] / qb["pb_src"]).groupby([qb["year"], qb["quarter"]]).sum()
        mb = qb.groupby(["year", "quarter"])["mcap_src"].sum()
        w_pb = (mb / bk).replace([np.inf, -np.inf], np.nan).reindex(med_pe.index)
    if len(med_pe) < 8:
        return out
    lab = lambda yy, qq_: f"Q{int(qq_)}/{int(yy) % 100:02d}"  # noqa: E731
    out["val_hist"] = [{"p": lab(yy, qq_), "pe": _r(med_pe.get((yy, qq_)), 1),
                        "pb": _r(med_pb.get((yy, qq_)), 2) if med_pb is not None else None,
                        "pe_w": _r(w_pe.get((yy, qq_)), 1) if w_pe is not None else None,
                        "pb_w": _r(w_pb.get((yy, qq_)), 2) if w_pe is not None else None}
                       for (yy, qq_) in med_pe.index]
    # tương thích ngược
    out["pe_hist"] = [{"p": x["p"], "v": x["pe"]} for x in out["val_hist"]]
    def stats(series, now, key):
        s_ = pd.Series([x for x in series if x is not None and x == x], dtype=float)
        if len(s_) < 8 or now is None:
            return {}
        return {f"{key}_hist_med": _r(s_.median(), 2), f"{key}_hist_lo": _r(s_.quantile(0.1), 2), f"{key}_hist_hi": _r(s_.quantile(0.9), 2),
                f"{key}_pctl_hist": _r(100 * float((s_ < now).mean()), 0),
                f"{key}_vs_hist": _r(100 * (now / s_.median() - 1), 0) if s_.median() else None}
    out.update(stats([x["pe"] for x in out["val_hist"]], cur.get("pe_med"), "pe"))
    out.update(stats([x["pb"] for x in out["val_hist"]], cur.get("pb_med"), "pb"))
    out.update(stats([x["pe_w"] for x in out["val_hist"]], cur.get("pe_w_pos"), "pew"))
    out.update(stats([x["pb_w"] for x in out["val_hist"]], cur.get("pb_w"), "pbw"))
    return out


def _clean_q(fq: pd.DataFrame) -> pd.DataFrame | None:
    if fq is None or fq.empty or "pe_src" not in fq:
        return None
    cols = [c for c in ("symbol", "year", "quarter", "pe_src", "pb_src", "mcap_src") if c in fq]
    q = fq[cols].dropna(subset=["pe_src"])
    q = q[(q["pe_src"] > 0) & (q["pe_src"] < 80)]
    if "pb_src" in q:
        q = q[(q["pb_src"].isna()) | ((q["pb_src"] > 0) & (q["pb_src"] < 15))]
    return q


def market_summary(u: pd.DataFrame, fq: pd.DataFrame, rf: float | None = None) -> dict:
    f = u[u["has_fin"].fillna(False)]
    rec = valuation_block(f)
    rec.update({"n_fin": int(len(f)), "mcap_bn": _r(float(f["mcap_bn"].sum()), 0),
                "roe_med": _r(f["roe"].median(), 1), "ni_yoy_med": _r(f["ni_yoy"].median(), 1),
                "rev_yoy_med": _r(f["rev_yoy"].median(), 1), "div_med": _r(f["div_yield"].median(), 2),
                "fscore_med": _r(f["fscore"].median(), 1), "de_med": _r(f["de"].median(), 2),
                "upside_med": _r(f["upside"].median(), 1) if "upside" in f else None})
    q = _clean_q(fq)
    if q is not None:
        q = q[q["symbol"].isin(f.index)]
        rec.update(history_block(q, rec))
    if rf is not None and rec.get("ey_w"):
        rec["rf"] = rf
        rec["erp"] = _r(rec["ey_w"] - rf, 2)
    return rec


def analyze(u: pd.DataFrame, wide: pd.DataFrame, wide_val: pd.DataFrame, idx_close: pd.Series,
            fq: pd.DataFrame, level: str = "sector", min_n: int = 3) -> list[dict]:
    w = wide.iloc[-520:]
    val = wide_val.iloc[-20:].mean()
    out = []
    pe_hist = None
    q = _clean_q(fq)
    if q is not None:
        pe_hist = q.merge(u[[level]].rename_axis("sym").reset_index().rename(columns={"sym": "symbol"}),
                          on="symbol", how="inner")
    bench = idx_close.reindex(w.index).ffill()
    for name, g in u.groupby(level):
        syms = [s for s in g.index if s in w.columns]
        liq = [s for s in syms if val.get(s, 0) > 0.3]
        if len(liq) < min_n:
            continue
        wt = val.reindex(liq).fillna(0)
        idx = index_series(w, liq, wt)
        rs = idx / bench * 100
        rs_ratio = 100 * rs / rs.rolling(50, min_periods=20).mean()
        rs_mom = 100 * rs_ratio / rs_ratio.shift(10)
        ma50 = w[liq].rolling(50).mean().iloc[-1]
        ma200 = w[liq].rolling(200).mean().iloc[-1]
        last = w[liq].iloc[-1]
        f = g[g["has_fin"].fillna(False)]
        rec = {
            "name": name, "level": level, "n": int(len(syms)), "n_liquid": int(len(liq)), "n_fin": int(len(f)),
            "value_bn": _r(float(val.reindex(syms).sum()), 0), "mcap_bn": _r(float(g["mcap_bn"].sum()), 0),
            "r1w": _r(_wret(w, liq, wt, 5), 1), "r1m": _r(_wret(w, liq, wt, 21), 1), "r3m": _r(_wret(w, liq, wt, 63), 1),
            "r6m": _r(_wret(w, liq, wt, 126), 1), "r1y": _r(_wret(w, liq, wt, 250), 1),
            "above50": _r(100 * float((last > ma50).mean()), 0), "above200": _r(100 * float((last > ma200).mean()), 0),
            "rs_ratio": _r(rs_ratio.iloc[-1], 1), "rs_mom": _r(rs_mom.iloc[-1], 1),
            "pe_med": _r(f["pe"][f["pe"] > 0].median(), 1), "pb_med": _r(f["pb"][f["pb"] > 0].median(), 2),
            "roe_med": _r(f["roe"].median(), 1), "ni_yoy_med": _r(f["ni_yoy"].median(), 1),
            "rev_yoy_med": _r(f["rev_yoy"].median(), 1), "div_med": _r(f["div_yield"].median(), 2),
            "fscore_med": _r(f["fscore"].median(), 1), "de_med": _r(f["de"].median(), 2),
            "upside_med": _r(f["upside"].median(), 1), "composite_med": _r(f["composite"].median(), 0),
            "of_delta5": _r(g["of_delta5"].mean(), 3) if "of_delta5" in g and g["of_delta5"].notna().any() else None,
            "smc_bias": _r(g["smc_bias"].mean(), 2) if "smc_bias" in g else None,
            "rrg_tail": [{"x": _r(a, 1), "y": _r(b, 1)} for a, b in zip(rs_ratio.iloc[-60::5], rs_mom.iloc[-60::5])
                         if a == a and b == b],
            "index": [{"d": str(d.date()), "v": _r(v, 2)} for d, v in idx.iloc[-260:].items()],
        }
        x, y = rec["rs_ratio"] or 100, rec["rs_mom"] or 100
        rec["quadrant"] = ("Dẫn dắt" if x >= 100 and y >= 100 else "Suy yếu" if x >= 100 else
                           "Cải thiện" if y >= 100 else "Tụt hậu")
        rec.update({k: v for k, v in valuation_block(f).items() if v is not None})
        if pe_hist is not None:
            rec.update(history_block(pe_hist[pe_hist[level] == name], rec))
        top = f.sort_values("composite", ascending=False).head(5)
        rec["leaders"] = [{"symbol": s, "composite": _r(r_.get("composite"), 0), "pe": _r(r_.get("pe"), 1),
                           "roe": _r(r_.get("roe"), 1), "upside": _r(r_.get("upside"), 0)} for s, r_ in top.iterrows()]
        out.append(rec)
    return sorted(out, key=lambda r: -(r["mcap_bn"] or 0))
