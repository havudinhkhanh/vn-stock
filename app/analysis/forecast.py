"""Dự phóng tài chính 5 năm, 3 kịch bản (Xấu / Cơ sở / Tốt) + DCF (FCFE, kiểm tra chéo FCFF/WACC) & DDM.

Doanh nghiệp thường (CT) – dòng tiền tính TƯỜNG MINH:
  EBIT = LN gộp − chi phí BH&QL;  lãi vay = lãi suất vay × dư nợ bình quân;  dư nợ = nợ vay/vốn chủ mục tiêu × vốn chủ năm trước
  FCFE = LN ròng + khấu hao − đầu tư TSCĐ − tăng vốn lưu động + vay ròng (phần của cổ đông mẹ)
  Đầu tư TSCĐ/doanh thu đi từ nhịp đầu tư 2 năm gần nhất (vd. đang mua tàu, xây nhà máy) về mức duy trì = khấu hao + tăng trưởng × (TSCĐ/doanh thu).
  Kế hoạch đầu tư lớn (anh tự nhập): X tỷ trong N năm, Y% vay → thêm doanh thu Z tỷ/năm khi xong, biên EBIT m; khấu hao 15 năm, nợ trả dần 8 năm.

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
        debt = (_num(r.get("st_debt")) or 0) + (_num(r.get("lt_debt")) or 0)
        cash = (_num(r.get("cash")) or 0) + (_num(r.get("st_invest")) or 0)
        eb, ebit = _num(r.get("ebitda")), _num(r.get("ebit"))
        cx, it = _num(r.get("capex")), _num(r.get("interest_exp"))
        row.update({"capex_r": abs(cx) / rev if cx is not None and rev and rev > 0 else None,
                    "da_r": (eb - ebit) / rev if eb is not None and ebit is not None and rev and rev > 0 and eb >= ebit else None,
                    "debt": debt, "net_debt": debt - cash, "int": abs(it) if it is not None else None,
                    "de": debt / eq if eq and eq > 0 else None,
                    "fa_r": (_num(r.get("fixed_assets")) or 0) / rev if rev and rev > 0 else None, "capex": abs(cx) if cx is not None else None})
        if prev and prev.get("debt") is not None and row["int"] and (debt + prev["debt"]) > 0:
            row["kd"] = row["int"] / ((debt + prev["debt"]) / 2) if (debt + prev["debt"]) / 2 > 20 else None
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
    nfac = float((fa.get("norm") or {}).get("f") or 1.0)
    if model == "FIN" and nfac != 1 and ni > 0:
        ni = ni * nfac   # ngân hàng/CTCK/bảo hiểm: dự phóng từ lợi nhuận đã chuẩn hoá
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
    gterm = float(np.clip(0.6 * gterm_cfg + 0.4 * (cagr_lt if cagr_lt is not None else gterm_cfg) * 0.5, 0.025, 0.04))
    lbl = "doanh thu" if model == "CT" else "lợi nhuận"
    why["g1"] = (f"{lbl} 12 tháng {_pct(ttm_g)}, CAGR 3 năm {_pct(cagr3)}, ngành {_pct(sg)}; lịch sử dao động ±{_pct(vol, 0)}"
                 f" nên tin ngành {w_sec * 100:.0f}%")
    why["gmid"] = f"CAGR {lbl} {len(level) - 1 if level else 0} năm của chính DN {_pct(cagr_lt)}, hội tụ một nửa về ngành {_pct(sg)}"
    why["gterm"] = f"60% mức chuẩn {_pct(gterm_cfg)} + 40% một nửa CAGR dài hạn, giới hạn 2,5–4%"

    dps = (fa.get("dividend") or {}).get("dps_avg3") or (fa.get("dividend") or {}).get("dps_ttm") or 0
    eps = fa.get("eps") or 0
    payout = float(np.clip(dps / eps, 0, 0.9)) if eps and eps > 0 else 0.0
    why["payout"] = "cổ tức tiền mặt bình quân 3 năm ÷ EPS hiện tại"
    conv = _median([h["conv"] for h in H], 0.7, 0.1, 1.2)
    cv = [h["conv"] for h in H if h["conv"] is not None]
    conv_raw = float(np.median(cv)) if cv else None
    nconv = len(cv)
    why["conv"] = f"trung vị {nconv} năm (dòng tiền kinh doanh − đầu tư TSCĐ) ÷ lợi nhuận" if nconv else "chưa đủ lịch sử – dùng 70%"
    if model == "FIN":
        conv = None

    base = {"model": model, "shares": shares, "equity": eq, "ni": ni, "price": fa.get("price"), "bvps": fa.get("bvps"),
            "years": int(cfg.get("forecast_years", 5))}
    a = {"g1": round(g1, 4), "gmid": round(gmid, 4), "gterm": round(gterm, 4), "payout": round(payout, 3),
         "conv": round(conv, 3) if conv is not None else None, "conv_raw": round(conv_raw, 3) if conv_raw is not None else None}
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
        if nfac != 1:
            gm_now = 0.5 * gm_now + 0.5 * gm_lt
            why["gm"] = f"chuẩn hoá: ½ biên 12 tháng + ½ trung vị nhiều năm = {_pct(gm_now)} (lợi nhuận 12 tháng lệch xa mức bình thường)"
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
        # ---- vay nợ & đầu tư (số liệu quý gần nhất + năm)
        g_ = (lambda k: _num(ttm_row.get(k)) if ttm_row is not None else None)
        debt0 = (g_("st_debt") or 0) + (g_("lt_debt") or 0)
        cash0 = (g_("cash") or 0) + (g_("st_invest") or 0)
        debt_ly = H[-1]["debt"] if H and H[-1].get("debt") is not None else debt0
        avg_d = (debt0 + debt_ly) / 2
        kd0 = interest / avg_d if avg_d > 20 and interest > 0 else None
        kds = [h.get("kd") for h in H[-3:] if h.get("kd")]
        kd = float(np.clip(kd0 if kd0 else (np.median(kds) if kds else 0.08), 0.03, 0.15))
        de0 = debt0 / eq if eq > 0 else 0.0
        da_r = _median([h.get("da_r") for h in H[-3:]], 0.03, 0.0, 0.3)
        cap_hist = [h.get("capex_r") for h in H if h.get("capex_r") is not None]
        cap_med = float(np.median(cap_hist[-5:])) if cap_hist else da_r
        cap_rec = float(np.mean(cap_hist[-2:])) if cap_hist else da_r
        fa_r = _median([h.get("fa_r") for h in H[-2:]], 0.3, 0.0, 5.0)
        capex_lt = float(np.clip(da_r + gterm * fa_r, 0.0, 0.5))
        capex1 = float(np.clip(cap_rec, 0.0, 0.8))
        rec, inv_, cl, sd = g_("receivables") or 0, g_("inventory") or 0, g_("current_liab") or 0, g_("st_debt") or 0
        nwc = float(np.clip((rec + inv_ - (cl - sd)) / rev, -0.3, 0.6)) if rev else 0.0
        ebit_m = (gp - sga_now * rev) / rev if rev else 0.1
        base.update({"revenue": rev, "interest": interest, "other": other, "minority": minority, "debt": debt0, "cash": cash0})
        roe_lt = _median([h["roe"] for h in H], 0.12, 0.06, 0.30)
        conv_term = float(np.clip(1 - gterm / max(roe_lt, 0.06), 0.3, 0.95))
        a.pop("conv", None)
        a.update({"gm": round(gm_now, 4), "gm_lt": round(gm_lt, 4), "sga": round(sga_now, 4), "sga_lt": round(sga_lt, 4),
                  "tax": (fa.get("tax_rate") or 20) / 100, "conv_term": round(conv_term, 3),
                  "kd": round(kd, 4), "de": round(float(np.clip(de0, 0, 3)), 3), "da": round(da_r, 4), "capex1": round(capex1, 4), "capex_lt": round(capex_lt, 4),
                  "nwc": round(nwc, 4), "inv": 0.0, "inv_y": 2.0, "inv_debt": 0.6, "inv_rev": 0.0, "inv_m": round(float(np.clip(ebit_m, 0.02, 0.5)), 4)})
        why["kd"] = (f"lãi vay 12 tháng {interest:,.0f} tỷ ÷ dư nợ vay bình quân {avg_d:,.0f} tỷ".replace(",", ".") if kd0 else "chưa đủ số liệu lãi vay – dùng 8%") + " (giới hạn 3–15%)"
        why["de"] = f"nợ vay {debt0:,.0f} tỷ ÷ vốn chủ {eq:,.0f} tỷ hiện tại – dư nợ tăng theo vốn chủ (vay ròng tính vào dòng tiền)".replace(",", ".")
        why["da"] = "khấu hao ÷ doanh thu, trung vị 3 năm (EBITDA − EBIT)"
        boom = cap_rec > 0.04 and ((cap_rec > 1.6 * cap_med and cap_rec > da_r * 1.5) or cap_rec > 1.8 * max(da_r, 0.005))
        why["capex1"] = (f"nhịp đầu tư TSCĐ 2 năm gần nhất {_pct(cap_rec)} doanh thu (5 năm: {_pct(cap_med)}; khấu hao {_pct(da_r)})"
                         + (" – ĐANG TRONG CHU KỲ ĐẦU TƯ LỚN (mua tài sản / xây nhà máy); nếu biết kế hoạch cụ thể, nhập vào Kế hoạch đầu tư bên dưới" if boom else ""))
        why["capex_lt"] = f"mức duy trì: khấu hao {_pct(da_r)} + tăng trưởng dài hạn × TSCĐ/doanh thu ({fa_r:.2f}) – đầu tư đi dần từ nhịp hiện tại về mức này"
        why["nwc"] = "(phải thu + tồn kho − nợ ngắn hạn không phải vay) ÷ doanh thu – doanh thu tăng thì cần thêm vốn lưu động"
        why["inv"] = "kế hoạch đầu tư mới chưa nằm trong số liệu (vd. hợp đồng đóng tàu, nhà máy mới) – mặc định 0, anh tự nhập theo công bố của DN"
        why["inv_m"] = f"biên EBIT của phần doanh thu mới – mặc định bằng biên EBIT hiện tại {_pct(ebit_m)}"
        base["inv_hint"] = {"boom": bool(boom), "cap_rec": _r(cap_rec, 4), "cap_med": _r(cap_med, 4), "da_r": _r(da_r, 4),
                            "debt_chg_2y": _r(debt0 - (H[-2]["debt"] if len(H) >= 2 and H[-2].get("debt") is not None else debt0), 0)}
        why["conv_term"] = (f"dài hạn: doanh nghiệp tăng {_pct(gterm)}/năm với ROE {_pct(roe_lt)} cần giữ lại {_pct(gterm / max(roe_lt, 0.06))} lợi nhuận"
                            " → phần còn lại là dòng tiền tự do; tỷ lệ thành tiền đi dần từ mức lịch sử về mức này (năm cuối = giá trị cuối kỳ)")
        why["tax"] = "thuế thực tế 12 tháng gần nhất"
    else:
        roe_now = ni / eq
        roe_med = _median([h["roe"] for h in H] + [roe_now], roe_now, 0.05, 0.30)
        a.update({"roe_cap": round(float(np.clip(roe_med, 0.05, 0.30)), 4)})
        why["roe_cap"] = f"trung vị ROE nhiều năm của chính DN (hiện {_pct(roe_now)})"
    hist = [{"year": h["year"], "rev_g": _r(h["rev_g"], 4), "ni_g": _r(h["ni_g"], 4), "gm": _r(h["gm"], 4), "sga": _r(h["sga"], 4),
             "conv": _r(h["conv"], 3), "roe": _r(h["roe"], 4), "capex_r": _r(h.get("capex_r"), 4), "da_r": _r(h.get("da_r"), 4),
             "capex": _r(h.get("capex"), 0), "debt": _r(h.get("debt"), 0), "net_debt": _r(h.get("net_debt"), 0), "kd": _r(h.get("kd"), 4),
             "de": _r(h.get("de"), 3)} for h in H[-8:]]
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
    "bear": {"g1": lambda g: g - max(0.05, 0.5 * abs(g)), "gm": -0.015, "kd": 0.015, "label": "Xấu"},
    "base": {"g1": lambda g: g, "gm": 0.0, "kd": 0.0, "label": "Cơ sở"},
    "bull": {"g1": lambda g: g + max(0.04, 0.3 * abs(g)), "gm": 0.01, "kd": -0.01, "label": "Tốt"},
}


def project(base: dict, a: dict) -> list[dict]:
    """Dự phóng N năm. Trả về list dict theo năm (đơn vị tỷ đồng, EPS/DPS đồng)."""
    n = base["years"]
    rows = []
    equity = base["equity"]
    shares = base["shares"]
    if base["model"] == "CT":
        rev_core = rev_prev = base["revenue"]
        debt_prev = base.get("debt") or 0.0
        plan_debt = 0.0
    ni_prev = base["ni"]
    P = path(a, n)
    for t in range(1, n + 1):
        g, gm_t, sga_t = P[t - 1]
        if base["model"] == "CT":
            rev_core = rev_core * (1 + g)
            inv, ny = float(a.get("inv") or 0), max(1, int(round(a.get("inv_y") or 2)))
            capex_plan = inv / ny if inv > 0 and t <= ny else 0.0
            plan_debt += capex_plan * float(a.get("inv_debt") or 0)
            if inv > 0 and t > ny:
                plan_debt = max(0.0, plan_debt - inv * float(a.get("inv_debt") or 0) / 8)
            rev_plan = float(a.get("inv_rev") or 0) * (1 + g) ** (t - ny - 1) if t > ny and (a.get("inv_rev") or 0) > 0 else 0.0
            rev = rev_core + rev_plan
            gp = rev_core * gm_t
            sga = rev_core * sga_t
            ebit = gp - sga + rev_plan * float(a.get("inv_m") or 0)
            debt = float(a.get("de") or 0) * equity + plan_debt
            interest = float(a.get("kd") or 0) * (debt_prev + debt) / 2
            other = base["other"] * (0.8 ** t)
            pbt = ebit - interest + other
            tax = max(0.0, pbt * a["tax"])
            ni_all = pbt - tax
            ni = ni_all * (1 - base["minority"])
            f = (t - 1) / max(1, n - 1)
            capex_r = a["capex1"] + (a["capex_lt"] - a["capex1"]) * f
            da = a["da"] * rev_core + (inv / 15 if inv > 0 and t > ny else 0.0)
            capex = capex_r * rev_core + capex_plan
            dnwc = a["nwc"] * (rev - rev_prev)
            borrow = debt - debt_prev
            fcfe = (ni_all + da - capex - dnwc + borrow) * (1 - base["minority"])
            fcff = ebit * (1 - a["tax"]) + da - capex - dnwc
            row = {"revenue": rev, "gross_profit": gp, "sga": sga, "ebit": ebit, "interest": interest, "pbt": pbt, "ni": ni,
                   "da": da, "capex": capex, "dnwc": dnwc, "debt": debt, "borrow": borrow, "fcff": fcff}
            debt_prev, rev_prev = debt, rev
        else:
            ni = ni_prev * (1 + g)
            roe = ni / equity if equity > 0 else a["roe_cap"]
            fcfe = ni * (1 - g / max(roe, 0.05))
            row = {"ni": ni}
        eps = ni * 1000 / shares
        dps = max(0.0, eps * a["payout"])
        eq_prev = equity
        equity = equity + ni - dps * shares / 1000
        row.update({"year_offset": t, "g": g, "eps": eps, "dps": dps, "fcfe": fcfe,
                    "equity": equity, "bvps": equity * 1000 / shares,
                    "roe": ni / eq_prev if eq_prev > 0 else None})
        rows.append(row)
        ni_prev = ni
    return rows


def dcf_detail(base: dict, a: dict, rows: list[dict], ke: float) -> tuple[float | None, float | None]:
    """(giá trị nội tại / cổ phiếu (nghìn đồng) theo FCFE, tỷ trọng giá trị cuối kỳ trong tổng).
    Năm cuối kỳ dùng ĐÚNG tỷ lệ thành tiền của năm dự phóng cuối (doanh nghiệp) để không nhảy vọt dòng tiền."""
    g = a["gterm"]
    if ke <= g + 0.01:
        ke = g + 0.01
    pv = sum(r["fcfe"] / (1 + ke) ** r["year_offset"] for r in rows)
    last = rows[-1]
    if base["model"] == "CT" and last["ni"]:
        # năm cuối kỳ ở trạng thái ổn định: giữ lại g/ROE dài hạn để tăng trưởng g, phần còn lại là dòng tiền cho cổ đông
        fcfe_t = last["ni"] * (1 + g) * float(a.get("conv_term") or 0.7)
    else:
        roe_t = min(max(last["roe"] or 0.12, 0.06), 0.25)
        fcfe_t = last["ni"] * (1 + g) * (1 - g / roe_t)
    tv = fcfe_t / (ke - g) / (1 + ke) ** len(rows)
    val = pv + tv
    if val <= 0:
        return None, None
    return val / base["shares"], (tv / val if val else None)


def fcff_detail(base: dict, a: dict, rows: list[dict], ke: float) -> dict | None:
    """Kiểm tra chéo: chiết khấu dòng tiền cho toàn doanh nghiệp theo WACC rồi trừ nợ ròng."""
    if base["model"] != "CT" or not rows or not base.get("price"):
        return None
    E = base["price"] * base["shares"]          # nghìn đồng × triệu cp = tỷ đồng
    D = float(base.get("debt") or 0)
    kd_at = float(a.get("kd") or 0.08) * (1 - a["tax"])
    w = (E * ke + D * kd_at) / (E + D) if E + D > 0 else ke
    g = a["gterm"]
    w = max(w, g + 0.01)
    pv = sum(r["fcff"] / (1 + w) ** r["year_offset"] for r in rows)
    last = rows[-1]
    tv = last["ebit"] * (1 - a["tax"]) * (1 + g) * float(a.get("conv_term") or 0.7) / (w - g) / (1 + w) ** len(rows)
    ev = pv + tv
    eqv = (ev - D + float(base.get("cash") or 0)) * (1 - base["minority"])
    return {"wacc": _r(w, 4), "ev": _r(ev, 0), "net_debt": _r(D - float(base.get("cash") or 0), 0), "per_share": _r(eqv / base["shares"], 2) if eqv > 0 else None,
            "kd_after_tax": _r(kd_at, 4), "d_weight": _r(D / (E + D), 3) if E + D > 0 else None}


def dcf_value(base: dict, a: dict, rows: list[dict], ke: float) -> float | None:
    return dcf_detail(base, a, rows, ke)[0]


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
            if a0.get("kd") is not None:
                a["kd"] = a0["kd"] + sc.get("kd", 0)
        rows = project(base, a)
        dv, tvs = dcf_detail(base, a, rows, ke)
        out[k] = {
            "label": sc["label"], "g1": round(a["g1"], 4),
            "dcf": _r(dv, 2), "tv_share": _r(tvs, 3), "fcff": fcff_detail(base, a, rows, ke),
            "fcfe5": _r(sum(r["fcfe"] for r in rows), 0),
            "ddm": _r(ddm_value(base, a, rows, ke), 2),
            "rows": [{kk: (_r(v, 2) if isinstance(v, float) else v) for kk, v in r.items()} for r in rows],
        }
    return out
