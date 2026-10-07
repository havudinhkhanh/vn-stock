"""Backtest các rổ (tái cơ cấu hàng tháng, dữ liệu tại thời điểm – không nhìn trước tương lai)
và thống kê độ tin cậy của các mô hình sóng/kỹ thuật.

Hạn chế cần biết (hiển thị trên web):
- Chỉ có các mã đang niêm yết → bỏ sót mã đã huỷ niêm yết (survivorship bias) → kết quả lạc quan hơn thực tế.
- Rổ "Giá trị" dùng P/E, P/B so với ngành thay cho DCF (DCF lịch sử quá nặng để tính lại mỗi tháng).
- Giá đã điều chỉnh theo cổ tức/chia tách của nguồn dữ liệu.
"""
from __future__ import annotations

import logging
import random

import numpy as np
import pandas as pd

from . import patterns, signals

log = logging.getLogger("backtest")


def _period_end(y, q):
    return pd.to_datetime([f"{int(a)}-{int(b) * 3:02d}-01" for a, b in zip(y, q)]) + pd.offsets.MonthEnd(0)


def prepare_fund(fq: pd.DataFrame, lag_days: int) -> pd.DataFrame:
    """Bảng chỉ số theo quý, có ngày được phép dùng (sau khi công bố BCTC)."""
    if fq.empty:
        return fq
    f = fq.dropna(subset=["ni_parent_ttm"]).copy()
    f = f.sort_values(["symbol", "year", "quarter"])
    f["avail"] = _period_end(f["year"], f["quarter"]) + pd.Timedelta(days=lag_days)
    g = f.groupby("symbol")
    for c in ("ni_parent_ttm", "revenue_ttm", "total_assets", "cfo_ttm", "lt_debt", "gross_profit_ttm",
              "current_assets", "current_liab", "shares"):
        if c in f:
            f[c + "_l4"] = g[c].shift(4)
    f["roa"] = f["ni_parent_ttm"] / f["total_assets"]
    f["roa_l4"] = f["ni_parent_ttm_l4"] / f["total_assets_l4"]
    f["fs"] = ((f["roa"] > 0).astype(int) + (f["cfo_ttm"] > 0).astype(int)
               + (f["roa"] > f["roa_l4"]).astype(int) + (f["cfo_ttm"] > f["ni_parent_ttm"]).astype(int)
               + ((f["lt_debt"].fillna(0) / f["total_assets"]) <= (f["lt_debt_l4"].fillna(0) / f["total_assets_l4"])).astype(int)
               + ((f["current_assets"] / f["current_liab"]) > (f["current_assets_l4"] / f["current_liab_l4"])).astype(int)
               + (f["shares"] <= f["shares_l4"] * 1.02).astype(int)
               + ((f["gross_profit_ttm"] / f["revenue_ttm"]) > (f["gross_profit_ttm_l4"] / f["revenue_ttm_l4"])).astype(int)
               + ((f["revenue_ttm"] / f["total_assets"]) > (f["revenue_ttm_l4"] / f["total_assets_l4"])).astype(int))
    f["ni_yoy"] = np.where(f["ni_parent_ttm_l4"] > 0, (f["ni_parent_ttm"] / f["ni_parent_ttm_l4"] - 1) * 100, np.nan)
    f["rev_yoy"] = np.where(f["revenue_ttm_l4"] > 0, (f["revenue_ttm"] / f["revenue_ttm_l4"] - 1) * 100, np.nan)
    f["roe"] = 100 * f["ni_parent_ttm"] / f["equity"].where(f["equity"] > 0)
    f["de"] = f["debt"] / f["equity"].where(f["equity"] > 0)
    f["qend"] = _period_end(f["year"], f["quarter"])
    # cổ tức tiền mặt từ lưu chuyển tiền tệ (TTM) và số năm tài chính liên tiếp có trả cổ tức
    if "dividends_paid_ttm" in f:
        f["div_cf_ttm"] = f["dividends_paid_ttm"].abs()
        q4 = f[f["quarter"] == 4][["symbol", "year", "div_cf_ttm"]].copy()
        q4["paid"] = (q4["div_cf_ttm"].fillna(0) > 0).astype(int)
        streaks = []
        for sym, gq in q4.sort_values("year").groupby("symbol"):
            run_ = 0
            for _, r in gq.iterrows():
                run_ = run_ + 1 if r["paid"] else 0
                streaks.append((sym, int(r["year"]), run_))
        st = pd.DataFrame(streaks, columns=["symbol", "fy", "cf_years"])
        # năm tài chính đã kết thúc gần nhất trước kỳ đang xét
        f["fy"] = np.where(f["quarter"] == 4, f["year"], f["year"] - 1)
        f = f.merge(st, on=["symbol", "fy"], how="left")
        f["cf_years"] = f["cf_years"].fillna(0)
    else:
        f["div_cf_ttm"], f["cf_years"] = np.nan, 0
    keep = ["symbol", "avail", "qend", "ni_parent_ttm", "equity", "shares", "fs", "ni_yoy", "rev_yoy", "roe", "de",
            "cfo_ttm", "pe_src", "pb_src", "div_cf_ttm", "cf_years"]
    return f[[c for c in keep if c in f]].sort_values("avail")


def regime_series(idx_close: pd.Series) -> pd.Series:
    s50, s200 = idx_close.rolling(50).mean(), idx_close.rolling(200).mean()
    a = (idx_close > s200).astype(int) + (s50 > s200).astype(int) + (idx_close > s50).astype(int)
    return a.map({3: 1.0, 2: 0.6, 1: 0.3, 0: 0.3})


def snapshot_at(t, wide, wide_val, fund, divs, listing_sector, cfg) -> pd.DataFrame:
    w = wide.loc[:t]
    if len(w) < 260:
        return pd.DataFrame()
    px = w.iloc[-1]
    hist_n = w.iloc[-260:].notna().sum()
    val20 = wide_val.loc[:t].iloc[-20:].mean()
    uni = px[(px >= cfg["min_price"]) & (hist_n >= 120) & (val20.reindex(px.index) >= cfg["min_val"])].index
    if len(uni) < 20:
        return pd.DataFrame()
    fa = fund[fund["avail"] <= t].groupby("symbol").tail(1).set_index("symbol")
    d = pd.DataFrame(index=uni)
    d["price"] = px[uni]
    d = d.join(fa, how="inner")
    # P/E, P/B tại thời điểm t = P/E của nguồn tại cuối quý × (giá t / giá cuối quý), cùng chuỗi giá điều chỉnh
    #   -> không bị méo khi có chia cổ phiếu. Nếu nguồn không có thì tự tính.
    pq = pd.Series(np.nan, index=d.index)
    if "qend" in d:
        for qe, idx in d.groupby("qend").groups.items():
            ww = wide.loc[:qe]
            if not ww.empty:
                pq.loc[idx] = ww.iloc[-1].reindex(idx).values
    ratio = d["price"] / pq
    d["eps"] = d["ni_parent_ttm"] * 1000 / d["shares"]
    pe_calc = np.where(d["eps"] > 0, d["price"] * 1000 / d["eps"], np.nan)
    pb_calc = np.where(d["equity"] > 0, d["price"] * d["shares"] / d["equity"], np.nan)
    pe_src = d["pe_src"].where(d["pe_src"] > 0) * ratio if "pe_src" in d else np.nan
    pb_src = d["pb_src"].where(d["pb_src"] > 0) * ratio if "pb_src" in d else np.nan
    d["pe"] = pd.Series(pe_src, index=d.index).fillna(pd.Series(pe_calc, index=d.index))
    d["pb"] = pd.Series(pb_src, index=d.index).fillna(pd.Series(pb_calc, index=d.index))
    d.loc[d["ni_parent_ttm"] <= 0, "pe"] = np.nan
    c = w[d.index]
    d["ret_12_1"] = c.iloc[-22] / c.iloc[-252] - 1
    d["ret_6m"] = c.iloc[-1] / c.iloc[-126] - 1
    d["vol_1y"] = c.iloc[-250:].pct_change(fill_method=None).std() * np.sqrt(250)
    hi = c.iloc[-250:].max()
    d["from_hi"] = c.iloc[-1] / hi - 1
    s200 = c.iloc[-200:].mean()
    s50 = c.iloc[-50:].mean()
    d["trend_up"] = (c.iloc[-1] > s50) & (s50 > s200)
    d["above200"] = c.iloc[-1] > s200
    d["trend_down"] = (c.iloc[-1] < s50) & (s50 < s200)
    if divs is not None and not divs.empty:
        dv = divs[(divs["ex_date"] <= t) & (divs["ex_date"] > t - pd.Timedelta(days=365))
                  & divs["method"].str.contains("cash", na=False)]
        dps = dv.groupby("symbol")["cash_pct"].sum() * 10000
        d["div_yield"] = (dps.reindex(d.index).fillna(0) / (d["price"] * 1000)) * 100
        past = divs[(divs["ex_date"] <= t) & divs["method"].str.contains("cash", na=False)]
        yrs = past.assign(y=past["ex_date"].dt.year).groupby("symbol")["y"].apply(
            lambda s: sum(1 for k in range(t.year - 1, t.year - 6, -1) if k in set(s)))
        d["cash_years"] = yrs.reindex(d.index).fillna(0)
    else:
        d["div_yield"], d["cash_years"] = 0.0, 0
    mcap_pit = (d["pe"] * d["ni_parent_ttm"]).where(d["pe"] > 0)                 # tỷ đồng
    mcap_pit = mcap_pit.fillna((d["pb"] * d["equity"]).where(d["pb"] > 0))
    d["mcap"] = mcap_pit
    y_cf = 100 * d["div_cf_ttm"] / mcap_pit
    d["div_yield"] = d["div_yield"].where(d["div_yield"] > 0, y_cf).fillna(0).clip(upper=30)
    d["cash_years"] = np.maximum(d["cash_years"], d["cf_years"].fillna(0))
    d["sector"] = listing_sector.reindex(d.index)
    for m in ("pe", "pb"):
        d[m + "_pct"] = d.groupby("sector")[m].rank(pct=True)
    return d


GUARDS = {"min_mcap_bn": 0.0, "value_guard": False, "trend": "not_down"}


def pick(d: pd.DataFrame, basket: str, n: int) -> list[str]:
    if d.empty:
        return []
    if GUARDS["min_mcap_bn"] > 0 and "mcap" in d:
        d = d[d["mcap"].fillna(0) >= GUARDS["min_mcap_bn"]]
        if d.empty:
            return []
    r = lambda s, asc=True: s.rank(pct=True, ascending=asc)  # noqa: E731
    if basket == "garp":
        m = (d["roe"] >= 15) & (d["ni_yoy"] >= 10) & (d["fs"] >= 5) & ((d["de"].fillna(0) < 1.5)) & (d["cfo_ttm"] > 0)
        peg = d["pe"] / d["ni_yoy"].clip(lower=1)
        m &= peg <= 1.5
        sc = r(d["roe"]) + r(d["ni_yoy"]) + r(d["pe"], False)
    elif basket == "dividend":
        m = (d["cash_years"] >= 3) & (d["div_yield"] >= 5) & (d["ni_parent_ttm"] > 0) & (d["fs"] >= 4)
        sc = 2 * r(d["div_yield"]) + r(d["roe"])
    elif basket == "value":
        m = (d["pe_pct"] <= 0.35) & (d["pb_pct"] <= 0.5) & (d["fs"] >= 5) & (d["roe"] >= 8)
        if GUARDS["value_guard"]:  # tránh bẫy giá trị: lợi nhuận không sụt mạnh, dòng tiền thật, nợ vừa phải
            m &= (d["ni_yoy"].fillna(-100) > -10) & (d["cfo_ttm"] > 0) & (d["de"].fillna(0) < 2)
        sc = r(d["pe"], False) + r(d["pb"], False) + r(d["fs"])
    elif basket == "defensive":
        m = (r(d["vol_1y"], False) >= 0.6) & (d["de"].fillna(0) < 1) & (d["cash_years"] >= 3) & (d["roe"] >= 10)
        sc = r(d["vol_1y"], False) + r(d["div_yield"])
    elif basket == "growth":
        m = (d["ni_yoy"] >= 25) & (d["roe"] >= 15) & (d["from_hi"] >= -0.15) & d["trend_up"]
        sc = r(d["ret_12_1"]) + r(d["ni_yoy"])
    else:
        return []
    # hàng rào kỹ thuật giống hệ thống thật
    if GUARDS["trend"] == "up":
        m &= d["trend_up"]
    elif GUARDS["trend"] == "above200":
        m &= d["above200"]
    else:
        m &= ~d["trend_down"]
    return list(sc[m.fillna(False)].sort_values(ascending=False).index[:n])


def sector_pick(g: pd.DataFrame, k: int) -> list[str]:
    """'Tốt nhất ngành': xếp hạng tương đối TRONG ngành (ROE, tăng trưởng LN, P/E thấp, F-Score,
    sức mạnh giá 6 tháng), chỉ lấy mã đang có xu hướng tăng như hệ thống thật."""
    r = lambda x, asc=True: x.rank(pct=True, ascending=asc)  # noqa: E731
    sc = (r(g["roe"]) + r(g["ni_yoy"]) + r(g["pe"].where(g["pe"] > 0), False) + r(g["fs"]) + r(g["ret_6m"])).fillna(0)
    m = pd.Series(True, index=g.index)
    if GUARDS["trend"] == "up":
        m &= g["trend_up"]
    elif GUARDS["trend"] == "above200":
        m &= g["above200"]
    else:
        m &= ~g["trend_down"]
    m &= (g["ni_parent_ttm"] > 0)
    return list(sc[m.fillna(False)].sort_values(ascending=False).index[:k])


def _stats(curve: pd.Series) -> dict:
    curve = curve.dropna()
    if len(curve) < 30:
        return {}
    yrs = (curve.index[-1] - curve.index[0]).days / 365.25
    r = curve.pct_change().dropna()
    dd = curve / curve.cummax() - 1
    cagr = (curve.iloc[-1] / curve.iloc[0]) ** (1 / yrs) - 1 if yrs > 0 else np.nan
    sharpe = (r.mean() * 250 - 0.03) / (r.std() * np.sqrt(250)) if r.std() > 0 else np.nan
    yearly = curve.resample("YE").last().pct_change()
    first = curve.resample("YE").last().iloc[0] / curve.iloc[0] - 1
    yearly.iloc[0] = first
    return {"cagr": round(100 * cagr, 1), "total": round(100 * (curve.iloc[-1] / curve.iloc[0] - 1), 1),
            "max_dd": round(100 * dd.min(), 1), "vol": round(100 * r.std() * np.sqrt(250), 1),
            "sharpe": round(sharpe, 2) if sharpe == sharpe else None,
            "yearly": {str(k.year): round(100 * v, 1) for k, v in yearly.items() if v == v},
            "win_years": int((yearly > 0).sum()), "n_years": int(yearly.notna().sum())}


def run(prices: pd.DataFrame, fq_ttm: pd.DataFrame, divs: pd.DataFrame, listing: pd.DataFrame,
        cfg: dict) -> dict:
    bcfg = cfg.get("backtest") or {}
    start = pd.Timestamp(bcfg.get("start", "2016-01-01"))
    lag = int(bcfg.get("report_lag_days", 45))
    cost = float(bcfg.get("cost_pct", 0.25)) / 100
    alloc = {k: float(v) for k, v in (cfg.get("allocation") or {}).items()}
    maxpos = int((cfg.get("risk") or {}).get("max_positions", 8))
    ucfg = {"min_price": float((cfg.get("universe") or {}).get("min_price", 5)),
            "min_val": float((cfg.get("universe") or {}).get("min_avg_value_bn", 3)) * float(bcfg.get("liquidity_factor", 0.5))}
    scfg = {**(cfg.get("strategy") or {}), **bcfg}   # backtest dùng chung quy tắc chọn mã với hệ thống thật
    GUARDS["min_mcap_bn"] = float(scfg.get("min_mcap_bn", 0))
    GUARDS["value_guard"] = bool(scfg.get("value_guard", False))
    GUARDS["trend"] = str(scfg.get("trend_filter", "not_down"))

    stocks = prices[~prices["symbol"].isin(["VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"])]
    wide = stocks.pivot_table(index="date", columns="symbol", values="close").sort_index()
    wide = wide.ffill(limit=5)
    wide_val = (stocks.assign(v=stocks["close"] * stocks["volume"] / 1e6)
                .pivot_table(index="date", columns="symbol", values="v").reindex(wide.index).fillna(0))
    idx = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"].sort_index()
    if idx.empty or wide.empty:
        return {"ok": False, "reason": "Thiếu dữ liệu giá"}
    fund = prepare_fund(fq_ttm, lag)
    if fund.empty:
        return {"ok": False, "reason": "Thiếu dữ liệu BCTC"}
    sector = listing.set_index("symbol")["sector"]
    reg = regime_series(idx).reindex(wide.index).ffill()
    # bắt đầu khi ≥ 60% số mã có BCTC đã có dữ liệu dùng được (tránh giai đoạn rổ trống vì thiếu số liệu)
    first_avail = fund.groupby("symbol")["avail"].min().sort_values()
    if len(first_avail) >= 10:
        start = max(start, first_avail.iloc[int(len(first_avail) * 0.6)] + pd.Timedelta(days=380))
    dates = wide.loc[start:].groupby(wide.loc[start:].index.to_period("M")).tail(1).index
    if len(dates) < 12:
        return {"ok": False, "reason": "Lịch sử quá ngắn để backtest"}

    tot_alloc = sum(v for v in alloc.values() if v > 0) or 1
    baskets = ["garp", "dividend", "value", "defensive", "growth"]
    curves = {b: [1.0] for b in baskets}
    combo, combo_reg = [1.0], [1.0]
    curve_dates = [dates[0]]
    holdings_hist = {b: [] for b in baskets}
    prev_w = {b: {} for b in baskets}
    prev_combo, prev_combo_reg = {}, {}
    per_basket = int(bcfg.get("slots_per_basket", 0))
    if per_basket > 0:
        nslots = {b: per_basket for b in baskets}
    else:
        nslots = {b: max(1, round(maxpos * alloc.get(b, 0) / tot_alloc)) if alloc.get(b, 0) > 0 else 5 for b in baskets}

    msl = float((cfg.get("risk") or {}).get("max_stop_loss_pct", 12)) / 100
    stop_lvl = (1 - msl) if bcfg.get("use_stop", True) else None

    def period_path(weights: dict, t0, t1):
        sub = wide.loc[t0:t1, list(weights)] if weights else None
        if sub is None or sub.empty:
            return pd.Series(1.0, index=wide.loc[t0:t1].index)
        rel = sub / sub.iloc[0]
        rel = rel.ffill().fillna(1.0)
        # cắt lỗ giống hệ thống thật: giảm quá max_stop_loss_pct so với giá mua -> bán, giữ tiền đến kỳ sau
        if stop_lvl is not None:
            hit = rel.le(stop_lvl)
            first = hit.cummax()
            rel = rel.where(~first, stop_lvl * (1 - cost))
        cash = 1 - sum(weights.values())
        return (rel * pd.Series(weights)).sum(axis=1) + cash

    def turnover(a: dict, b: dict) -> float:
        keys = set(a) | set(b)
        return sum(abs(a.get(k, 0) - b.get(k, 0)) for k in keys)

    daily = {b: [] for b in baskets}
    sec_k = int(bcfg.get("sector_top_k", 3))
    sec_state: dict = {}
    daily_combo, daily_combo_reg = [], []
    for i in range(len(dates) - 1):
        t0, t1 = dates[i], dates[i + 1]
        snap = snapshot_at(t0, wide, wide_val, fund, divs, sector, ucfg)
        combo_w, combo_w_reg = {}, {}
        for b in baskets:
            syms = pick(snap, b, nslots[b])
            w = {s: 1 / nslots[b] for s in syms}
            holdings_hist[b].append({"date": str(t0.date()), "symbols": syms})
            path = period_path(w, t0, t1)
            c_cost = turnover(w, prev_w[b]) * cost
            prev_w[b] = w
            base = curves[b][-1] * (1 - c_cost)
            seg = base * path
            daily[b].append(seg.iloc[1:] if daily[b] else seg)
            curves[b].append(float(seg.iloc[-1]))
            share = alloc.get(b, 0) / tot_alloc
            for s, x in w.items():
                combo_w[s] = combo_w.get(s, 0) + x * share
                combo_w_reg[s] = combo_w_reg.get(s, 0) + x * share * float(reg.loc[t0])
        for wts, store_, prev, lst in ((combo_w, combo, prev_combo, daily_combo),
                                       (combo_w_reg, combo_reg, prev_combo_reg, daily_combo_reg)):
            path = period_path(wts, t0, t1)
            base = store_[-1] * (1 - turnover(wts, prev) * cost)
            seg = base * path
            lst.append(seg.iloc[1:] if lst else seg)
            store_.append(float(seg.iloc[-1]))
        prev_combo, prev_combo_reg = combo_w, combo_w_reg
        # ---- theo ngành: top-k tốt nhất trong ngành vs mua đều cả ngành
        if not snap.empty and "sector" in snap:
            for sec, g in snap.groupby("sector"):
                if len(g) < 5:
                    continue
                picks = sector_pick(g, sec_k)
                for key, wts in (("pick", {s: 1 / sec_k for s in picks}),
                                 ("all", {s: 1 / len(g) for s in g.index})):
                    st_ = sec_state.setdefault(sec, {"pick": {"curve": 1.0, "daily": [], "prev": {}, "n": []},
                                                     "all": {"curve": 1.0, "daily": [], "prev": {}, "n": []}})[key]
                    path = period_path(wts, t0, t1)
                    base = st_["curve"] * (1 - turnover(wts, st_["prev"]) * cost)
                    seg = base * path
                    st_["daily"].append(seg.iloc[1:] if st_["daily"] else seg)
                    st_["curve"] = float(seg.iloc[-1])
                    st_["prev"] = wts
                    st_["n"].append(len(wts))
                    if key == "pick":
                        st_["last"] = picks
        curve_dates.append(t1)

    res = {"ok": True, "start": str(dates[0].date()), "end": str(dates[-1].date()),
           "months": len(dates) - 1, "baskets": {}, "notes": [
               "Chỉ gồm các mã đang niêm yết (bỏ sót mã đã huỷ niêm yết) → kết quả có thể lạc quan hơn thực tế.",
               "Rổ Giá trị trong backtest dùng P/E, P/B thấp so với ngành thay cho định giá DCF.",
               f"Đã trừ phí + thuế {bcfg.get('cost_pct', 0.25)}% mỗi chiều; BCTC chỉ dùng sau {lag} ngày kết thúc quý.",
               f"Có mô phỏng cắt lỗ {int(msl * 100)}% như hệ thống thật (bán khi giảm quá mức so với giá mua, mua lại ở kỳ sau nếu vẫn đạt điều kiện).",
               "Bắt đầu từ khi đa số doanh nghiệp đã có báo cáo tài chính trên nguồn dữ liệu (từ 2018).",
               "Lợi nhuận quá khứ không đảm bảo lợi nhuận tương lai."]}
    bench = idx.loc[dates[0]:dates[-1]]
    bench = bench / bench.iloc[0]
    res["benchmark"] = {"name": "VN-Index", **_stats(bench)}

    def pack(name, daily_list, label):
        s = pd.concat(daily_list)
        s = s[~s.index.duplicated()]
        st = _stats(s)
        m = s.resample("ME").last()
        return {"name": label, **st,
                "curve": [{"d": str(k.date()), "v": round(float(v), 4)} for k, v in m.items()]}

    from .strategy import BASKETS
    for b in baskets:
        if daily[b]:
            res["baskets"][b] = pack(b, daily[b], BASKETS[b]["name"])
            res["baskets"][b]["last_holdings"] = holdings_hist[b][-1]["symbols"] if holdings_hist[b] else []
            res["baskets"][b]["avg_count"] = round(float(np.mean([len(h["symbols"]) for h in holdings_hist[b]])), 1)
    res["sectors"] = {}
    for sec, stt in sec_state.items():
        if len(stt["pick"]["daily"]) < 12:
            continue
        a = pd.concat(stt["pick"]["daily"]); a = a[~a.index.duplicated()]
        b_ = pd.concat(stt["all"]["daily"]); b_ = b_[~b_.index.duplicated()]
        sa, sb = _stats(a), _stats(b_)
        if not sa or not sb:
            continue
        ma, mb = a.resample("ME").last(), b_.resample("ME").last()
        res["sectors"][sec] = {
            "top": {k: sa[k] for k in ("cagr", "max_dd", "sharpe", "yearly")},
            "all": {k: sb[k] for k in ("cagr", "max_dd", "sharpe", "yearly")},
            "alpha": round(sa["cagr"] - sb["cagr"], 1),
            "avg_n": round(float(np.mean(stt["all"]["n"])), 1), "months": len(stt["pick"]["daily"]),
            "last_picks": stt["pick"].get("last", []),
            "curve": [{"d": str(k.date()), "top": round(float(x), 4), "all": round(float(y), 4)}
                      for (k, x), y in zip(ma.items(), mb.reindex(ma.index).ffill().values)]}
    res["combo"] = pack("combo", daily_combo, "Danh mục theo phân bổ của anh")
    res["combo_regime"] = pack("combo_regime", daily_combo_reg, "Phân bổ của anh + đèn thị trường")
    m = bench.resample("ME").last()
    res["benchmark"]["curve"] = [{"d": str(k.date()), "v": round(float(v), 4)} for k, v in m.items()]
    return res


# ------------------------------------------------------------------ độ tin cậy mô hình
def pattern_stats(prices: pd.DataFrame, symbols: list[str], years: int = 3, step: int = 12,
                  horizon: int = 20, max_symbols: int = 220, seed: int = 7) -> dict:
    """Đo tỷ lệ đúng của Elliott, Wyckoff, Dow, mô hình giá, Harmonic trên dữ liệu VN.

    Tại mỗi thời điểm mẫu chỉ dùng dữ liệu đến thời điểm đó, rồi so sánh với lợi nhuận
    `horizon` phiên sau (vượt trội so với VN-Index)."""
    rnd = random.Random(seed)
    syms = symbols[:max_symbols] if len(symbols) <= max_symbols else rnd.sample(symbols, max_symbols)
    idx = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"].sort_index()
    rec: dict[str, list] = {}
    for s in syms:
        df = prices[prices["symbol"] == s].set_index("date").sort_index()
        if len(df) < 400:
            continue
        start = max(300, len(df) - years * 250)
        for i in range(start, len(df) - horizon, step):
            hist = df.iloc[:i + 1]
            fwd = df["close"].iloc[i + horizon] / df["close"].iloc[i] - 1
            d0, d1 = df.index[i], df.index[i + horizon]
            ib = idx[:d0]
            ie = idx[:d1]
            if ib.empty or ie.empty:
                continue
            ex = fwd - (ie.iloc[-1] / ib.iloc[-1] - 1)
            try:
                sig = signals.compute(hist)
            except Exception:  # noqa: BLE001
                continue
            for name, b in sig:
                rec.setdefault(name, []).append((b, ex))
    out = {}
    for name, lst in rec.items():
        arr = np.array(lst)
        if len(arr) < 30:
            continue
        hit = float(np.mean(np.sign(arr[:, 1]) == arr[:, 0]))
        edge = float(np.mean(arr[:, 0] * arr[:, 1]))
        out[name] = {"n": int(len(arr)), "hit_rate": round(100 * hit, 1),
                     "avg_excess": round(100 * edge, 2),
                     "useful": bool(hit >= 0.55 and edge > 0.005)}
    return {"horizon_days": horizon, "years": years, "symbols": len(syms), "stats": out}
