"""Phân tích cơ bản: TTM, chỉ số tài chính, tăng trưởng, Piotroski F-Score, cổ tức, so sánh ngành.

Quy ước đơn vị: số liệu BCTC = tỷ đồng; giá = nghìn đồng; số cổ phiếu = triệu cp;
EPS/BVPS/DPS = đồng.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

FLOW = ["revenue", "cogs", "gross_profit", "selling_exp", "admin_exp", "fin_income", "fin_exp",
        "interest_exp", "operating_profit", "pbt", "tax", "net_income", "ni_parent", "nii", "toi",
        "provision", "cfo", "capex", "fcf", "dividends_paid", "ebitda", "ebit"]
STOCK = ["total_assets", "current_assets", "cash", "st_invest", "receivables", "inventory",
         "fixed_assets", "total_liab", "current_liab", "st_debt", "lt_debt", "debt", "equity",
         "minority", "loans", "deposits", "shares", "bvps"]


def _num(x):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else x
    except (TypeError, ValueError):
        return None


def _div(a, b):
    a, b = _num(a), _num(b)
    if a is None or b is None or b == 0:
        return None
    return a / b


def _pc(a, b):
    """100 * a / b, hoặc None nếu thiếu số liệu."""
    v = _div(a, b)
    return None if v is None else 100 * v


def _r(x, nd=2):
    x = _num(x)
    return None if x is None else round(x, nd)


# ------------------------------------------------------------------ TTM
def add_ttm(q: pd.DataFrame) -> pd.DataFrame:
    """Thêm cột *_ttm (tổng 4 quý liên tiếp) cho từng mã."""
    if q.empty:
        return q
    q = q.sort_values(["symbol", "year", "quarter"]).copy()
    q["pidx"] = q["year"] * 4 + q["quarter"] - 1
    out = []
    for sym, g in q.groupby("symbol", sort=False):
        g = g.set_index("pidx").reindex(range(int(g["pidx"].min()), int(g["pidx"].max()) + 1))
        g["symbol"] = sym
        g["year"] = (g.index // 4).astype(int)
        g["quarter"] = (g.index % 4 + 1).astype(int)
        for c in FLOW:
            if c in g:
                g[c + "_ttm"] = g[c].rolling(4, min_periods=4).sum()
        out.append(g.reset_index())
    return pd.concat(out, ignore_index=True)


def latest_row(qs: pd.DataFrame) -> pd.Series | None:
    """Quý gần nhất có số liệu thật (không phải dòng trống do reindex)."""
    ok = qs.dropna(subset=["revenue", "net_income", "total_assets"], how="all")
    return None if ok.empty else ok.iloc[-1]


def period_end(year: int, quarter: int) -> pd.Timestamp:
    return pd.Timestamp(year=int(year), month=int(quarter) * 3, day=1) + pd.offsets.MonthEnd(0)


# ------------------------------------------------------------------ cổ tức
def dividend_from_cashflow(ys: pd.DataFrame | None, paid_ttm: float | None, shares: float | None,
                           price: float, eps_ttm: float | None) -> dict:
    """Dự phòng khi chưa có lịch sự kiện: cổ tức tiền mặt = 'cổ tức đã trả' trên lưu chuyển tiền tệ / số CP."""
    if not shares:
        return {"has_data": False, "cash_years": 0, "yield": None, "dps_ttm": None, "history": []}
    hist, by_year = [], {}
    if ys is not None and not ys.empty and "dividends_paid" in ys:
        for _, r in ys.sort_values("year").iterrows():
            v = _num(r.get("dividends_paid"))
            sh = _num(r.get("shares")) or shares
            if v is not None:
                by_year[int(r["year"])] = abs(v) * 1e9 / (sh * 1e6)
    now = pd.Timestamp.now()
    ttm = abs(paid_ttm) * 1e9 / (shares * 1e6) if paid_ttm is not None else by_year.get(now.year - 1)
    if ttm is None and not by_year:
        return {"has_data": False, "cash_years": 0, "yield": None, "dps_ttm": None, "history": []}
    streak = 0
    for y in sorted(by_year, reverse=True):
        if by_year[y] > 0:
            streak += 1
        else:
            break
    last3 = [by_year.get(y, 0) for y in range(now.year - 3, now.year)]
    hist = [{"year": y, "cash_dps": round(v), "stock_pct": None} for y, v in sorted(by_year.items())[-10:]]
    return {"has_data": True, "source": "cashflow", "dps_ttm": _r(ttm, 0), "dps_avg3": _r(np.mean(last3), 0),
            "yield": _r(100 * ttm / (price * 1000), 2) if price and ttm is not None else None,
            "yield_avg3": _r(100 * np.mean(last3) / (price * 1000), 2) if price else None,
            "cash_years": int(streak), "paid_years_5": int(sum(1 for v in last3 + [by_year.get(now.year - 4, 0), by_year.get(now.year - 5, 0)] if v > 0)),
            "payout": _r(100 * ttm / eps_ttm, 1) if eps_ttm and eps_ttm > 0 and ttm is not None else None,
            "last_ex_date": None, "stock_dividend_3y": None, "history": hist,
            "note": "Ước tính từ 'cổ tức đã trả' trên báo cáo lưu chuyển tiền tệ (chưa có lịch chốt quyền)."}


def dividend_profile(divs: pd.DataFrame, price: float, eps_ttm: float | None) -> dict:
    """Cổ tức tiền mặt & cổ phiếu. cash_pct là % trên mệnh giá 10.000đ."""
    if divs is None or divs.empty:
        return {"has_data": False, "cash_years": 0, "yield": None, "dps_ttm": None, "history": []}
    d = divs.copy().sort_values("ex_date")
    d["year"] = d["ex_date"].dt.year
    cash = d[d["method"].str.contains("cash|tiền", na=False)]
    stock = d[~d.index.isin(cash.index)]
    cash_by_year = (cash.groupby("year")["cash_pct"].sum() * 10000).round(0)
    last_ex = d["ex_date"].max()
    now = pd.Timestamp.now().normalize()
    ttm = cash[cash["ex_date"] > now - pd.Timedelta(days=365)]["cash_pct"].sum() * 10000
    yrs = sorted(cash_by_year.index)
    streak = 0
    for yv in range(now.year - (0 if now.year in yrs else 1), now.year - 15, -1):
        if yv in cash_by_year.index and cash_by_year[yv] > 0:
            streak += 1
        else:
            break
    hist = [{"year": int(y), "cash_dps": float(cash_by_year.get(y, 0)),
             "stock_pct": _r(100 * stock[stock["year"] == y]["cash_pct"].sum(), 1)}
            for y in sorted(set(d["year"]))[-10:]]
    dps_avg3 = float(np.mean([cash_by_year.get(y, 0) for y in range(now.year - 3, now.year)]))
    return {
        "has_data": True,
        "dps_ttm": _r(ttm, 0),
        "dps_avg3": _r(dps_avg3, 0),
        "yield": _r(100 * ttm / (price * 1000), 2) if price else None,
        "yield_avg3": _r(100 * dps_avg3 / (price * 1000), 2) if price else None,
        "cash_years": int(streak),
        "paid_years_5": int(sum(1 for y in range(now.year - 5, now.year) if cash_by_year.get(y, 0) > 0)),
        "payout": _r(100 * ttm / eps_ttm, 1) if eps_ttm and eps_ttm > 0 else None,
        "last_ex_date": str(last_ex.date()) if pd.notna(last_ex) else None,
        "stock_dividend_3y": _r(100 * stock[stock["ex_date"] > now - pd.Timedelta(days=3 * 365)]["cash_pct"].sum(), 1),
        "history": hist,
    }


# ------------------------------------------------------------------ Piotroski
def piotroski(a: pd.Series, b: pd.Series) -> tuple[int | None, list[dict]]:
    """a: kỳ hiện tại, b: cùng kỳ năm trước (đã có cột *_ttm hoặc số năm)."""
    def g(s, c):
        return _num(s.get(c + "_ttm", s.get(c))) if c in FLOW else _num(s.get(c))

    ni_a, ni_b = g(a, "net_income"), g(b, "net_income")
    ta_a, ta_b = g(a, "total_assets"), g(b, "total_assets")
    cfo_a = g(a, "cfo")
    if None in (ni_a, ta_a) or not ta_a:
        return None, []
    roa_a = ni_a / ta_a
    roa_b = (ni_b / ta_b) if ni_b is not None and ta_b else None
    lev_a = _div(g(a, "lt_debt") or 0, ta_a)
    lev_b = _div(g(b, "lt_debt") or 0, ta_b)
    cr_a = _div(g(a, "current_assets"), g(a, "current_liab"))
    cr_b = _div(g(b, "current_assets"), g(b, "current_liab"))
    gm_a = _div(g(a, "gross_profit"), g(a, "revenue"))
    gm_b = _div(g(b, "gross_profit"), g(b, "revenue"))
    at_a = _div(g(a, "revenue"), ta_a)
    at_b = _div(g(b, "revenue"), ta_b)
    sh_a, sh_b = g(a, "shares"), g(b, "shares")
    tests = [
        ("ROA dương", roa_a > 0),
        ("Dòng tiền kinh doanh dương", cfo_a is not None and cfo_a > 0),
        ("ROA cải thiện so với năm trước", roa_b is not None and roa_a > roa_b),
        ("Dòng tiền KD > lợi nhuận (lợi nhuận chất lượng)", cfo_a is not None and cfo_a > ni_a),
        ("Nợ dài hạn/Tổng tài sản giảm", lev_a is not None and lev_b is not None and lev_a <= lev_b),
        ("Thanh toán hiện hành cải thiện", cr_a is not None and cr_b is not None and cr_a > cr_b),
        ("Không phát hành thêm cổ phiếu", sh_a is not None and sh_b is not None and sh_a <= sh_b * 1.02),
        ("Biên lợi nhuận gộp cải thiện", gm_a is not None and gm_b is not None and gm_a > gm_b),
        ("Vòng quay tài sản cải thiện", at_a is not None and at_b is not None and at_a > at_b),
    ]
    return int(sum(bool(t) for _, t in tests)), [{"name": n, "ok": bool(t)} for n, t in tests]


# ------------------------------------------------------------------ chỉ số 1 mã
def analyze_symbol(sym: str, qs: pd.DataFrame, ys: pd.DataFrame, price: float,
                   divs: pd.DataFrame | None, ctype: str = "CT", shares_now: float | None = None) -> dict:
    """qs: các quý của mã (đã add_ttm); ys: các năm của mã."""
    L = latest_row(qs) if qs is not None and not qs.empty else None
    if L is None and (ys is None or ys.empty):
        return {"ok": False, "reason": "Chưa có BCTC"}
    if L is None:  # chỉ có số năm
        L = ys.iloc[-1].copy()
        for c in FLOW:
            L[c + "_ttm"] = L.get(c)
    # cùng kỳ năm trước
    prev = None
    if qs is not None and not qs.empty:
        m = qs[(qs["year"] == L["year"] - 1) & (qs["quarter"] == L["quarter"])]
        prev = m.iloc[-1] if not m.empty else None
    if prev is None and ys is not None and len(ys) >= 2:
        prev = ys.iloc[-2].copy()
        for c in FLOW:
            prev[c + "_ttm"] = prev.get(c)

    def T(c, row=L):
        if row is None:
            return None
        v = _num(row.get(c + "_ttm"))
        return v

    shares = _num(L.get("shares"))
    shares_report = shares
    if shares_now and shares_now > 0:
        shares = shares_now  # số CP hiện tại: đúng với giá đã điều chỉnh sau phát hành/chia thưởng
    if shares is None and ys is not None and not ys.empty:
        shares = _num(ys["shares"].dropna().iloc[-1]) if ys["shares"].notna().any() else None
    if shares is None:
        bv = _num(L.get("bvps"))
        eq = _num(L.get("equity"))
        if bv and eq:
            shares = eq * 1e9 / bv / 1e6
    equity = _num(L.get("equity"))
    minority = _num(L.get("minority")) or 0
    eq_parent = equity - minority if equity is not None else None
    ni = T("ni_parent") if T("ni_parent") is not None else T("net_income")
    rev = T("revenue")
    if rev is None and ctype in ("NH", "CK", "BH"):
        rev = T("toi")
    eps = ni * 1000 / shares if ni is not None and shares else None           # đồng
    bvps = eq_parent * 1000 / shares if eq_parent is not None and shares else _num(L.get("bvps"))
    mcap = price * shares if price and shares else None                     # tỷ đồng
    debt = _num(L.get("debt")) or 0
    cash = (_num(L.get("cash")) or 0) + (_num(L.get("st_invest")) or 0)
    ev = mcap + debt - cash if mcap is not None and ctype == "CT" else None
    ebit = T("operating_profit")
    if ebit is not None and T("interest_exp") is not None:
        ebit = ebit + T("interest_exp")  # cộng lại chi phí lãi vay
    ebitda = T("ebitda")
    ta = _num(L.get("total_assets"))
    # vốn chủ bình quân
    eq_prev = _num(prev.get("equity")) if prev is not None else None
    eq_avg = (equity + eq_prev) / 2 if equity is not None and eq_prev is not None else equity
    ta_prev = _num(prev.get("total_assets")) if prev is not None else None
    ta_avg = (ta + ta_prev) / 2 if ta is not None and ta_prev is not None else ta
    tax_rate = _div(T("tax"), T("pbt"))
    tax_rate = min(max(tax_rate, 0.1), 0.3) if tax_rate is not None else 0.2
    invested = (equity or 0) + debt - cash
    roic = _div(ebit * (1 - tax_rate), invested) if ebit is not None and invested > 0 else None

    def yoy(c):
        a, b = T(c), T(c, prev)
        if a is None or b is None or b <= 0:
            return None
        return (a / b - 1) * 100

    def q_yoy(c):
        a = _num(L.get(c))
        b = _num(prev.get(c)) if prev is not None else None
        if a is None or b is None or b <= 0:
            return None
        return (a / b - 1) * 100

    # tăng trưởng nhiều năm (theo số năm)
    cagr3 = {}
    if ys is not None and len(ys) >= 4:
        yy = ys.sort_values("year")
        for c in ("revenue", "ni_parent"):
            s = yy[c].dropna()
            if len(s) >= 4 and s.iloc[-4] > 0 and s.iloc[-1] > 0:
                cagr3[c] = ((s.iloc[-1] / s.iloc[-4]) ** (1 / 3) - 1) * 100
    # chuỗi quý tăng trưởng lợi nhuận
    streak = 0
    if qs is not None and len(qs) > 8:
        qq = qs.dropna(subset=["ni_parent"]).copy()
        qq["prev"] = qq["ni_parent"].shift(4)
        for _, r in qq.iloc[::-1].iterrows():
            if pd.notna(r["prev"]) and r["prev"] > 0 and r["ni_parent"] > r["prev"]:
                streak += 1
            else:
                break
    # ổn định ROE 5 năm
    roe_hist = []
    if ys is not None and not ys.empty:
        for _, r in ys.sort_values("year").tail(6).iterrows():
            e = _num(r.get("equity"))
            n = _num(r.get("ni_parent")) or _num(r.get("net_income"))
            if e and e > 0 and n is not None:
                roe_hist.append(n / e * 100)
    loss_years = int(sum(1 for x in roe_hist if x < 0))

    fscore, ftests = (piotroski(L, prev) if prev is not None else (None, []))
    div = dividend_profile(divs, price, eps)
    if not div.get("has_data"):
        div = dividend_from_cashflow(ys, T("dividends_paid"), shares, price, eps)
    cfo = T("cfo")
    out = {
        "ok": True,
        "period": f"Q{int(L['quarter'])}/{int(L['year'])}" if int(L.get("quarter", 0) or 0) > 0 else f"{int(L['year'])}",
        "ctype": ctype,
        "price": _r(price), "shares_mn": _r(shares, 1), "mcap_bn": _r(mcap, 0),
        "shares_report_mn": _r(shares_report, 1),
        "shares_note": (f"Số cổ phiếu hiện tại {shares:,.0f} triệu, khác báo cáo kỳ gần nhất "
                        f"({shares_report:,.0f} triệu) – có đợt phát hành/chia thưởng mới; EPS, P/E đã tính theo số mới.")
        if shares and shares_report and abs(shares / shares_report - 1) > 0.03 else None,
        "eps": _r(eps, 0), "bvps": _r(bvps, 0),
        "pe": _r(price * 1000 / eps, 1) if eps and eps > 0 else None,
        "pb": _r(price * 1000 / bvps, 2) if bvps and bvps > 0 else None,
        "ps": _r(_div(mcap, rev), 2),
        "ev_ebitda": _r(_div(ev, ebitda), 1) if ebitda and ebitda > 0 else None,
        "earnings_yield": _r(_pc(ebit, ev), 2) if ev and ev > 0 and ebit is not None else None,
        "revenue_ttm": _r(rev, 0), "ni_ttm": _r(ni, 0),
        "roe": _r(_pc(ni, eq_avg), 1) if eq_avg and eq_avg > 0 else None,
        "roa": _r(_pc(ni, ta_avg), 2),
        "roic": _r(100 * roic, 1) if roic is not None else None,
        "gross_margin": _r(_pc(T("gross_profit"), rev), 1) if ctype == "CT" else None,
        "op_margin": _r(_pc(T("operating_profit"), rev), 1),
        "net_margin": _r(_pc(ni, rev), 1),
        "de": _r(_div(debt, equity), 2) if equity and equity > 0 else None,
        "liab_equity": _r(_div(_num(L.get("total_liab")), equity), 2) if equity and equity > 0 else None,
        "net_debt_ebitda": _r(_div(debt - cash, ebitda), 2) if ebitda and ebitda > 0 else None,
        "current_ratio": _r(_div(_num(L.get("current_assets")), _num(L.get("current_liab"))), 2),
        "interest_cover": _r(_div(ebit, T("interest_exp")), 1) if T("interest_exp") else None,
        "cfo_ni": _r(_div(cfo, ni), 2) if ni and ni > 0 else None,
        "fcf_ttm": _r(T("fcf"), 0),
        "fcf_yield": _r(_pc(T("fcf"), mcap), 2) if mcap else None,
        "rev_yoy": _r(yoy("revenue") if ctype == "CT" else (yoy("toi") or yoy("revenue")), 1),
        "ni_yoy": _r(yoy("ni_parent") or yoy("net_income"), 1),
        "rev_q_yoy": _r(q_yoy("revenue"), 1),
        "ni_q_yoy": _r(q_yoy("ni_parent") or q_yoy("net_income"), 1),
        "rev_cagr3": _r(cagr3.get("revenue"), 1),
        "ni_cagr3": _r(cagr3.get("ni_parent"), 1),
        "ni_growth_streak": streak,
        "roe_avg5": _r(np.mean(roe_hist[-5:]), 1) if roe_hist else None,
        "roe_std5": _r(np.std(roe_hist[-5:]), 1) if len(roe_hist) >= 3 else None,
        "loss_years": loss_years,
        "fscore": fscore, "fscore_tests": ftests,
        "dividend": div,
        "tax_rate": _r(tax_rate * 100, 1),
        "equity_bn": _r(equity, 0), "debt_bn": _r(debt, 0), "cash_bn": _r(cash, 0),
        "ebit_ttm": _r(ebit, 0),
        # ngân hàng
        "nim": _r(_num(L.get("nim")), 2),
        "npl": _r(_num(L.get("npl")), 2),
        "loans_bn": _r(_num(L.get("loans")), 0),
        "deposits_bn": _r(_num(L.get("deposits")), 0),
    }
    return out


# ------------------------------------------------------------------ bảng lịch sử để vẽ
def history_table(qs: pd.DataFrame, ys: pd.DataFrame, n_q: int = 12, n_y: int = 8) -> dict:
    cols = ["revenue", "gross_profit", "operating_profit", "pbt", "ni_parent", "cfo", "capex", "fcf",
            "total_assets", "equity", "debt", "cash", "toi", "nii"]

    def pack(df, label):
        if df is None or df.empty:
            return []
        d = df.dropna(subset=["revenue", "ni_parent", "total_assets"], how="all").tail(n_q if label == "q" else n_y)
        rows = []
        for _, r in d.iterrows():
            row = {"period": (f"Q{int(r['quarter'])}/{int(r['year']) % 100:02d}" if label == "q"
                              else str(int(r["year"])))}
            for c in cols:
                row[c] = _r(r.get(c), 0)
            rev = _num(r.get("revenue"))
            row["gm"] = _r(_pc(r.get("gross_profit"), rev), 1) if rev else None
            row["nm"] = _r(_pc(r.get("ni_parent"), rev), 1) if rev else None
            rows.append(row)
        return rows

    return {"quarterly": pack(qs, "q"), "annual": pack(ys, "y")}


# ------------------------------------------------------------------ so sánh ngành
PEER_METRICS = ["pe", "pb", "roe", "roa", "net_margin", "gross_margin", "rev_yoy", "ni_yoy",
                "de", "fscore", "div_yield", "mcap_bn"]
LOWER_BETTER = {"pe", "pb", "de"}


def peer_stats(snap: pd.DataFrame, group_col: str = "industry") -> pd.DataFrame:
    """Thêm hạng phần trăm trong ngành cho từng chỉ số (100 = tốt nhất ngành)."""
    snap = snap.copy()
    for m in PEER_METRICS:
        if m not in snap:
            continue
        x = pd.to_numeric(snap[m], errors="coerce")
        if m in ("pe", "pb"):
            x = x.where(x > 0)
        rank = x.groupby(snap[group_col]).rank(pct=True, ascending=m not in LOWER_BETTER)
        snap[f"{m}_pctl"] = (100 * rank).round(0)
        snap[f"{m}_ind_med"] = x.groupby(snap[group_col]).transform("median")
    snap["peers_n"] = snap.groupby(group_col)["symbol"].transform("count")
    return snap
