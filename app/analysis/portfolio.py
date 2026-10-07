"""Tư vấn cho danh mục đang nắm: Giữ / Chốt lời / Cắt lỗ / Bán vì luận điểm gãy."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import exits as ex


def _v(x, nd=2):
    return f"{x:,.{nd}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def advise(holdings: list[dict], u: pd.DataFrame, closes: dict[str, pd.Series], cfg: dict,
           regime: dict, cash_vnd: float = 0.0, capital: float | None = None) -> dict:
    risk = cfg.get("risk") or {}
    max_sl = float(risk.get("max_stop_loss_pct", 12)) / 100
    rows = []
    total_mv = cash_vnd
    for h in holdings:
        sym = str(h.get("symbol", "")).upper().strip()
        qty = float(h.get("qty") or 0)
        cost = float(h.get("cost") or 0)  # nghìn đồng
        if not sym or qty <= 0:
            continue
        c = closes.get(sym)
        price = float(c.iloc[-1]) if c is not None and len(c) else cost
        total_mv += qty * price * 1000
        rows.append({"symbol": sym, "qty": qty, "cost": cost, "price": price, "date": h.get("date"),
                     "basket": h.get("basket")})
    out = []
    hmap = {str(h.get("symbol", "")).upper().strip(): h for h in holdings}
    for r in rows:
        sym, price, cost = r["symbol"], r["price"], r["cost"]
        info = u.loc[sym] if sym in u.index else None
        c = closes.get(sym)
        since = c[c.index >= pd.Timestamp(r["date"])] if c is not None and r.get("date") else c
        peak = float(since.max()) if since is not None and len(since) else price
        held = int(len(since) - 1) if since is not None and r.get("date") and len(since) else None
        inf = {k: (info.get(k) if info is not None else None) for k in ("atr", "e20", "e20_below2", "fair", "fair_hi", "div_yield")}
        ep = ex.plan(hmap.get(sym, {}), price, peak, held, inf, max_sl * 100)
        pnl = (price / cost - 1) * 100 if cost else None
        actions, reasons = [], []
        sev = 0
        hits = [x for x in ep["levels"] if x["status"] == "hit"]
        full = [x for x in hits if x["sell"] >= 0.999 and x["kind"] in ("stop", "cond", "time", "tp")]
        part = [x for x in hits if 0 < x["sell"] < 0.999]
        rev = [x for x in hits if x["sell"] == 0]
        if full:
            x = full[0]
            actions.append("CẮT LỖ / BÁN" if x["kind"] == "stop" and x["price"] and x["price"] < cost else "BÁN HẾT")
            reasons.append(f"{x['label']}" + (f" {_v(x['price'])}" if x.get("price") else "") + f" – bán hết {_v(x['qty'], 0)} cp. {x['why']}")
            sev = 3 if x["kind"] in ("stop", "cond") else 2
        elif part:
            x = max(part, key=lambda z: z["price"] or 0)
            actions.append(f"CHỐT LỜI {round(x['sell'] * 100):.0f}%")
            reasons.append(f"{x['label']} {_v(x['price'])} – bán {_v(x['qty'], 0)} cp. {x['why']}")
            sev = 2
        for x in rev:
            actions.append("XEM LẠI LUẬN ĐIỂM")
            reasons.append(f"{x['label']} – {x['why']}")
            sev = max(sev, 1)
        if info is not None:
            thesis = []
            if pd.notna(info.get("fscore")) and info["fscore"] <= 3:
                thesis.append(f"F-Score chỉ còn {int(info['fscore'])}/9")
            if (pd.notna(info.get("ni_q_yoy")) and info["ni_q_yoy"] < -30
                    and pd.notna(info.get("ni_yoy")) and info["ni_yoy"] < -20):
                thesis.append("lợi nhuận quý và 12 tháng đều giảm mạnh")
            if pd.notna(info.get("ni_ttm")) and info["ni_ttm"] < 0:
                thesis.append("đang lỗ 12 tháng gần nhất")
            if (ep["style"] == "income" or r.get("basket") == "dividend") and pd.notna(info.get("div_yield")) and info["div_yield"] < 2:
                thesis.append("cổ tức tiền mặt đã giảm mạnh")
            if thesis:
                actions.insert(0, "BÁN – LUẬN ĐIỂM GÃY")
                reasons.insert(0, "; ".join(thesis))
                sev = 3
            if ep["style"] == "position" and info.get("trend") == "down" and pnl is not None and pnl < -5 and sev < 2:
                actions.append("CÂN NHẮC GIẢM TỶ TRỌNG")
                reasons.append("Giá trong xu hướng giảm và đang lỗ – giảm bớt 1/3 để bảo toàn vốn")
                sev = max(sev, 1)
        if not actions:
            actions.append("GIỮ")
            nxt = sorted([x for x in ep["levels"] if x["status"] in ("near", "far") and x.get("dist") is not None], key=lambda z: abs(z["dist"]))
            if nxt:
                x = nxt[0]
                reasons.append(f"Mức gần nhất: {x['label']} {_v(x['price'])} ({'+' if x['dist'] > 0 else ''}{_v(x['dist'], 1)}%)")
            else:
                reasons.append("Các tiêu chí cơ bản và định giá vẫn ổn")
        mv = r["qty"] * price * 1000
        out.append({**r, "pnl_pct": round(pnl, 1) if pnl is not None else None,
                    "pnl_vnd": round(r["qty"] * (price - cost) * 1000) if cost else None,
                    "mv_vnd": round(mv), "weight": round(100 * mv / total_mv, 1) if total_mv else None,
                    "stop": ep["stop"], "peak": round(peak, 2), "held": held, "style": ep["style"], "exit": ep,
                    "near": [x for x in ep["levels"] if x["status"] == "near"],
                    "fair": round(float(info["fair"]), 2) if info is not None and pd.notna(info.get("fair")) else None,
                    "action": actions[0], "actions": actions, "reasons": reasons, "severity": sev})
    # mẫu số tỷ trọng: tổng vốn anh nhập (nếu có), không thì cổ phiếu + tiền mặt
    stock_mv = sum(o["mv_vnd"] for o in out)
    denom = max(float(capital or 0), stock_mv + cash_vnd)
    known_total = bool(capital) or cash_vnd > 0
    for o in out:
        o["weight"] = round(100 * o["mv_vnd"] / denom, 1) if denom else None
    total_mv = denom
    out.sort(key=lambda x: -x["severity"])
    # mức sụt danh mục (ước tính theo giá lịch sử, khối lượng hiện tại)
    dd = None
    if rows:
        frames = []
        for r in rows:
            c = closes.get(r["symbol"])
            if c is not None and len(c):
                frames.append((c.iloc[-250:] * r["qty"] * 1000).rename(r["symbol"]))
        if frames:
            v = pd.concat(frames, axis=1).ffill().sum(axis=1) + cash_vnd
            dd = round(100 * (v.iloc[-1] / v.max() - 1), 1)
    sectors = {}
    for o in out:
        sec = u.loc[o["symbol"], "sector"] if o["symbol"] in u.index else "Khác"
        sectors[sec or "Khác"] = sectors.get(sec or "Khác", 0) + (o["weight"] or 0)
    warn = []
    if dd is not None and dd < -float(risk.get("max_drawdown_target", 25)):
        warn.append(f"Danh mục đang sụt {dd}% từ đỉnh 1 năm – vượt ngưỡng chịu đựng.")
    for s, w in sectors.items():
        if known_total and w > float(risk.get("max_weight_per_sector", 30)):
            warn.append(f"Ngành {s} chiếm {w:.0f}% – vượt giới hạn {risk.get('max_weight_per_sector', 30)}%.")
    stock_w = sum(o["weight"] or 0 for o in out)
    if not known_total and out:
        warn.append("Chưa nhập tổng vốn hoặc tiền mặt ở tab Danh mục nên chưa tính được tỷ trọng cổ phiếu và ngành.")
    elif stock_w > regime.get("exposure", 100) + 5:
        warn.append(f"Tỷ trọng cổ phiếu {stock_w:.0f}% cao hơn mức khuyến nghị {regime.get('exposure')}% "
                    f"theo đèn thị trường.")
    return {"positions": out, "total_vnd": round(total_mv), "drawdown_1y": dd,
            "sectors": {k: round(v, 1) for k, v in sectors.items()}, "warnings": warn}
