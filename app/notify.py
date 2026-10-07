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
    for w in pfo.get("warnings", []):
        if w not in prev.get("warnings", []):
            lines.append("⚠️ " + html.escape(w))
    state = {"light": reg["light"], "picks": cur_syms,
             "acts": {p["symbol"]: p["action"] for p in acts}, "warnings": pfo.get("warnings", [])}
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
