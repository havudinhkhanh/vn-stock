"""Thông báo sau lượt đóng cửa.

collect() tạo danh sách việc cần báo (có cấu trúc) – dùng chung cho:
  - Telegram của chủ sở hữu (compose / send),
  - thông báo trên web, thông báo đẩy và email của từng người dùng (app/personal.py).
"""
from __future__ import annotations

import hashlib
import html
import json
import logging
import os

import requests

from . import config
from .data import store

log = logging.getLogger("notify")
LIGHT = {"green": "🟢 XANH", "yellow": "🟡 VÀNG", "red": "🔴 ĐỎ"}
LIGHT_TXT = {"green": "XANH", "yellow": "VÀNG", "red": "ĐỎ"}

BASKET_VI = {"swing": "Lướt sóng", "long": "Dài hạn", "income": "Cổ tức", "garp": "GARP", "dividend": "Cổ tức", "value": "Giá trị", "defensive": "Phòng thủ",
             "growth": "Tăng trưởng"}
GROUPS = {"light": None, "pick_new": "🛒 MUA MỚI", "pick_out": None, "act": "📌 DANH MỤC CỦA ANH", "near": "⏳ SẮP CHẠM MỨC THOÁT", "warn": None,
          "alert": "🔔 CẢNH BÁO GIÁ", "event": "⚡ CÓ SỰ KIỆN (mã của anh)", "event_ok": "🎯 SAU SỰ KIỆN – ĐIỂM VÀO (mã của anh)", "event_new": "🎯 CƠ HỘI SAU SỰ KIỆN", "flow": "🐋 DÒNG TIỀN LỚN (mã của anh)", "rel": "🔗 MÃ LIÊN QUAN (mã của anh)"}
FEATURE_OF = {"pick_new": "today", "pick_out": "today", "flow": "flow", "rel": "pairs", "event_new": "today"}
VI_FLOW = {"dist": "XẢ âm thầm", "acc": "GOM âm thầm", "brk": "BỨT PHÁ có KL", "acc_brk": "GOM rồi BỨT PHÁ"}


def _fmt(x, nd=2):
    if x is None:
        return "—"
    s = f"{x:,.{nd}f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")  # kiểu Việt Nam: 1.234,56


def _h(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:10]


def _read_json(name: str):
    p = config.OUT_DIR / name
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except ValueError:
        return None


def collect(today: dict, prev: dict, *, live_sent: set | None = None, mine: set | None = None, flowJ: dict | None = None,
            pairsJ: dict | None = None, conc: list | None = None, feats: set | None = None) -> tuple[list[dict], dict]:
    """today = phần chung của lượt chạy + phần riêng (portfolio, alerts). prev = trạng thái lần trước. feats = tính năng theo gói (None = tất cả)."""
    d = today["date"]
    live_sent = live_sent or set()
    mine = set(mine or set())
    reg = today["regime"]
    plan = today.get("plan") or {}
    picks = plan.get("picks") or []
    cur_syms = sorted(p["symbol"] for p in picks)
    items = []

    def add(kind, key, sev, tg, title, body="", sym=None, url=None):
        if feats is not None and FEATURE_OF.get(kind) and FEATURE_OF[kind] not in feats:
            return
        items.append({"kind": kind, "key": f"{d}:{key}", "sev": sev, "tg": tg, "title": title, "body": body, "sym": sym,
                      "url": url or (f"#/s/{sym}" if sym else "#/")})

    if prev.get("light") and prev["light"] != reg["light"]:
        add("light", f"light:{reg['light']}", 1, f"<b>Đèn thị trường đổi: {LIGHT[prev['light']]} → {LIGHT[reg['light']]}</b>\n{html.escape(reg['text'])}",
            f"Đèn thị trường đổi: {LIGHT_TXT[prev['light']]} → {LIGHT_TXT[reg['light']]}", reg.get("text") or "", url="#/market")
    if True:
        for p in [p for p in picks if p["symbol"] not in set(prev.get("picks", []))]:
            body = (f"Mua {_fmt(p['zone'][0])}–{_fmt(p['zone'][1])}, cắt lỗ {_fmt(p['stop'])}, mục tiêu {_fmt(p['t1'])} ({p['t1_pct']:+.0f}%), tỷ trọng {p['weight']}%. "
                    f"{p.get('why') or ''}")
            add("pick_new", f"pick:{p['symbol']}", 1,
                f"• <b>{p['symbol']}</b> ({BASKET_VI.get(p.get('basket'), p.get('basket'))}) – mua {_fmt(p['zone'][0])}–{_fmt(p['zone'][1])}, "
                f"cắt lỗ {_fmt(p['stop'])}, mục tiêu {_fmt(p['t1'])} ({p['t1_pct']:+.0f}%), tỷ trọng {p['weight']}%\n  <i>{html.escape(p.get('why') or '')}</i>",
                f"MUA MỚI {p['symbol']} ({BASKET_VI.get(p.get('basket'), p.get('basket'))})", body, sym=p["symbol"])
    removed = [s for s in prev.get("picks", []) if s not in cur_syms]
    if removed:
        add("pick_out", f"out:{','.join(removed)}", 1, "<b>Ra khỏi danh sách mua:</b> " + ", ".join(removed) + " (nếu đang nắm, xem tư vấn bên dưới)",
            "Ra khỏi danh sách mua: " + ", ".join(removed), "Nếu đang nắm, xem tư vấn trong Danh mục.", url="#/")
    pfo = today.get("portfolio") or {}
    acts = [p for p in pfo.get("positions", []) if p["severity"] >= 1]
    prev_acts = prev.get("acts", {})
    for p in [p for p in acts if prev_acts.get(p["symbol"]) != p["action"]]:
        add("act", f"act:{p['symbol']}:{p['action']}", min(3, int(p["severity"]) + 1),
            f"• <b>{p['symbol']}</b>: <b>{p['action']}</b> – giá {_fmt(p['price'])}, lãi/lỗ {_fmt(p['pnl_pct'], 1)}%\n  <i>{html.escape('; '.join(p['reasons']))}</i>",
            f"{p['symbol']}: {p['action']}", f"Giá {_fmt(p['price'])}, lãi/lỗ {_fmt(p['pnl_pct'], 1)}%. " + "; ".join(p["reasons"]), sym=p["symbol"], url="#/portfolio")
    near_prev = set(prev.get("near_sent", [])) | {k.rsplit(":", 1)[0] for k in live_sent if k.endswith((":near", ":hit"))}
    near_now = {}
    for p in pfo.get("positions", []):
        if p["severity"] >= 2:
            continue
        for x in p.get("near") or []:
            near_now[f"{p['symbol']}:{x['key']}:{x.get('price')}"] = (p, x)
    for k, (p, x) in near_now.items():
        if k in near_prev:
            continue
        act = "bán hết" if x["sell"] >= 0.999 else ("xem lại" if x["sell"] == 0 else f"bán {round(x['sell'] * 100)}% (≈ {_fmt(x.get('qty'), 0)} cp)")
        add("near", f"near:{k}", 2, f"• <b>{p['symbol']}</b>: {html.escape(x['label'])} {_fmt(x.get('price'))} – còn {_fmt(x.get('dist'), 1)}% · {act}",
            f"{p['symbol']} sắp chạm {x['label']} {_fmt(x.get('price'))}", f"Còn {_fmt(x.get('dist'), 1)}% · {act}", sym=p["symbol"], url="#/portfolio")
    for w in pfo.get("warnings", []):
        if w not in prev.get("warnings", []):
            add("warn", f"warn:{_h(w)}", 1, "⚠️ " + html.escape(w), "Cảnh báo danh mục", w, url="#/portfolio")
    sent = set(prev.get("alerts_sent", []))
    for a in today.get("alerts") or []:
        if f"{a['id']}@{a['date']}" in sent or a["id"] in sent or f"alert:{a['id']}" in live_sent:
            continue
        add("alert", f"alert:{a['id']}", 2, f"• <b>{a['symbol']}</b>: {html.escape(a['text'])}" + (f"\n  <i>{html.escape(a['note'])}</i>" if a.get("note") else ""),
            f"Cảnh báo giá {a['symbol']}", a["text"] + (f" · {a['note']}" if a.get("note") else ""), sym=a["symbol"])
    mine |= {p["symbol"] for p in pfo.get("positions", [])}
    flow_now = []
    if flowJ:
        E = flowJ.get("events") or {}
        fl_prev = set(prev.get("flow_sent", []))
        for x in flowJ.get("rows") or []:
            if x["s"] not in mine:
                continue
            for k in x.get("st") or []:
                key = f"{x['s']}:{k}"
                flow_now.append(key)
                if key in fl_prev:
                    continue
                e = E.get(k) or {}
                hist = f" · lịch sử 20 phiên sau TB {_fmt(e.get('r20'), 1)}% so VNI" if e.get("r20") is not None else ""
                txt = f"KL {_fmt(x.get('vr'), 1)}×, giá {_fmt(x.get('pchg'), 1)}% trong 10 phiên, KL tăng/giảm {_fmt(x.get('ud'), 2)}{hist}"
                add("flow", f"flow:{key}", 2 if k == "dist" else 1, f"• <b>{x['s']}</b>: {VI_FLOW.get(k, k)} – {txt}", f"{x['s']}: {VI_FLOW.get(k, k)}", txt, sym=x["s"])
    rel_now = []
    r_prev = set(prev.get("rel_sent", []))
    for c in conc or []:
        key = f"conc:{c['a']}-{c['b']}"
        rel_now.append(key)
        if key not in r_prev:
            txt = f"đồng pha {_fmt(c.get('rc'), 2)}, cùng sụt ≥10%/4 tuần {_fmt(c.get('p_dd'), 0)}% số lần – coi như MỘT vị thế"
            add("rel", key, 1, f"• Đang nắm <b>{c['a']}</b> + <b>{c['b']}</b>: {txt}", f"Đang nắm {c['a']} + {c['b']} đồng pha", txt, sym=c["a"])
    for p in (pairsJ or {}).get("pairs") or []:
        f8 = (p.get("fc") or [None] * 8)[-1]
        if p["follow"] not in mine or f8 is None or abs(f8) < 2:
            continue
        key = f"lead:{p['lead']}-{p['follow']}:{'+' if f8 > 0 else '-'}"
        rel_now.append(key)
        if key not in r_prev:
            caut = " (độ tin cậy thấp)" if (p.get("fdr") or 0) > 0.2 else ""
            txt = (f"{p['lead']} đi trước {p['follow']} {', '.join(str(g['L']) for g in p['lags'])} tuần{caut}: {p['lead']} 4 tuần {_fmt(p.get('lead_4w'), 1)}% vs VNI "
                   f"→ dự báo {p['follow']} {_fmt(f8, 1)}% trong 8 tuần")
            add("rel", key, 1, f"• <b>{p['lead']}</b> → <b>{p['follow']}</b>: {html.escape(txt)}",
                f"{p['lead']} đi trước {p['follow']}", txt, sym=p["follow"])
    # mã có sự kiện / đã qua giai đoạn nguội (vùng vào sau sự kiện)
    ev_prev, pe_prev = set(prev.get("ev_sent", [])), set(prev.get("pe_sent", []))
    ev_now = [x["symbol"] for x in today.get("event_active") or []]
    pe_now = [x["symbol"] for x in today.get("post_event") or []]
    for x in today.get("event_active") or []:
        if x["symbol"] in mine and x["symbol"] not in ev_prev:
            txt = (f"Giá thấp hơn đỉnh trước sự kiện {abs(x.get('dd_now') or 0):.0f}%, {x.get('n_down')} phiên giảm sàn từ {x['start']}. "
                   "Lịch sử VN: mua ngay hoặc mua nhịp hồi sớm thường thua thị trường; chờ đủ 120 phiên và 60 phiên không giảm sàn.")
            add("event", f"event:{x['symbol']}:{x['start']}", 2, f"• <b>{x['symbol']}</b>: CÓ SỰ KIỆN – {html.escape(txt)}", f"{x['symbol']}: có sự kiện – chưa vào", txt, sym=x["symbol"])
    for x in today.get("post_event") or []:
        if x["symbol"] in pe_prev:
            continue
        mine_x = x["symbol"] in mine
        if not mine_x and not x.get("quality"):
            continue
        txt = (f"Sự kiện từ {x['start']} đã nguội ({x['since']} phiên, {x['quiet']} phiên không giảm sàn). Vùng vào {_fmt(x['zone'][0])}–{_fmt(x['zone'][1])}, "
               f"cắt lỗ {_fmt(x['stop'])}, mục tiêu {_fmt(x['t1'])}. {x.get('edge', '')}")
        kind = "event_ok" if mine_x else "event_new"
        add(kind, f"pe:{x['symbol']}:{x['start']}", 2 if (mine_x and x.get("quality")) else 1,
            f"• <b>{x['symbol']}</b>: SAU SỰ KIỆN – {html.escape(txt)}", f"{x['symbol']}: điểm vào sau sự kiện", txt, sym=x["symbol"])
    sent_ids = list(sent | {a["id"] for a in today.get("alerts") or []})[-500:]
    state = {"light": reg["light"], "picks": cur_syms if (feats is None or "today" in feats) else prev.get("picks", []),
             "acts": {p["symbol"]: p["action"] for p in acts}, "warnings": pfo.get("warnings", []), "alerts_sent": sent_ids,
             "near_sent": list(near_now), "flow_sent": flow_now, "rel_sent": rel_now, "ev_sent": ev_now, "pe_sent": pe_now}
    return items, state


def format_telegram(today: dict, items: list[dict]) -> str | None:
    reg = today["regime"]
    lines, seen = [], set()
    order = ["light", "pick_new", "pick_out", "act", "near", "warn", "alert", "event", "event_ok", "event_new", "flow", "rel"]
    for k in order:
        grp = [x for x in items if x["kind"] == k]
        if not grp:
            continue
        if GROUPS.get(k) and k not in seen:
            lines.append(f"<b>{GROUPS[k]}</b>")
            seen.add(k)
        lines.extend(x["tg"] for x in grp)
    if not lines and config.get("notify.only_when_action", True):
        return None
    head = (f"<b>VN-Stock {today['date']}</b> · Đèn {LIGHT[reg['light']]} · VN-Index "
            f"{_fmt(reg['index']['close'])} ({'+' if (reg['index']['chg1d'] or 0) > 0 else ''}{_fmt(reg['index']['chg1d'], 2)}%)")
    url = os.environ.get("SITE_URL")
    tail = f"\n\n<a href=\"{url}\">Mở trang web</a>" if url else ""
    if not lines:
        lines.append("Không có việc cần làm hôm nay.")
    return head + "\n\n" + "\n".join(lines) + tail


def compose(today: dict, watch_syms: set | None = None) -> tuple[str | None, dict]:
    """Tin Telegram cho chủ sở hữu. today = phần chung + phần riêng của chủ sở hữu."""
    prev = {}
    sp = store.path("notify_state.json")
    if sp.exists():
        prev = json.loads(sp.read_text(encoding="utf-8"))
    live_sent = set()
    lp = store.path("live_state.json")
    if lp.exists():
        try:
            ls = json.loads(lp.read_text(encoding="utf-8"))
            if ls.get("date") == today["date"]:
                live_sent = set(ls.get("sent") or [])
        except ValueError:
            pass
    if watch_syms is None:
        try:
            from .portfolio_store import load_watchlist
            watch_syms = {str(w.get("symbol", "")).upper() for w in load_watchlist()}
        except Exception:  # noqa: BLE001
            watch_syms = set()
    items, state = collect(today, prev, live_sent=live_sent, mine=watch_syms, flowJ=_read_json("flow.json"), pairsJ=_read_json("pairs.json"),
                           conc=((today.get("rel") or {}).get("conc")))
    return format_telegram(today, items), state


def send(today: dict, dry: bool = False, watch_syms: set | None = None) -> bool:
    msg, state = compose(today, watch_syms)
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


def send_weekly(W: dict, dry: bool = False) -> bool:
    """Báo cáo tuần (chế độ một người dùng) qua Telegram – bản đầy đủ ở #/report."""
    if not W:
        return False
    e = html.escape
    f = lambda x, nd=1: "—" if x is None else (("+" if x > 0 else "") + f"{x:,.{nd}f}".replace(",", "X").replace(".", ",").replace("X", "."))  # noqa: E731
    M, P, PL = W["market"], W["pf"], W["plan"]
    L = {"green": "🟢 Xanh", "yellow": "🟡 Vàng", "red": "🔴 Đỏ"}
    lines = [f"<b>📊 Báo cáo tuần {e(W['from'][8:10])}/{e(W['from'][5:7])} – {e(W['to'][8:10])}/{e(W['to'][5:7])}</b>",
             f"VN-Index {f(M.get('vni_chg'), 2)}% trong tuần · đèn {L.get(M.get('light'), '—')}",
             f"Danh mục: lãi/lỗ tuần {f((P.get('wk_pnl') or 0) / 1e6, 1)} tr ({f(P.get('wk_ret'), 2)}%) · cổ phiếu {f(P.get('exp'), 0).lstrip('+')}% (cho phép ≈ {P.get('target')}%)",
             "", f"<b>{e(PL['head'])}</b>"]
    lines += [f"• BÁN {e(x['s'])} – {e(x['action'] or '')}" for x in PL["sells"]]
    lines += [f"• MUA {e(x['s'])} vùng {x['zone'][0]}–{x['zone'][1]}, cắt lỗ {x['stop']}" for x in PL["picks"] if x.get("zone")]
    lines += [f"• Chờ {e(x['s'])} về {x['zone'][0]}–{x['zone'][1]}" for x in PL["waits"][:4] if x.get("zone")]
    if W.get("risks"):
        lines += ["", "<b>Rủi ro</b>"] + [f"• {e(r)}" for r in W["risks"][:5]]
    site = os.environ.get("SITE_URL") or ""
    if site:
        lines += ["", f"Bản đầy đủ / in PDF: {site.rstrip('/')}/#/report"]
    msg = "\n".join(lines)
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if dry or not (tok and chat) or not config.get("notify.telegram", True):
        log.info("Telegram báo cáo tuần (không gửi):\n%s", msg)
        return False
    r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage", json={"chat_id": chat, "text": msg[:3900], "parse_mode": "HTML",
                                                                              "disable_web_page_preview": True}, timeout=20)
    if not r.ok:
        log.warning("Telegram báo cáo tuần lỗi: %s", r.text[:300])
    return r.ok
