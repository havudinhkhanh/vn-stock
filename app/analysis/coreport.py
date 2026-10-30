"""Hồ sơ doanh nghiệp kiểu "báo cáo cổ phiếu" một trang: 5 trục chấm điểm (định giá, tương lai, quá khứ, sức khoẻ, cổ tức) –
mỗi trục 6 tiêu chí đúng / sai –, dòng doanh thu → chi phí → lợi nhuận, lịch sử 12 tháng, lợi nhuận → dòng tiền tự do,
tăng trưởng so với ngành / thị trường, cân đối kế toán, cổ tức, ban lãnh đạo, cơ cấu cổ đông, giao dịch nội bộ, sự kiện.
Đơn vị: tiền tỷ đồng · giá nghìn đồng · cổ tức, EPS đồng/cổ phiếu. Số liệu lấy từ BCTC (Vietcap / KBS) và Vietcap IQ (cổ đông, sự kiện)."""
from __future__ import annotations

import html
import re

import numpy as np
import pandas as pd

from .fundamentals import _num, _r

SAVINGS = 5.0          # % lãi tiết kiệm 12 tháng (mốc so sánh tăng trưởng dự phóng)
_TAG = re.compile(r"<[^>]+>")


def _txt(s) -> str:
    s = html.unescape(_TAG.sub(" ", str(s or "")))
    return re.sub(r"\s+", " ", s).strip()


def _cagr(a, b, years):
    a, b = _num(a), _num(b)
    if a is None or b is None or a <= 0 or b <= 0 or years <= 0:
        return None
    return 100 * ((a / b) ** (1 / years) - 1)


def _g(a, b):
    a, b = _num(a), _num(b)
    if a is None or b is None or b <= 0:
        return None
    return 100 * (a / b - 1)


def _seq(qs: pd.DataFrame | None) -> pd.DataFrame | None:
    """Chuỗi quý liên tiếp (đã có cột *_ttm từ add_ttm), bỏ quý trống cuối."""
    if qs is None or qs.empty:
        return None
    q = qs.sort_values(["year", "quarter"]).drop_duplicates(["year", "quarter"], keep="last").reset_index(drop=True)
    ok = q.dropna(subset=["revenue", "net_income", "total_assets"], how="all")
    return q.loc[: ok.index[-1]] if len(ok) else None


def growth(qs: pd.DataFrame | None, ys: pd.DataFrame | None) -> dict:
    """Tăng trưởng lợi nhuận / doanh thu 1 năm & 5 năm (theo năm, kép) từ số 12 tháng gần nhất."""
    q = _seq(qs)
    out = {}
    def ni_of(r):
        v = _num(r.get("ni_parent_ttm"))
        return v if v is not None else _num(r.get("net_income_ttm"))
    if q is not None and len(q) >= 5:
        L = q.iloc[-1]
        out["ni_t"], out["rev_t"] = ni_of(L), _num(L.get("revenue_ttm"))
        out["g1"] = _g(ni_of(L), ni_of(q.iloc[-5]))
        out["rg1"] = _g(L.get("revenue_ttm"), q.iloc[-5].get("revenue_ttm"))
        if len(q) >= 21:
            out["g5"] = _cagr(ni_of(L), ni_of(q.iloc[-21]), 5)
            out["rg5"] = _cagr(L.get("revenue_ttm"), q.iloc[-21].get("revenue_ttm"), 5)
    if out.get("g5") is None and ys is not None and len(ys) >= 6:
        y = ys.sort_values("year")
        ni = y["ni_parent"].fillna(y["net_income"])
        out["g5"] = _cagr(ni.iloc[-1], ni.iloc[-6], 5)
        out["rg5"] = _cagr(y["revenue"].iloc[-1], y["revenue"].iloc[-6], 5)
    return {k: (_r(v, 1) if k not in ("ni_t", "rev_t") else v) for k, v in out.items()}


def universe_stats(u: pd.DataFrame, fq_by: dict, fy_by: dict, fwd_g: dict) -> dict:
    """Mốc so sánh cho từng ngành & toàn thị trường: tăng trưởng LN 1 / 5 năm, tăng trưởng dự phóng, P/E, P/B, tỷ suất cổ tức."""
    rows = []
    for s in u.index:
        g = growth(fq_by.get(s), fy_by.get(s))
        f = fwd_g.get(s) or {}
        rows.append({"s": s, "ind": u.at[s, "industry"] if "industry" in u else None, "g1": g.get("g1"), "g5": g.get("g5"), "rg1": g.get("rg1"), "rg5": g.get("rg5"),
                     "fg": f.get("g"), "frg": f.get("rg"), "froe": f.get("roe"),
                     "pe": _num(u.at[s, "pe"]) if "pe" in u else None, "pb": _num(u.at[s, "pb"]) if "pb" in u else None,
                     "dy": _num(u.at[s, "div_yield"]) if "div_yield" in u else None})
    D = pd.DataFrame(rows)
    if D.empty:
        return {"mkt": {}, "ind": {}}
    for c in ("g1", "g5", "rg1", "rg5", "fg", "frg"):
        D[c] = pd.to_numeric(D[c], errors="coerce").clip(-90, 300)
    D["pe"] = pd.to_numeric(D["pe"], errors="coerce").where(lambda x: (x > 0) & (x < 100))
    D["pb"] = pd.to_numeric(D["pb"], errors="coerce").where(lambda x: (x > 0) & (x < 20))
    D["dy"] = pd.to_numeric(D["dy"], errors="coerce")

    def agg(x):
        pay = x["dy"][x["dy"] > 0]
        m = lambda c: _r(x[c].median(), 1) if x[c].notna().sum() >= 3 else None  # noqa: E731
        return {"g1": m("g1"), "g5": m("g5"), "rg1": m("rg1"), "rg5": m("rg5"), "fg": m("fg"), "frg": m("frg"), "froe": m("froe"),
                "pe": m("pe"), "pb": _r(x["pb"].median(), 2) if x["pb"].notna().sum() >= 3 else None,
                "dy_avg": _r(pay.mean(), 2) if len(pay) >= 3 else None, "dy25": _r(pay.quantile(0.25), 2) if len(pay) >= 8 else None,
                "dy75": _r(pay.quantile(0.75), 2) if len(pay) >= 8 else None, "n": int(len(x))}
    return {"mkt": agg(D), "ind": {k: agg(g) for k, g in D.groupby("ind") if k}}


def fwd_growth(val: dict | None, ni_t, rev_t) -> dict | None:
    """Tăng trưởng LN / doanh thu bình quân năm theo kịch bản cơ sở của mô hình định giá (không phải dự báo của CTCK)."""
    rows = (((val or {}).get("scenarios") or {}).get("base") or {}).get("rows") or []
    if not rows:
        return None
    n = len(rows); L = rows[-1]
    return {"g": _r(_cagr(L.get("ni"), ni_t, n), 1), "rg": _r(_cagr(L.get("revenue"), rev_t, n), 1),
            "roe": _r(100 * L["roe"], 1) if _num(L.get("roe")) is not None else None, "n": n,
            "ni": [_r(r.get("ni"), 0) for r in rows], "rev": [_r(r.get("revenue"), 0) for r in rows], "eps": [_r(r.get("eps"), 0) for r in rows],
            "dps": [_r(r.get("dps"), 0) for r in rows]}


def _chk(ok, name, why):
    return {"ok": None if ok is None else bool(ok), "n": name, "w": why}


def build(sym: str, r: pd.Series, qs, ys, divs, fa: dict, val: dict | None, close: pd.Series | None, prof: dict | None, stats: dict,
          peer_med: dict | None, fwd: dict | None) -> dict:
    fa = fa or {}
    bank = str(fa.get("ctype") or r.get("ctype") or "CT") != "CT"
    price = _num(r.get("price"))
    ind = (stats.get("ind") or {}).get(r.get("industry")) or {}
    mkt = stats.get("mkt") or {}
    q = _seq(qs)
    gr = growth(qs, ys)
    out: dict = {"bank": bank, "g": gr, "ind": ind, "mkt": mkt, "ind_name": r.get("industry"), "savings": SAVINGS}

    # ---------------- dòng doanh thu → chi phí → lợi nhuận (từng năm + 12 tháng gần nhất)
    def sk_row(x, label, ttm=False):
        g = lambda k: _num(x.get(k + "_ttm" if ttm else k))  # noqa: E731
        rev = g("toi") if bank and g("toi") else g("revenue")
        if rev is None or rev <= 0:
            return None
        ni = g("ni_parent") if g("ni_parent") is not None else g("net_income")
        if bank:
            return {"p": label, "rev": _r(rev, 0), "nii": _r(g("nii"), 0), "prov": _r(g("provision"), 0), "pbt": _r(g("pbt"), 0), "tax": _r(g("tax"), 0), "ni": _r(ni, 0)}
        cogs, gp = g("cogs"), g("gross_profit")
        if gp is None and cogs is not None:
            gp = rev - cogs
        op, pbt = g("operating_profit"), g("pbt")
        return {"p": label, "rev": _r(rev, 0), "cogs": _r(cogs if cogs is not None else (rev - gp if gp is not None else None), 0), "gp": _r(gp, 0),
                "sell": _r(g("selling_exp"), 0), "adm": _r(g("admin_exp"), 0), "fin_in": _r(g("fin_income"), 0), "fin_ex": _r(g("fin_exp"), 0),
                "int": _r(g("interest_exp"), 0), "op": _r(op, 0),
                "jv": _r(op - (gp - (g("selling_exp") or 0) - (g("admin_exp") or 0) + (g("fin_income") or 0) - (g("fin_exp") or 0)), 0) if op is not None and gp is not None else None, "oth": _r(pbt - op, 0) if pbt is not None and op is not None else None,
                "pbt": _r(pbt, 0), "tax": _r(g("tax"), 0), "mi": _r((g("net_income") or 0) - (ni or 0), 0) if g("net_income") is not None and ni is not None else None, "ni": _r(ni, 0)}
    sk = []
    if ys is not None and not ys.empty:
        for _, x in ys.sort_values("year").tail(11).iterrows():
            v = sk_row(x, str(int(x["year"])))
            if v:
                sk.append(v)
    if q is not None and len(q) >= 4:
        L = q.iloc[-1]
        v = sk_row(L, f"12T đến Q{int(L['quarter'])}/{int(L['year'])}", ttm=True)
        if v:
            sk.append(v)
    out["sk"] = sk

    # ---------------- lịch sử 12 tháng theo quý (tối đa 10 năm): doanh thu, lợi nhuận, dòng tiền kinh doanh / tự do, chi phí hoạt động
    if q is not None:
        H = []
        for _, x in q.tail(40).iterrows():
            g = lambda k: _num(x.get(k + "_ttm"))  # noqa: E731
            rev = g("toi") if bank and g("toi") else g("revenue")
            ni = g("ni_parent") if g("ni_parent") is not None else g("net_income")
            if rev is None and ni is None:
                continue
            cfo = g("cfo")
            H.append({"p": f"Q{int(x['quarter'])}/{int(x['year']) % 100:02d}", "rev": _r(rev, 0), "ni": _r(ni, 0), "cfo": _r(cfo, 0) if not bank else None,
                      "fcf": _r(cfo + (g("capex") or 0), 0) if cfo is not None and not bank else None,
                      "opex": _r((g("selling_exp") or 0) + (g("admin_exp") or 0), 0) if (g("selling_exp") is not None or g("admin_exp") is not None) else None})
        out["hist"] = H

    # ---------------- lợi nhuận → dòng tiền tự do (12 tháng gần nhất)
    if q is not None and len(q) >= 5 and not bank:
        L, P = q.iloc[-1], q.iloc[-5]
        ni = _num(L.get("ni_parent_ttm")) if _num(L.get("ni_parent_ttm")) is not None else _num(L.get("net_income_ttm"))
        cfo, capex = _num(L.get("cfo_ttm")), _num(L.get("capex_ttm"))
        eb, ebit = _num(L.get("ebitda")), _num(L.get("ebit"))
        da = eb - ebit if eb and ebit and eb >= ebit else None
        def nwc(x):
            a = [_num(x.get(k)) for k in ("receivables", "inventory", "current_liab", "st_debt")]
            return None if any(v is None for v in a[:3]) else a[0] + a[1] - (a[2] - (a[3] or 0))
        dn = (nwc(L) - nwc(P)) if nwc(L) is not None and nwc(P) is not None else None
        if ni is not None and cfo is not None:
            fcf = cfo + (capex or 0)
            w = {"ni": _r(ni, 0), "da": _r(da, 0), "sbc": 0, "nwc": _r(-dn, 0) if dn is not None else None, "capex": _r(capex, 0), "cfo": _r(cfo, 0), "fcf": _r(fcf, 0)}
            w["oth"] = _r(cfo - ni - (da or 0) - (-dn if dn is not None else 0), 0)
            out["wf"] = w

    # ---------------- cân đối kế toán (quý gần nhất) + lịch sử nợ / vốn chủ / tiền
    if q is not None:
        L = q.iloc[-1]
        n = lambda k: _num(L.get(k))  # noqa: E731
        ta, tl, cl, eq = n("total_assets"), n("total_liab"), n("current_liab"), n("equity")
        std, ltd = n("st_debt") or 0, n("lt_debt") or 0
        debt = std + ltd
        cash = (n("cash") or 0) + (n("st_invest") or 0)
        bs = {"p": f"Q{int(L['quarter'])}/{int(L['year'])}", "ta": _r(ta, 0), "tl": _r(tl, 0), "eq": _r(eq, 0), "mi": _r(n("minority"), 0),
              "cash": _r(cash, 0), "rec": _r(n("receivables"), 0), "inv": _r(n("inventory"), 0), "fa": _r(n("fixed_assets"), 0),
              "ca": _r(n("current_assets"), 0), "cl": _r(cl, 0), "ltl": _r(tl - cl, 0) if tl is not None and cl is not None else None,
              "debt": _r(debt, 0), "std": _r(std, 0), "ltd": _r(ltd, 0), "loans": _r(n("loans"), 0), "dep": _r(n("deposits"), 0)}
        if ta is not None:
            bs["oa"] = _r(ta - sum(v or 0 for v in (cash, n("receivables"), n("inventory"), n("fixed_assets"))), 0)
        if tl is not None:
            bs["ocl"] = _r((cl or 0) - std, 0) if cl is not None else None
            bs["oll"] = _r(tl - (cl or 0) - ltd, 0) if cl is not None else None
        out["bs"] = bs
        H = []
        for _, x in q.iloc[::-1].iloc[::4].iloc[::-1].tail(11).iterrows():      # mỗi năm 1 điểm (cùng quý)
            dd = (_num(x.get("st_debt")) or 0) + (_num(x.get("lt_debt")) or 0)
            H.append({"p": f"Q{int(x['quarter'])}/{int(x['year']) % 100:02d}", "debt": _r(dd, 0), "eq": _r(x.get("equity"), 0),
                      "cash": _r((_num(x.get("cash")) or 0) + (_num(x.get("st_invest")) or 0), 0)})
        out["dh"] = H

    # ---------------- cổ tức theo năm (tiền mặt, đồng/cp theo số CP hiện tại) + tỷ suất + EPS
    dv = []
    eps_y = {}
    if ys is not None and not ys.empty:
        for _, x in ys.iterrows():
            ni = _num(x.get("ni_parent")) if _num(x.get("ni_parent")) is not None else _num(x.get("net_income"))
            sh = _num(x.get("shares")) or _num(fa.get("shares_mn"))
            if ni is not None and sh:
                eps_y[int(x["year"])] = ni * 1000 / sh
    if divs is not None and not divs.empty:
        d = divs[divs["method"].astype(str).str.contains("cash")].copy()
        d["yr"] = pd.to_datetime(d["ex_date"]).dt.year
        by = d.groupby("yr")["cash_pct"].sum() * 10000
        if len(by):
            y0, y1 = max(int(by.index.min()), pd.Timestamp.now().year - 12), pd.Timestamp.now().year
            for y in range(y0, y1 + 1):
                dps = float(by.get(y, 0.0))
                px = None
                if close is not None and len(close):
                    c = close[(close.index.year == y)]
                    px = float(c.mean()) if len(c) else None
                dv.append({"y": y, "dps": _r(dps, 0), "dy": _r(dps / (px * 1000) * 100, 2) if px and dps else (0 if px else None), "eps": _r(eps_y.get(y), 0)})
    fdv = fa.get("dividend") or {}
    dy = _num(fdv.get("yield")) if fdv.get("yield") is not None else _num(r.get("div_yield"))
    payout = _num(fdv.get("payout"))
    cpay = None
    if q is not None:
        L = q.iloc[-1]
        dp, fcf = _num(L.get("dividends_paid_ttm")), _num(L.get("cfo_ttm"))
        if fcf is not None:
            fcf = fcf + (_num(L.get("capex_ttm")) or 0)
        if dp is not None and fcf:
            cpay = _r(100 * abs(dp) / fcf, 0) if fcf > 0 else _r(-100 * abs(dp) / abs(fcf), 0)
    out["dv"] = {"hist": dv, "yield": _r(dy, 2), "dps": _r(fdv.get("dps_ttm"), 0), "payout": _r(payout, 0), "cash_payout": cpay,
                 "years": fdv.get("cash_years"), "last_ex": fdv.get("last_ex_date"), "fwd_dps": (fwd or {}).get("dps"),
                 "fwd_yield": _r((fwd or {}).get("dps")[0] / (price * 1000) * 100, 2) if fwd and fwd.get("dps") and fwd["dps"][0] and price else None}

    # ---------------- tiêu chí 5 trục
    C: dict = {}
    fair, up = _num((val or {}).get("fair")), None
    if fair and price:
        up = 100 * (fair / price - 1)
    pe, pb = _num(fa.get("pe")), _num(fa.get("pb"))
    pm = peer_med or {}
    vmeth = bool((val or {}).get("reliable"))
    C["val"] = [
        _chk(price < fair if fair and price else None, "Giá dưới giá trị hợp lý", f"Giá {price:g} so với giá trị hợp lý {fair:g} (nghìn đồng) của mô hình định giá trên trang{'' if vmeth else ' – mô hình ghi chú độ tin cậy thấp'}." if fair and price else "Chưa đủ số liệu để định giá."),
        _chk(price < 0.8 * fair if fair and price else None, "Giá thấp hơn giá trị hợp lý trên 20%", f"Biên an toàn {up:+.1f}%." if up is not None else "Chưa đủ số liệu."),
        _chk(pe < pm.get("pe") if pe and pe > 0 and pm.get("pe") else None, "P/E thấp hơn mâm so sánh", f"P/E {pe:.1f} so với trung vị mâm {pm.get('pe'):.1f}." if pe and pm.get("pe") else "Chưa có P/E dương hoặc mâm so sánh."),
        _chk(pe < ind.get("pe") if pe and pe > 0 and ind.get("pe") else None, "P/E thấp hơn ngành", f"P/E {pe:.1f} so với trung vị ngành {ind.get('pe'):.1f}." if pe and ind.get("pe") else "Chưa đủ số liệu."),
        _chk(pe < mkt.get("pe") if pe and pe > 0 and mkt.get("pe") else None, "P/E thấp hơn thị trường", f"P/E {pe:.1f} so với trung vị thị trường {mkt.get('pe'):.1f}." if pe and mkt.get("pe") else "Chưa đủ số liệu."),
        _chk(pb < ind.get("pb") if pb and pb > 0 and ind.get("pb") else None, "P/B thấp hơn ngành", f"P/B {pb:.2f} so với trung vị ngành {ind.get('pb'):.2f}." if pb and ind.get("pb") else "Chưa đủ số liệu."),
    ]
    f = fwd or {}
    C["fut"] = [
        _chk(f["g"] > SAVINGS if f.get("g") is not None else None, "LN dự phóng tăng nhanh hơn lãi tiết kiệm", f"LN dự phóng tăng {f.get('g')}%/năm so với lãi tiết kiệm ~{SAVINGS:g}%." if f.get("g") is not None else "Chưa có dự phóng."),
        _chk(f["g"] > mkt["fg"] if f.get("g") is not None and mkt.get("fg") is not None else None, "LN dự phóng tăng nhanh hơn thị trường", f"{f.get('g')}%/năm so với trung vị thị trường {mkt.get('fg')}%." if f.get("g") is not None else "Chưa có dự phóng."),
        _chk(f["g"] > 20 if f.get("g") is not None else None, "LN dự phóng tăng cao (> 20%/năm)", f"{f.get('g')}%/năm." if f.get("g") is not None else "Chưa có dự phóng."),
        _chk(f["rg"] > mkt["frg"] if f.get("rg") is not None and mkt.get("frg") is not None else None, "Doanh thu dự phóng tăng nhanh hơn thị trường", f"{f.get('rg')}%/năm so với {mkt.get('frg')}%." if f.get("rg") is not None else "Chưa có dự phóng."),
        _chk(f["rg"] > 20 if f.get("rg") is not None else None, "Doanh thu dự phóng tăng cao (> 20%/năm)", f"{f.get('rg')}%/năm." if f.get("rg") is not None else "Chưa có dự phóng."),
        _chk(f["roe"] >= 20 if f.get("roe") is not None else None, "ROE dự phóng cao (≥ 20%)", f"ROE năm cuối dự phóng {f.get('roe')}%." if f.get("roe") is not None else "Chưa có dự phóng."),
    ]
    roe, nm = _num(fa.get("roe")), _num(fa.get("net_margin"))
    nm1 = None
    if q is not None and len(q) >= 5:
        P = q.iloc[-5]
        ni_p = _num(P.get("ni_parent_ttm")) if _num(P.get("ni_parent_ttm")) is not None else _num(P.get("net_income_ttm"))
        rv_p = _num(P.get("toi_ttm")) if bank and _num(P.get("toi_ttm")) else _num(P.get("revenue_ttm"))
        nm1 = 100 * ni_p / rv_p if ni_p is not None and rv_p else None
    acc = None
    if q is not None and not bank:
        L = q.iloc[-1]
        ni, cfo, ta = _num(L.get("ni_parent_ttm")), _num(L.get("cfo_ttm")), _num(L.get("total_assets"))
        if ni is not None and cfo is not None and ta:
            acc = 100 * (ni - cfo) / ta
    g1, g5 = gr.get("g1"), gr.get("g5")
    C["past"] = [
        _chk(acc <= 10 if acc is not None else None, "Lợi nhuận chất lượng (thu được bằng tiền)", f"(LN − dòng tiền kinh doanh) / tổng tài sản = {acc:.1f}% (> 10% là nhiều lợi nhuận chưa thu tiền)." if acc is not None else "Không áp dụng / thiếu số liệu."),
        _chk(nm > nm1 if nm is not None and nm1 is not None else None, "Biên lợi nhuận tăng", f"Biên LN ròng {nm:.1f}% so với {nm1:.1f}% một năm trước." if nm is not None and nm1 is not None else "Thiếu số liệu."),
        _chk(g5 > 0 if g5 is not None else None, "Lợi nhuận tăng trong 5 năm", f"Tăng bình quân {g5:+.1f}%/năm." if g5 is not None else "Chưa đủ 5 năm số liệu."),
        _chk(g1 > g5 if g1 is not None and g5 is not None else None, "Tăng trưởng đang nhanh lên", f"1 năm qua {g1:+.1f}% so với bình quân 5 năm {g5:+.1f}%/năm." if g1 is not None and g5 is not None else "Thiếu số liệu."),
        _chk(g1 > ind["g1"] if g1 is not None and ind.get("g1") is not None else None, "Tăng nhanh hơn ngành", f"1 năm qua {g1:+.1f}% so với trung vị ngành {ind.get('g1'):+.1f}%." if g1 is not None and ind.get("g1") is not None else "Thiếu số liệu."),
        _chk(roe >= 20 if roe is not None else None, "ROE cao (≥ 20%)", f"ROE {roe:.1f}%." if roe is not None else "Thiếu số liệu."),
    ]
    bs = out.get("bs") or {}
    if not bank:
        de_now = (bs.get("debt") or 0) / bs["eq"] * 100 if bs.get("eq") else None
        de_5 = None
        if q is not None and len(q) >= 21:
            P = q.iloc[-21]; e5 = _num(P.get("equity"))
            de_5 = ((_num(P.get("st_debt")) or 0) + (_num(P.get("lt_debt")) or 0)) / e5 * 100 if e5 else None
        nde = ((bs.get("debt") or 0) - (bs.get("cash") or 0)) / bs["eq"] * 100 if bs.get("eq") else None
        cfo_t = (out.get("wf") or {}).get("cfo")
        icov = _num(fa.get("interest_cover"))
        C["hlth"] = [
            _chk(bs["ca"] > bs["cl"] if bs.get("ca") is not None and bs.get("cl") else None, "Tài sản ngắn hạn > nợ ngắn hạn", f"{bs.get('ca'):,.0f} so với {bs.get('cl'):,.0f} tỷ." if bs.get("ca") is not None and bs.get("cl") else "Thiếu số liệu."),
            _chk(bs["ca"] > bs["ltl"] if bs.get("ca") is not None and bs.get("ltl") is not None else None, "Tài sản ngắn hạn > nợ dài hạn", f"{bs.get('ca'):,.0f} so với {bs.get('ltl'):,.0f} tỷ." if bs.get("ca") is not None and bs.get("ltl") is not None else "Thiếu số liệu."),
            _chk(nde < 40 if nde is not None else None, "Nợ vay ròng / vốn chủ < 40%", ("Tiền & đầu tư ngắn hạn nhiều hơn nợ vay (tiền ròng)." if nde is not None and nde < 0 else f"Nợ vay ròng bằng {nde:.1f}% vốn chủ.") if nde is not None else "Thiếu số liệu."),
            _chk(de_now < de_5 if de_now is not None and de_5 is not None else None, "Nợ vay / vốn chủ giảm trong 5 năm", f"{de_5:.1f}% → {de_now:.1f}%." if de_now is not None and de_5 is not None else "Chưa đủ 5 năm số liệu."),
            _chk((cfo_t / bs["debt"] > 0.2) if bs.get("debt") and cfo_t is not None else (True if bs.get("debt") == 0 else None), "Dòng tiền kinh doanh trả được nợ (> 20% nợ vay)", (f"Dòng tiền kinh doanh 12 tháng bằng {100 * cfo_t / bs['debt']:.0f}% nợ vay." if bs.get("debt") and cfo_t is not None else "Không có nợ vay.") if bs.get("debt") is not None else "Thiếu số liệu."),
            _chk(icov > 3 if icov is not None else (True if bs.get("debt") == 0 else None), "Lợi nhuận trả lãi vay > 3 lần", f"EBIT gấp {icov:.1f} lần lãi vay." if icov is not None else ("Không có nợ vay." if bs.get("debt") == 0 else "Thiếu số liệu.")),
        ]
    else:
        npl, ldr = _num(fa.get("npl")), (bs.get("loans") / bs["dep"] * 100 if bs.get("loans") and bs.get("dep") else None)
        ea = bs["eq"] / bs["ta"] * 100 if bs.get("eq") and bs.get("ta") else None
        C["hlth"] = [
            _chk(npl <= 2 if npl is not None else None, "Nợ xấu ≤ 2%", f"Nợ xấu {npl:.2f}%." if npl is not None else "Thiếu số liệu."),
            _chk(ldr <= 90 if ldr is not None else None, "Cho vay / tiền gửi ≤ 90%", f"{ldr:.0f}%." if ldr is not None else "Thiếu số liệu."),
            _chk(ea >= 8 if ea is not None else None, "Vốn chủ / tổng tài sản ≥ 8%", f"{ea:.1f}%." if ea is not None else "Thiếu số liệu."),
            _chk(_num(fa.get("nim")) >= 3 if _num(fa.get("nim")) is not None else None, "Biên lãi thuần (NIM) ≥ 3%", f"NIM {_num(fa.get('nim')):.2f}%." if _num(fa.get("nim")) is not None else "Thiếu số liệu."),
            _chk(roe >= 15 if roe is not None else None, "ROE ≥ 15%", f"ROE {roe:.1f}%." if roe is not None else "Thiếu số liệu."),
            _chk(g1 > 0 if g1 is not None else None, "Lợi nhuận 12 tháng tăng", f"{g1:+.1f}%." if g1 is not None else "Thiếu số liệu."),
        ]
    pays = [x for x in dv if x["y"] < pd.Timestamp.now().year]
    paid = [x["dps"] for x in pays if x["dps"]]
    stable = None
    if len(pays) >= 5:
        seq = [x["dps"] or 0 for x in pays[-10:]]
        stable = all(v > 0 for v in seq) and all(seq[i] >= 0.75 * seq[i - 1] for i in range(1, len(seq)))
    grow = (pays[-1]["dps"] or 0) > (pays[-10 if len(pays) >= 10 else 0]["dps"] or 0) if len(pays) >= 5 else None
    d25, d75 = mkt.get("dy25"), mkt.get("dy75")
    C["div"] = [
        _chk(dy > d25 if dy is not None and d25 is not None else None, "Cổ tức đáng kể (cao hơn 25% thấp nhất thị trường)", f"Tỷ suất {dy or 0:.2f}% so với mốc {d25}%." if d25 is not None else "Thiếu số liệu thị trường."),
        _chk(dy > d75 if dy is not None and d75 is not None else None, "Cổ tức cao (thuộc 25% cao nhất thị trường)", f"Tỷ suất {dy or 0:.2f}% so với mốc {d75}%." if d75 is not None else "Thiếu số liệu thị trường."),
        _chk(stable, "Cổ tức ổn định (10 năm không cắt > 25%)", "Năm nào cũng trả, không năm nào giảm quá 25%." if stable else ("Có năm không trả hoặc giảm mạnh." if stable is False else "Chưa đủ 5 năm lịch sử.")),
        _chk(grow, "Cổ tức tăng dần", f"{pays[-10 if len(pays) >= 10 else 0]['y']}: {pays[-10 if len(pays) >= 10 else 0]['dps'] or 0:,.0f}đ → {pays[-1]['y']}: {pays[-1]['dps'] or 0:,.0f}đ." if grow is not None else "Chưa đủ lịch sử."),
        _chk(0 < payout <= 90 if payout is not None and dy else (None if dy else False), "Lợi nhuận đủ trả cổ tức (chi trả ≤ 90%)", f"Tỷ lệ chi trả {payout:.0f}% lợi nhuận." if payout is not None and dy else "Không trả cổ tức tiền mặt."),
        _chk(0 < cpay <= 90 if cpay is not None and dy else (None if dy else False), "Dòng tiền tự do đủ trả cổ tức (≤ 90%)", (f"Cổ tức đã trả bằng {cpay:.0f}% dòng tiền tự do." if cpay > 0 else "Dòng tiền tự do âm mà vẫn trả cổ tức.") if cpay is not None and dy else "Không trả cổ tức tiền mặt / thiếu số liệu."),
    ]
    out["checks"] = C
    out["score"] = {k: sum(1 for c in v if c["ok"]) for k, v in C.items()}
    out["fwd"] = f
    out["val"] = {"fair": _r(fair, 2), "up": _r(up, 1), "pe": _r(pe, 1), "pb": _r(pb, 2), "pe_peer": pm.get("pe"), "pe_ind": ind.get("pe"), "pe_mkt": mkt.get("pe"),
                  "pb_peer": pm.get("pb"), "pb_ind": ind.get("pb"), "pb_mkt": mkt.get("pb"), "reliable": vmeth}

    # ---------------- cổ đông, ban lãnh đạo, giao dịch nội bộ, sự kiện, thông tin công ty
    P_ = prof or {}
    sh_n = _num(fa.get("shares_mn"))
    S = P_.get("struct") or {}
    if S:
        st_, inst, bod, fo = (_num(S.get(k)) or 0 for k in ("statePercentage", "institutionPercentage", "bodPercentage", "foreignPercentage"))
        out["own"] = {"state": _r(100 * st_, 2), "inst": _r(100 * max(0, inst - st_), 2), "bod": _r(100 * bod, 2), "pub": _r(100 * max(0, 1 - inst - bod), 2),
                      "foreign": _r(100 * fo, 2), "foreign_max": _r(100 * _num((P_.get("det") or {}).get("maximumForeignPercentage") or 0), 0) or None, "total": _num(S.get("totalShares"))}
    tops = []
    for x in (P_.get("sh") or [])[:30]:
        qn, pc = _num(x.get("q")), _num(x.get("pct"))
        tops.append({**x, "val": _r(qn * price / 1e6, 1) if qn and price else (_r(pc * sh_n * price / 1000, 1) if pc and sh_n and price else None)})
    out["top"] = tops
    mgr = [x for x in (P_.get("sh") or []) if x.get("pos")]
    seen = {x["n"] for x in mgr}
    for t in P_.get("ins") or []:
        if t.get("pos") and t.get("n") and t["n"] not in seen and t.get("code") == "DDIND":
            seen.add(t["n"]); mgr.append({"n": t["n"], "pos": t["pos"], "q": _num(t.get("after")) or None, "pct": None, "t": "INDIVIDUAL"})
    out["mgr"] = mgr[:25]
    ceo = next((x for x in mgr if re.search(r"tổng giám đốc|ceo|giám đốc điều hành", str(x.get("pos")), re.I) and not re.search(r"phó", str(x.get("pos")), re.I)), None)
    chair = next((x for x in mgr if re.search(r"chủ tịch", str(x.get("pos")), re.I) and not re.search(r"phó", str(x.get("pos")), re.I)), None)
    out["ceo"], out["chair"] = ceo, chair
    now = pd.Timestamp.now()
    buck = [{"m": f"{i * 3}–{i * 3 + 3}", "ib": 0, "is": 0, "cb": 0, "cs": 0} for i in range(4)]
    nb = ns = 0
    for t in P_.get("ins") or []:
        d = pd.to_datetime(t.get("d"), errors="coerce"); a = _num(t.get("acq"))
        if pd.isna(d) or not a:
            continue
        k = int((now - d).days // 91)
        if 0 <= k < 4:
            ind_ = t.get("code") == "DDIND"
            buck[k][("i" if ind_ else "c") + ("b" if a > 0 else "s")] += abs(a)
            if a > 0: nb += a
            else: ns += -a
    out["ins12"] = buck
    out["ins"] = (P_.get("ins") or [])[:30]
    out["ev"] = (P_.get("ev") or [])[:30]
    det = P_.get("det") or {}
    out["co"] = {"name": det.get("viOrganName") or r.get("name"), "short": det.get("viOrganShortName"), "en": det.get("enOrganName"), "exchange": r.get("exchange"),
                 "sector": r.get("sector"), "industry": r.get("industry"), "sub": r.get("subindustry"), "mcap": _r(r.get("mcap_bn"), 0), "shares": _r(sh_n, 2),
                 "profile": _txt(det.get("profile"))[:2400] or None, "hi52": _num(det.get("highestPrice1Year")), "lo52": _num(det.get("lowestPrice1Year")),
                 "fetched": P_.get("fetched")}
    # ban lãnh đạo: tiêu chí
    bodp = (out.get("own") or {}).get("bod")
    C["mgmt"] = [
        _chk(bool(ceo) if P_ else None, "Có thông tin Tổng giám đốc", f"{ceo['n']} – {ceo['pos']}." if ceo else ("Chưa tìm thấy trong danh sách cổ đông / giao dịch nội bộ." if P_ else "Chưa tải dữ liệu cổ đông.")),
        _chk(bodp >= 0.5 if bodp is not None else None, "Ban lãnh đạo có nắm giữ đáng kể (≥ 0,5%)", f"HĐQT & ban điều hành nắm {bodp:.2f}% cổ phần." if bodp is not None else "Thiếu số liệu."),
        _chk(nb >= ns if P_ and (nb or ns) else None, "Người nội bộ mua ròng 12 tháng", f"Mua {nb:,.0f} · bán {ns:,.0f} cổ phiếu." if nb or ns else "Không có giao dịch nội bộ đã hoàn tất trong 12 tháng."),
    ]
    out["score"]["mgmt"] = sum(1 for c in C["mgmt"] if c["ok"])
    # pha loãng: số CP hiện tại so với 1 năm trước
    dil = None
    if q is not None and len(q) >= 5:
        s1, s0 = _num(q.iloc[-1].get("shares")), _num(q.iloc[-5].get("shares"))
        if s1 and s0:
            f_ = 1.0      # chia cổ tức / thưởng bằng cổ phiếu trong 12 tháng không làm giảm phần sở hữu → loại ra
            if divs is not None and not divs.empty:
                d = divs[~divs["method"].astype(str).str.contains("cash")]
                ex = pd.to_datetime(d["ex_date"])
                for v in pd.to_numeric(d.loc[(ex > pd.Timestamp.now() - pd.Timedelta(days=400)), "cash_pct"], errors="coerce").dropna():
                    if 0 < v < 3:
                        f_ *= 1 + v
            dil = {"raw": _r(100 * (s1 / s0 - 1), 1), "adj": _r(100 * (s1 / (s0 * f_) - 1), 1), "stock": _r(100 * (f_ - 1), 1)}
    out["dil"] = dil
    return out


# ------------------------------------------------------------------ nén dữ liệu Vietcap IQ cho mỗi mã (lưu ở data/profiles.json)
def compact_profile(sh: list, struct: dict, ins: list, ev: list, det: dict) -> dict:
    T = lambda s: str(s or "")[:10]  # noqa: E731
    S = [{"n": x.get("ownerName") or x.get("ownerNameEn"), "q": x.get("quantity"), "pct": _r(100 * (_num(x.get("percentage")) or 0), 3), "t": x.get("ownerType"),
          "pos": x.get("positionName"), "d": T(x.get("publicDate"))} for x in sh or [] if isinstance(x, dict) and x.get("percentage") is not None]
    S.sort(key=lambda x: -(x["pct"] or 0))
    I = [{"d": T(x.get("publicDate") or x.get("displayDate1")), "n": x.get("traderNameVi"), "pos": x.get("traderPositionVi"), "act": x.get("actionTypeVi"),
          "reg": x.get("shareRegister"), "acq": x.get("shareAcquire"), "before": x.get("shareBeforeTrade"), "after": x.get("shareAfterTrade"),
          "own": _r(100 * (_num(x.get("ownershipAfterTrade")) or 0), 3), "st": x.get("tradeStatusVi"), "code": x.get("eventCode"), "s": T(x.get("startDate")), "e": T(x.get("endDate"))}
         for x in ins or [] if isinstance(x, dict)]
    E = [{"d": T(x.get("publicDate") or x.get("displayDate1")), "c": x.get("eventCode"), "cat": x.get("category"), "t": x.get("eventTitleVi") or x.get("eventNameVi"),
          "x": T(x.get("exrightDate")), "r": T(x.get("recordDate"))} for x in ev or [] if isinstance(x, dict)]
    E.sort(key=lambda x: x["d"], reverse=True); I.sort(key=lambda x: x["d"], reverse=True)
    keep = ("viOrganName", "viOrganShortName", "enOrganName", "profile", "highestPrice1Year", "lowestPrice1Year", "maximumForeignPercentage", "foreignerPercentage", "statePercentage", "comTypeCode")
    return {"sh": S[:40], "struct": struct or {}, "ins": I[:60], "ev": E[:60], "det": {k: det.get(k) for k in keep if det and det.get(k) is not None}}
