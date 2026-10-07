"""Kế hoạch thoát hàng cho từng mã đang nắm – theo đúng phong cách đã mua.

Mỗi mức: giá, bán bao nhiêu (tỷ lệ của số cổ phiếu CÒN LẠI lúc chạm mức), lý do.
Cùng công thức với hàm exitPlan() trong site/app.js (web tính lại ngay khi anh đổi phong cách / mức riêng).

  position  Trung hạn: dừng = max(giá vốn × (1 − cắt lỗ %), đỉnh sau mua − 3×ATR) → bán hết;
            chốt 1/2 khi giá ≥ giá trị hợp lý × 1,10; chốt nửa còn lại ở vùng giá trị cao; xem lại sau 60 phiên chưa lãi.
  swing     Lướt sóng: dừng ban đầu = giá vốn − 2,5×ATR (5–10%), dời theo đỉnh, về hoà vốn khi lãi 1,5R;
            chốt 2/3 ở 3R, phần còn lại ở 4R; bán hết sau 20 phiên chưa đạt 3R hoặc đóng cửa dưới EMA20 2 phiên.
  long      Dài hạn: không cắt lỗ theo giá (xem lại khi −25%); chốt 1/3 ở giá trị hợp lý × 1,2, thêm 1/3 ở × 1,4.
  income    Cổ tức: xem lại khi −20%; bán 1/2 khi lợi suất còn 3,5%, bán hết khi còn 3%.
"""
from __future__ import annotations

import math

FEE_SELL = 0.25  # % (gồm 0,1% thuế)
NEAR_PCT = 3.0
STYLE_OF_BASKET = {"swing": "swing", "long": "long", "income": "income"}


def style_of(h: dict) -> str:
    s = h.get("style")
    if s in ("swing", "position", "long", "income"):
        return s
    return STYLE_OF_BASKET.get(h.get("basket") or "", "position")


def _ok(x) -> float | None:
    try:
        x = float(x)
        return None if math.isnan(x) or math.isinf(x) or x <= 0 else x
    except (TypeError, ValueError):
        return None


def plan(h: dict, price: float, peak: float, held: int | None, info: dict, max_sl_pct: float = 20.0) -> dict:
    """h: holding (cost, qty, style/basket, exit_custom, exits_done). info: atr, e20, e20_below2, fair, fair_hi, div_yield."""
    style = style_of(h)
    cost = float(h.get("cost") or price)
    atr = _ok(info.get("atr")) or price * 0.025
    fair, fair_hi, y = _ok(info.get("fair")), _ok(info.get("fair_hi")), _ok(info.get("div_yield"))
    be = cost / (1 - FEE_SELL / 100)
    L = []

    def add(key, kind, label, px, sell, trig, why):
        if px is not None or trig in ("time", "cond"):
            L.append({"key": key, "kind": kind, "label": label, "price": round(px, 2) if px is not None else None,
                      "sell": sell, "trig": trig, "why": why})

    if style == "swing":
        r0 = min(max(cost - 2.5 * atr, cost * 0.90), cost * 0.95)
        risk = cost - r0
        stop = max(r0, peak - 2.5 * atr)
        if peak >= cost + 1.5 * risk:
            stop = max(stop, be)
        add("stop", "stop", "Dừng lỗ" if stop < be else "Dừng – khoá lãi", stop, 1, "below",
            "2,5×ATR dưới giá vốn (5–10%), dời lên theo đỉnh; về hoà vốn khi đã lãi 1,5R")
        add("tp1", "tp", "Mục tiêu 1 (3R)", cost + 3 * risk, 2 / 3, "above", "Lãi gấp 3 lần rủi ro – chốt 2/3")
        add("tp2", "tp", "Mục tiêu 2 (4R)", cost + 4 * risk, 1, "above", "Chốt nốt phần còn lại")
        add("time", "time", "Hết 20 phiên", None, 1, "time", "Lướt sóng quá 20 phiên mà chưa tới mục tiêu 1 – bán hết, giải phóng vốn")
        L[-1]["hit"] = bool(held is not None and held >= 20)
        if _ok(info.get("e20")):
            add("ema", "cond", "Đóng cửa dưới EMA20 2 phiên", float(info["e20"]), 1, "cond", "Nhịp tăng đã gãy")
            L[-1]["hit"] = bool(info.get("e20_below2") == True)  # noqa: E712 (NaN → False)
    elif style == "long":
        add("review", "review", "Xem lại luận điểm (−25%)", cost * 0.75, 0, "below", "Dài hạn không tự cắt lỗ theo giá – đọc lại BCTC, nếu luận điểm còn nguyên có thể mua thêm")
        if fair:
            add("tp1", "tp", "Vượt giá trị hợp lý 20%", fair * 1.2, 1 / 3, "above", "Đã đắt – chốt 1/3")
            add("tp2", "tp", "Vượt giá trị hợp lý 40%", fair * 1.4, 1 / 2, "above", "Rất đắt – chốt thêm một nửa phần còn lại, giữ 1/3 tích sản")
    elif style == "income":
        add("review", "review", "Xem lại (−20%)", cost * 0.8, 0, "below", "Kiểm tra cổ tức có bị cắt không – nếu vẫn trả đều thì không bán")
        if y:
            dps = price * y / 100
            add("tp1", "tp", "Lợi suất còn 3,5%", dps / 0.035, 1 / 2, "above", f"Cổ tức {dps * 1000:,.0f} đ/cp – giá đã cao, bán một nửa".replace(",", "."))
            add("tp2", "tp", "Lợi suất còn 3%", dps / 0.03, 1, "above", "Bán hết, chuyển sang mã lợi suất cao hơn")
    else:
        hard, trail = cost * (1 - max_sl_pct / 100), peak - 3 * atr
        stop = max(hard, trail)
        add("stop", "stop", "Dừng lỗ" if stop < be else "Dừng – khoá lãi", stop, 1, "below",
            f"Lỗ tối đa {max_sl_pct:.0f}% so với giá vốn" if stop == hard else "Đỉnh sau mua − 3×ATR (dời lên theo giá)")
        if fair:
            t1 = fair * 1.10
            add("tp1", "tp", "Vượt giá trị hợp lý 10%", t1, 1 / 2, "above", "Định giá đã đắt – chốt một nửa")
            add("tp2", "tp", "Vùng giá trị cao", max(fair_hi or fair * 1.25, t1 * 1.08), 1, "above", "Chốt nốt phần còn lại")
        add("time", "review", "Xem lại sau 60 phiên", None, 0, "time", "Nắm 60 phiên mà lãi < 5% – vốn đang đứng yên")
        L[-1]["hit"] = bool(held is not None and held >= 60 and price < cost * 1.05)

    cu = h.get("exit_custom") or {}
    if _ok(cu.get("stop")):
        L = [x for x in L if x["key"] != "stop"]
        L.insert(0, {"key": "stop", "kind": "stop", "label": "Dừng lỗ của anh", "price": round(float(cu["stop"]), 2), "sell": 1, "trig": "below", "why": "Mức anh tự đặt"})
    if _ok(cu.get("tp")):
        sp = min(100.0, max(1.0, float(cu.get("tp_pct") or 50))) / 100
        L.append({"key": "tpc", "kind": "tp", "label": "Chốt lời của anh", "price": round(float(cu["tp"]), 2), "sell": sp, "trig": "above", "why": "Mức anh tự đặt"})

    done = set(h.get("exits_done") or [])
    for x in L:
        p = x.get("price")
        x["dist"] = round(100 * (p / price - 1), 1) if p else None
        if x["key"] in done:
            x["status"] = "done"
        elif x["trig"] == "below":
            x["status"] = "hit" if price <= p else ("near" if x["dist"] is not None and x["dist"] >= -NEAR_PCT else "far")
        elif x["trig"] == "above":
            x["status"] = "hit" if price >= p else ("near" if x["dist"] is not None and x["dist"] <= NEAR_PCT else "far")
        else:
            x["status"] = "hit" if x.pop("hit", False) else "far"
        x.pop("hit", None)
    if style == "swing":  # đã chạm mục tiêu 1 thì không còn hạn 20 phiên
        if any(x["key"] == "tp1" and x["status"] in ("hit", "done") for x in L):
            L = [x for x in L if x["key"] != "time"]
    # khối lượng theo thứ tự xảy ra: chốt lời từ thấp lên cao, dừng lỗ áp cho phần còn lại hiện tại
    qty = float(h.get("qty") or 0)
    rem = qty
    for x in sorted([x for x in L if x["trig"] == "above" and x["status"] != "done"], key=lambda z: z["price"]):
        q = _lot_part(rem, x["sell"])
        x["qty"], rem = q, rem - q
    for x in L:
        if "qty" not in x:
            x["qty"] = _lot_part(qty, x["sell"]) if x["status"] != "done" else 0
        if x.get("price") and x["qty"]:
            x["proceeds"] = round(x["qty"] * x["price"] * (1 - FEE_SELL / 100) * 1000)
            x["pnl"] = round((x["price"] * (1 - FEE_SELL / 100) - cost) * x["qty"] * 1000)
    stop_lv = next((x for x in L if x["key"] == "stop"), None) or next((x for x in L if x["kind"] == "review" and x.get("price")), None)
    for x in L:
        x["sell"] = round(x["sell"], 4)
    return {"style": style, "levels": L, "stop": stop_lv["price"] if stop_lv else None, "breakeven": round(be, 2)}


def _lot_part(rem: float, frac: float) -> float:
    if rem <= 0 or frac <= 0:
        return 0
    if frac >= 0.999:
        return rem
    q = math.floor(rem * frac / 100 + 1e-6) * 100
    return q if q > 0 else (min(100.0, rem) if rem >= 100 else rem)
