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
    """P/E, P/B lịch sử 5 năm của chính mã (tại cuối mỗi quý)."""
    if qs is None or qs.empty or close.empty or not shares:
        return {}
    pe, pb = [], []
    for _, r in qs.dropna(subset=["ni_parent_ttm"]).tail(20).iterrows():
        d = pd.Timestamp(year=int(r["year"]), month=int(r["quarter"]) * 3, day=1) + pd.offsets.MonthEnd(0)
        # dùng giá 45 ngày sau kỳ (khi BCTC đã công bố)
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
    ke = rf + b * erp
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

    # 1) DCF (FCFE)
    if sc and sc["base"]["dcf"]:
        methods.append({"key": "dcf", "name": "DCF (dòng tiền tự do cho cổ đông)", "value": sc["base"]["dcf"],
                        "w": 0.35 if ctype == "CT" else 0.15,
                        "range": [sc["bear"]["dcf"], sc["bull"]["dcf"]]})
    # 2) DDM
    div = fa.get("dividend") or {}
    if sc and sc["base"]["ddm"] and div.get("paid_years_5", 0) >= 3:
        methods.append({"key": "ddm", "name": "Chiết khấu cổ tức (DDM)", "value": sc["base"]["ddm"], "w": 0.20,
                        "range": [sc["bear"]["ddm"], sc["bull"]["ddm"]]})
    # 3) P/E mục tiêu × EPS dự phóng
    pe_targets = [x for x in (peers.get("pe_ind_med"), hist.get("pe_med")) if x and 3 < x < 40]
    if pe_targets and (fwd_eps or eps) and (fwd_eps or eps) > 0:
        pe_t = float(np.mean(pe_targets))
        e = fwd_eps or eps
        methods.append({"key": "pe", "mult": pe_t, "name": f"P/E mục tiêu {pe_t:.1f}x (ngành & lịch sử) × EPS dự phóng",
                        "value": _r(pe_t * e / 1000), "w": 0.25 if ctype == "CT" else 0.20,
                        "range": [_r(min(pe_targets) * e / 1000), _r(max(pe_targets) * e / 1000)]})
    # 4) P/B mục tiêu
    pb_targets = [x for x in (peers.get("pb_ind_med"), hist.get("pb_med")) if x and 0.3 < x < 8]
    if pb_targets and bvps and bvps > 0:
        pb_t = float(np.mean(pb_targets))
        methods.append({"key": "pb", "mult": pb_t, "name": f"P/B mục tiêu {pb_t:.2f}x × BVPS", "value": _r(pb_t * bvps / 1000),
                        "w": 0.15 if ctype == "CT" else 0.25,
                        "range": [_r(min(pb_targets) * bvps / 1000), _r(max(pb_targets) * bvps / 1000)]})
    # 5) P/B hợp lý theo ROE (ngân hàng, CTCK, bảo hiểm)
    if ctype != "CT" and bvps and bvps > 0:
        roe_n = np.nanmean([x for x in (fa.get("roe"), fa.get("roe_avg5")) if x is not None] or [np.nan]) / 100
        g = cfg.get("terminal_growth", 4.0) / 100
        if roe_n == roe_n and roe_n > g:
            pbj = float(np.clip((roe_n - g) / max(ke - g, 0.02), 0.3, 4.0))
            methods.append({"key": "pbroe", "mult": pbj, "name": f"P/B hợp lý theo ROE ({pbj:.2f}x = (ROE−g)/(ke−g))",
                            "value": _r(pbj * bvps / 1000), "w": 0.40, "range": None})
    methods = [m for m in methods if m["value"] and m["value"] > 0]
    if not methods:
        return {"ok": False, "reason": "Không đủ số liệu để định giá (lỗ, vốn âm hoặc thiếu BCTC)",
                "ke": _r(ke * 100, 2), "beta": _r(b, 2)}
    # cắt bớt giá trị lệch quá xa (> 2.5 lần trung vị) để tránh 1 phương pháp kéo lệch
    med = float(np.median([m["value"] for m in methods]))
    for m in methods:
        m["used"] = bool(med / 2.5 <= m["value"] <= med * 2.5)
    used = [m for m in methods if m["used"]] or methods
    wsum = sum(m["w"] for m in used)
    fair = sum(m["value"] * m["w"] for m in used) / wsum
    lows = [m["range"][0] for m in used if m.get("range") and m["range"][0]]
    highs = [m["range"][1] for m in used if m.get("range") and m["range"][1]]
    fair_lo = float(np.mean(lows)) if lows else fair * 0.8
    fair_hi = float(np.mean(highs)) if highs else fair * 1.2
    buy_below = fair * (1 - mos_pct / 100)
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
    if spread > 2.2:
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
            "buy_below": _r(buy_below), "sell_above": _r(fair * 1.10), "upside": _r(upside, 1),
            "verdict": verdict, "reliable": reliable, "warning": warning, "methods": methods, "ke": _r(ke * 100, 2), "beta": _r(b, 2),
            "scenarios": sc, "model": model, "hist": {k: _r(v, 2) for k, v in hist.items()}}
