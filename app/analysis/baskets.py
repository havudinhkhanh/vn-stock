"""Rổ chỉ số & quỹ ETF: hiệu suất, xu hướng, định giá rổ (từ BCTC từng mã thành phần), quy tắc vào/ra đã kiểm chứng,
và ETF nào bám rổ nào (suy ra từ tương quan lợi nhuận ngày – không đoán theo tên quỹ)."""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import mtf as mtf_
from .flow import _states

NAMES = {
    "VNINDEX": ("VN-Index", "Toàn bộ cổ phiếu sàn HOSE, gia quyền vốn hoá"),
    "VN30": ("VN30", "30 mã vốn hoá & thanh khoản lớn nhất HOSE"),
    "VN100": ("VN100", "100 mã lớn nhất HOSE (VN30 + Midcap)"),
    "VNMIDCAP": ("VN Midcap", "70 mã vốn hoá vừa trên HOSE"),
    "VNSMALLCAP": ("VN Smallcap", "Mã vốn hoá nhỏ trên HOSE"),
    "VNALLSHARE": ("VN AllShare", "Toàn bộ mã đủ chuẩn trên HOSE"),
    "VNDIAMOND": ("VN Diamond", "Mã tốt đã/gần kín room ngoại – rổ khối ngoại muốn mua"),
    "VNFINLEAD": ("VN FinLead", "Ngân hàng, chứng khoán dẫn đầu"),
    "VNFINSELECT": ("VN FinSelect", "Tài chính chọn lọc (ngân hàng, CK, bảo hiểm)"),
    "VNX50": ("VNX50", "50 mã lớn nhất HOSE + HNX"),
    "VNSI": ("VNSI", "Doanh nghiệp phát triển bền vững"),
    "HNX30": ("HNX30", "30 mã lớn nhất sàn HNX"),
    "VNIT": ("VN-IT", "Ngành công nghệ thông tin (HOSE)"),
    "VNREAL": ("VN-Real", "Ngành bất động sản (HOSE)"),
    "VNFIN": ("VN-Fin", "Ngành tài chính (HOSE)"),
    "VNMAT": ("VN-Mat", "Ngành nguyên vật liệu (HOSE)"),
    "VNIND": ("VN-Ind", "Ngành công nghiệp (HOSE)"),
    "VNCONS": ("VN-Cons", "Hàng tiêu dùng thiết yếu (HOSE)"),
    "VNCOND": ("VN-Cond", "Hàng tiêu dùng không thiết yếu (HOSE)"),
    "VNENE": ("VN-Ene", "Ngành năng lượng (HOSE)"),
    "VNHEAL": ("VN-Heal", "Ngành y tế (HOSE)"),
    "VNUTI": ("VN-Uti", "Ngành tiện ích – điện, nước, khí (HOSE)"),
}
BASKET = ["VN30", "VN100", "VNDIAMOND", "VNFINLEAD", "VNFINSELECT", "VNMIDCAP", "VNSMALLCAP", "VNX50", "VNSI", "HNX30", "VNALLSHARE", "VNINDEX"]
SECTOR_IX = ["VNFIN", "VNREAL", "VNIT", "VNMAT", "VNIND", "VNCONS", "VNCOND", "VNENE", "VNHEAL", "VNUTI"]


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def _ret(c: pd.Series, n: int):
    return _r(100 * (c.iloc[-1] / c.iloc[-1 - n] - 1), 1) if len(c) > n else None


def _perf(c: pd.Series) -> dict:
    ytd0 = c[c.index < pd.Timestamp(c.index[-1].year, 1, 1)]
    ma50, ma200 = c.rolling(50).mean(), c.rolling(200, min_periods=150).mean()
    pk = c.cummax()
    return {"close": _r(c.iloc[-1], 2), "chg": _r(100 * (c.iloc[-1] / c.iloc[-2] - 1), 2) if len(c) > 1 else None,
            "r1w": _ret(c, 5), "r1m": _ret(c, 21), "r3m": _ret(c, 63), "r6m": _ret(c, 126), "r1y": _ret(c, 250), "r3y": _ret(c, 750),
            "ytd": _r(100 * (c.iloc[-1] / ytd0.iloc[-1] - 1), 1) if len(ytd0) else None,
            "dd": _r(100 * (c.iloc[-1] / pk.iloc[-1] - 1), 1), "peak": _r(pk.iloc[-1], 2),
            "hi52": _r(c.iloc[-250:].max(), 2), "lo52": _r(c.iloc[-250:].min(), 2),
            "ma50": _r(ma50.iloc[-1], 2), "ma200": _r(ma200.iloc[-1], 2),
            "above50": bool(c.iloc[-1] > ma50.iloc[-1]) if ma50.notna().iloc[-1] else None,
            "above200": bool(c.iloc[-1] > ma200.iloc[-1]) if ma200.notna().iloc[-1] else None,
            "vol": _r(100 * c.pct_change().iloc[-250:].std() * np.sqrt(250), 1), "first": str(c.index[0].date())}


def _bt(c: pd.Series, S: pd.Series | None, vni: pd.Series | None) -> dict:
    """Kiểm chứng 3 cách đánh rổ trên chính chỉ số (chưa tính phí & cổ tức): mua giữ / theo MA200 / MA200 + vào lại khi sợ hãi vừa qua."""
    c = c[c.index >= pd.Timestamp("2016-01-01")]
    if len(c) < 400:
        return {"ok": False}
    r = c.pct_change().fillna(0)
    ma = c.rolling(200, min_periods=150).mean()
    rules = {"hold": pd.Series(1.0, index=c.index), "ma200": (c > ma).astype(float)}
    if S is not None and vni is not None and len(S) > 300:
        st = _states(S, vni).reindex(c.index).ffill()
        rec = pd.Series(0.0, index=c.index)
        left = 0
        for i, v in enumerate(st.values):
            if v in ("recover", "fear_deep"):
                left = 120
            rec.iloc[i] = 1.0 if left > 0 else 0.0
            left -= 1
        rules["ma200_fear"] = ((c > ma).astype(float) + rec).clip(0, 1)
    out = {}
    for k, pos in rules.items():
        p = pos.shift(1).fillna(0)
        eq = (1 + r * p).cumprod()
        yrs = len(eq) / 250
        out[k] = {"cagr": _r(100 * (eq.iloc[-1] ** (1 / yrs) - 1), 1), "mdd": _r(100 * (eq / eq.cummax() - 1).min(), 1),
                  "expo": _r(100 * p.mean(), 0), "trades": int((p.diff().abs() > 0).sum() // 2), "now": bool(pos.iloc[-1] > 0),
                  "curve": [{"d": str(d.date()), "v": _r(v * 100, 1)} for d, v in eq.iloc[::5].items()]}
    return {"ok": True, "from": str(c.index[0].date()), "rules": out}


def _valuation(mem: list[str], u: pd.DataFrame, picks: set) -> dict:
    m = u.reindex([s for s in mem if s in u.index])
    if m.empty:
        return {}
    mc = pd.to_numeric(m["mcap_bn"], errors="coerce")
    pe, pb = pd.to_numeric(m["pe"], errors="coerce"), pd.to_numeric(m["pb"], errors="coerce")
    ok = (pe > 0) & mc.notna()
    e = (mc / pe).where(ok)
    okb = (pb > 0) & mc.notna()
    w = mc / mc.sum()
    top = m.assign(w=100 * w).sort_values("w", ascending=False)
    num = lambda c: pd.to_numeric(m[c], errors="coerce") if c in m else pd.Series(dtype=float)  # noqa: E731
    return {"n": int(len(m)), "pe_w": _r(mc[ok].sum() / e.sum(), 1) if e.sum() > 0 else None, "pe_med": _r(pe[pe > 0].median(), 1),
            "pb_w": _r(mc[okb].sum() / (mc / pb).where(okb).sum(), 2) if okb.any() else None, "pb_med": _r(pb[pb > 0].median(), 2),
            "roe_med": _r(num("roe").median(), 1), "ni_yoy_med": _r(num("ni_yoy").median(), 1), "div_w": _r((num("div_yield") * w).sum(), 2),
            "upside_med": _r(num("upside").median(), 1), "composite_med": _r(num("composite").median(), 0),
            "up_pct": _r(100 * (m["trend"] == "up").mean(), 0) if "trend" in m else None,
            "in_buy": sorted(set(m.index) & picks),
            "top": [{"s": s, "w": _r(r.w, 1), "chg1m": _r(r.chg1m, 1), "pe": _r(r.pe, 1), "upside": _r(r.upside, 1), "trend": r.trend,
                     "sector": r.get("peer_label") or r.get("sector")} for s, r in top.head(40).iterrows()]}


def build(bp: pd.DataFrame, g: dict, members: pd.DataFrame, etfs: pd.DataFrame, u: pd.DataFrame, picks: set,
          S: pd.Series | None, vni: pd.Series | None) -> dict:
    ser: dict[str, pd.DataFrame] = {}
    for s, d in (bp.groupby("symbol") if not bp.empty else []):
        ser[s] = d.drop(columns="symbol").set_index("date").sort_index()
    for s in ("VNINDEX", "VN30"):
        if s in g:
            ser[s] = g[s]
    mem = members.groupby("index")["symbol"].apply(list).to_dict() if not members.empty else {}
    idx_out = []
    for k in BASKET + SECTOR_IX:
        d = ser.get(k)
        if d is None or len(d) < 60:
            continue
        c = d["close"].astype(float)
        rec = {"key": k, "name": NAMES.get(k, (k, ""))[0], "desc": NAMES.get(k, (k, ""))[1], "kind": "sector" if k in SECTOR_IX else "basket",
               **_perf(c), "members": mem.get(k, []) if k != "VNINDEX" else []}
        if k in BASKET:
            try:
                rec["mtf"] = mtf_.full(d.assign(volume=d.get("volume", 0)))
            except Exception:  # noqa: BLE001
                rec["mtf"] = None
            rec["bt"] = _bt(c, S, vni)
            if rec["members"]:
                rec["val"] = _valuation(rec["members"], u, picks)
            rec["ohlc_w"] = {kk: v for kk, v in mtf_.payload(mtf_.resample(d, "W")).items() if kk in ("t", "c")}
            rec["line"] = {"t": [x.strftime("%Y-%m-%d") for x in c.index[-500:]], "c": [_r(v, 2) for v in c.iloc[-500:]]}
        idx_out.append(rec)
    # ---- ETF: bám rổ nào (tương quan lợi nhuận ngày 1 năm gần nhất), lệch so với rổ
    rets = {k: ser[k]["close"].pct_change() for k in BASKET if k in ser}
    etf_out = []
    names = etfs.set_index("symbol")["name"].to_dict() if not etfs.empty else {}
    for s in (etfs["symbol"] if not etfs.empty else []):
        d = ser.get(s)
        if d is None or len(d) < 20:
            continue
        c, v = d["close"].astype(float), d["volume"].astype(float)
        rec = {"s": s, "name": names.get(s, s), **_perf(c), "val20": _r((c * v).iloc[-20:].mean() / 1e6, 2),   # giá nghìn đồng × CCQ → tỷ đồng
               "days_traded20": int((v.iloc[-20:] > 0).sum())}
        er = c.pct_change().iloc[-250:]
        best, bc = None, 0.0
        for k, rr in rets.items():
            x = pd.concat([er, rr], axis=1, join="inner").dropna()
            x = x[(x.iloc[:, 0] != 0)]
            if len(x) < 40:
                continue
            cc = x.iloc[:, 0].corr(x.iloc[:, 1])
            if cc == cc and cc > bc:
                best, bc = k, cc
        if best and bc >= 0.85:
            ic = ser[best]["close"].astype(float)
            rec["track"], rec["corr"] = best, _r(bc, 3)
            j = pd.concat([c, ic], axis=1, join="inner").dropna()
            if len(j) > 250:
                rec["td1y"] = _r(100 * ((j.iloc[-1, 0] / j.iloc[-251, 0]) - (j.iloc[-1, 1] / j.iloc[-251, 1])), 1)
            dr = (j.iloc[:, 0].pct_change() - j.iloc[:, 1].pct_change()).iloc[-250:]
            rec["te"] = _r(100 * dr.std() * np.sqrt(250), 1)
        rec["line"] = {"t": [x.strftime("%Y-%m-%d") for x in c.index[-250:]], "c": [_r(x, 2) for x in c.iloc[-250:]]}
        etf_out.append(rec)
    etf_out.sort(key=lambda x: -(x.get("val20") or 0))
    for rec in idx_out:
        rec["etfs"] = [e["s"] for e in etf_out if e.get("track") == rec["key"]]
    return {"indices": idx_out, "etfs": etf_out}
