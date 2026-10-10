"""Báo cáo riêng từng người dùng:
  - scorecard(): "Nếu làm theo hệ thống" – lãi/lỗ thực tế theo tháng (dựng lại từ nhật ký giao dịch + danh mục, giá đóng cửa hằng ngày)
    so với cùng số vốn đi theo danh mục mẫu của hệ thống (mô phỏng lịch sử; từ khi có theo dõi thực tế thì dùng số thực tế) và VN-Index.
  - weekly(): báo cáo tuần (thứ 7) – danh mục, lệnh trong tuần, rủi ro, thị trường tuần qua, kế hoạch tuần tới.
Mọi số tiền theo đồng; giá theo nghìn đồng."""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger("report")

FEE_BUY, FEE_SELL = 0.15, 0.25


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _num(x, d=0.0):
    try:
        v = float(x)
        return d if np.isnan(v) else v
    except (TypeError, ValueError):
        return d


def _vn(x, nd=0) -> str:
    return f"{x:,.{nd}f}".replace(",", "X").replace(".", ",").replace("X", ".")


def trades_of(data: dict) -> list[dict]:
    """Lệnh trong nhật ký + lệnh mua "ẩn" cho phần danh mục đang nắm chưa có trong nhật ký (mua trước khi ghi)."""
    T = [x for x in (((data or {}).get("journal") or {}).get("trades") or []) if isinstance(x, dict) and x.get("symbol") and x.get("date")]
    T = [{**x, "symbol": str(x["symbol"]).upper(), "qty": _num(x.get("qty")), "price": _num(x.get("price"))} for x in T if _num(x.get("qty")) > 0 and _num(x.get("price")) > 0]
    net = {}
    for x in T:
        net[x["symbol"]] = net.get(x["symbol"], 0) + (x["qty"] if x.get("side") == "buy" else -x["qty"])
    for h in (((data or {}).get("portfolio") or {}).get("holdings") or []):
        if not isinstance(h, dict) or not h.get("symbol"):
            continue
        s, q = str(h["symbol"]).upper(), _num(h.get("qty"))
        miss = q - max(0.0, net.get(s, 0))
        if miss >= 1 and _num(h.get("cost")) > 0:
            T.append({"symbol": s, "side": "buy", "qty": miss, "price": _num(h.get("cost")), "fee": 0, "date": str(h.get("date") or ""),
                      "decision": "pre", "synthetic": True})
    return T


def book(T: list[dict], close: pd.DataFrame, start=None) -> pd.DataFrame | None:
    """Giá trị cổ phiếu nắm giữ hằng ngày (V), tiền ròng bỏ vào mua (F), lãi/lỗ trong ngày (pnl = ΔV − F)."""
    if not T or close is None or close.empty:
        return None
    idx = close.index
    first = min((pd.Timestamp(x["date"]) for x in T if x.get("date")), default=None)
    lo = idx[0] if first is None else max(idx[0], first.normalize())
    if start is not None:
        lo = max(lo, pd.Timestamp(start))
    syms = sorted({x["symbol"] for x in T if x["symbol"] in close.columns})
    if not syms:
        return None
    C = close[syms].ffill()
    dates = idx[idx >= lo]
    if len(dates) < 2:
        return None
    # trước ngày đầu: số lượng đã nắm (lệnh "ẩn" không có ngày → coi như đã nắm từ đầu kỳ)
    q = {s: 0.0 for s in syms}
    by_day: dict = {}
    for x in sorted(T, key=lambda x: (x.get("date") or "", x.get("ts") or 0)):
        if x["symbol"] not in q:
            continue
        d = pd.Timestamp(x["date"]) if x.get("date") else None
        if d is None or d < dates[0]:
            q[x["symbol"]] += x["qty"] if x.get("side") == "buy" else -x["qty"]
            continue
        # khớp sau phiên cuối → bỏ; ngày nghỉ → phiên kế tiếp
        pos = dates.searchsorted(d.normalize())
        if pos >= len(dates):
            continue
        by_day.setdefault(dates[pos], []).append(x)
    rows = []
    prevV = sum(max(0.0, q[s]) * _num(C.at[dates[0], s]) * 1000 for s in syms)
    for d in dates:
        F = 0.0
        for x in by_day.get(d, []):
            fee = _num(x.get("fee"), FEE_BUY if x.get("side") == "buy" else FEE_SELL) / 100
            if x.get("side") == "buy":
                q[x["symbol"]] += x["qty"]
                F += x["qty"] * x["price"] * 1000 * (1 + fee)
            else:
                sq = min(x["qty"], max(0.0, q[x["symbol"]]))
                q[x["symbol"]] -= sq
                F -= sq * x["price"] * 1000 * (1 - fee)
        V = sum(max(0.0, q[s]) * _num(C.at[d, s]) * 1000 for s in syms)
        rows.append({"date": d, "V": V, "F": F, "pnl": V - prevV - F})
        prevV = V
    return pd.DataFrame(rows).set_index("date")


def _sys_monthly(sbt: dict | None, fwdj: dict | None, style: str) -> tuple[dict, str | None]:
    """Lợi nhuận tháng của danh mục mẫu: {YYYY-MM: (ret, nguồn)}; nguồn 'bt' (mô phỏng) hoặc 'fwd' (theo dõi thực tế)."""
    out = {}
    cur = ((sbt or {}).get(style) or {}).get("curve") or []
    prev = None
    for p in cur:
        m = str(p["d"])[:7]
        if prev is not None and prev > 0:
            out[m] = (p["v"] / prev - 1, "bt")
        prev = p["v"]
    fs = (((fwdj or {}).get("by_style") or {}).get(style) or {}).get("nav") or []
    fstart = fs[0]["d"] if fs else None
    if len(fs) >= 2:
        by_m = {}
        for p in fs:
            by_m.setdefault(p["d"][:7], []).append(p["v"])
        base = fs[0]["v"]
        for m in sorted(by_m):
            end = by_m[m][-1]
            if base and base > 0:
                out[m] = (end / base - 1, "fwd")
            base = end
    return out, fstart


def scorecard(data: dict, close: pd.DataFrame, vni: pd.Series, sbt: dict | None, fwdj: dict | None, style: str,
              capital: float | None, cash: float = 0.0) -> dict | None:
    T = trades_of(data)
    if not T:
        return None
    start = (close.index[-1] - pd.DateOffset(months=24)) if len(close.index) else None
    B = book(T, close, start)
    if B is None or B.empty:
        return None
    V_now = float(B["V"].iloc[-1])
    cap = capital if capital and capital > 0 else (cash + V_now if cash + V_now > 0 else None)
    if not cap:
        return None
    sysm, fstart = _sys_monthly(sbt, fwdj, style)
    vm = vni.reindex(B.index).ffill()
    months = []
    cum_u = cum_s = cum_v = 0.0
    for m, g in B.groupby(B.index.to_period("M")):
        key = str(m)
        pnl = float(g["pnl"].sum())
        v0 = vm.loc[:g.index[0]]
        vs = float(vm.iloc[max(0, vm.index.get_loc(g.index[0]) - 1)]) if len(v0) else None
        ve = float(g.index.map(lambda d: vm.get(d)).dropna()[-1]) if len(g) else None
        vr = (ve / vs - 1) if vs and ve else None
        sr, src = sysm.get(key, (None, None))
        inv = float(g["V"].mean())
        cum_u += pnl
        cum_s += (sr or 0) * cap
        cum_v += (vr or 0) * cap
        months.append({"m": key, "pnl": _r(pnl, 0), "ret": _r(100 * pnl / cap, 2), "exp": _r(100 * inv / cap, 0),
                       "sys_ret": _r(100 * sr, 2) if sr is not None else None, "sys_pnl": _r(sr * cap, 0) if sr is not None else None, "src": src,
                       "vni_ret": _r(100 * vr, 2) if vr is not None else None, "vni_pnl": _r(vr * cap, 0) if vr is not None else None,
                       "diff": _r(pnl - sr * cap, 0) if sr is not None else None,
                       "cum": _r(cum_u, 0), "cum_sys": _r(cum_s, 0), "cum_vni": _r(cum_v, 0),
                       "trades": int(sum(1 for x in T if not x.get("synthetic") and str(x.get("date", ""))[:7] == key))})
    # quyết định: theo / tự / ngược hệ thống – lệnh thật trong nhật ký
    real = [x for x in T if not x.get("synthetic")]
    dec = {k: sum(1 for x in real if x.get("decision") == k) for k in ("sys", "self", "against")}
    # mã hệ thống đã chọn (theo dõi thực tế) mà người dùng không mua
    eps = ((((fwdj or {}).get("by_style") or {}).get(style) or {}).get("episodes")) or []
    bought = {x["symbol"] for x in real if x.get("side") == "buy"}
    missed = [e for e in eps if e.get("symbol") not in bought and e.get("ret") is not None]
    taken = [e for e in eps if e.get("symbol") in bought and e.get("ret") is not None]
    cut = months[-12:]
    tot = {k: _r(sum((x.get(k) or 0) for x in cut), 0) for k in ("pnl", "sys_pnl", "vni_pnl", "diff")}
    return {"capital": _r(cap, 0), "capital_src": "capital" if capital else "cash+cp", "style": style, "fwd_start": fstart,
            "months": cut, "total12": tot, "decisions": dec, "n_trades": len(real), "n_pre": sum(1 for x in T if x.get("synthetic")),
            "missed": {"n": len(missed), "avg": _r(np.mean([e["ret"] for e in missed]), 1) if missed else None,
                       "top": sorted([{"s": e["symbol"], "ret": e.get("ret"), "date": e.get("date")} for e in missed], key=lambda x: -(x["ret"] or 0))[:5]},
            "taken": {"n": len(taken), "avg": _r(np.mean([e["ret"] for e in taken]), 1) if taken else None}}


# ------------------------------------------------------------------------------------------------ báo cáo tuần
def _week_dates(idx: pd.DatetimeIndex) -> tuple[pd.Timestamp, pd.Timestamp, pd.Timestamp | None]:
    last = idx[-1]
    mon = (last - pd.Timedelta(days=last.weekday())).normalize()
    wk = idx[idx >= mon]
    prev = idx[idx < mon]
    return wk[0], last, (prev[-1] if len(prev) else None)


def market_week(close: pd.DataFrame, vni: pd.Series, u: pd.DataFrame, today: dict, digests: list[dict]) -> dict:
    d0, d1, dp = _week_dates(vni.dropna().index)
    base = dp if dp is not None else d0
    vr = float(vni.loc[d1] / vni.loc[base] - 1) if base in vni.index else None
    liq = [s for s in u.index if bool(u.at[s, "liquid_ok"])] if "liquid_ok" in u.columns else list(u.index)
    liq = [s for s in liq if s in close.columns]
    wr = (close.loc[d1, liq] / close.loc[base, liq] - 1).dropna() if base in close.index else pd.Series(dtype=float)
    secs = []
    if len(wr):
        sec = u.loc[wr.index, "sector"]
        for name, g in wr.groupby(sec):
            if len(g) >= 3:
                secs.append({"name": name, "chg": _r(100 * g.median(), 1), "n": int(len(g)), "up": int((g > 0).sum())})
    secs.sort(key=lambda x: -(x["chg"] or 0))
    top = wr.sort_values(ascending=False)
    lights = [{"date": x.get("date"), "light": (x.get("regime") or {}).get("light"), "chg": (x.get("indices") or {}).get("VNINDEX", {}).get("chg"),
               "headline": x.get("headline")} for x in digests]
    return {"from": str(d0.date()), "to": str(d1.date()), "vni": _r(float(vni.loc[d1]), 2), "vni_chg": _r(100 * vr, 2) if vr is not None else None,
            "light": (today.get("regime") or {}).get("light"), "light_start": lights[0]["light"] if lights else None, "days": lights,
            "breadth": {"up": int((wr > 0).sum()), "down": int((wr < 0).sum()), "n": int(len(wr))},
            "sectors_top": secs[:4], "sectors_bottom": secs[-3:][::-1] if len(secs) > 4 else [],
            "gainers": [{"s": s, "chg": _r(100 * v, 1)} for s, v in top.head(5).items()],
            "losers": [{"s": s, "chg": _r(100 * v, 1)} for s, v in top.tail(5)[::-1].items()]}


def weekly(data: dict, per: dict, today: dict, close: pd.DataFrame, vni: pd.Series, mkt: dict, events: list[dict], score: dict | None) -> dict:
    """Báo cáo tuần cho một người: per = phần riêng đã tính (portfolio, rel, style)."""
    d0, d1 = pd.Timestamp(mkt["from"]), pd.Timestamp(mkt["to"])
    adv = per.get("portfolio") or {}
    pos = adv.get("positions") or []
    T = trades_of(data)
    B = book(T, close, start=d0 - pd.Timedelta(days=10)) if T else None
    wk_pnl = float(B.loc[B.index >= d0, "pnl"].sum()) if B is not None and len(B) else None
    style = per.get("style") or today.get("style") or "position"
    SP = (today.get("styles") or {}).get(style) or {}
    reg = today.get("regime") or {}
    target = min(reg.get("exposure", 100), SP.get("exposure_cap", 100) if SP.get("exposure_cap") is not None else 100)
    total = adv.get("total_vnd") or per.get("capital")
    mv = sum(_num(p.get("mv_vnd")) for p in pos)
    hold = []
    for p in pos:
        s = p["symbol"]
        wc = None
        if s in close.columns:
            c = close[s].dropna()
            prev = c[c.index < d0]
            if len(prev) and d1 in c.index:
                wc = _r(100 * (float(c.loc[d1]) / float(prev.iloc[-1]) - 1), 1)
        hold.append({"s": s, "qty": p.get("qty"), "price": p.get("price"), "cost": p.get("cost"), "pnl_pct": p.get("pnl_pct"), "pnl_vnd": p.get("pnl_vnd"),
                     "weight": p.get("weight"), "wk": wc, "action": p.get("action"), "sev": p.get("severity"), "stop": p.get("stop"),
                     "why": (p.get("reasons") or [""])[0]})
    hold.sort(key=lambda x: (-(x["sev"] or 0), -(x["weight"] or 0)))
    trades = [{"date": x["date"], "s": x["symbol"], "side": x.get("side"), "qty": x["qty"], "price": x["price"], "decision": x.get("decision"),
               "reason": x.get("reason") or ""} for x in T if not x.get("synthetic") and d0 <= pd.Timestamp(x["date"]) <= d1 + pd.Timedelta(days=1)]
    # rủi ro
    risks = list(adv.get("warnings") or [])
    rk = today.get("risk") or {}
    for name, w in (adv.get("sectors") or {}).items():
        if w and w > (rk.get("max_weight_per_sector") or 30) + 0.5:
            risks.append(f"Ngành {name} chiếm {w:.0f}% (giới hạn {rk.get('max_weight_per_sector') or 30:.0f}%).")
    for p in pos:
        if (p.get("weight") or 0) > (rk.get("max_weight_per_stock") or 20) + 0.5:
            risks.append(f"{p['symbol']} chiếm {p['weight']:.0f}% danh mục (giới hạn {rk.get('max_weight_per_stock') or 20:.0f}%/mã).")
        st, px = p.get("stop"), p.get("price")
        if st and px and px > st and (px / st - 1) < 0.03 and (p.get("severity") or 0) < 2:
            risks.append(f"{p['symbol']} chỉ cách mức dừng {_vn(st, 2)} khoảng {_vn((px / st - 1) * 100, 1)}%.")
    for c in ((per.get("rel") or {}).get("conc") or [])[:3]:
        if (c.get("rc") or 0) >= 0.6:
            risks.append(f"{c['a']} và {c['b']} đồng pha mạnh (hệ số {str(c['rc']).replace('.', ',')}) – rủi ro dồn một hướng.")
    if adv.get("drawdown_1y") is not None and adv["drawdown_1y"] <= -15:
        risks.append(f"Danh mục đang sụt {abs(adv['drawdown_1y']):.0f}% so với đỉnh 1 năm.")
    # kế hoạch tuần tới
    held = {p["symbol"] for p in pos}
    sells = [{"s": p["symbol"], "action": p.get("action"), "why": (p.get("reasons") or [""])[0], "qty": p.get("qty"), "price": p.get("price")} for p in pos if (p.get("severity") or 0) >= 2]
    watchp = [{"s": p["symbol"], "action": p.get("action"), "why": (p.get("reasons") or [""])[0]} for p in pos if (p.get("severity") or 0) == 1]
    cur = 100 * mv / total if total else None
    picks = [{"s": p["symbol"], "zone": p.get("zone"), "stop": p.get("stop"), "t1": p.get("t1"), "weight": p.get("weight"), "basket": p.get("basket")}
             for p in (SP.get("picks") or []) if p["symbol"] not in held][:6]
    waits = [{"s": p["symbol"], "zone": p.get("zone"), "reason": p.get("reason")} for p in (SP.get("watch") or []) if p["symbol"] not in held][:6]
    pe = [{"s": x["symbol"], "zone": x.get("zone"), "stop": x.get("stop"), "t1": x.get("t1")} for x in (today.get("post_event") or []) if x.get("quality") and x["symbol"] not in held][:3]
    no_buy = bool(sells) or (cur is not None and cur > target + 5)
    if no_buy:
        picks, pe = [], []
    ev_next = [e for e in (events or []) if str(d1.date()) < e.get("date", "") <= str((d1 + pd.Timedelta(days=9)).date()) and (not e.get("symbol") or e.get("symbol") in held)]
    if sells:
        head = f"Tuần tới: xử lý {len(sells)} mã có tín hiệu thoát trước khi mua mới"
    elif cur is not None and cur > target + 5:
        head = f"Tuần tới: giảm tỷ trọng cổ phiếu từ {cur:.0f}% về ≈ {target}% theo đèn"
    elif picks and (cur is None or cur < target - 5):
        head = f"Tuần tới: có {len(picks)} mã trong danh sách MUA – giải ngân từng phần trong vùng mua"
    elif waits:
        head = f"Tuần tới: giữ tiền, chờ {len(waits)} mã về vùng mua"
    else:
        head = "Tuần tới: giữ nguyên danh mục"
    month = (score or {}).get("months", [])[-1:] or [None]
    return {"week": f"{d1.isocalendar()[0]}-W{d1.isocalendar()[1]:02d}", "from": mkt["from"], "to": mkt["to"], "market": mkt,
            "pf": {"total": _r(total, 0), "mv": _r(mv, 0), "exp": _r(cur, 0), "target": target, "wk_pnl": _r(wk_pnl, 0),
                   "wk_ret": _r(100 * wk_pnl / total, 2) if wk_pnl is not None and total else None, "dd": adv.get("drawdown_1y"), "n": len(pos)},
            "holdings": hold, "trades": trades, "risks": risks[:8],
            "plan": {"head": head, "no_buy": no_buy, "sells": sells, "watch": watchp, "picks": picks, "waits": waits, "post_event": pe, "events": ev_next[:8],
                     "light": reg.get("light"), "target": target, "style": style, "style_name": SP.get("name")},
            "month": month[0], "style": style}


def weekly_email(u: dict, W: dict, site: str = "") -> tuple[str, str]:
    """(tiêu đề, HTML) – email gọn, đủ đọc trên điện thoại; bản đầy đủ (in PDF) ở #/report."""
    e = lambda s: str(s if s is not None else "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")  # noqa: E731
    f = lambda x, nd=0: "—" if x is None else f"{x:,.{nd}f}".replace(",", "X").replace(".", ",").replace("X", ".")  # noqa: E731
    sg = lambda x, nd=1: "—" if x is None else ("+" if x > 0 else "") + f(x, nd) + "%"  # noqa: E731
    M, P, PL = W["market"], W["pf"], W["plan"]
    L = {"green": "Xanh", "yellow": "Vàng", "red": "Đỏ"}
    rows = "".join(f"<tr><td><b>{e(h['s'])}</b></td><td align='right'>{sg(h['wk'])}</td><td align='right'>{sg(h['pnl_pct'])}</td><td>{e(h['action'])}</td></tr>" for h in W["holdings"][:10])
    plan = "".join(f"<li><b>BÁN {e(x['s'])}</b> – {e(x['action'])}: {e(x['why'])}</li>" for x in PL["sells"])
    plan += "".join(f"<li><b>MUA {e(x['s'])}</b> vùng {f(x['zone'][0], 2)}–{f(x['zone'][1], 2)}, cắt lỗ {f(x['stop'], 2)}</li>" for x in PL["picks"] if x.get("zone"))
    plan += "".join(f"<li>Chờ {e(x['s'])} về {f(x['zone'][0], 2)}–{f(x['zone'][1], 2)}</li>" for x in PL["waits"][:4] if x.get("zone"))
    plan += "".join(f"<li>📅 {e(x['date'])}: {e(x.get('symbol') or '')} {e(x['title'])}</li>" for x in PL["events"][:5])
    risks = "".join(f"<li>{e(r)}</li>" for r in W["risks"])
    link = f"{site.rstrip('/')}/#/report" if site else ""
    html = f"""<div style='font-family:Arial,sans-serif;font-size:14px;color:#111;max-width:640px'>
<h2 style='margin:0 0 4px'>Báo cáo tuần {e(W['from'])} → {e(W['to'])}</h2>
<p style='margin:0 0 10px;color:#555'>Chào {e(u.get('name') or '')} – tóm tắt danh mục và việc cần làm tuần tới.</p>
<p><b>Thị trường:</b> VN-Index {f(M['vni'], 2)} ({sg(M['vni_chg'], 2)} trong tuần), đèn {L.get(M['light'], '—')}; {M['breadth']['up']} mã tăng / {M['breadth']['down']} mã giảm.
{('Ngành mạnh: ' + ', '.join(f"{e(s['name'])} {sg(s['chg'])}" for s in M['sectors_top'][:3]) + '.') if M['sectors_top'] else ''}</p>
<p><b>Danh mục:</b> lãi/lỗ tuần {f(P['wk_pnl'])} đ ({sg(P['wk_ret'], 2)} tổng tài sản) · cổ phiếu {f(P['exp'])}% (đèn cho phép ≈ {P['target']}%).</p>
{f"<table style='border-collapse:collapse;width:100%;font-size:13px' cellpadding='4'><tr style='background:#f3f3f3'><th align='left'>Mã</th><th align='right'>Tuần</th><th align='right'>Lãi/lỗ</th><th align='left'>Hệ thống</th></tr>{rows}</table>" if rows else ""}
<h3 style='margin:14px 0 4px'>{e(PL['head'])}</h3><ul style='padding-left:18px;margin:4px 0'>{plan or '<li>Không có lệnh cần đặt.</li>'}</ul>
{f"<h3 style='margin:14px 0 4px'>Rủi ro cần để ý</h3><ul style='padding-left:18px;margin:4px 0'>{risks}</ul>" if risks else ""}
{f"<p><a href='{link}'>Xem báo cáo đầy đủ / in PDF</a></p>" if link else ""}
<p style='color:#888;font-size:12px'>Thông tin tham khảo, không phải khuyến nghị đầu tư cá nhân. Đổi cài đặt email trong trang Tài khoản.</p></div>"""
    return f"VN-Stock – báo cáo tuần {W['from'][8:10]}/{W['from'][5:7]}–{W['to'][8:10]}/{W['to'][5:7]}: {PL['head'].replace('Tuần tới: ', '')}", html
