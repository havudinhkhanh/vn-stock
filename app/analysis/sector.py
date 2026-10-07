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


def analyze(u: pd.DataFrame, wide: pd.DataFrame, wide_val: pd.DataFrame, idx_close: pd.Series,
            fq: pd.DataFrame, level: str = "sector", min_n: int = 3) -> list[dict]:
    w = wide.iloc[-520:]
    val = wide_val.iloc[-20:].mean()
    out = []
    pe_hist = None
    if fq is not None and not fq.empty and "pe_src" in fq:
        q = fq[["symbol", "year", "quarter", "pe_src", "pb_src"]].dropna(subset=["pe_src"])
        q = q[(q["pe_src"] > 0) & (q["pe_src"] < 80)]
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
        if pe_hist is not None:
            ph = pe_hist[pe_hist[level] == name].groupby(["year", "quarter"])["pe_src"].median().tail(24)
            if len(ph) >= 8 and rec["pe_med"]:
                rec["pe_hist"] = [{"p": f"Q{int(qq)}/{int(yy) % 100:02d}", "v": _r(v, 1)} for (yy, qq), v in ph.items()]
                rec["pe_pctl_hist"] = _r(100 * float((ph < rec["pe_med"]).mean()), 0)
        top = f.sort_values("composite", ascending=False).head(5)
        rec["leaders"] = [{"symbol": s, "composite": _r(r_.get("composite"), 0), "pe": _r(r_.get("pe"), 1),
                           "roe": _r(r_.get("roe"), 1), "upside": _r(r_.get("upside"), 0)} for s, r_ in top.iterrows()]
        out.append(rec)
    return sorted(out, key=lambda r: -(r["mcap_bn"] or 0))
