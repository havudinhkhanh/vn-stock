"""Dự phóng tài chính 5 năm, 3 kịch bản (Xấu / Cơ sở / Tốt) + DCF (FCFE) & DDM.

LƯU Ý: Công thức ở đây được viết lại y hệt trong site/app.js (hàm project / dcf) để khi
anh sửa giả định trên web, kết quả tính lại ngay trên trình duyệt. Sửa một bên phải sửa
bên kia.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .fundamentals import _div, _num, _r


def _avg(vals, default=None, lo=None, hi=None):
    v = [x for x in vals if x is not None and not np.isnan(x)]
    if not v:
        return default
    m = float(np.mean(v))
    if lo is not None:
        m = max(lo, m)
    if hi is not None:
        m = min(hi, m)
    return m


def build_base(fa: dict, ys: pd.DataFrame, ttm_row: pd.Series | None, sector_growth: float | None,
               cfg: dict) -> dict | None:
    """Số liệu gốc (TTM) + giả định mặc định cho mô hình."""
    if not fa.get("ok") or not fa.get("shares_mn"):
        return None
    ctype = fa["ctype"]
    model = "CT" if ctype == "CT" else "FIN"
    shares = fa["shares_mn"]
    ni = fa.get("ni_ttm")
    eq = fa.get("equity_bn")
    if ni is None or eq is None or eq <= 0:
        return None
    yy = ys.sort_values("year").tail(4) if ys is not None and not ys.empty else pd.DataFrame()

    def ratio_hist(num, den):
        if yy.empty:
            return []
        return [_div(r.get(num), r.get(den)) for _, r in yy.iterrows()]

    g_parts = []
    if model == "CT":
        if fa.get("rev_yoy") is not None:
            g_parts.append((0.4, fa["rev_yoy"] / 100))
        if fa.get("rev_cagr3") is not None:
            g_parts.append((0.4, fa["rev_cagr3"] / 100))
    else:
        if fa.get("ni_yoy") is not None:
            g_parts.append((0.4, fa["ni_yoy"] / 100))
        if fa.get("ni_cagr3") is not None:
            g_parts.append((0.4, fa["ni_cagr3"] / 100))
    if sector_growth is not None and not np.isnan(sector_growth):
        g_parts.append((0.2, sector_growth / 100))
    g1 = sum(w * g for w, g in g_parts) / sum(w for w, _ in g_parts) if g_parts else 0.06
    g1 = float(np.clip(g1, -0.10, 0.30))
    gterm = cfg.get("terminal_growth", 4.0) / 100

    # tỷ lệ chi trả cổ tức
    dps = (fa.get("dividend") or {}).get("dps_avg3") or (fa.get("dividend") or {}).get("dps_ttm") or 0
    eps = fa.get("eps") or 0
    payout = float(np.clip(dps / eps, 0, 0.9)) if eps and eps > 0 else 0.0
    # chuyển đổi lợi nhuận -> dòng tiền tự do cho cổ đông
    conv = _avg([_div((_num(r.get("cfo")) or 0) + (_num(r.get("capex")) or 0), r.get("ni_parent"))
                 for _, r in yy.iterrows()] if not yy.empty else [], 0.7, 0.2, 1.1)
    if model == "FIN":
        conv = None  # ngân hàng: dùng công thức g/ROE

    base = {
        "model": model,
        "shares": shares,
        "equity": eq,
        "ni": ni,
        "price": fa.get("price"),
        "bvps": fa.get("bvps"),
        "years": int(cfg.get("forecast_years", 5)),
    }
    a = {"g1": round(g1, 4), "gterm": gterm, "payout": round(payout, 3),
         "conv": round(conv, 3) if conv is not None else None}
    if model == "CT":
        rev = fa.get("revenue_ttm")
        if not rev or rev <= 0:
            return None
        gp = (fa.get("gross_margin") or 0) / 100 * rev
        gm_hist = [x for x in ratio_hist("gross_profit", "revenue") if x is not None]
        sga_hist = [_div((_num(r.get("selling_exp")) or 0) + (_num(r.get("admin_exp")) or 0), r.get("revenue"))
                    for _, r in yy.iterrows()] if not yy.empty else []
        gm = _avg(gm_hist + [gp / rev], gp / rev, -0.5, 0.95)
        sga = _avg(sga_hist, 0.08, 0, 0.6)
        interest = 0.0
        if ttm_row is not None:
            interest = _num(ttm_row.get("interest_exp_ttm")) or 0.0
        pbt = ni / max(0.5, 1 - (fa.get("tax_rate") or 20) / 100)
        if ttm_row is not None and _num(ttm_row.get("pbt_ttm")) is not None:
            pbt = _num(ttm_row.get("pbt_ttm"))
        other = pbt - (gp - sga * rev - interest)
        minority = 0.0
        if ttm_row is not None:
            nt, npar = _num(ttm_row.get("net_income_ttm")), _num(ttm_row.get("ni_parent_ttm"))
            if nt and npar is not None and nt > 0:
                minority = float(np.clip(1 - npar / nt, 0, 0.6))
        base.update({"revenue": rev, "interest": interest, "other": other, "minority": minority})
        a.update({"gm": round(gm, 4), "sga": round(sga, 4), "tax": (fa.get("tax_rate") or 20) / 100})
    else:
        roe = ni / eq
        a.update({"roe_cap": round(float(np.clip(roe, 0.05, 0.30)), 4)})
    return {"base": base, "assumptions": a}


SCEN = {
    "bear": {"g1": lambda g: g - max(0.05, 0.5 * abs(g)), "gm": -0.015, "label": "Xấu"},
    "base": {"g1": lambda g: g, "gm": 0.0, "label": "Cơ sở"},
    "bull": {"g1": lambda g: g + max(0.04, 0.3 * abs(g)), "gm": 0.01, "label": "Tốt"},
}


def project(base: dict, a: dict) -> list[dict]:
    """Dự phóng N năm. Trả về list dict theo năm (đơn vị tỷ đồng, EPS/DPS đồng)."""
    n = base["years"]
    rows = []
    equity = base["equity"]
    shares = base["shares"]
    if base["model"] == "CT":
        rev, rev0 = base["revenue"], base["revenue"]
    ni_prev = base["ni"]
    for t in range(1, n + 1):
        g = a["g1"] + (a["gterm"] - a["g1"]) * (t - 1) / max(1, n - 1)
        if base["model"] == "CT":
            rev = rev * (1 + g)
            gp = rev * a["gm"]
            sga = rev * a["sga"]
            interest = base["interest"] * (rev / rev0) ** 0.5
            other = base["other"] * (0.8 ** t)
            pbt = gp - sga - interest + other
            tax = max(0.0, pbt * a["tax"])
            ni_all = pbt - tax
            ni = ni_all * (1 - base["minority"])
            fcfe = ni * a["conv"]
            row = {"revenue": rev, "gross_profit": gp, "sga": sga, "interest": interest,
                   "pbt": pbt, "ni": ni}
        else:
            ni = ni_prev * (1 + g)
            roe = ni / equity if equity > 0 else a["roe_cap"]
            fcfe = ni * (1 - g / max(roe, 0.05))
            row = {"ni": ni}
        eps = ni * 1000 / shares
        dps = max(0.0, eps * a["payout"])
        equity = equity + ni - dps * shares / 1000
        row.update({"year_offset": t, "g": g, "eps": eps, "dps": dps, "fcfe": fcfe,
                    "equity": equity, "bvps": equity * 1000 / shares,
                    "roe": ni / (equity - ni + dps * shares / 1000) if equity > 0 else None})
        rows.append(row)
        ni_prev = ni
    return rows


def dcf_value(base: dict, a: dict, rows: list[dict], ke: float) -> float | None:
    """Giá trị nội tại / cổ phiếu (nghìn đồng) theo FCFE."""
    g = a["gterm"]
    if ke <= g + 0.01:
        ke = g + 0.01
    pv = sum(r["fcfe"] / (1 + ke) ** r["year_offset"] for r in rows)
    last = rows[-1]
    roe_t = min(max(last["roe"] or 0.12, 0.06), 0.25)
    fcfe_t = last["ni"] * (1 + g) * (1 - g / roe_t)
    tv = fcfe_t / (ke - g)
    val = pv + tv / (1 + ke) ** len(rows)
    if val <= 0:
        return None
    return val / base["shares"]


def ddm_value(base: dict, a: dict, rows: list[dict], ke: float) -> float | None:
    if a["payout"] <= 0.05:
        return None
    g = a["gterm"]
    if ke <= g + 0.01:
        ke = g + 0.01
    pv = sum(r["dps"] / (1 + ke) ** r["year_offset"] for r in rows)
    tv = rows[-1]["dps"] * (1 + g) / (ke - g)
    val = (pv + tv / (1 + ke) ** len(rows)) / 1000  # đồng -> nghìn đồng
    return val if val > 0 else None


def scenarios(model: dict, ke: float) -> dict:
    base, a0 = model["base"], model["assumptions"]
    out = {}
    for k, sc in SCEN.items():
        a = dict(a0)
        a["g1"] = sc["g1"](a0["g1"])
        if base["model"] == "CT":
            a["gm"] = a0["gm"] + sc["gm"]
        rows = project(base, a)
        out[k] = {
            "label": sc["label"], "g1": round(a["g1"], 4),
            "dcf": _r(dcf_value(base, a, rows, ke), 2),
            "ddm": _r(ddm_value(base, a, rows, ke), 2),
            "rows": [{kk: (_r(v, 2) if isinstance(v, float) else v) for kk, v in r.items()} for r in rows],
        }
    return out
