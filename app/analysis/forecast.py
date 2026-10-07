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


def _pct(x, nd=1):
    return "—" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x * 100:.{nd}f}%".replace(".", ",")


def _median(v, default=None, lo=None, hi=None):
    v = [x for x in v if x is not None and not (isinstance(x, float) and np.isnan(x))]
    if not v:
        return default
    m = float(np.median(v))
    if lo is not None:
        m = max(lo, m)
    if hi is not None:
        m = min(hi, m)
    return m


def history(ys: pd.DataFrame) -> list[dict]:
    """Chuỗi chỉ số theo năm của chính doanh nghiệp – nền cho giả định mặc định."""
    if ys is None or ys.empty:
        return []
    yy = ys.sort_values("year").drop_duplicates("year", keep="last")
    out, prev = [], None
    for _, r in yy.iterrows():
        rev, ni, eq = _num(r.get("revenue")), _num(r.get("ni_parent")), _num(r.get("equity"))
        row = {"year": int(r["year"]), "rev": rev, "ni": ni,
               "gm": _div(r.get("gross_profit"), rev) if rev and rev > 0 else None,
               "sga": _div((_num(r.get("selling_exp")) or 0) + (_num(r.get("admin_exp")) or 0), rev) if rev and rev > 0 else None,
               "conv": _div((_num(r.get("cfo")) or 0) + (_num(r.get("capex")) or 0), ni) if ni and ni > 0 else None,
               "roe": _div(ni, eq) if eq and eq > 0 and ni is not None else None,
               "rev_g": None, "ni_g": None}
        if prev:
            if rev and prev["rev"] and prev["rev"] > 0 and rev > 0:
                row["rev_g"] = rev / prev["rev"] - 1
            if ni is not None and prev["ni"] and prev["ni"] > 0 and ni > 0:
                row["ni_g"] = ni / prev["ni"] - 1
        out.append(row)
        prev = row
    return out


def _cagr(vals, years):
    v = [(y, x) for y, x in zip(years, vals) if x is not None and x > 0]
    if len(v) < 3:
        return None
    (y0, a), (y1, b) = v[0], v[-1]
    return (b / a) ** (1 / max(1, y1 - y0)) - 1 if y1 > y0 else None


def build_base(fa: dict, ys: pd.DataFrame, ttm_row: pd.Series | None, sector_growth: float | None,
               cfg: dict) -> dict | None:
    """Số liệu gốc (TTM) + giả định mặc định RIÊNG cho từng doanh nghiệp, suy ra từ lịch sử của chính nó:
    - tăng trưởng năm 1: đà gần nhất (12 tháng) + CAGR 3 năm, kéo về ngành khi lịch sử thất thường
    - tăng trưởng năm 3: CAGR dài hạn của chính DN (tới 7 năm) hội tụ một nửa về ngành
    - tăng trưởng dài hạn: theo CAGR dài hạn, giới hạn 2,5–5%
    - biên gộp, chi phí BH&QL: đi từ mức hiện tại về trung vị nhiều năm của chính DN
    - tỷ lệ LN thành tiền tự do, ROE: trung vị nhiều năm của chính DN."""
    if not fa.get("ok") or not fa.get("shares_mn"):
        return None
    ctype = fa["ctype"]
    model = "CT" if ctype == "CT" else "FIN"
    shares = fa["shares_mn"]
    ni = fa.get("ni_ttm")
    eq = fa.get("equity_bn")
    if ni is None or eq is None or eq <= 0:
        return None
    H = history(ys)
    years = [h["year"] for h in H]
    sg = sector_growth / 100 if sector_growth is not None and not np.isnan(sector_growth) else None
    sg_c = float(np.clip(sg, -0.05, 0.20)) if sg is not None else 0.08
    why = {}

    key_g = "rev_g" if model == "CT" else "ni_g"
    series = [h[key_g] for h in H if h[key_g] is not None]
    level = [h["rev" if model == "CT" else "ni"] for h in H]
    cagr_lt = _cagr(level, years)
    cagr3 = _cagr(level[-4:], years[-4:]) if len(level) >= 4 else None
    ttm_g = (fa.get("rev_yoy") if model == "CT" else fa.get("ni_yoy"))
    ttm_g = ttm_g / 100 if ttm_g is not None else None
    vol = float(np.std(series)) if len(series) >= 3 else 0.25
    w_sec = float(np.clip(0.15 + vol, 0.15, 0.6))  # lịch sử càng thất thường càng tin ngành
    parts = [(0.55, ttm_g), (0.45, cagr3 if cagr3 is not None else cagr_lt)]
    parts = [(w, g) for w, g in parts if g is not None]
    own = sum(w * float(np.clip(g, -0.3, 0.6)) for w, g in parts) / sum(w for w, _ in parts) if parts else None
    g1 = (1 - w_sec) * own + w_sec * sg_c if own is not None else sg_c
    g1 = float(np.clip(g1, -0.15, 0.35))
    gmid_own = cagr_lt if cagr_lt is not None else own
    gmid = 0.5 * float(np.clip(gmid_own, -0.1, 0.4)) + 0.5 * sg_c if gmid_own is not None else sg_c
    gmid = float(np.clip(gmid, -0.05, 0.25))
    gterm_cfg = cfg.get("terminal_growth", 4.0) / 100
    gterm = float(np.clip(0.6 * gterm_cfg + 0.4 * (cagr_lt if cagr_lt is not None else gterm_cfg) * 0.5, 0.025, 0.05))
    lbl = "doanh thu" if model == "CT" else "lợi nhuận"
    why["g1"] = (f"{lbl} 12 tháng {_pct(ttm_g)}, CAGR 3 năm {_pct(cagr3)}, ngành {_pct(sg)}; lịch sử dao động ±{_pct(vol, 0)}"
                 f" nên tin ngành {w_sec * 100:.0f}%")
    why["gmid"] = f"CAGR {lbl} {len(level) - 1 if level else 0} năm của chính DN {_pct(cagr_lt)}, hội tụ một nửa về ngành {_pct(sg)}"
    why["gterm"] = f"60% mức chuẩn {_pct(gterm_cfg)} + 40% một nửa CAGR dài hạn, giới hạn 2,5–5%"

    dps = (fa.get("dividend") or {}).get("dps_avg3") or (fa.get("dividend") or {}).get("dps_ttm") or 0
    eps = fa.get("eps") or 0
    payout = float(np.clip(dps / eps, 0, 0.9)) if eps and eps > 0 else 0.0
    why["payout"] = "cổ tức tiền mặt bình quân 3 năm ÷ EPS hiện tại"
    conv = _median([h["conv"] for h in H], 0.7, 0.1, 1.2)
    nconv = len([h for h in H if h["conv"] is not None])
    why["conv"] = f"trung vị {nconv} năm (dòng tiền kinh doanh − đầu tư TSCĐ) ÷ lợi nhuận" if nconv else "chưa đủ lịch sử – dùng 70%"
    if model == "FIN":
        conv = None

    base = {"model": model, "shares": shares, "equity": eq, "ni": ni, "price": fa.get("price"), "bvps": fa.get("bvps"),
            "years": int(cfg.get("forecast_years", 5))}
    a = {"g1": round(g1, 4), "gmid": round(gmid, 4), "gterm": round(gterm, 4), "payout": round(payout, 3),
         "conv": round(conv, 3) if conv is not None else None}
    if model == "CT":
        rev = fa.get("revenue_ttm")
        if not rev or rev <= 0:
            return None
        gp = (fa.get("gross_margin") or 0) / 100 * rev
        gm_now = gp / rev
        gm_lt = _median([h["gm"] for h in H] + [gm_now], gm_now, -0.5, 0.95)
        sga_hist = [h["sga"] for h in H]
        sga_now = next((x for x in reversed(sga_hist) if x is not None), None)
        sga_now = float(np.clip(sga_now, 0, 0.6)) if sga_now is not None else 0.08
        sga_lt = _median(sga_hist, sga_now, 0, 0.6)
        why["gm"] = f"biên gộp 12 tháng gần nhất {_pct(gm_now)}"
        why["gm_lt"] = f"trung vị biên gộp {len([h for h in H if h['gm'] is not None])} năm của chính DN – biên đi dần về mức này"
        why["sga"] = f"chi phí bán hàng + quản lý ÷ doanh thu năm gần nhất {_pct(sga_now)}"
        why["sga_lt"] = "trung vị nhiều năm của chính DN"
        interest = 0.0
        if ttm_row is not None:
            interest = _num(ttm_row.get("interest_exp_ttm")) or 0.0
        pbt = ni / max(0.5, 1 - (fa.get("tax_rate") or 20) / 100)
        if ttm_row is not None and _num(ttm_row.get("pbt_ttm")) is not None:
            pbt = _num(ttm_row.get("pbt_ttm"))
        other = pbt - (gp - sga_now * rev - interest)
        minority = 0.0
        if ttm_row is not None:
            nt, npar = _num(ttm_row.get("net_income_ttm")), _num(ttm_row.get("ni_parent_ttm"))
            if nt and npar is not None and nt > 0:
                minority = float(np.clip(1 - npar / nt, 0, 0.6))
        base.update({"revenue": rev, "interest": interest, "other": other, "minority": minority})
        a.update({"gm": round(gm_now, 4), "gm_lt": round(gm_lt, 4), "sga": round(sga_now, 4), "sga_lt": round(sga_lt, 4),
                  "tax": (fa.get("tax_rate") or 20) / 100})
        why["tax"] = "thuế thực tế 12 tháng gần nhất"
    else:
        roe_now = ni / eq
        roe_med = _median([h["roe"] for h in H] + [roe_now], roe_now, 0.05, 0.30)
        a.update({"roe_cap": round(float(np.clip(roe_med, 0.05, 0.30)), 4)})
        why["roe_cap"] = f"trung vị ROE nhiều năm của chính DN (hiện {_pct(roe_now)})"
    hist = [{"year": h["year"], "rev_g": _r(h["rev_g"], 4), "ni_g": _r(h["ni_g"], 4), "gm": _r(h["gm"], 4), "sga": _r(h["sga"], 4),
             "conv": _r(h["conv"], 3), "roe": _r(h["roe"], 4)} for h in H[-8:]]
    return {"base": base, "assumptions": a, "why": why, "hist": hist}


def path(a: dict, n: int):
    """Tăng trưởng và biên theo từng năm: năm 1 → năm 3 → dài hạn; biên đi từ hiện tại về trung vị lịch sử."""
    g1, gt = a["g1"], a["gterm"]
    gm_ = a.get("gmid")
    if gm_ is None:
        gm_ = (g1 + gt) / 2
    m = min(3, n)
    out = []
    for t in range(1, n + 1):
        if t <= m:
            g = g1 + (gm_ - g1) * (t - 1) / max(1, m - 1)
        else:
            g = gm_ + (gt - gm_) * (t - m) / max(1, n - m)
        f = (t - 1) / max(1, n - 1)
        gm = a.get("gm")
        gm_t = gm + ((a.get("gm_lt") if a.get("gm_lt") is not None else gm) - gm) * f if gm is not None else None
        sga = a.get("sga")
        sga_t = sga + ((a.get("sga_lt") if a.get("sga_lt") is not None else sga) - sga) * f if sga is not None else None
        out.append((g, gm_t, sga_t))
    return out


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
    P = path(a, n)
    for t in range(1, n + 1):
        g, gm_t, sga_t = P[t - 1]
        if base["model"] == "CT":
            rev = rev * (1 + g)
            gp = rev * gm_t
            sga = rev * sga_t
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
        if a0.get("gmid") is not None:
            a["gmid"] = sc["g1"](a0["gmid"])
        if base["model"] == "CT":
            a["gm"] = a0["gm"] + sc["gm"]
            if a0.get("gm_lt") is not None:
                a["gm_lt"] = a0["gm_lt"] + sc["gm"]
        rows = project(base, a)
        out[k] = {
            "label": sc["label"], "g1": round(a["g1"], 4),
            "dcf": _r(dcf_value(base, a, rows, ke), 2),
            "ddm": _r(ddm_value(base, a, rows, ke), 2),
            "rows": [{kk: (_r(v, 2) if isinstance(v, float) else v) for kk, v in r.items()} for r in rows],
        }
    return out
