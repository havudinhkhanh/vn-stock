"""Phần RIÊNG của từng người dùng sau lượt đóng cửa: tư vấn danh mục, cảnh báo giá, mã đồng pha trong danh mục,
thông báo (web / đẩy / email). Phần chung (danh sách MUA, phân tích mã…) do build.py tính một lần cho mọi người."""
from __future__ import annotations

import copy
import json
import logging
import os

import pandas as pd

from . import config, notify, users
from . import report as rp
from .analysis import portfolio as pf
from .analysis import styles as sty
from .portfolio_store import apply_profile

log = logging.getLogger("personal")


def _f2(x):
    return f"{x:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def holdings_of(data: dict) -> tuple[list[dict], float, float | None]:
    p = (data or {}).get("portfolio") or {}
    h = [x for x in (p.get("holdings") or []) if isinstance(x, dict) and x.get("symbol")]
    return h, float(p.get("cash") or 0), (float(p["capital"]) if p.get("capital") else None)


def watch_of(data: dict) -> list[dict]:
    return [x for x in (((data or {}).get("watchlist") or {}).get("items") or []) if isinstance(x, dict) and x.get("symbol")]


def alerts_for(watch: list[dict], g: dict, last_date, plan_syms: dict, active_style: str) -> list[dict]:
    """Cảnh báo giá đã kích hoạt trong phiên vừa đóng cửa."""
    alerts = []
    for it in watch:
        s = str(it["symbol"]).upper()
        if s not in g or g[s].empty:
            continue
        bar = g[s].iloc[-1]
        if pd.Timestamp(g[s].index[-1]).normalize() != pd.Timestamp(last_date).normalize():
            continue
        prev_c = float(g[s]["close"].iloc[-2]) if len(g[s]) > 1 else float(bar["close"])
        for a in it.get("alerts") or []:
            if not a.get("active", True):
                continue
            typ, val = a.get("type"), a.get("value")
            hit, txt = False, ""
            try:
                v = float(val) if val not in (None, "") else None
            except (TypeError, ValueError):
                v = None
            if typ == "below" and v and float(bar["low"]) <= v:
                hit, txt = True, f"giá chạm/giảm dưới {_f2(v)} (thấp nhất {_f2(float(bar['low']))}, đóng cửa {_f2(float(bar['close']))})"
            elif typ == "above" and v and float(bar["high"]) >= v:
                hit, txt = True, f"giá chạm/vượt {_f2(v)} (cao nhất {_f2(float(bar['high']))}, đóng cửa {_f2(float(bar['close']))})"
            elif typ == "pct" and v and prev_c and abs(float(bar["close"]) / prev_c - 1) * 100 >= v:
                hit, txt = True, f"biến động {100 * (float(bar['close']) / prev_c - 1):+.1f}% trong phiên"
            elif typ == "plan" and s in plan_syms.get(a.get("style") or active_style, set()):
                hit, txt = True, f"vào danh sách MUA ({sty.STYLES.get(a.get('style') or active_style, {}).get('name', '')})"
            if hit:
                alerts.append({"id": a.get("id") or f"{s}-{typ}-{val}", "symbol": s, "type": typ, "value": v, "text": txt,
                               "note": a.get("note") or it.get("note") or "", "close": round(float(bar["close"]), 2), "date": str(pd.Timestamp(last_date).date())})
    return alerts


def rel_for(co: dict, rel_by: dict, held: set, watch: set) -> dict:
    conc = []
    for a in sorted(s for s in held if s in co):
        for c in co[a]:
            if c["s"] in held and c["s"] > a and (c.get("rc") or 0) >= 0.4:
                conc.append({"a": a, "b": c["s"], "rc": c["rc"], "p_dd": c.get("p_dd"), "p_base": c.get("p_base")})
    mine = {s: [{k: c.get(k) for k in ("s", "rc", "p_dd", "p_base", "es_t", "es_c")} | {"held": c.get("s") in held} for c in (rel_by[s].get("co") or [])[:5]]
            for s in sorted((held | watch) & set(rel_by))}
    return {"conc": conc, "mine": mine}


def compute(data: dict, ctx: dict) -> dict:
    """Phần riêng của một người. ctx: u, g, cfg0 (cấu hình gốc), regime, last_date, plan_syms, active_style, co, rel_by."""
    holdings, cash, capital = holdings_of(data)
    prof = (data or {}).get("profile") or {}
    cfg = copy.deepcopy(ctx["cfg0"])
    changed = apply_profile(cfg, prof)
    style = prof.get("style") if prof.get("style") in ("swing", "position", "long", "income") else ctx["active_style"]
    held = {h["symbol"].upper() for h in holdings}
    closes = {s: ctx["g"][s]["close"] for s in held if s in ctx["g"]}
    advice = pf.advise(holdings, ctx["u"], closes, cfg, ctx["regime"], cash, capital) if holdings else None
    watch = watch_of(data)
    wsyms = {str(w["symbol"]).upper() for w in watch}
    out = {"date": str(pd.Timestamp(ctx["last_date"]).date()), "portfolio": advice, "alerts": alerts_for(watch, ctx["g"], ctx["last_date"], ctx["plan_syms"], style),
            "capital": capital, "style": style, "rel": rel_for(ctx["co"], ctx["rel_by"], held, wsyms),
            "profile": {"applied": changed, "updated": prof.get("updated"), "exclude_sectors": cfg.get("exclude_sectors") or [], "exclude_symbols": cfg.get("exclude_symbols") or []}}
    out["score"] = score_for(data, out, ctx)
    return out


def score_for(data: dict, per: dict, ctx: dict) -> dict | None:
    """Bảng "nếu làm theo hệ thống" (None nếu chưa có lệnh / chưa có vốn)."""
    if ctx.get("close") is None:
        return None
    try:
        _, cash, capital = holdings_of(data)
        return rp.scorecard(data, ctx["close"], ctx["vni"], ctx.get("sbt"), ctx.get("fwd"), per.get("style") or ctx["active_style"], capital, cash)
    except Exception as e:  # noqa: BLE001
        log.warning("Bảng so sánh lỗi: %s", e)
        return None


def weekly_for(data: dict, per: dict, today: dict, ctx: dict) -> dict | None:
    wk = ctx.get("weekly")
    if not wk or not (per.get("portfolio") or ((data or {}).get("journal") or {}).get("trades")):
        return None
    try:
        return rp.weekly(data, per, today, ctx["close"], ctx["vni"], wk["market"], wk["events"], per.get("score"))
    except Exception as e:  # noqa: BLE001
        log.exception("Báo cáo tuần lỗi: %s", e)
        return None


def holdings_levels(advice: dict | None) -> dict:
    out = {}
    for pos in (advice or {}).get("positions") or []:
        ep = pos.get("exit") or {}
        out[pos["symbol"]] = {"levels": [{"key": x["key"], "label": x["label"], "price": x.get("price"), "trig": x.get("trig"), "sell": x.get("sell"),
                                          "done": x.get("status") == "done"} for x in ep.get("levels") or []]}
    return out


def run_all(be, U: list[dict], ctx: dict, today: dict, out_dir) -> dict:
    """Tính phần riêng + thông báo cho mọi người dùng. Trả về {uid: personal} để dùng cho live_ctx và Telegram chủ sở hữu."""
    cfgD = users.config(be)
    flowJ = _rj(out_dir / "flow.json")
    pairsJ = _rj(out_dir / "pairs.json")
    res, stats = {}, {"users": 0, "new": 0, "push": 0, "email": 0}
    for u in U:
        try:
            per = compute(u["data"], ctx)
            users.save(be, u["id"], "_personal", per)
            res[u["id"]] = per
            prev = u["data"].get("_nstate") or {}
            merged = {**today, **per}
            wsyms = {str(w["symbol"]).upper() for w in watch_of(u["data"])}
            items, state = notify.collect(merged, prev, mine=wsyms, flowJ=flowJ, pairsJ=pairsJ, conc=per["rel"]["conc"], feats=u["features"])
            if not prev:      # lần đầu: chỉ ghi nhận trạng thái, không dội hàng loạt thông báo cũ
                items = [x for x in items if x["kind"] in ("act", "near", "alert")]
            items.append({"kind": "digest", "key": f"{per['date']}:digest", "sev": 0, "title": f"Bản tin thị trường {per['date']}",
                          "body": (today.get("digest_line") or "Tổng hợp biến động thị trường phiên hôm nay."), "url": "#/digest"})
            users.save(be, u["id"], "_nstate", state)
            r = users.deliver(be, cfgD, u, items, f"VN-Stock {per['date']}: " + (items[0]["title"] if len(items) == 1 else f"{len(items)} việc mới"))
            if "weekly" in u["features"]:
                W = weekly_for(u["data"], per, {**today, **per}, ctx)
                if W:
                    users.save(be, u["id"], "_weekly", W)
                    wi = [{"kind": "weekly", "key": f"{W['week']}:weekly", "sev": 1, "title": f"Báo cáo tuần {W['from'][8:10]}/{W['from'][5:7]}–{W['to'][8:10]}/{W['to'][5:7]}",
                           "body": W["plan"]["head"], "url": "#/report"}]
                    new = users.add_notifications(be, u["id"], wi)
                    if new:
                        site = os.environ.get("SITE_URL") or cfgD.get("site_url") or ""
                        users.send_push(be, cfgD, u, new, site)
                        if "notify_email" in u["features"] and users.prefs(u)["email"] != "off":
                            sub, html_ = rp.weekly_email(u, W, site)
                            stats["email"] += int(users.send_html(cfgD, users.prefs(u)["email_to"], sub, html_))
            stats["users"] += 1
            stats["new"] += r.get("new", 0)
            stats["push"] += r.get("push", 0)
            stats["email"] += int(bool(r.get("email")))
        except Exception as e:  # noqa: BLE001
            log.exception("Phần riêng của %s lỗi: %s", u.get("email"), e)
    log.info("Người dùng: %s", stats)
    return res


def _rj(p):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except ValueError:
        return None


__all__ = ["compute", "run_all", "alerts_for", "rel_for", "holdings_levels", "config"]
