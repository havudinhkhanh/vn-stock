"""Gửi tin nhắn Telegram khi có việc cần làm."""
from __future__ import annotations

import html
import json
import logging
import os

import requests

from . import config
from .data import store

log = logging.getLogger("notify")
LIGHT = {"green": "🟢 XANH", "yellow": "🟡 VÀNG", "red": "🔴 ĐỎ"}


BASKET_VI = {"swing": "Lướt sóng", "long": "Dài hạn", "income": "Cổ tức", "garp": "GARP", "dividend": "Cổ tức", "value": "Giá trị", "defensive": "Phòng thủ",
             "growth": "Tăng trưởng"}


def _fmt(x, nd=2):
    if x is None:
        return "—"
    s = f"{x:,.{nd}f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")  # kiểu Việt Nam: 1.234,56


def compose(today: dict) -> tuple[str | None, dict]:
    prev = {}
    sp = store.path("notify_state.json")
    if sp.exists():
        prev = json.loads(sp.read_text(encoding="utf-8"))
    reg = today["regime"]
    picks = today["plan"]["picks"]
    cur_syms = sorted(p["symbol"] for p in picks)
    lines = []
    if prev.get("light") and prev["light"] != reg["light"]:
        lines.append(f"<b>Đèn thị trường đổi: {LIGHT[prev['light']]} → {LIGHT[reg['light']]}</b>\n{html.escape(reg['text'])}")
    new = [p for p in picks if p["symbol"] not in set(prev.get("picks", []))]
    if new:
        lines.append("<b>🛒 MUA MỚI</b>")
        for p in new:
            lines.append(f"• <b>{p['symbol']}</b> ({BASKET_VI.get(p.get('basket'), p.get('basket'))}) – mua {_fmt(p['zone'][0])}–{_fmt(p['zone'][1])}, "
                         f"cắt lỗ {_fmt(p['stop'])}, mục tiêu {_fmt(p['t1'])} ({p['t1_pct']:+.0f}%), "
                         f"tỷ trọng {p['weight']}%\n  <i>{html.escape(p.get('why') or '')}</i>")
    removed = [s for s in prev.get("picks", []) if s not in cur_syms]
    if removed:
        lines.append("<b>Ra khỏi danh sách mua:</b> " + ", ".join(removed) +
                     " (nếu đang nắm, xem tư vấn bên dưới)")
    pfo = today.get("portfolio") or {}
    acts = [p for p in pfo.get("positions", []) if p["severity"] >= 1]
    prev_acts = prev.get("acts", {})
    acts_new = [p for p in acts if prev_acts.get(p["symbol"]) != p["action"]]
    if acts_new:
        lines.append("<b>📌 DANH MỤC CỦA ANH</b>")
        for p in acts_new:
            lines.append(f"• <b>{p['symbol']}</b>: <b>{p['action']}</b> – giá {_fmt(p['price'])}, "
                         f"lãi/lỗ {_fmt(p['pnl_pct'], 1)}%\n  <i>{html.escape('; '.join(p['reasons']))}</i>")
    # việc đã nhắn trong lượt trong phiên hôm nay thì không nhắn lại lúc đóng cửa
    live_sent = set()
    lp = store.path("live_state.json")
    if lp.exists():
        try:
            ls = json.loads(lp.read_text(encoding="utf-8"))
            if ls.get("date") == today["date"]:
                live_sent = set(ls.get("sent") or [])
        except ValueError:
            pass
    near_prev = set(prev.get("near_sent", [])) | {k.rsplit(":", 1)[0] for k in live_sent if k.endswith((":near", ":hit"))}
    near_now = {}
    for p in pfo.get("positions", []):
        if p["severity"] >= 2:
            continue
        for x in p.get("near") or []:
            near_now[f"{p['symbol']}:{x['key']}:{x.get('price')}"] = (p, x)
    near_new = [v for k, v in near_now.items() if k not in near_prev]
    if near_new:
        lines.append("<b>⏳ SẮP CHẠM MỨC THOÁT</b>")
        for p, x in near_new:
            act = "bán hết" if x["sell"] >= 0.999 else ("xem lại" if x["sell"] == 0 else f"bán {round(x['sell'] * 100)}% (≈ {_fmt(x.get('qty'), 0)} cp)")
            lines.append(f"• <b>{p['symbol']}</b>: {html.escape(x['label'])} {_fmt(x.get('price'))} – còn {_fmt(x.get('dist'), 1)}% · {act}")
    for w in pfo.get("warnings", []):
        if w not in prev.get("warnings", []):
            lines.append("⚠️ " + html.escape(w))
    sent = set(prev.get("alerts_sent", []))
    al_new = [a for a in today.get("alerts") or [] if f"{a['id']}@{a['date']}" not in sent and a["id"] not in sent and f"alert:{a['id']}" not in live_sent]
    if al_new:
        lines.append("<b>🔔 CẢNH BÁO GIÁ</b>")
        for a in al_new:
            lines.append(f"• <b>{a['symbol']}</b>: {html.escape(a['text'])}" + (f"\n  <i>{html.escape(a['note'])}</i>" if a.get("note") else ""))
    # dòng tiền lớn với mã anh nắm / theo dõi: xả âm thầm, gom âm thầm, bứt phá có KL (chỉ nhắn khi trạng thái mới xuất hiện)
    flow_now = []
    try:
        fp = config.OUT_DIR / "flow.json"
        if fp.exists():
            FJ = json.loads(fp.read_text(encoding="utf-8"))
            mine = {p["symbol"] for p in pfo.get("positions", [])}
            try:
                from .portfolio_store import load_watchlist
                mine |= {str(w.get("symbol", "")).upper() for w in load_watchlist()}
            except Exception:  # noqa: BLE001
                pass
            E = FJ.get("events") or {}
            VI = {"dist": "XẢ âm thầm", "acc": "GOM âm thầm", "brk": "BỨT PHÁ có KL", "acc_brk": "GOM rồi BỨT PHÁ"}
            fl_prev = set(prev.get("flow_sent", []))
            fl_lines = []
            for x in FJ.get("rows") or []:
                if x["s"] not in mine:
                    continue
                for k in x.get("st") or []:
                    key = f"{x['s']}:{k}"
                    flow_now.append(key)
                    if key in fl_prev:
                        continue
                    e = E.get(k) or {}
                    hist = f" · lịch sử 20 phiên sau TB {_fmt(e.get('r20'), 1)}% so VNI" if e.get("r20") is not None else ""
                    fl_lines.append(f"• <b>{x['s']}</b>: {VI.get(k, k)} – KL {_fmt(x.get('vr'), 1)}×, giá {_fmt(x.get('pchg'), 1)}% trong 10 phiên, "
                                    f"KL tăng/giảm {_fmt(x.get('ud'), 2)}{hist}")
            if fl_lines:
                lines.append("<b>🐋 DÒNG TIỀN LỚN (mã của anh)</b>")
                lines.extend(fl_lines)
    except Exception as e:  # noqa: BLE001
        log.warning("Không đọc được dòng tiền lớn: %s", e)
    rel_now = []
    try:
        pp = config.OUT_DIR / "pairs.json"
        if pp.exists():
            PJ = json.loads(pp.read_text(encoding="utf-8"))
            held_ = {p["symbol"] for p in pfo.get("positions", [])}
            mine_ = set(held_)
            try:
                from .portfolio_store import load_watchlist
                mine_ |= {str(w.get("symbol", "")).upper() for w in load_watchlist()}
            except Exception:  # noqa: BLE001
                pass
            r_prev = set(prev.get("rel_sent", []))
            r_lines = []
            for c in PJ.get("conc") or []:
                key = f"conc:{c['a']}-{c['b']}"
                rel_now.append(key)
                if key not in r_prev:
                    r_lines.append(f"• Đang nắm <b>{c['a']}</b> + <b>{c['b']}</b>: đồng pha {_fmt(c.get('rc'), 2)}, cùng sụt ≥10%/4 tuần {_fmt(c.get('p_dd'), 0)}% số lần – coi như MỘT vị thế")
            for p in PJ.get("pairs") or []:
                f8 = (p.get("fc") or [None] * 8)[-1]
                if p["follow"] not in mine_ or f8 is None or abs(f8) < 2:
                    continue
                key = f"lead:{p['lead']}-{p['follow']}:{'+' if f8 > 0 else '-'}"
                rel_now.append(key)
                if key not in r_prev:
                    caut = " (độ tin cậy thấp)" if (p.get("fdr") or 0) > 0.2 else ""
                    r_lines.append(f"• <b>{p['lead']}</b> đi trước <b>{p['follow']}</b> {', '.join(str(g['L']) for g in p['lags'])} tuần{caut}: "
                                   f"{p['lead']} 4 tuần {_fmt(p.get('lead_4w'), 1)}% vs VNI → dự báo {p['follow']} {_fmt(f8, 1)}% trong 8 tuần")
            if r_lines:
                lines.append("<b>🔗 MÃ LIÊN QUAN (mã của anh)</b>")
                lines.extend(r_lines)
    except Exception as e:  # noqa: BLE001
        log.warning("Không đọc được mã liên quan: %s", e)
    sent_ids = list(sent | {a["id"] for a in today.get("alerts") or []})[-500:]
    state = {"light": reg["light"], "picks": cur_syms,
             "acts": {p["symbol"]: p["action"] for p in acts}, "warnings": pfo.get("warnings", []), "alerts_sent": sent_ids, "near_sent": list(near_now), "flow_sent": flow_now, "rel_sent": rel_now}
    if not lines and config.get("notify.only_when_action", True):
        return None, state
    head = (f"<b>VN-Stock {today['date']}</b> · Đèn {LIGHT[reg['light']]} · VN-Index "
            f"{_fmt(reg['index']['close'])} ({'+' if (reg['index']['chg1d'] or 0) > 0 else ''}{_fmt(reg['index']['chg1d'], 2)}%)")
    url = os.environ.get("SITE_URL")
    tail = f"\n\n<a href=\"{url}\">Mở trang web</a>" if url else ""
    if not lines:
        lines.append("Không có việc cần làm hôm nay.")
    return head + "\n\n" + "\n".join(lines) + tail, state


def send(today: dict, dry: bool = False) -> bool:
    msg, state = compose(today)
    store.path("notify_state.json").write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    if not msg:
        log.info("Telegram: không có việc cần làm, không gửi.")
        return False
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if dry or not (tok and chat) or not config.get("notify.telegram", True):
        log.info("Telegram (không gửi – chưa cài bot hoặc chạy thử):\n%s", msg)
        return False
    chunks = [msg[i:i + 3800] for i in range(0, len(msg), 3800)]
    for ch in chunks:
        r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                          json={"chat_id": chat, "text": ch, "parse_mode": "HTML",
                                "disable_web_page_preview": True}, timeout=20)
        if not r.ok:
            log.warning("Telegram lỗi: %s", r.text[:300])
            return False
    log.info("Telegram: đã gửi %d tin", len(chunks))
    return True
