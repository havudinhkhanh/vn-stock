"""Lượt chạy TRONG PHIÊN (11:35 và 14:35): giá trực tiếp, cảnh báo, Telegram, dữ liệu cho web.

Chạy nhanh (≈ 1 phút): không tải lại BCTC, không tính lại toàn bộ – dùng bối cảnh đã tính ở lượt đóng cửa
gần nhất (data/live_ctx.json: mức thoát hàng, danh sách mua, hồ sơ hành vi giá từng mã) + bảng giá hiện tại.

Cảnh báo:
  - mã anh nắm: chạm / sắp chạm mức thoát (dừng lỗ, chốt lời) tính theo giá cao/thấp TRONG PHIÊN;
  - cảnh báo giá anh đặt (≤, ≥, biến động %);
  - mã trong danh sách mua: đang trong vùng mua / đã vượt giá không nên mua đuổi;
  - hành vi bất thường: đẩy sáng (kèm xác suất chiều xả theo lịch sử của chính mã), xả từ đỉnh phiên, kéo từ đáy,
    chạm trần rồi rời, chạm sàn rồi kéo, KL bất thường so với cùng thời điểm các phiên trước, khối ngoại bán/mua ròng lớn.
"""
from __future__ import annotations

import html
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
import requests

from . import config
from .data import intraday as itd
from .data import store, vci
from .data.http import FetchError

log = logging.getLogger("live")
VN = ZoneInfo("Asia/Ho_Chi_Minh")
B_END = [9 * 60 + 30, 10 * 60, 10 * 60 + 30, 11 * 60, 11 * 60 + 30, 13 * 60 + 30, 14 * 60, 14 * 60 + 30, 14 * 60 + 45]
B_START = [9 * 60, 9 * 60 + 30, 10 * 60, 10 * 60 + 30, 11 * 60, 13 * 60, 13 * 60 + 30, 14 * 60, 14 * 60 + 30]


def _f(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _v(x, nd=2):
    if x is None:
        return "—"
    s = f"{x:,.{nd}f}"
    return s.replace(",", "_").replace(".", ",").replace("_", ".")


def cum_frac(minute: int, vshare: list | None) -> float:
    """Tỷ lệ khối lượng của cả phiên thường đã khớp tới thời điểm này (theo nhịp khối lượng trung bình)."""
    vs = [x if isinstance(x, (int, float)) else None for x in (vshare or [])]
    if len(vs) != 9 or any(v is None for v in vs):
        vs = [16, 11, 9, 8, 6, 9, 8, 9, 24]   # nhịp điển hình HOSE nếu chưa đủ lịch sử
    tot = sum(vs) or 1
    acc = 0.0
    for i in range(9):
        a, b = B_START[i], B_END[i]
        if minute >= b:
            acc += vs[i]
        elif minute > a:
            acc += vs[i] * (minute - a) / (b - a)
    return max(acc / tot, 0.03)


def _kv_put(key: str, obj) -> bool:
    acc, tok, ns = os.environ.get("CF_ACCOUNT_ID"), os.environ.get("CF_API_TOKEN"), os.environ.get("CF_KV_NAMESPACE_ID")
    if not (acc and tok and ns):
        return False
    url = f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{key}"
    try:
        r = requests.put(url, headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
                         data=json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"), timeout=30)
        return r.ok
    except Exception as e:  # noqa: BLE001
        log.warning("Không ghi được KV %s: %s", key, e)
        return False


def run(notify: bool = True, slot: str | None = None) -> dict:
    now = datetime.now(tz=VN).replace(tzinfo=None)
    minute = now.hour * 60 + now.minute
    slot = slot or ("noon" if minute < 14 * 60 + 30 else "atc" if minute < 14 * 60 + 46 else "after")
    cp = store.path("live_ctx.json")
    if not cp.exists():
        log.warning("Chưa có bối cảnh từ lượt đóng cửa (live_ctx.json) – bỏ qua lượt trong phiên")
        return {"ok": False}
    ctx = json.loads(cp.read_text(encoding="utf-8"))
    S = ctx.get("syms") or {}
    from .portfolio_store import load_holdings, load_watchlist
    holdings, _, _ = load_holdings()
    watch = load_watchlist()
    held = {h["symbol"].upper(): h for h in holdings}
    wl = {w["symbol"].upper(): w for w in watch}
    act = ctx.get("active_style") or "position"
    picks = {p["symbol"]: p for p in ctx.get("picks") or [] if p.get("style") == act}
    universe = list(dict.fromkeys(list(held) + list(wl) + list(picks) + list(S)))
    try:
        bd = itd.board(universe)
    except FetchError as e:
        log.error("Không lấy được bảng giá: %s", e)
        return {"ok": False}
    if bd.empty:
        return {"ok": False}
    today = now.strftime("%Y-%m-%d")
    traded = bd[(bd["vol"] > 0) & (bd["date"].astype(str) == today)]
    if len(traded) < max(20, 0.2 * len(bd)):
        log.info("Hôm nay không có giao dịch (nghỉ lễ?) – bỏ qua lượt trong phiên")
        return {"ok": False, "holiday": True}
    bd = bd.set_index("symbol")
    # chỉ số
    idx = {}
    try:
        got = vci.prices(["VNINDEX", "VN30"], now - timedelta(days=7))
        for k, df in got.items():
            if len(df) >= 2 and str(df["date"].iloc[-1].date()) == today:
                idx[k] = {"close": _f(df["close"].iloc[-1]), "chg": _f(100 * (df["close"].iloc[-1] / df["close"].iloc[-2] - 1))}
    except Exception as e:  # noqa: BLE001
        log.warning("Chỉ số: %s", e)
    mk = ctx.get("mkt") or {}

    # ---- chỉ số từng mã
    rows = {}
    for s, b in bd.iterrows():
        ref, px = b.get("ref"), b.get("price") or None
        if not ref or not px:
            continue
        c = S.get(s) or {}
        typ = (c.get("typ") or 2.5) / 100
        hi, lo = (b.get("high") or px), (b.get("low") or px)
        frac = cum_frac(minute if slot != "after" else 14 * 60 + 45, c.get("vshare") or mk.get("vshare"))
        vavg = c.get("vavg")
        pace = (b["vol"] / (vavg * frac)) if vavg else None
        r = {"s": s, "px": _f(px), "ref": _f(ref), "chg": _f(100 * (px / ref - 1)), "hi": _f(100 * (hi / ref - 1)), "lo": _f(100 * (lo / ref - 1)),
             "fh": _f(100 * (px / hi - 1)), "fl": _f(100 * (px / lo - 1)), "pace": _f(pace, 1), "val": _f(b.get("value_bn"), 1),
             "fn": _f(b.get("f_net_bn"), 1), "ceil": _f(b.get("ceil")), "floor": _f(b.get("floor")), "typ": _f(100 * typ, 1),
             "flags": []}
        F = r["flags"]
        chg, hip, lop = px / ref - 1, hi / ref - 1, lo / ref - 1
        big = max(0.02, 0.7 * typ)
        if b.get("ceil") and hi >= b["ceil"] - 1e-6 and px < b["ceil"] * 0.985:
            F.append("leave_c")
        elif b.get("ceil") and px >= b["ceil"] - 1e-6:
            F.append("at_ceil")
        if b.get("floor") and lo <= b["floor"] + 1e-6 and px > b["floor"] * 1.015:
            F.append("rec_f")
        elif b.get("floor") and px <= b["floor"] + 1e-6:
            F.append("at_floor")
        if hip >= big and (px - hi) / ref <= -max(0.02, 0.6 * typ) and "leave_c" not in F:
            F.append("fade_hi")
        if lop <= -big and (px - lo) / ref >= max(0.02, 0.6 * typ) and "rec_f" not in F:
            F.append("bounce_lo")
        if slot == "noon" and chg >= max(0.015, 0.6 * typ) and (c.get("p_fade") or 0) >= 55 and (c.get("n_up") or 0) >= 10:
            F.append("pump_am")
        if slot == "noon" and chg <= -max(0.015, 0.6 * typ) and (c.get("p_bounce") or 0) >= 55 and (c.get("n_dn") or 0) >= 10:
            F.append("dump_am")
        if pace and pace >= 2.5 and (b.get("value_bn") or 0) >= 3:
            F.append("vol")
        fnet, val = b.get("f_net_bn") or 0, b.get("value_bn") or 0
        if fnet <= -max(10, 0.25 * val) and val > 0:
            F.append("f_sell")
        elif fnet >= max(10, 0.25 * val) and val > 0:
            F.append("f_buy")
        rows[s] = r

    # ---- nến phút cho nhóm cần xem kỹ: sáng / chiều, đường đi trong phiên
    lb = int(config.get("intraday.live_bars", 90))
    movers = sorted([s for s in rows if s in S], key=lambda s: -(len(rows[s]["flags"]) * 10 + abs(rows[s]["chg"] or 0) + (rows[s]["pace"] or 0)))
    want = list(dict.fromkeys([s for s in list(held) + list(wl) + list(picks) if s in rows] + movers))[:lb]

    def one(s):
        try:
            return s, itd.bars(s, "ONE_MINUTE", 300)
        except FetchError:
            return s, None
    with ThreadPoolExecutor(max_workers=3) as ex:
        for s, df in ex.map(one, want):
            if df is None or df.empty:
                continue
            d = df[df["time"].dt.strftime("%Y-%m-%d") == today]
            if d.empty:
                continue
            ref = rows[s]["ref"]
            mm = d["time"].dt.hour * 60 + d["time"].dt.minute
            m, a = d[mm < 11 * 60 + 30], d[(mm >= 13 * 60) & (mm < 14 * 60 + 30)]
            r = rows[s]
            if not m.empty:
                r["m_ret"] = _f(100 * (m["c"].iloc[-1] / ref - 1))
            if not a.empty and not m.empty:
                r["a_ret"] = _f(100 * (a["c"].iloc[-1] / m["c"].iloc[-1] - 1))
            # đường đi theo khung 30 phút (để vẽ cạnh đường trung bình lịch sử)
            bk = itd.buckets(d)
            r["path"] = [_f(100 * (x / ref - 1)) for x in bk.sort_values("b")["c"]]
            r["hi_t"] = d["time"].iloc[int(d["h"].values.argmax())].strftime("%H:%M")
            r["lo_t"] = d["time"].iloc[int(d["l"].values.argmin())].strftime("%H:%M")
            c = S.get(s) or {}
            if slot == "atc" and r.get("m_ret") is not None and r.get("a_ret") is not None:
                if r["m_ret"] >= 2 and r["a_ret"] <= -1.5:
                    r["flags"].append("fade_pm")
                if r["m_ret"] <= -2 and r["a_ret"] >= 1.5:
                    r["flags"].append("bounce_pm")
            if slot == "noon" and r.get("m_ret") is not None and "pump_am" not in r["flags"] and r["m_ret"] >= 1.5 and (c.get("p_fade") or 0) >= 55 and (c.get("n_up") or 0) >= 10:
                r["flags"].append("pump_am")

    # ---- việc của anh
    personal = []
    for s, h in held.items():
        r = rows.get(s)
        if not r:
            continue
        hx = (ctx.get("holdings") or {}).get(s) or {}
        hi_px, lo_px, px = r["ref"] * (1 + (r["hi"] or 0) / 100), r["ref"] * (1 + (r["lo"] or 0) / 100), r["px"]
        for L in hx.get("levels") or []:
            p = L.get("price")
            if p is None or L.get("done"):
                continue
            if L.get("trig") == "below":
                hit, dist = lo_px <= p, 100 * (px / p - 1)
            elif L.get("trig") == "above":
                hit, dist = hi_px >= p, 100 * (p / px - 1)
            else:
                continue
            if hit or 0 <= dist <= 3:
                qty = float(h.get("qty") or 0)
                personal.append({"kind": "exit", "symbol": s, "key": f"{s}:{L['key']}:{p}", "hit": bool(hit), "label": L.get("label"), "price": p,
                                 "sell": L.get("sell"), "qty": int(round(qty * (L.get("sell") or 0) / 100) * 100) if L.get("sell") else 0,
                                 "dist": _f(dist, 1), "px": px})
        if r["flags"]:
            personal.append({"kind": "flag", "symbol": s, "key": f"{s}:flags:{','.join(sorted(r['flags']))}", "flags": r["flags"], "px": px, "held": True})
    for s, w in wl.items():
        r = rows.get(s)
        if not r:
            continue
        hi_px, lo_px = r["ref"] * (1 + (r["hi"] or 0) / 100), r["ref"] * (1 + (r["lo"] or 0) / 100)
        for a in w.get("alerts") or []:
            if not a.get("active", True):
                continue
            try:
                v = float(a.get("value")) if a.get("value") not in (None, "") else None
            except (TypeError, ValueError):
                v = None
            typ_, txt = a.get("type"), None
            if typ_ == "below" and v and lo_px <= v:
                txt = f"giá chạm/giảm dưới {_v(v)} (thấp nhất {_v(lo_px)}, hiện {_v(r['px'])})"
            elif typ_ == "above" and v and hi_px >= v:
                txt = f"giá chạm/vượt {_v(v)} (cao nhất {_v(hi_px)}, hiện {_v(r['px'])})"
            elif typ_ == "pct" and v and abs(r["chg"] or 0) >= v:
                txt = f"biến động {r['chg']:+.1f}% trong phiên"
            if txt:
                personal.append({"kind": "alert", "symbol": s, "key": "alert:" + str(a.get("id") or f"{s}-{typ_}-{a.get('value')}"), "text": txt,
                                 "note": a.get("note") or w.get("note") or ""})
        if r["flags"] and s not in held:
            personal.append({"kind": "flag", "symbol": s, "key": f"{s}:flags:{','.join(sorted(r['flags']))}", "flags": r["flags"], "px": r["px"], "held": False})
    for s, p in picks.items():
        r = rows.get(s)
        if not r or not p.get("zone"):
            continue
        z0, z1 = p["zone"]
        chase = p.get("chase") or z1 * 1.02
        if z0 <= r["px"] <= z1:
            personal.append({"kind": "pick_in", "symbol": s, "key": f"{s}:pick_in", "px": r["px"], "zone": [z0, z1], "stop": p.get("stop"), "style": p.get("style")})
        elif r["px"] > chase:
            personal.append({"kind": "pick_chase", "symbol": s, "key": f"{s}:pick_chase", "px": r["px"], "zone": [z0, z1], "chase": chase})

    # ---- cảnh báo hành vi bất thường toàn thị trường (mã thanh khoản)
    sev = {"leave_c": 3, "fade_pm": 3, "fade_hi": 2, "pump_am": 2, "vol": 2, "f_sell": 1, "rec_f": 2, "bounce_pm": 2, "bounce_lo": 1,
           "dump_am": 1, "f_buy": 1, "at_ceil": 0, "at_floor": 0}
    mkt = []
    for s, r in rows.items():
        c = S.get(s)
        if not c or (c.get("val") or 0) < 5:
            continue
        sc = max([sev.get(f, 0) for f in r["flags"]] or [0])
        if sc >= 2:
            mkt.append({"s": s, "sev": sc, "flags": r["flags"], "score": c.get("score"), "tags": c.get("tags")})
    mkt.sort(key=lambda x: (-x["sev"], -(x.get("score") or 0)))

    out = {"ok": True, "at": now.isoformat(timespec="minutes"), "date": today, "slot": slot, "minute": minute, "index": idx,
           "rows": [rows[s] for s in sorted(rows)], "personal": personal, "market": mkt[:40],
           "ctx_date": ctx.get("date"), "n": len(rows)}
    ok_kv = _kv_put("intraday", out)
    log.info("Trong phiên %s: %d mã, %d việc của anh, %d mã bất thường, KV=%s", slot, len(rows), len(personal), len(mkt), ok_kv)
    try:
        snap = pd.DataFrame([{"symbol": r["s"], "date": pd.Timestamp(today), "slot": slot, "px": r["px"], "chg": r["chg"], "hi": r["hi"], "lo": r["lo"],
                              "pace": r["pace"], "val": r["val"], "fn": r["fn"], "m_ret": r.get("m_ret"), "a_ret": r.get("a_ret"),
                              "flags": ",".join(r["flags"])} for r in rows.values()])
        store.upsert("live_snap", snap, ["symbol", "date", "slot"])
    except Exception as e:  # noqa: BLE001
        log.warning("Không lưu được ảnh chụp trong phiên: %s", e)
    store.path("live_last.json").write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")
    if notify:
        send(out, ctx, held)
    return out


FLAG_VI = {
    "leave_c": "chạm trần rồi rời", "at_ceil": "đang trần", "rec_f": "chạm sàn rồi được kéo", "at_floor": "đang sàn",
    "fade_hi": "bị xả từ đỉnh phiên", "bounce_lo": "được kéo từ đáy phiên", "pump_am": "sáng tăng mạnh – mã hay bị xả buổi chiều",
    "dump_am": "sáng giảm mạnh – mã hay được kéo buổi chiều", "fade_pm": "sáng đẩy, chiều xả", "bounce_pm": "sáng đạp, chiều kéo",
    "vol": "KL bất thường so với cùng giờ", "f_sell": "khối ngoại bán ròng mạnh", "f_buy": "khối ngoại mua ròng mạnh",
}


def flag_text(s: str, r: dict, c: dict) -> str:
    parts = []
    for f in r.get("flags") or []:
        t = FLAG_VI.get(f, f)
        if f == "pump_am" and c.get("p_fade") is not None:
            t += f" ({_v(c['p_fade'], 0)}% số lần chiều giảm lại, TB chiều {_v(c.get('a_after_up'), 1)}%)"
        if f == "dump_am" and c.get("p_bounce") is not None:
            t += f" ({_v(c['p_bounce'], 0)}% số lần chiều hồi, TB chiều {_v(c.get('a_after_dn'), 1)}%)"
        if f == "vol" and r.get("pace"):
            t += f" (gấp {_v(r['pace'], 1)} lần)"
        if f in ("f_sell", "f_buy") and r.get("fn") is not None:
            t += f" ({_v(r['fn'], 1)} tỷ)"
        if f == "fade_hi":
            t += f" (cao nhất {_v(r.get('hi'), 1)}%, giờ {_v(r.get('chg'), 1)}%)"
        parts.append(t)
    return "; ".join(parts)


ADVICE = {
    "pump_am": "đừng mua đuổi; đang lãi có thể chốt bớt ở giá cao",
    "fade_hi": "đang nắm: giữ kỷ luật điểm dừng; chưa nắm: không bắt",
    "leave_c": "lực bán chờ sẵn ở trần – không mua đuổi",
    "fade_pm": "người đẩy giá có thể đã thoát – không mua thêm hôm nay",
    "dump_am": "đừng bán tháo theo đám đông, chờ chiều",
    "rec_f": "có lực đỡ giá thấp – không bán sàn",
    "vol": "có thể có thông tin – kiểm tra tin trước khi đặt lệnh",
    "f_sell": "theo dõi; khối ngoại bán ròng kéo dài thường gây áp lực",
}


def send(out: dict, ctx: dict, held: dict) -> bool:
    sp = store.path("live_state.json")
    st = json.loads(sp.read_text(encoding="utf-8")) if sp.exists() else {}
    if st.get("date") != out["date"]:
        st = {"date": out["date"], "sent": []}
    sent = set(st.get("sent") or [])
    S = ctx.get("syms") or {}
    rows = {r["s"]: r for r in out["rows"]}
    lines = []
    ex_new = [p for p in out["personal"] if p["kind"] == "exit" and p["key"] + (":hit" if p["hit"] else ":near") not in sent]
    if ex_new:
        lines.append("<b>📌 DANH MỤC – MỨC THOÁT</b>")
        for p in ex_new:
            act = "bán hết" if (p.get("sell") or 0) >= 0.999 else ("xem lại luận điểm" if not p.get("sell") else f"bán {round(p['sell'] * 100)}% (≈ {_v(p['qty'], 0)} cp)")
            if p["hit"]:
                lines.append(f"• <b>{p['symbol']}</b> ĐÃ CHẠM {html.escape(p['label'] or '')} {_v(p['price'])} – giá {_v(p['px'])} → <b>{act}</b>")
            else:
                lines.append(f"• <b>{p['symbol']}</b> còn {_v(p['dist'], 1)}% tới {html.escape(p['label'] or '')} {_v(p['price'])} – giá {_v(p['px'])} · {act}")
    fl = [p for p in out["personal"] if p["kind"] == "flag" and p["key"] not in sent]
    if fl:
        lines.append("<b>👀 MÃ CỦA ANH – BIẾN ĐỘNG</b>")
        for p in fl:
            r = rows.get(p["symbol"], {})
            adv = "; ".join(dict.fromkeys(ADVICE[f] for f in p["flags"] if f in ADVICE))
            lines.append(f"• <b>{p['symbol']}</b>{'' if p['held'] else ' (theo dõi)'} {_v(r.get('px'))} ({_v(r.get('chg'), 1)}%): "
                         f"{html.escape(flag_text(p['symbol'], r, S.get(p['symbol']) or {}))}" + (f"\n  <i>{html.escape(adv)}</i>" if adv else ""))
    al = [p for p in out["personal"] if p["kind"] == "alert" and p["key"] not in sent]
    if al:
        lines.append("<b>🔔 CẢNH BÁO GIÁ</b>")
        for p in al:
            lines.append(f"• <b>{p['symbol']}</b>: {html.escape(p['text'])}" + (f"\n  <i>{html.escape(p['note'])}</i>" if p.get("note") else ""))
    pk = [p for p in out["personal"] if p["kind"] in ("pick_in", "pick_chase") and p["key"] not in sent]
    if pk:
        lines.append("<b>🛒 DANH SÁCH MUA</b>")
        for p in pk:
            if p["kind"] == "pick_in":
                lines.append(f"• <b>{p['symbol']}</b> đang trong vùng mua {_v(p['zone'][0])}–{_v(p['zone'][1])} (giá {_v(p['px'])}), dừng lỗ {_v(p.get('stop'))}")
            else:
                lines.append(f"• <b>{p['symbol']}</b> {_v(p['px'])} đã vượt {_v(p['chase'])} – không mua đuổi, chờ về vùng {_v(p['zone'][0])}–{_v(p['zone'][1])}")
    mk = [m for m in out["market"] if m["sev"] >= 3 and f"mkt:{m['s']}:{','.join(sorted(m['flags']))}" not in sent][:5]
    if mk and lines:
        lines.append("<b>⚠️ BẤT THƯỜNG TRÊN THỊ TRƯỜNG</b>")
        for m in mk:
            r = rows.get(m["s"], {})
            lines.append(f"• <b>{m['s']}</b> {_v(r.get('chg'), 1)}%: {html.escape(flag_text(m['s'], r, S.get(m['s']) or {}))}")
    for p in ex_new:
        sent.add(p["key"] + (":hit" if p["hit"] else ":near"))
    for p in fl + al + pk:
        sent.add(p["key"])
    for m in mk:
        sent.add(f"mkt:{m['s']}:{','.join(sorted(m['flags']))}")
    st["sent"] = list(sent)[-800:]
    sp.write_text(json.dumps(st, ensure_ascii=False), encoding="utf-8")
    if not lines:
        log.info("Telegram trong phiên: không có việc mới")
        return False
    ix = out.get("index", {}).get("VNINDEX") or {}
    head = f"<b>⏱ TRONG PHIÊN {out['at'][11:16]}</b> · VN-Index {_v(ix.get('close'))} ({'+' if (ix.get('chg') or 0) > 0 else ''}{_v(ix.get('chg'), 2)}%)"
    url = os.environ.get("SITE_URL")
    msg = head + "\n\n" + "\n".join(lines) + (f"\n\n<a href=\"{url}#/swing\">Xem bảng trong phiên</a>" if url else "")
    tok, chat = os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID")
    if not (tok and chat) or not config.get("notify.telegram", True):
        log.info("Telegram trong phiên (chưa cài bot):\n%s", msg)
        return False
    for i in range(0, len(msg), 3800):
        r = requests.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                          json={"chat_id": chat, "text": msg[i:i + 3800], "parse_mode": "HTML", "disable_web_page_preview": True}, timeout=20)
        if not r.ok:
            log.warning("Telegram lỗi: %s", r.text[:300])
            return False
    log.info("Telegram trong phiên: đã gửi")
    return True
