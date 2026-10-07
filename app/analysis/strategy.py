"""Chấm điểm 9 phương pháp, 5 rổ chọn mã, tín hiệu Mua/Bán và kế hoạch danh mục."""
from __future__ import annotations

import math

import numpy as np
import pandas as pd

METHOD_INFO = {
    "piotroski": {"name": "Piotroski F-Score", "desc":
                  "9 bài kiểm tra sức khoẻ tài chính (lãi, dòng tiền, nợ, biên lợi nhuận, hiệu quả). "
                  "Điểm 7-9 là doanh nghiệp đang khoẻ lên; 0-3 là đang yếu đi."},
    "magic_formula": {"name": "Magic Formula (Greenblatt)", "desc":
                      "Xếp hạng theo 2 tiêu chí: doanh nghiệp TỐT (ROIC cao) và giá RẺ (EBIT/EV cao). "
                      "Mua nhóm đứng đầu cả hai. Không áp dụng cho ngân hàng/CTCK/bảo hiểm."},
    "value": {"name": "Giá trị (Value)", "desc":
              "Giá đang thấp hơn giá trị hợp lý (định giá đa phương pháp), P/E, P/B thấp hơn ngành "
              "và lịch sử của chính mã."},
    "quality": {"name": "Chất lượng (Quality)", "desc":
                "ROE cao và ổn định 5 năm, ít năm lỗ, biên lợi nhuận tốt, dòng tiền thật (CFO/LN), nợ thấp."},
    "growth": {"name": "Tăng trưởng (Growth)", "desc":
               "Doanh thu, lợi nhuận tăng (năm gần nhất, quý gần nhất, 3 năm), chuỗi quý tăng liên tiếp."},
    "dividend": {"name": "Cổ tức", "desc":
                 "Tỷ suất cổ tức TIỀN MẶT cao, trả đều nhiều năm, tỷ lệ chi trả bền vững, có dòng tiền che phủ."},
    "momentum": {"name": "Sức mạnh giá (Momentum)", "desc":
                 "Mã tăng mạnh hơn thị trường 3-12 tháng (bỏ tháng gần nhất). Mã mạnh thường tiếp tục mạnh."},
    "canslim": {"name": "CANSLIM", "desc":
                "C: LN quý tăng ≥25% · A: LN 3 năm tăng ≥20%/năm & ROE ≥17% · N: gần đỉnh 52 tuần · "
                "S: thanh khoản tốt · L: dẫn dắt (sức mạnh giá top 20%) · M: thị trường thuận lợi."},
    "low_vol": {"name": "Biến động thấp", "desc":
                "Mã dao động giá ít và beta thấp – phòng thủ khi thị trường xấu."},
}

BASKETS = {
    "garp": {"name": "Chất lượng + Tăng trưởng hợp lý (GARP)", "risk": "Vừa",
             "rule": "ROE ≥ 15%, LN tăng ≥ 10%, PEG ≤ 1.5, F-Score ≥ 5, nợ vay/vốn < 1.5, CFO dương"},
    "dividend": {"name": "Cổ tức", "risk": "Thấp",
                 "rule": "Trả cổ tức tiền mặt ≥ 3 năm liên tiếp, tỷ suất ≥ 5%, chi trả ≤ 90% LN, có lãi, F-Score ≥ 4"},
    "value": {"name": "Giá trị", "risk": "Thấp – vừa",
              "rule": "Giá ≤ giá trị hợp lý trừ biên an toàn, F-Score ≥ 5, ROE ≥ 8%, không lỗ 3 năm gần nhất"},
    "defensive": {"name": "Phòng thủ", "risk": "Thấp",
                  "rule": "Biến động thấp (top 40%), nợ vay/vốn < 1, cổ tức ≥ 3 năm, ROE ≥ 10%"},
    "growth": {"name": "Tăng trưởng mạnh (CANSLIM)", "risk": "Cao",
               "rule": "Đạt ≥ 4/6 tiêu chí CANSLIM, xu hướng giá tăng"},
}


def _pct(s: pd.Series, ascending=True) -> pd.Series:
    s = pd.to_numeric(s, errors="coerce")
    return 100 * s.rank(pct=True, ascending=ascending)


def _mean(*series, default=50.0) -> pd.Series:
    df = pd.concat(series, axis=1)
    return df.mean(axis=1, skipna=True).fillna(default)


def score_methods(u: pd.DataFrame, market_light: str) -> pd.DataFrame:
    """u: bảng tổng hợp 1 dòng/mã. Trả về các cột điểm 0-100."""
    s = pd.DataFrame(index=u.index)
    ct = u["ctype"] == "CT"
    s["piotroski"] = (pd.to_numeric(u["fscore"], errors="coerce") / 9 * 100).fillna(40)

    mf = _pct(u["earnings_yield"].where(ct)) + _pct(u["roic"].where(ct))
    fin_alt = _pct(u["roe"].where(~ct)) + _pct(u["pb"].where(~ct & (u["pb"] > 0)), ascending=False)
    s["magic_formula"] = _pct(mf).where(ct, _pct(fin_alt)).fillna(40)

    s["value"] = _mean(_pct(u["upside"]),
                       u.get("pe_pctl", pd.Series(index=u.index, dtype=float)),
                       u.get("pb_pctl", pd.Series(index=u.index, dtype=float)),
                       _pct(u["pe_vs_hist"], ascending=False), default=40)
    s["quality"] = _mean(_pct(u["roe_avg5"]), _pct(u["roe_std5"], ascending=False),
                         _pct(u["gross_margin"]), _pct(u["cfo_ni"].clip(upper=2)),
                         _pct(u["de"], ascending=False),
                         pd.Series(np.where(u["loss_years"].fillna(1) == 0, 80, 20), index=u.index))
    s["growth"] = _mean(_pct(u["rev_yoy"]), _pct(u["ni_yoy"]), _pct(u["ni_q_yoy"]),
                        _pct(u["rev_cagr3"]), _pct(u["ni_cagr3"]),
                        _pct(u["ni_growth_streak"]), default=40)
    sustain = pd.Series(np.where((u["payout"].fillna(0) > 0) & (u["payout"].fillna(999) <= 90), 80, 30),
                        index=u.index)
    s["dividend"] = _mean(_pct(u["div_yield"].fillna(0)), _pct(u["cash_years"].fillna(0)), sustain)
    s["momentum"] = _mean(_pct(u["ret_12_1"]), _pct(u["ret_6m"]), _pct(u["rs_raw"]))
    rs_rating = _pct(u["rs_raw"])
    c = pd.DataFrame({
        "C": u["ni_q_yoy"].fillna(-1) >= 25,
        "A": (u["ni_cagr3"].fillna(-1) >= 20) & (u["roe"].fillna(0) >= 17),
        "N": u["from_hi52"].fillna(-99) >= -15,
        "S": u["avg_value_bn"].fillna(0) >= 10,
        "L": rs_rating.fillna(0) >= 80,
        "M": pd.Series(market_light != "red", index=u.index),
    })
    s["canslim"] = c.sum(axis=1) / 6 * 100
    s["low_vol"] = _mean(_pct(u["vol_1y"], ascending=False), _pct(u["beta"], ascending=False))
    s["rs_rating"] = rs_rating.round(0)
    s["canslim_flags"] = c.apply(lambda r: "".join(k for k, v in r.items() if v), axis=1)
    return s


def composite(scores: pd.DataFrame, weights: dict) -> pd.Series:
    w = {k: float(v) for k, v in weights.items() if k in scores and float(v) > 0}
    if not w:
        return pd.Series(50, index=scores.index)
    tot = sum(w.values())
    return sum(scores[k] * v for k, v in w.items()) / tot


def basket_members(u: pd.DataFrame, sc: pd.DataFrame, light: str) -> dict[str, pd.Series]:
    """Trả về {rổ: điểm xếp hạng (chỉ mã đạt điều kiện)}."""
    ct = u["ctype"] == "CT"
    pos_cfo = (u["cfo_ni"].fillna(0) > 0) | ~ct
    peg = u["pe"] / u[["ni_cagr3", "ni_yoy"]].min(axis=1).clip(lower=0.1)
    res = {}
    m = ((u["roe"] >= 15) & (u[["ni_cagr3", "ni_yoy"]].max(axis=1) >= 10) & (peg <= 1.5)
         & (u["fscore"].fillna(0) >= 5) & ((u["de"].fillna(0) < 1.5) | ~ct) & pos_cfo)
    res["garp"] = (0.4 * sc["quality"] + 0.3 * sc["growth"] + 0.3 * sc["value"])[m]
    m = ((u["cash_years"].fillna(0) >= 3) & (u["div_yield"].fillna(0) >= 5)
         & (u["payout"].fillna(999) <= 90) & (u["ni_ttm"].fillna(-1) > 0) & (u["fscore"].fillna(0) >= 4))
    res["dividend"] = (0.6 * sc["dividend"] + 0.2 * sc["quality"] + 0.2 * sc["value"])[m]
    m = ((u["price"] <= u["buy_below"]) & (u["fscore"].fillna(0) >= 5) & (u["roe"].fillna(0) >= 8)
         & (u["loss_years"].fillna(9) == 0))
    res["value"] = (0.6 * sc["value"] + 0.25 * sc["piotroski"] + 0.15 * sc["quality"])[m]
    m = ((sc["low_vol"] >= 60) & ((u["de"].fillna(0) < 1) | ~ct) & (u["cash_years"].fillna(0) >= 3)
         & (u["roe"].fillna(0) >= 10))
    res["defensive"] = (0.5 * sc["low_vol"] + 0.3 * sc["dividend"] + 0.2 * sc["quality"])[m]
    m = (sc["canslim"] >= 4 / 6 * 100 - 0.1) & (u["trend"] == "up")
    res["growth"] = (0.6 * sc["canslim"] + 0.4 * sc["momentum"])[m]
    return {k: v.sort_values(ascending=False) for k, v in res.items()}


# ------------------------------------------------------------------ tín hiệu
def trade_levels(row: pd.Series, risk_cfg: dict) -> dict:
    """Vùng mua, cắt lỗ, mục tiêu cho 1 mã."""
    def v(k):
        x = row.get(k)
        try:
            return None if x is None or x != x else float(x)
        except (TypeError, ValueError):
            return None

    price = float(row["price"])
    atr = v("atr") or price * 0.025
    buy_below = v("buy_below")
    sup = v("support1")
    max_sl = risk_cfg.get("max_stop_loss_pct", 12) / 100
    if buy_below and price <= buy_below:
        lo = max(sup if sup and sup < price else price * 0.96, price * 0.95)
        zone = [round(lo, 2), round(min(price * 1.01, buy_below), 2)]
        entry = price
        state = "now"
    elif buy_below:
        zone = [round(buy_below * 0.97, 2), round(buy_below, 2)]
        entry = buy_below
        state = "wait"
    else:
        zone = [round(price * 0.97, 2), round(price, 2)]
        entry = price
        state = "now"
    stop_atr = entry - 2.5 * atr
    stop_sup = sup * 0.97 if sup and sup < entry else stop_atr
    stop = max(min(stop_atr, stop_sup), entry * (1 - max_sl))
    t1 = v("fair") or entry * 1.15
    t2 = v("fair_hi") or t1 * 1.15
    if t1 <= entry * 1.03:
        t1 = entry * 1.10
    if t2 <= t1:
        t2 = t1 * 1.10
    rr = (t1 - entry) / (entry - stop) if entry > stop else None
    return {"zone": zone, "entry": round(entry, 2), "stop": round(stop, 2),
            "stop_pct": round(100 * (stop / entry - 1), 1), "t1": round(t1, 2), "t2": round(t2, 2),
            "t1_pct": round(100 * (t1 / entry - 1), 1), "rr": round(rr, 2) if rr else None, "state": state}


def timing_ok(row: pd.Series) -> tuple[bool, str]:
    """Hàng rào kỹ thuật: không bắt dao rơi."""
    if row.get("trend") == "down" and row.get("wyckoff") not in ("accum", "markup_start"):
        return False, "Giá đang trong xu hướng giảm – chờ tạo đáy (giá lên trên MA50 hoặc nền tích luỹ)"
    if row.get("st_dir", 1) < 0 and row.get("trend") != "up" and row.get("ta_score", 50) < 35:
        return False, "Kỹ thuật yếu (điểm kỹ thuật < 35) – chờ tín hiệu xác nhận"
    return True, ""


def plan(u: pd.DataFrame, sc: pd.DataFrame, members: dict[str, pd.Series], cfg: dict,
         regime: dict) -> dict:
    """Chọn danh mục mục tiêu theo phân bổ rổ, đèn thị trường và giới hạn rủi ro."""
    alloc = {k: float(v) for k, v in (cfg.get("allocation") or {}).items() if float(v) > 0}
    risk = cfg.get("risk") or {}
    maxpos = int(risk.get("max_positions", 8))
    max_w = float(risk.get("max_weight_per_stock", 20))
    max_sec = float(risk.get("max_weight_per_sector", 30))
    exposure = regime.get("exposure", 100) / 100
    light = regime.get("light", "yellow")
    tot = sum(alloc.values()) or 1
    picks, sector_w, used = [], {}, set()
    watch = []
    for b, a in sorted(alloc.items(), key=lambda x: -x[1]):
        if light == "red" and b not in ("dividend", "defensive", "value"):
            continue
        n_slots = max(1, round(maxpos * a / tot))
        w_each = min(max_w, a / tot * 100 * exposure / n_slots)
        got = 0
        for sym, score in members.get(b, pd.Series(dtype=float)).items():
            if got >= n_slots:
                break
            if sym in used:
                continue
            row = u.loc[sym]
            if not row.get("liquid_ok", False):
                continue
            ok, why = timing_ok(row)
            lv = trade_levels(row, risk)
            sec = row.get("sector") or "Khác"
            if not ok or lv["state"] == "wait":
                watch.append({"symbol": sym, "basket": b, "score": round(float(score), 1),
                              "reason": why or f"Chờ giá về vùng {lv['zone'][0]}–{lv['zone'][1]}",
                              **lv})
                continue
            if sector_w.get(sec, 0) + w_each > max_sec:
                continue
            # cỡ vị thế theo rủi ro: lỗ tối đa risk_per_trade % vốn nếu chạm cắt lỗ
            rpt = float(risk.get("risk_per_trade", 1.5))
            w_risk = rpt / max(1e-6, -lv["stop_pct"]) * 100 if lv["stop_pct"] < 0 else w_each
            w = round(min(w_each, w_risk, max_w), 1)
            picks.append({"symbol": sym, "basket": b, "weight": w, "score": round(float(score), 1),
                          "sector": sec, **lv})
            sector_w[sec] = sector_w.get(sec, 0) + w
            used.add(sym)
            got += 1
    invested = round(sum(p["weight"] for p in picks), 1)
    return {"picks": picks, "watch": watch[:25], "cash": round(100 - invested, 1),
            "invested": invested, "exposure_cap": regime.get("exposure", 100)}


def shares_for(capital_vnd: float, weight_pct: float, price_k: float) -> int:
    """Số cổ phiếu (làm tròn lô 100)."""
    if not capital_vnd or not price_k:
        return 0
    return int(math.floor(capital_vnd * weight_pct / 100 / (price_k * 1000) / 100) * 100)
