"""Kế hoạch thoát hàng cho từng mã đang nắm – theo đúng phong cách đã mua.

Mỗi mức: giá, bán bao nhiêu (tỷ lệ của số cổ phiếu CÒN LẠI lúc chạm mức), lý do.
Cùng công thức với hàm exitPlan() trong site/app.js (web tính lại ngay khi anh đổi phong cách / mức riêng).

  position  Trung hạn: dừng = max(giá vốn × (1 − cắt lỗ %), đỉnh sau mua − 3×ATR) → bán hết;
            chốt 1/2 khi giá ≥ giá trị hợp lý × 1,10; chốt nửa còn lại ở vùng giá trị cao; xem lại sau 60 phiên chưa lãi.
  swing     Lướt sóng: dừng ban đầu = giá vốn − 2,5×ATR (5–10%), dời theo đỉnh, về hoà vốn khi lãi 1,5R;
            chốt 2/3 ở 3R, phần còn lại ở 4R; bán hết sau 20 phiên chưa đạt 3R hoặc đóng cửa dưới EMA20 2 phiên.
  long      Dài hạn: không cắt lỗ theo giá (xem lại khi −25%); chốt 1/3 ở giá trị hợp lý × 1,2, thêm 1/3 ở × 1,4.
  income    Cổ tức: xem lại khi −20%; bán 1/2 khi lợi suất còn 3,5%, bán hết khi còn 3%.

Cổ tức tiền đã nhận được tính vào mức lỗ tối đa (lỗ trên TỔNG lợi nhuận = chênh giá + cổ tức):
  ngưỡng giá = giá vốn × (1 − x%) − cổ tức/cp đã nhận (sau thuế 5%). Ngày GDKHQ giá giảm đúng phần cổ tức nên không bị "chạm" máy móc.
Mã chưa chọn phong cách mà đạt chuẩn cổ tức (lợi suất ≥ 5%, trả tiền ≥ 3 năm) → mặc định phong cách Cổ tức.
"""
from __future__ import annotations

import math

FEE_SELL = 0.25  # % (gồm 0,1% thuế)
NEAR_PCT = 3.0
STYLE_OF_BASKET = {"swing": "swing", "long": "long", "income": "income", "dividend": "income"}
PIT = 0.05


def is_income(info: dict | None) -> bool:
    y, cy = _ok((info or {}).get("div_yield")), _ok((info or {}).get("cash_years"))
    return bool(y and y >= 5 and (cy or 0) >= 3)


def style_of(h: dict, info: dict | None = None) -> str:
    s = h.get("style")
    if s in ("swing", "position", "long", "income"):
        return s
    b = STYLE_OF_BASKET.get(h.get("basket") or "")
    return b or ("income" if is_income(info) else "position")


def div_received(h: dict) -> float:
    """Cổ tức tiền đã nhận (nghìn đồng / cổ phiếu, sau thuế TNCN) – đã ghi (h.divs) + chưa ghi (ca_pending)."""
    t = sum(float(d.get("dps") or 0) for d in (h.get("divs") or []))
    t += sum(float(e.get("v") or 0) for e in (h.get("ca_pending") or []) if e.get("k") == "c")
    return t * (1 - PIT) / 1000


def _ok(x) -> float | None:
    try:
        x = float(x)
        return None if math.isnan(x) or math.isinf(x) or x <= 0 else x
    except (TypeError, ValueError):
        return None


def plan(h: dict, price: float, peak: float, held: int | None, info: dict, max_sl_pct: float = 20.0) -> dict:
    """h: holding (cost, qty, style/basket, exit_custom, exits_done). info: atr, e20, e20_below2, fair, fair_hi, div_yield."""
    style = style_of(h, info)
    cost = float(h.get("cost") or price)
    dr = div_received(h)
    floor = lambda f: cost * (1 - f) - dr  # noqa: E731  (ngưỡng lỗ f% trên tổng lợi nhuận, đã tính cổ tức đã nhận)
    dtxt = f" – đã tính {dr * 1000:,.0f} đ/cp cổ tức đã nhận".replace(",", ".") if dr > 0 else ""
    atr = _ok(info.get("atr")) or price * 0.025
    fair, fair_hi, y = _ok(info.get("fair")), _ok(info.get("fair_hi")), _ok(info.get("div_yield"))
    be = cost / (1 - FEE_SELL / 100)
    L = []

    def add(key, kind, label, px, sell, trig, why):
        if px is not None or trig in ("time", "cond"):
            L.append({"key": key, "kind": kind, "label": label, "price": round(px, 2) if px is not None else None,
                      "sell": sell, "trig": trig, "why": why})

    if info.get("etf"):
        # quỹ ETF = cả rổ: thoát theo quy tắc đánh rổ đã kiểm chứng (đóng cửa TUẦN dưới MA200), cộng mức lỗ tối đa anh đặt
        add("stop", "stop", "Dừng lỗ tối đa", floor(max_sl_pct / 100), 1, "below", f"Lỗ tối đa {max_sl_pct:.0f}% so với giá vốn (mức anh đặt){dtxt}")
        ma = _ok(info.get("ma200"))
        if ma:
            add("ma200w", "cond", "Đóng cửa tuần dưới MA200", ma, 1, "cond",
                "Quy tắc đánh rổ đã kiểm chứng: tuần nào đóng cửa dưới MA200 thì bán, chờ một tuần đóng cửa lại trên MA200 mới mua lại")
            L[-1]["hit"] = bool(info.get("wk_below200"))
    elif style == "swing":
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
        add("review", "review", "Xem lại luận điểm (−25%)", floor(0.25), 0, "below", "Dài hạn không tự cắt lỗ theo giá – đọc lại BCTC, nếu luận điểm còn nguyên có thể mua thêm" + dtxt)
        if fair:
            add("tp1", "tp", "Vượt giá trị hợp lý 20%", fair * 1.2, 1 / 3, "above", "Đã đắt – chốt 1/3")
            add("tp2", "tp", "Vượt giá trị hợp lý 40%", fair * 1.4, 1 / 2, "above", "Rất đắt – chốt thêm một nửa phần còn lại, giữ 1/3 tích sản")
    elif style == "income":
        add("review", "review", "Xem lại (−20%)", floor(0.20), 0, "below", "Kiểm tra cổ tức có bị cắt không – nếu vẫn trả đều thì không bán. Giá giảm đúng bằng cổ tức ngày GDKHQ không phải lỗ" + dtxt)
        if y:
            dps = price * y / 100
            add("tp1", "tp", "Lợi suất còn 3,5%", dps / 0.035, 1 / 2, "above", f"Cổ tức {dps * 1000:,.0f} đ/cp – giá đã cao, bán một nửa".replace(",", "."))
            add("tp2", "tp", "Lợi suất còn 3%", dps / 0.03, 1, "above", "Bán hết, chuyển sang mã lợi suất cao hơn")
    else:
        hard, trail = floor(max_sl_pct / 100), peak - 3 * atr
        stop = max(hard, trail)
        add("stop", "stop", "Dừng lỗ" if stop < be else "Dừng – khoá lãi", stop, 1, "below",
            f"Lỗ tối đa {max_sl_pct:.0f}% so với giá vốn{dtxt}" if stop == hard else "Đỉnh sau mua − 3×ATR (dời lên theo giá; đỉnh đã điều chỉnh theo cổ tức)")
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
    return {"style": style, "levels": L, "stop": stop_lv["price"] if stop_lv else None, "breakeven": round(be, 2), "div_rcv": round(dr, 4)}


def _lot_part(rem: float, frac: float) -> float:
    if rem <= 0 or frac <= 0:
        return 0
    if frac >= 0.999:
        return rem
    q = math.floor(rem * frac / 100 + 1e-6) * 100
    return q if q > 0 else (min(100.0, rem) if rem >= 100 else rem)


# ----------------------------------------------------------------- câu chữ thông báo mức thoát (dùng chung Telegram / web / thông báo đẩy)
def _vn(x, nd=2):
    if x is None:
        return "—"
    return f"{x:,.{nd}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def act_text(sell, qty=None) -> str:
    sell = sell or 0
    if sell >= 0.999:
        return "bán hết"
    if sell <= 0:
        return "xem lại luận điểm"
    return f"bán {round(sell * 100)}%" + (f" (≈ {_vn(qty, 0)} cp)" if qty else "")


def exit_msg(sym: str, label: str, level, px, trig: str, sell, qty=None, hit: bool = False, html_b: bool = True) -> tuple[str, str, str]:
    """→ (dòng Telegram, tiêu đề ngắn, nội dung ngắn). Nói rõ ĐÃ chạm hay CHƯA, và việc cần làm là có điều kiện."""
    b = (lambda t: f"<b>{t}</b>") if html_b else (lambda t: t)
    act = act_text(sell, qty)
    below = trig != "above"
    if hit:
        line = f"• {b(sym)} ĐÃ CHẠM {label} {_vn(level)} (giá {_vn(px)}) → {b(act)} theo kế hoạch"
        return line, f"{sym} ĐÃ CHẠM {label} {_vn(level)}", f"Giá {_vn(px)} → {act} theo kế hoạch"
    d = abs(100 * (level / px - 1)) if level and px else None
    gap = f"còn {_vn(d, 1)}%" if d is not None else "gần"
    cond = f"nếu giá {'giảm về' if below else 'lên tới'} {_vn(level)} thì {act}"
    line = f"• {b(sym)} giá {_vn(px)} – cách {label.lower() if label.startswith(('Dừng', 'Chốt')) else label} {_vn(level)} {gap}, <i>chưa chạm</i> → {cond}" if html_b else \
        f"• {sym} giá {_vn(px)} – cách {label} {_vn(level)} {gap}, chưa chạm → {cond}"
    return line, f"{sym} gần {label} {_vn(level)} (chưa chạm)", f"Giá {_vn(px)}, {gap}. Chưa cần làm gì – {cond}."
