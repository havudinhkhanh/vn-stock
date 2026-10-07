"""Tạo dữ liệu GIẢ LẬP (mã bắt đầu bằng chữ Z) để thử giao diện khi chưa có dữ liệu thật."""
from __future__ import annotations

import string

import numpy as np
import pandas as pd

from .data import store

SECTORS = {
    "Ngân hàng": ("NH", "Ngân hàng"), "Bất động sản": ("CT", "Bất động sản"),
    "Thực phẩm & Đồ uống": ("CT", "Thực phẩm"), "Tài nguyên cơ bản": ("CT", "Thép"),
    "Công nghệ": ("CT", "Phần mềm"), "Dịch vụ tài chính": ("CK", "Môi giới chứng khoán"),
    "Điện, nước & xăng dầu": ("CT", "Sản xuất điện"), "Xây dựng & Vật liệu": ("CT", "Vật liệu xây dựng"),
    "Bán lẻ": ("CT", "Bán lẻ"), "Hoá chất": ("CT", "Phân bón"),
}


def make(n: int = 120, seed: int = 42) -> None:
    rng = np.random.default_rng(seed)
    syms = sorted({"Z" + a + b for a in string.ascii_uppercase for b in string.ascii_uppercase})
    syms = list(rng.choice(syms, n, replace=False))
    secs = list(SECTORS)
    dates = pd.bdate_range("2014-01-02", pd.Timestamp.now().normalize() - pd.Timedelta(days=1))
    T = len(dates)
    # nhân tố thị trường có chu kỳ
    mkt = rng.normal(0.0004, 0.011, T)
    for a, b, d in ((900, 1100, -0.003), (2050, 2250, -0.0035), (1550, 1750, 0.002)):
        if b < T:
            mkt[a:b] += d
    rows_p, rows_l, rows_q, rows_d = [], [], [], []
    caps = {}
    for i, s in enumerate(syms):
        sec = secs[i % len(secs)]
        ctype, sub = SECTORS[sec]
        exch = ["HOSE", "HOSE", "HNX", "UPCOM"][i % 4]
        quality = rng.uniform(-0.5, 1.0)
        beta = rng.uniform(0.6, 1.5)
        drift = 0.0001 + 0.0004 * quality
        vol = rng.uniform(0.012, 0.03)
        start = int(rng.integers(0, 600)) if i % 7 else int(rng.integers(1500, 2600))
        r = beta * mkt + rng.normal(drift, vol, T)
        price0 = rng.uniform(8, 120)
        close = price0 * np.exp(np.cumsum(r))
        close[:start] = np.nan
        hi = close * (1 + np.abs(rng.normal(0, vol / 2, T)))
        lo = close * (1 - np.abs(rng.normal(0, vol / 2, T)))
        op = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, vol / 3, T))
        shares = float(rng.uniform(50, 3000))
        liq = rng.uniform(0.0005, 0.006) * (2 if exch == "HOSE" else 0.5)
        volu = np.maximum(0, shares * 1e6 * liq * np.exp(rng.normal(0, 0.5, T))).round(-2)
        df = pd.DataFrame({"symbol": s, "date": dates, "open": op, "high": np.maximum(hi, np.maximum(op, close)),
                           "low": np.minimum(lo, np.minimum(op, close)), "close": close, "volume": volu}).dropna()
        rows_p.append(df)
        caps[s] = close[-1] * shares
        rows_l.append({"symbol": s, "exchange": exch, "name": f"Công ty Giả lập {s}", "sector": sec,
                       "industry": sec, "subindustry": sub, "com_type": ctype})
        # BCTC quý
        rev = rng.uniform(200, 8000)
        g = 0.02 + 0.03 * quality
        gm = rng.uniform(0.12, 0.45)
        eq = rev * rng.uniform(1.0, 3.0)
        payout = rng.choice([0, 0.3, 0.5, 0.7])
        for y in range(2013, pd.Timestamp.now().year + 1):
            for q in range(1, 5):
                pe_ = pd.Timestamp(year=y, month=q * 3, day=28)
                if pe_ > pd.Timestamp.now() - pd.Timedelta(days=50):
                    break
                rev *= (1 + g / 4 * 4 * 0.25 + rng.normal(0, 0.04))
                gp = rev * (gm + rng.normal(0, 0.02))
                sga = rev * 0.08
                interest = rev * 0.015
                pbt = gp - sga - interest + rev * 0.01
                tax = max(0, pbt * 0.2)
                ni = pbt - tax
                eq += ni * (1 - payout)
                ta = eq * (2.0 if ctype == "CT" else 9.0)
                debt = ta * 0.25 if ctype == "CT" else 0
                rows_q.append({"symbol": s, "year": y, "quarter": q, "revenue": rev, "cogs": rev - gp,
                               "gross_profit": gp, "selling_exp": sga * 0.5, "admin_exp": sga * 0.5,
                               "interest_exp": interest, "operating_profit": gp - sga, "pbt": pbt, "tax": tax,
                               "net_income": ni, "ni_parent": ni * 0.97, "total_assets": ta,
                               "current_assets": ta * 0.5, "cash": ta * 0.08, "st_invest": ta * 0.02,
                               "receivables": ta * 0.15, "inventory": ta * 0.15, "fixed_assets": ta * 0.3,
                               "total_liab": ta - eq, "current_liab": ta * 0.3 * rng.uniform(0.8, 1.2),
                               "st_debt": debt * 0.6, "lt_debt": debt * 0.4, "equity": eq, "minority": eq * 0.03,
                               "cfo": ni * rng.uniform(0.5, 1.4), "capex": -rev * 0.03, "shares": shares,
                               "source": "DEMO"})
            if payout > 0 and y >= 2014:
                rows_d.append({"symbol": s, "ex_date": pd.Timestamp(year=y, month=7, day=15),
                               "year": y, "cash_pct": round(rng.uniform(0.05, 0.3), 2), "method": "cash"})
    prices = pd.concat(rows_p, ignore_index=True)
    # chỉ số = bình quân gia quyền vốn hoá
    w = pd.Series(caps)
    w = w / w.sum()
    wide = prices.pivot_table(index="date", columns="symbol", values="close")
    ret = wide.pct_change(fill_method=None).fillna(0)
    idx = 1000 * (1 + (ret * w.reindex(wide.columns).fillna(0)).sum(axis=1) * 1.0).cumprod() * 0.6
    vol_idx = prices.groupby("date")["volume"].sum()
    for name, lvl in (("VNINDEX", 1.0), ("HNXINDEX", 0.2), ("UPCOMINDEX", 0.09), ("VN30", 1.05)):
        c = idx * lvl
        prices = pd.concat([prices, pd.DataFrame({"symbol": name, "date": c.index, "open": c.shift().fillna(c),
                                                  "high": c * 1.004, "low": c * 0.996, "close": c,
                                                  "volume": vol_idx.reindex(c.index).values})], ignore_index=True)
    from .data.normalize import finalize
    fq = finalize(pd.DataFrame(rows_q))
    fy = fq.groupby(["symbol", "year"]).agg({**{c: "sum" for c in ("revenue", "cogs", "gross_profit", "selling_exp",
                                                                     "admin_exp", "interest_exp", "operating_profit",
                                                                     "pbt", "tax", "net_income", "ni_parent", "cfo",
                                                                     "capex", "fcf")},
                                             **{c: "last" for c in ("total_assets", "current_assets", "cash",
                                                                    "st_invest", "receivables", "inventory",
                                                                    "fixed_assets", "total_liab", "current_liab",
                                                                    "st_debt", "lt_debt", "debt", "equity",
                                                                    "minority", "shares")}}).reset_index()
    fy["quarter"] = 0
    fy = finalize(fy.assign(source="DEMO"))
    for name in ("prices", "listing", "fin_q", "fin_y", "dividends"):
        p = store.path(f"{name}.parquet")
        if p.exists():
            p.unlink()
    store.write("prices", prices)
    store.write("listing", pd.DataFrame(rows_l))
    store.write("fin_q", fq)
    store.write("fin_y", fy)
    store.write("dividends", pd.DataFrame(rows_d))
    m = store.meta()
    m["demo"] = True
    store.save_meta(m)
