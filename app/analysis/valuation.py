"""Định giá đa phương pháp → giá trị hợp lý, vùng giá mua có biên an toàn."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import forecast
from .fundamentals import _num, _r


def beta(stock: pd.Series, index: pd.Series) -> float:
    s = stock.iloc[-520:].resample("W-FRI").last().pct_change(fill_method=None)
    i = index.reindex(stock.index).ffill().iloc[-520:].resample("W-FRI").last().pct_change(fill_method=None)
    df = pd.concat([s, i], axis=1).dropna()
    if len(df) < 40 or df.iloc[:, 1].var() == 0:
        return 1.0
    b = df.cov().iloc[0, 1] / df.iloc[:, 1].var()
    return float(np.clip(0.67 * b + 0.33, 0.6, 1.6))  # điều chỉnh Blume


def hist_multiples(qs: pd.DataFrame, close: pd.Series, shares: float | None) -> dict:
    """P/E, P/B lịch sử 5 năm của chính mã tại cuối mỗi quý.

    Ưu tiên P/E, P/B do nguồn tính tại thời điểm đó (đúng theo giá & số cổ phiếu lúc ấy).
    Tự tính từ giá đã điều chỉnh chỉ khi nguồn không có (có thể lệch nếu có chia cổ phiếu)."""
    if qs is None or qs.empty:
        return {}
    q = qs.dropna(subset=["ni_parent_ttm"]).tail(20)
    pe, pb = [], []
    for _, r in q.iterrows():
        pe_s, pb_s = _num(r.get("pe_src")), _num(r.get("pb_src"))
        if pe_s and 0 < pe_s < 200:
            pe.append(pe_s)
        if pb_s and 0 < pb_s < 50:
            pb.append(pb_s)
    if len(pe) < 6 and not close.empty and shares:
        pe, pb = [], []
        for _, r in q.iterrows():
            d = pd.Timestamp(year=int(r["year"]), month=int(r["quarter"]) * 3, day=1) + pd.offsets.MonthEnd(0)
            px = close[:d + pd.Timedelta(days=45)]
            if px.empty:
                continue
            p = px.iloc[-1]
            sh = _num(r.get("shares")) or shares
            eps = r["ni_parent_ttm"] * 1000 / sh
            if eps > 0:
                pe.append(p * 1000 / eps)
            eq = _num(r.get("equity"))
            if eq and eq > 0:
                pb.append(p * 1000 / (eq * 1000 / sh))
    res = {}
    if len(pe) >= 6:
        res["pe_med"] = float(np.median(pe))
        res["pe_lo"], res["pe_hi"] = float(np.percentile(pe, 20)), float(np.percentile(pe, 80))
    if len(pb) >= 6:
        res["pb_med"] = float(np.median(pb))
        res["pb_lo"], res["pb_hi"] = float(np.percentile(pb, 20)), float(np.percentile(pb, 80))
    return res


def value(fa: dict, model: dict | None, peers: dict, hist: dict, b: float, cfg: dict,
          mos_pct: float) -> dict:
    price = fa.get("price")
    rf = cfg.get("risk_free", 3.2) / 100
    erp = cfg.get("equity_risk_premium", 8.0) / 100
    # Chi phí vốn: beta tuần của cổ phiếu VN ít thanh khoản bị kéo thấp → không cho beta < 1 làm giảm ke;
    # cộng phần bù quy mô (DN nhỏ rủi ro cao hơn) và đặt mức sàn.
    mcap = fa.get("mcap_bn") or 0
    size_p = 0.02 if mcap < 2000 else 0.01 if mcap < 10000 else 0.0
    ke = max(rf + max(b, 1.0) * erp + size_p, cfg.get("ke_min", 12.0) / 100)
    methods = []
    sc = None
    if model is not None:
        sc = forecast.scenarios(model, ke)
        base_rows = sc["base"]["rows"]
        fwd_eps = base_rows[0]["eps"] if base_rows else None
    else:
        fwd_eps = None
    ctype = fa.get("ctype", "CT")
    eps, bvps = fa.get("eps"), fa.get("bvps")

    # 1) DCF (FCFE) – chỉ dùng khi mô hình không "mong manh"
    if sc and sc["base"]["dcf"]:
        a0 = (model or {}).get("assumptions", {})
        why_off = []
        cr = a0.get("conv_raw")
        if ctype == "CT" and cr is not None and cr < 0.2:
            why_off.append(f"dòng tiền tự do lịch sử chỉ {cr * 100:.0f}% lợi nhuận (đầu tư nặng)")
        tvs = sc["base"].get("tv_share")
        if tvs is not None and tvs > 0.85:
            why_off.append(f"{tvs * 100:.0f}% giá trị nằm ở giá trị cuối kỳ")
        lo_, hi_ = sc["bear"]["dcf"], sc["bull"]["dcf"]
        w_dcf = 0.25 if ctype == "CT" else 0.15
        note = ""
        if lo_ and hi_ and hi_ / lo_ > 2.5:
            w_dcf /= 2
            note = f" – giảm ½ trọng số: kịch bản tốt/xấu chênh {hi_ / lo_:.1f} lần"
        methods.append({"key": "dcf", "name": "DCF (dòng tiền tự do cho cổ đông)" + (f" – không dùng: {'; '.join(why_off)}" if why_off else note),
                        "value": sc["base"]["dcf"], "w": 0.0 if why_off else w_dcf,
                        "range": [lo_, hi_], "off": why_off or None})
    # 2) DDM
    div = fa.get("dividend") or {}
    payout = (model or {}).get("assumptions", {}).get("payout", 0) if model else 0
    # DDM chỉ hợp với DN trả phần lớn lợi nhuận làm cổ tức; DN giữ lại để tăng trưởng thì DDM đánh giá thấp có hệ thống
    if sc and sc["base"]["ddm"] and div.get("paid_years_5", 0) >= 3 and payout >= 0.6:
        methods.append({"key": "ddm", "name": "Chiết khấu cổ tức (DDM)", "value": sc["base"]["ddm"], "w": 0.20,
                        "range": [sc["bear"]["ddm"], sc["bull"]["ddm"]]})
    # 3) P/E mục tiêu × EPS 12 tháng gần nhất (P/E ngành và lịch sử đều là P/E quá khứ → nhân với EPS quá khứ cho nhất quán;
    #    P/E ngành điều chỉnh theo ROE của mã so với ngành: sinh lời kém hơn ngành thì không đáng được trả bằng ngành)
    pe_ind = peers.get("pe_ind_med")
    roe_m, roe_i = fa.get("roe"), peers.get("roe_ind_med")
    adj = float(np.clip(roe_m / roe_i, 0.7, 1.3)) if pe_ind and roe_m and roe_i and roe_i > 0 and roe_m > 0 else 1.0
    # Kiểm chứng 2019–2026 (IC với lợi nhuận 3 tháng sau): P/E ngành × ROE ÷ P/E có dự báo (IC 0,035, t 2,2);
    # "rẻ so với P/E lịch sử của chính mã" thì KHÔNG (IC −0,018) và làm hỏng kết quả khi trộn vào (IC 0,012) →
    # mục tiêu chỉ dùng mặt bằng ngành (điều chỉnh theo ROE); lịch sử của mã chỉ để tham khảo / dự phòng khi thiếu ngành.
    pe_t = pe_ind * adj if pe_ind and 3 < pe_ind * adj < 40 else (hist.get("pe_med") if hist.get("pe_med") and 3 < hist["pe_med"] < 40 else None)
    if pe_t and eps and eps > 0:
        e = eps
        src = f"ngành{f' ×{adj:.2f} theo ROE' if adj != 1 else ''}" if pe_ind else "lịch sử của mã (thiếu số liệu ngành)"
        lo_m, hi_m = (pe_ind * adj * 0.85, pe_ind * adj * 1.15) if pe_ind else (hist.get("pe_lo") or pe_t * 0.85, hist.get("pe_hi") or pe_t * 1.15)
        methods.append({"key": "pe", "mult": pe_t, "name": f"P/E mục tiêu {pe_t:.1f}x ({src}) × EPS 12 tháng",
                        "value": _r(pe_t * e / 1000), "w": 0.35 if ctype == "CT" else 0.20,
                        "range": [_r(lo_m * e / 1000), _r(hi_m * e / 1000)]})
    # 4) P/B mục tiêu (cùng logic: mặt bằng ngành điều chỉnh theo ROE)
    pb_ind = peers.get("pb_ind_med")
    # P/B hợp lý tỷ lệ thuận với ROE (P/B = (ROE−g)/(ke−g)) → điều chỉnh đủ theo ROE (0,5–2,5 lần); kiểm chứng IC 0,023 so với 0,008 khi chỉ điều chỉnh ±30%
    adj_b = float(np.clip(roe_m / roe_i, 0.5, 2.5)) if roe_m and roe_i and roe_i > 0 and roe_m > 0 else 1.0
    pb_t = pb_ind * adj_b if pb_ind and 0.3 < pb_ind * adj_b < 8 else (hist.get("pb_med") if hist.get("pb_med") and 0.3 < hist["pb_med"] < 8 else None)
    if pb_t and bvps and bvps > 0:
        methods.append({"key": "pb", "mult": pb_t, "name": f"P/B mục tiêu {pb_t:.2f}x ({'ngành' + (f' ×{adj_b:.2f} theo ROE' if adj_b != 1 else '') if pb_ind else 'lịch sử của mã'}) × BVPS",
                        "value": _r(pb_t * bvps / 1000), "w": 0.15 if ctype == "CT" else 0.25,
                        "range": [_r(pb_t * 0.85 * bvps / 1000), _r(pb_t * 1.15 * bvps / 1000)]})
    # 5) P/B hợp lý theo ROE (ngân hàng, CTCK, bảo hiểm)
    if ctype != "CT" and bvps and bvps > 0:
        roe_n = np.nanmean([x for x in (fa.get("roe"), fa.get("roe_avg5")) if x is not None] or [np.nan]) / 100
        g = cfg.get("terminal_growth", 4.0) / 100
        if roe_n == roe_n and roe_n > g:
            pbj = float(np.clip((roe_n - g) / max(ke - g, 0.02), 0.3, 4.0))
            methods.append({"key": "pbroe", "mult": pbj, "name": f"P/B hợp lý theo ROE ({pbj:.2f}x = (ROE−g)/(ke−g))",
                            "value": _r(pbj * bvps / 1000), "w": 0.40, "range": None})
    methods = [m for m in methods if m["value"] and m["value"] > 0]
    if not [m for m in methods if m["w"] > 0]:
        methods = []
    if not methods:
        return {"ok": False, "reason": "Không đủ số liệu để định giá (lỗ, vốn âm hoặc thiếu BCTC)",
                "ke": _r(ke * 100, 2), "beta": _r(b, 2)}
    # cắt bớt giá trị lệch quá xa (> 2.5 lần trung vị) để tránh 1 phương pháp kéo lệch
    act = [m for m in methods if m["w"] > 0]
    med = float(np.median([m["value"] for m in act]))
    for m in methods:
        m["used"] = bool(m["w"] > 0 and med / 2.5 <= m["value"] <= med * 2.5)
    used = [m for m in methods if m["used"]] or act
    # phương pháp càng lệch xa trung vị càng ít trọng số (không để 1 phương pháp kéo cả kết quả)
    for m in used:
        m["w_eff"] = m["w"] / (1 + 3 * abs(np.log(m["value"] / med)))
    wsum = sum(m["w_eff"] for m in used)
    for m in used:
        m["w_eff"] = round(m["w_eff"] / wsum, 3)
    fair = sum(m["value"] * m["w_eff"] for m in used)
    lows = [m["range"][0] for m in used if m.get("range") and m["range"][0]]
    highs = [m["range"][1] for m in used if m.get("range") and m["range"][1]]
    fair_lo = float(np.mean(lows)) if lows else fair * 0.8
    fair_hi = float(np.mean(highs)) if highs else fair * 1.2
    med_used = float(np.median([m["value"] for m in used]))
    buy_below = min(fair * (1 - mos_pct / 100), med_used * (1 - mos_pct / 200))
    upside = (fair / price - 1) * 100 if price else None
    # Kiểm tra bất thường: giá trị lệch quá xa giá thị trường thường là do số liệu nguồn lỗi
    # (đơn vị, số cổ phiếu, lợi nhuận bất thường 1 lần) → không dùng để ra quyết định mua.
    reliable = True
    warning = None
    if price and (fair > price * 2.5 or fair < price / 2.5):
        reliable = False
        warning = ("Giá trị tính ra lệch quá xa giá thị trường – có thể do số liệu bất thường "
                   "(lợi nhuận đột biến 1 lần, sai số cổ phiếu…). Anh nên tự rà lại giả định.")
    spread = (max(m["value"] for m in used) / min(m["value"] for m in used)) if len(used) > 1 else 1
    if spread > 3.0:
        reliable = False
        warning = warning or "Các phương pháp định giá cho kết quả rất khác nhau – độ tin cậy thấp."
    if price is None:
        verdict = "n/a"
    elif not reliable:
        verdict = "Chưa đáng tin – cần rà lại"
    elif price <= buy_below:
        verdict = "Rẻ – dưới vùng mua an toàn"
    elif price <= fair * 0.95:
        verdict = "Hơi rẻ"
    elif price <= fair * 1.10:
        verdict = "Hợp lý"
    else:
        verdict = "Đắt"
    return {"ok": True, "fair": _r(fair), "fair_lo": _r(min(fair_lo, fair)), "fair_hi": _r(max(fair_hi, fair)),
            "buy_below": _r(buy_below), "sell_above": _r(fair * 1.10), "upside": _r(upside, 1), "median": _r(med_used),
            "ke_parts": {"rf": _r(rf * 100, 2), "beta": _r(b, 2), "beta_used": _r(max(b, 1.0), 2), "erp": _r(erp * 100, 2), "size": _r(size_p * 100, 1),
                         "floor": cfg.get("ke_min", 12.0)},
            "verdict": verdict, "reliable": reliable, "warning": warning, "methods": methods, "ke": _r(ke * 100, 2), "beta": _r(b, 2),
            "scenarios": sc, "model": model, "hist": {k: _r(v, 2) for k, v in hist.items()}}
