"""Bản tin thị trường mỗi phiên (chung cho mọi người): chỉ số, độ rộng, thanh khoản, ngành, mã nổi bật,
dòng tiền lớn, tâm lý, hành vi giá bất thường, sự kiện sắp tới, tin tức. Lưu kho theo ngày (data/digest/) và chép ra web."""
from __future__ import annotations

import json
import logging
import shutil

import numpy as np
import pandas as pd

log = logging.getLogger("digest")
LIMIT = {"HOSE": 7.0, "HNX": 10.0, "UPCOM": 15.0}
KEEP = 400


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _v(x, nd=2):
    if x is None:
        return "–"
    return f"{x:,.{nd}f}".replace(",", "_").replace(".", ",").replace("_", ".")


def _rj(p):
    try:
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None
    except ValueError:
        return None


def build(out_dir, u: pd.DataFrame, today: dict, market: dict, idx: pd.DataFrame, last_date, sw_per: dict, store, g: dict | None = None) -> str:
    d = str(pd.Timestamp(last_date).date())
    reg = today.get("regime") or market.get("regime") or {}
    ix = market.get("indices") or {}
    U = u[u["price"].notna()].copy()
    U = U[U["chg1d"].notna()]
    # thanh khoản hôm nay so với TB 20 phiên (tính trên nến ngày)
    val_today = val_avg = None
    vol_x = {}
    if g:
        vt, va = 0.0, []
        for s in U.index:
            df = g.get(s)
            if df is None or len(df) < 25 or pd.Timestamp(df.index[-1]).normalize() != pd.Timestamp(last_date).normalize():
                continue
            v = (df["close"] * df["volume"] / 1e6).iloc[-21:]
            vt += float(v.iloc[-1])
            va.append(v.iloc[:-1].values)
            m = float(df["volume"].iloc[-21:-1].mean())
            if m > 0:
                vol_x[s] = float(df["volume"].iloc[-1]) / m
        if va:
            val_today = vt / 1000
            val_avg = float(np.nansum(np.vstack([x for x in va if len(x) == 20]), axis=0).mean()) / 1000 if any(len(x) == 20 for x in va) else None
    lim = U["exchange"].map(LIMIT).fillna(7.0)
    adv, dec = int((U["chg1d"] > 0.05).sum()), int((U["chg1d"] < -0.05).sum())
    unch = int(len(U) - adv - dec)
    ceil_, floor_ = int((U["chg1d"] >= lim - 0.35).sum()), int((U["chg1d"] <= -(lim - 0.35)).sum())
    liq = U[U["avg_value_bn"].fillna(0) >= 5]
    # ngành: bình quân theo vốn hoá
    secs = []
    for name, grp in liq.groupby("sector"):
        w = grp["mcap_bn"].fillna(0)
        r = float(np.average(grp["chg1d"], weights=w)) if w.sum() > 0 else float(grp["chg1d"].mean())
        top = grp.sort_values("chg1d", ascending=False)
        secs.append({"name": name, "n": int(len(grp)), "chg": _r(r), "up": int((grp["chg1d"] > 0).sum()), "down": int((grp["chg1d"] < 0).sum()),
                     "best": [[s, _r(top.at[s, "chg1d"])] for s in top.index[:3]], "worst": [[s, _r(top.at[s, "chg1d"])] for s in top.index[-3:][::-1]]})
    secs.sort(key=lambda x: -(x["chg"] or 0))
    # mã kéo / đè chỉ số (đóng góp ≈ vốn hoá × % thay đổi)
    hose = U[(U["exchange"] == "HOSE") & U["mcap_bn"].notna()]
    contrib = (hose["mcap_bn"] * hose["chg1d"] / 100)
    tot_cap = float(hose["mcap_bn"].sum()) or 1
    pts = (contrib / tot_cap * (ix.get("VNINDEX", {}).get("close") or 0)).sort_values()
    pull_up = [[s, _r(pts[s], 2), _r(U.at[s, "chg1d"])] for s in pts.index[::-1][:6] if pts[s] > 0]
    pull_dn = [[s, _r(pts[s], 2), _r(U.at[s, "chg1d"])] for s in pts.index[:6] if pts[s] < 0]

    def rows(df, k=8):
        return [{"s": s, "chg": _r(df.at[s, "chg1d"]), "price": _r(df.at[s, "price"]), "sector": df.at[s, "sector"], "val": _r(df.at[s, "avg_value_bn"], 0),
                 "vx": _r(vol_x.get(s), 1)} for s in df.index[:k]]
    gain = rows(liq.sort_values("chg1d", ascending=False))
    lose = rows(liq.sort_values("chg1d"))
    unusual = liq.assign(vx=[vol_x.get(s, np.nan) for s in liq.index])
    unusual = rows(unusual[unusual["vx"] >= 2.2].sort_values("vx", ascending=False), 10)
    bn = reg.get("breadth_now") or {}
    FJ = _rj(out_dir / "flow.json") or {}
    sent = FJ.get("sentiment") or {}
    frows = FJ.get("rows") or []
    flow = {"count": FJ.get("count"), "acc": [x["s"] for x in frows if "acc" in (x.get("st") or [])][:8], "dist": [x["s"] for x in frows if "dist" in (x.get("st") or [])][:8],
            "brk": [x["s"] for x in sorted(frows, key=lambda z: -(z.get("vr") or 0)) if set(x.get("st") or []) & {"brk", "acc_brk"}][:10]}
    SW = _rj(out_dir / "swing.json") or {}
    sigs = sorted(SW.get("today") or [], key=lambda x: -(x.get("sev") or 0))
    swing = {"n": len(sigs), "neg": sum(1 for x in sigs if (x.get("dir") or 0) < 0), "pos": sum(1 for x in sigs if (x.get("dir") or 0) > 0),
             "top": [{"s": x["symbol"], "ret": _r(x.get("ret")), "dir": x.get("dir"), "meaning": (x.get("meaning") or "")[:140]} for x in sigs[:6]]}
    EV = _rj(out_dir / "events.json") or {}
    d7 = str((pd.Timestamp(last_date) + pd.Timedelta(days=8)).date())
    events = [e for e in EV.get("events") or [] if d < e["date"] <= d7][:12]
    news = []
    try:
        nw = store.read("news")
        if not nw.empty:
            nw["time"] = pd.to_datetime(nw["time"])
            nw = nw[nw["time"] >= pd.Timestamp(last_date) - pd.Timedelta(days=1)].sort_values("time", ascending=False).drop_duplicates("title")
            news = [{"t": x.time.strftime("%Y-%m-%d %H:%M"), "title": x.title, "link": x.link, "src": x.src, "s": x.symbol} for x in nw.head(10).itertuples()]
    except Exception as e:  # noqa: BLE001
        log.warning("Tin tức cho bản tin: %s", e)
    vn = ix.get("VNINDEX") or {}
    # ---- lời bình (tự động, chỉ từ số liệu)
    lines = []
    if vn:
        mv = "tăng" if (vn.get("chg") or 0) > 0 else "giảm" if (vn.get("chg") or 0) < 0 else "đi ngang"
        liq_txt = ""
        if val_today and val_avg:
            rr = val_today / val_avg - 1
            liq_txt = f", thanh khoản {_v(val_today, 1)} nghìn tỷ ({'cao' if rr > 0.15 else 'thấp' if rr < -0.15 else 'xấp xỉ'} hơn TB 20 phiên {_v(100 * rr, 0)}%)" if abs(rr) > 0.15 else f", thanh khoản {_v(val_today, 1)} nghìn tỷ, xấp xỉ TB 20 phiên"
        lines.append(f"VN-Index {mv} {_v(abs(vn.get('chg') or 0), 2)}% về {_v(vn.get('close'))} điểm{liq_txt}.")
    lines.append(f"Độ rộng: {adv} mã tăng ({ceil_} trần) / {dec} mã giảm ({floor_} sàn) / {unch} đứng giá; {_v(bn.get('above50'), 0)}% mã thanh khoản nằm trên MA50.")
    big = [x for x in secs if x["n"] >= 3]
    if len(big) >= 4:
        lines.append("Ngành mạnh nhất: " + ", ".join(f"{x['name']} {_v(x['chg'], 1)}%" for x in big[:2]) + "; yếu nhất: " + ", ".join(f"{x['name']} {_v(x['chg'], 1)}%" for x in big[-2:][::-1]) + ".")
    if pull_up or pull_dn:
        lines.append("Kéo chỉ số: " + ", ".join(f"{s} ({_v(p, 1)} điểm)" for s, p, _ in pull_up[:3]) + ("; đè chỉ số: " + ", ".join(f"{s} ({_v(p, 1)} điểm)" for s, p, _ in pull_dn[:3]) if pull_dn else "") + ".")
    if sent.get("now") is not None:
        lines.append(f"Tâm lý thị trường {_v(sent['now'], 0)}/100 ({sent.get('label')}{', ' + ('+' if (sent.get('chg5') or 0) > 0 else '') + _v(sent.get('chg5'), 0) + ' điểm so với 5 phiên trước' if sent.get('chg5') is not None else ''}); "
                     f"đèn thị trường {({'green': 'XANH', 'yellow': 'VÀNG', 'red': 'ĐỎ'}).get(reg.get('light'), '–')}.")
    c = FJ.get("count") or {}
    if c:
        lines.append(f"Dòng tiền lớn: {c.get('acc', 0)} mã gom âm thầm, {c.get('dist', 0)} mã xả âm thầm, {c.get('brk', 0)} mã bứt phá có khối lượng.")
    out = {"date": d, "headline": lines[0] if lines else f"Bản tin {d}", "lines": lines, "regime": {k: reg.get(k) for k in ("light", "score", "max_score", "text", "exposure")},
           "indices": {k: {"close": v.get("close"), "chg": v.get("chg")} for k, v in ix.items()},
           "value": {"today": _r(val_today, 2), "avg20": _r(val_avg, 2)}, "breadth": {"adv": adv, "dec": dec, "unch": unch, "ceil": ceil_, "floor": floor_,
                                                                                    "above50": bn.get("above50"), "new_hi": bn.get("new_hi"), "new_lo": bn.get("new_lo")},
           "sectors": secs, "pull_up": pull_up, "pull_dn": pull_dn, "gainers": gain, "losers": lose, "unusual": unusual,
           "sentiment": {k: sent.get(k) for k in ("now", "label", "chg5")}, "flow": flow, "swing": swing, "events": events, "news": news}
    arch = store.path("digest")
    arch.mkdir(parents=True, exist_ok=True)
    (arch / f"{d}.json").write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")
    files = sorted(arch.glob("20*.json"))
    for f in files[:-KEEP]:
        f.unlink()
    files = files[-KEEP:]
    idx_rows = []
    for f in files:
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            idx_rows.append({"date": j["date"], "headline": j.get("headline"), "chg": (j.get("indices", {}).get("VNINDEX") or {}).get("chg"), "light": (j.get("regime") or {}).get("light")})
        except ValueError:
            continue
    od = out_dir / "digest"
    od.mkdir(parents=True, exist_ok=True)
    for f in files:
        shutil.copy(f, od / f.name)
    (od / "index.json").write_text(json.dumps({"dates": idx_rows[::-1]}, ensure_ascii=False), encoding="utf-8")
    log.info("Bản tin thị trường %s: %s", d, out["headline"])
    return out["headline"]
