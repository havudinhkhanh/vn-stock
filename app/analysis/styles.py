"""Phong cách đầu tư: mỗi phong cách có cách chọn mã, giá vào, cắt lỗ, mục tiêu và thời gian nắm giữ khác nhau.

- swing    Lướt sóng 1–4 tuần: thuần kỹ thuật (nhịp chỉnh về EMA20 trong xu hướng tăng, hoặc bứt phá nền
           kèm khối lượng), cắt lỗ theo ATR (3–8%), mục tiêu 2R/3R, thoát sau 15 phiên. Chỉ mã thanh khoản cao,
           có lãi. Đèn đỏ không lướt.
- position Trung hạn theo xu hướng 1–6 tháng: hệ thống gốc (rổ GARP/Tăng trưởng/Phòng thủ + xu hướng tăng).
- long     Dài hạn 1–3 năm: doanh nghiệp chất lượng, mua khi rẻ hơn giá trị hợp lý, mua dần 3 lần,
           không cắt lỗ theo giá – thoát khi luận điểm gãy hoặc đã đắt.
- income   Cổ tức: lợi suất tiền mặt cao và bền, mua ở giá cho lợi suất mục tiêu.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import indicators as ind

STYLES = {
    "swing": {"name": "Lướt sóng", "horizon": "1–4 tuần", "hold_max": 20,
              "desc": "Bắt nhịp tăng ngắn: mua khi giá chỉnh về đường EMA20 trong xu hướng tăng rồi bật lên, hoặc khi bứt phá khỏi nền giá với khối lượng lớn. "
                      "Cắt lỗ theo biến động (5–10%), chốt lời khi lãi gấp 3 lần rủi ro, thoát sau tối đa 20 phiên. Chỉ mã thanh khoản cao (≥ 10 tỷ/ngày) và đang có lãi.",
              "rules": ["Vào: giá đóng cửa trong vùng mua của phiên báo tín hiệu hoặc phiên kế tiếp", "Cắt lỗ: thủng điểm dừng (2,5×ATR hoặc đáy 5 phiên, tối đa 10%)",
                        "Chốt lời: chạm mục tiêu 1 (3R) – có thể giữ phần nhỏ tới mục tiêu 2", "Thoát theo thời gian: sau 20 phiên, hoặc đóng cửa dưới EMA20 2 phiên liền",
                        "Nhớ T+2: hàng về sau 2 phiên mới bán được", "Đèn đỏ: không mở vị thế mới"],
              "exposure": {"green": 100, "yellow": 50, "red": 0}, "max_positions": 5, "risk_per_trade": 1.0, "max_weight": 20},
    "position": {"name": "Trung hạn theo xu hướng", "horizon": "1–6 tháng", "hold_max": 60,
                 "desc": "Cấu hình gốc đã kiểm chứng: doanh nghiệp tốt (GARP, tăng trưởng, phòng thủ), chỉ mua khi giá đã vào xu hướng tăng và rẻ hơn giá trị hợp lý. "
                         "Cắt lỗ 20%, mục tiêu theo giá trị hợp lý.",
                 "rules": ["Vào: giá trong vùng mua và xu hướng tăng (giá > MA50 > MA200)", "Cắt lỗ: giảm quá 20% so với giá mua hoặc thủng điểm dừng động",
                           "Chốt lời một phần khi giá vượt giá trị hợp lý 10%", "Bán khi luận điểm cơ bản gãy (F-Score ≤ 3, lợi nhuận giảm mạnh)"]},
    "long": {"name": "Đầu tư dài hạn", "horizon": "1–3 năm+", "hold_max": 250,
             "desc": "Tích sản doanh nghiệp chất lượng cao (ROE bền, ít nợ, dòng tiền thật) khi giá rẻ hơn giá trị hợp lý. Mua dần 3 lần để có giá vốn tốt, "
                     "không cắt lỗ theo biến động giá – chỉ bán khi luận điểm gãy hoặc giá đã vượt xa giá trị.",
             "rules": ["Vào: chia 3 lần – 1/3 ở vùng mua, 1/3 khi giảm thêm 7%, 1/3 khi giảm thêm 14%", "Không cắt lỗ theo giá; xem lại luận điểm nếu giảm 25%",
                       "Bán một phần khi giá vượt giá trị hợp lý 20%", "Bán hết khi luận điểm gãy (F-Score ≤ 3, lỗ, ROE sụt mạnh)"],
             "exposure": {"green": 100, "yellow": 90, "red": 70}, "max_positions": 10, "max_weight": 15},
    "income": {"name": "Cổ tức", "horizon": "Nhiều năm", "hold_max": 250,
               "desc": "Nhận dòng tiền cổ tức đều: doanh nghiệp trả tiền mặt nhiều năm liền, lợi suất cao, tỷ lệ chi trả an toàn. Mua ở mức giá cho lợi suất ≥ 6%/năm.",
               "rules": ["Vào: khi lợi suất cổ tức tiền mặt ≥ 6%", "Không cắt lỗ theo giá; xem lại nếu giảm 20% hoặc cổ tức bị cắt",
                         "Bán khi lợi suất xuống dưới 3,5% (giá đã cao) hoặc doanh nghiệp giảm cổ tức"],
               "exposure": {"green": 100, "yellow": 80, "red": 60}, "max_positions": 8, "max_weight": 15},
}


def _f(x):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else x
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ lướt sóng: tín hiệu (dùng chung cho thật & backtest)
SWING = {"atr_mult": 2.5, "stop_cap": 0.90, "stop_min": 0.95, "target_r": 3.0, "mode": "both", "green_only": False, "hold_max": 20}


def swing_frame(df: pd.DataFrame) -> pd.DataFrame:
    c, h, l, o, v = df["close"], df["high"], df["low"], df["open"], df["volume"]
    e20 = ind.ema(c, 20)
    m50, m200 = ind.sma(c, 50), ind.sma(c, 200)
    atr = ind.atr(df, 14)
    rsi = ind.rsi(c, 14)
    vol20 = v.rolling(20).mean()
    hh20 = c.shift(1).rolling(20).max()
    ll20 = c.shift(1).rolling(20).min()
    val20 = (c * v / 1e6).rolling(20).mean()
    up = (c > m50) & (m50 > m200) & (m50 > m50.shift(10))
    pull = up & (l <= e20 * 1.01) & (c > e20) & (c > o) & (c > c.shift(1)) & rsi.between(40, 62)
    brk = (c > hh20) & (v > 1.5 * vol20) & (c > m50) & ((hh20 / ll20 - 1) < 0.20) & (m50 >= m200 * 0.98)
    stop = np.maximum(c - SWING["atr_mult"] * atr, l.rolling(5).min() * 0.99)
    stop = np.minimum(np.maximum(stop, c * SWING["stop_cap"]), c * SWING["stop_min"])
    if SWING["mode"] == "pull":
        brk = brk & False
    elif SWING["mode"] == "brk":
        pull = pull & False
    rs60 = c / c.shift(60) - 1
    return pd.DataFrame({"close": c, "pull": pull.fillna(False), "brk": brk.fillna(False), "stop": stop, "e20": e20, "atr": atr,
                         "val20": val20, "rs60": rs60, "volr": v / vol20, "rsi": rsi, "up": up.fillna(False)})


def swing_signal(df: pd.DataFrame) -> dict | None:
    if df is None or len(df) < 220:
        return None
    f = swing_frame(df)
    r = f.iloc[-1]
    if not (r["pull"] or r["brk"]):
        return None
    c = float(r["close"])
    stop = float(r["stop"])
    setup = "Bứt phá nền giá kèm khối lượng" if r["brk"] else "Chỉnh về EMA20 rồi bật lên trong xu hướng tăng"
    lo = round(max(stop * 1.01, float(r["e20"]) if r["pull"] else c * 0.99), 2)
    zone = [min(lo, round(c, 2)), round(c * 1.02, 2)]
    entry = c
    risk = entry - stop
    t1, t2 = entry + SWING["target_r"] * risk, entry + (SWING["target_r"] + 1) * risk
    return {"setup": setup, "setup_key": "brk" if r["brk"] else "pull", "zone": zone, "entry": round(entry, 2), "stop": round(stop, 2),
            "stop_pct": round(100 * (stop / entry - 1), 1), "t1": round(t1, 2), "t2": round(t2, 2), "t1_pct": round(100 * (t1 / entry - 1), 1),
            "rr": SWING["target_r"], "state": "now", "rs60": _f(r["rs60"]), "volr": _f(r["volr"]), "val20": _f(r["val20"]), "rsi": _f(r["rsi"]),
            "exit_note": "Thoát nếu sau 20 phiên chưa đạt mục tiêu, hoặc đóng cửa dưới EMA20 2 phiên liền"}


# ------------------------------------------------------------------ kế hoạch theo từng phong cách
def _size(risk_pct, stop_pct, cap):
    if stop_pct is None or stop_pct >= 0:
        return cap
    return round(min(cap, risk_pct / -stop_pct * 100), 1)


def plan_swing(u: pd.DataFrame, g: dict, regime: dict) -> dict:
    S = STYLES["swing"]
    ex = S["exposure"][regime.get("light", "yellow")]
    cand = []
    for s, r in u.iterrows():
        if not r.get("has_fin") or (r.get("ni_ttm") is not None and r.get("ni_ttm") == r.get("ni_ttm") and r.get("ni_ttm") <= 0):
            continue
        if (r.get("avg_value_bn") or 0) < 10 or (r.get("price") or 0) < 10 or s not in g:
            continue
        sig = swing_signal(g[s])
        if not sig:
            continue
        score = 50 + 25 * np.tanh(4 * (sig["rs60"] or 0)) + 10 * np.tanh((sig["volr"] or 1) - 1) + 0.15 * ((r.get("ta_score") or 50) - 50) + 0.1 * ((r.get("rs_rating") or 50) - 50)
        cand.append((float(score), s, r, sig))
    cand.sort(key=lambda x: -x[0])
    picks, watch = [], []
    slots = int(round(S["max_positions"] * ex / 100))
    for score, s, r, sig in cand:
        item = {"symbol": s, "basket": "swing", "score": round(score, 1), "sector": r.get("sector") or "Khác", **sig}
        if len(picks) < slots:
            w = _size(S["risk_per_trade"], sig["stop_pct"], S["max_weight"])
            picks.append({**item, "weight": w})
        else:
            watch.append({**item, "reason": "Đèn thị trường không cho lướt sóng thêm" if not slots else "Đã đủ số vị thế lướt sóng – xếp hạng thấp hơn"})
    inv = round(sum(p["weight"] for p in picks), 1)
    return {"picks": picks, "watch": watch[:15], "invested": inv, "cash": round(100 - inv, 1), "exposure_cap": ex,
            "note": None if slots else "Đèn đỏ: hệ thống lướt sóng không mở vị thế mới. Các tín hiệu dưới đây chỉ để theo dõi."}


def plan_long(u: pd.DataFrame, sc: pd.DataFrame, regime: dict, cfg: dict) -> dict:
    S = STYLES["long"]
    ex = S["exposure"][regime.get("light", "yellow")]
    d = u.join(sc[["quality", "value", "dividend", "growth"]].add_prefix("s_"), how="inner") if not sc.empty else u
    ct = d["ctype"] == "CT"
    m = (d["has_fin"].fillna(False) & (d["avg_value_bn"].fillna(0) >= 2) & (d["mcap_bn"].fillna(0) >= 3000)
         & (d["fscore"].fillna(0) >= 6) & (d[["roe_avg5", "roe"]].min(axis=1).fillna(0) >= 12) & ((d["de"].fillna(0) < 1.5) | ~ct)
         & (d["ni_ttm"].fillna(-1) > 0) & (d["loss_years"].fillna(0) == 0) & (d["fair"].notna())
         & ~d.get("val_flag", pd.Series(None, index=d.index)).isin(["event", "det"]))
    d = d[m].copy()
    d["sc_long"] = 0.35 * d["s_quality"] + 0.35 * d["s_value"] + 0.15 * d["s_dividend"] + 0.15 * d["s_growth"]
    d = d.sort_values("sc_long", ascending=False)
    picks, watch = [], []
    mos = float((cfg.get("risk") or {}).get("margin_of_safety", 20)) / 100
    w_each = min(S["max_weight"], ex / S["max_positions"])
    for s, r in d.iterrows():
        price, fair = float(r["price"]), float(r["fair"])
        buy_hi = fair * (1 - mos)
        t1, t2 = fair, float(r["fair_hi"]) if _f(r.get("fair_hi")) else fair * 1.2
        base = {"symbol": s, "basket": "long", "score": round(float(r["sc_long"]), 1), "sector": r.get("sector") or "Khác",
                "zone": [round(buy_hi * 0.9, 2), round(buy_hi, 2)], "stop": round(min(price, buy_hi) * 0.75, 2), "stop_pct": -25.0,
                "t1": round(t1, 2), "t2": round(t2, 2), "rr": None, "stop_label": "xem lại", "exit_note": "Không cắt lỗ theo giá – xem lại luận điểm nếu giảm 25%; bán một phần khi vượt giá trị hợp lý 20%"}
        if price <= buy_hi:
            entry = price
            item = {**base, "zone": [round(price * 0.97, 2), round(min(buy_hi, price * 1.02), 2)], "stop": round(price * 0.75, 2),
                    "rr": round((t1 - entry) / (entry * 0.25), 2), "entry": round(entry, 2), "state": "now", "t1_pct": round(100 * (t1 / entry - 1), 1),
                    "tranches": [round(entry, 2), round(entry * 0.93, 2), round(entry * 0.86, 2)],
                    "setup": "Rẻ hơn giá trị hợp lý ≥ " + str(int(mos * 100)) + "% – mua dần 3 lần"}
            if len(picks) < S["max_positions"]:
                picks.append({**item, "weight": round(w_each, 1)})
            else:
                watch.append({**item, "reason": "Đã đủ số mã dài hạn"})
        elif len(watch) < 15:
            watch.append({**base, "entry": round(buy_hi, 2), "state": "wait", "t1_pct": round(100 * (t1 / buy_hi - 1), 1),
                          "reason": f"Doanh nghiệp đạt chuẩn – chờ giá về ≤ {buy_hi:.2f} (giá trị hợp lý {fair:.2f} trừ biên an toàn)"})
    inv = round(sum(p["weight"] for p in picks), 1)
    return {"picks": picks, "watch": watch[:15], "invested": inv, "cash": round(100 - inv, 1), "exposure_cap": ex}


def plan_income(u: pd.DataFrame, regime: dict) -> dict:
    S = STYLES["income"]
    ex = S["exposure"][regime.get("light", "yellow")]
    d = u[u["has_fin"].fillna(False) & (u["avg_value_bn"].fillna(0) >= 1) & (u["cash_years"].fillna(0) >= 3)
          & (u["div_yield"].fillna(0) >= 3.5) & (u["payout"].fillna(999) <= 90) & (u["ni_ttm"].fillna(-1) > 0)
          & (u["fscore"].fillna(0) >= 5) & (u["mcap_bn"].fillna(0) >= 500)
          & ~u.get("val_flag", pd.Series(None, index=u.index)).isin(["event", "det"])].copy()
    d["sc_inc"] = d["div_yield"].clip(upper=15) * 4 + d["cash_years"].clip(upper=10) * 3 + d["fscore"].fillna(5) * 2 - d["de"].fillna(0).clip(upper=3) * 5
    d = d.sort_values("sc_inc", ascending=False)
    picks, watch = [], []
    w_each = min(S["max_weight"], ex / S["max_positions"])
    for s, r in d.iterrows():
        price, y = float(r["price"]), float(r["div_yield"])
        dps = price * y / 100
        p6, p35 = dps / 0.06, dps / 0.035
        base = {"symbol": s, "basket": "income", "score": round(float(r["sc_inc"]), 1), "sector": r.get("sector") or "Khác",
                "zone": [round(p6 * 0.93, 2), round(p6, 2)], "stop": round(min(price, p6) * 0.8, 2), "stop_pct": -20.0,
                "t1": round(p35, 2), "t2": round(p35 * 1.1, 2), "rr": None, "stop_label": "xem lại", "yield": round(y, 2), "dps": round(dps * 1000),
                "exit_note": "Bán khi lợi suất xuống dưới 3,5% hoặc doanh nghiệp giảm cổ tức"}
        if y >= 6:
            t1 = min(p35, price * 1.3)
            item = {**base, "zone": [round(price * 0.97, 2), round(min(p6, price * 1.01), 2)], "stop": round(price * 0.8, 2), "t1": round(t1, 2), "t2": round(min(p35, price * 1.5), 2), "rr": round((t1 - price) / (price * 0.2), 2),
                    "entry": round(price, 2), "state": "now", "t1_pct": round(100 * (t1 / price - 1), 1),
                    "setup": f"Lợi suất tiền mặt {y:.1f}%/năm" + (" – rất cao, kiểm tra có phải cổ tức đặc biệt một lần" if y > 10 else "")}
            if len(picks) < S["max_positions"]:
                picks.append({**item, "weight": round(w_each, 1)})
            else:
                watch.append({**item, "reason": "Đã đủ số mã cổ tức"})
        elif len(watch) < 15:
            watch.append({**base, "entry": round(p6, 2), "state": "wait", "t1_pct": round(100 * (p35 / p6 - 1), 1),
                          "reason": f"Lợi suất hiện {y:.1f}% – chờ giá ≤ {p6:.2f} để đạt 6%"})
    inv = round(sum(p["weight"] for p in picks), 1)
    return {"picks": picks, "watch": watch[:15], "invested": inv, "cash": round(100 - inv, 1), "exposure_cap": ex}


def levels_for(row: pd.Series, df: pd.DataFrame | None, cfg: dict) -> dict:
    """Mức giá của 1 mã theo từng phong cách (hiện trên trang chi tiết mã)."""
    out = {}
    sig = swing_signal(df) if df is not None else None
    out["swing"] = sig or {"none": True, "reason": "Chưa có điểm vào lướt sóng (cần nhịp chỉnh về EMA20 trong xu hướng tăng hoặc bứt phá nền có khối lượng)"}
    fair = _f(row.get("fair"))
    price = _f(row.get("price"))
    mos = float((cfg.get("risk") or {}).get("margin_of_safety", 20)) / 100
    if fair and price:
        buy_hi = fair * (1 - mos)
        out["long"] = {"zone": [round(price * 0.97, 2), round(min(buy_hi, price * 1.02), 2)] if price <= buy_hi else [round(buy_hi * 0.9, 2), round(buy_hi, 2)], "state": "now" if price <= buy_hi else "wait",
                       "tranches": [round(min(price, buy_hi), 2), round(min(price, buy_hi) * 0.93, 2), round(min(price, buy_hi) * 0.86, 2)],
                       "review": round(min(price, buy_hi) * 0.75, 2), "t1": round(fair, 2), "t2": round(_f(row.get("fair_hi")) or fair * 1.2, 2)}
    else:
        out["long"] = {"none": True, "reason": "Chưa định giá được đáng tin cậy"}
    y = _f(row.get("div_yield"))
    if y and price and y > 0:
        dps = price * y / 100
        out["income"] = {"yield": round(y, 2), "dps": round(dps * 1000), "buy_at_6": round(dps / 0.06, 2), "sell_at_35": round(dps / 0.035, 2),
                         "cash_years": _f(row.get("cash_years"))}
    else:
        out["income"] = {"none": True, "reason": "Không trả cổ tức tiền mặt"}
    return out


# ------------------------------------------------------------------ backtest lướt sóng (mô phỏng danh mục theo ngày)
def backtest_swing(prices: pd.DataFrame, idx_close: pd.Series, start: str = "2020-03-01", cost_buy=0.0015, cost_sell=0.0025,
                   max_pos=5, risk=0.01, max_w=0.20, hold_max=None) -> dict:
    hold_max = hold_max or SWING["hold_max"]
    stocks = prices[~prices["symbol"].isin(["VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"])]
    W = {k: stocks.pivot_table(index="date", columns="symbol", values=k).sort_index() for k in ("open", "high", "low", "close", "volume")}
    C = W["close"]
    dates = C.index
    # tín hiệu từng mã (vector hoá theo cột)
    pull, brk, stop, score, e20 = {}, {}, {}, {}, {}
    for s in C.columns:
        df = pd.DataFrame({k: W[k][s] for k in W}).dropna(subset=["close"])
        if len(df) < 250:
            continue
        f = swing_frame(df)
        ok = (f["val20"] >= 10) & (f["close"] >= 10)
        pull[s], brk[s] = (f["pull"] & ok), (f["brk"] & ok)
        stop[s], e20[s] = f["stop"], f["e20"]
        score[s] = np.tanh(4 * f["rs60"].fillna(0)) + 0.4 * np.tanh(f["volr"].fillna(1) - 1)
    if not pull:
        return {"ok": False}
    P = pd.DataFrame(pull).reindex(dates).fillna(False)
    B = pd.DataFrame(brk).reindex(dates).fillna(False)
    SIG = P | B
    STP = pd.DataFrame(stop).reindex(dates)
    SCR = pd.DataFrame(score).reindex(dates)
    E20 = pd.DataFrame(e20).reindex(dates)
    O, H, L = W["open"].reindex(columns=SIG.columns), W["high"].reindex(columns=SIG.columns), W["low"].reindex(columns=SIG.columns)
    C = C.reindex(columns=SIG.columns)
    ix = idx_close.reindex(dates).ffill()
    s50, s200 = ix.rolling(50).mean(), ix.rolling(200).mean()
    light = ((ix > s200).astype(int) + (s50 > s200).astype(int) + (ix > s50).astype(int)).map({3: 1.0, 2: 0.0 if SWING["green_only"] else 0.5, 1: 0.0, 0: 0.0})
    t0 = dates.searchsorted(pd.Timestamp(start))
    eq, cash = 1.0, 1.0
    pos = {}  # sym -> dict(qty, entry, stop, t1, i_entry, below)
    curve, trades = [], []
    for i in range(t0, len(dates) - 1):
        # 1) quản lý vị thế đang mở trong phiên i (đã qua T+2 mới bán được)
        for s in list(pos):
            p = pos[s]
            held = i - p["i"]
            o_, h_, l_, c_ = O[s].iat[i], H[s].iat[i], L[s].iat[i], C[s].iat[i]
            if c_ != c_:
                continue
            ex_px, why = None, None
            if held >= 2:
                if l_ <= p["stop"]:
                    ex_px, why = min(o_, p["stop"]) if o_ == o_ else p["stop"], "stop"
                elif h_ >= p["t1"]:
                    ex_px, why = max(o_, p["t1"]) if o_ == o_ else p["t1"], "target"
                else:
                    e = E20[s].iat[i]
                    p["below"] = p["below"] + 1 if (e == e and c_ < e) else 0
                    if p["below"] >= 2 or held >= hold_max:
                        ex_px, why = c_, "ema" if p["below"] >= 2 else "time"
            if ex_px is not None:
                proceeds = p["qty"] * ex_px * (1 - cost_sell)
                cash += proceeds
                trades.append({"sym": s, "ret": ex_px * (1 - cost_sell) / (p["entry"] * (1 + cost_buy)) - 1, "why": why, "days": held,
                               "r": (ex_px - p["entry"]) / (p["entry"] - p["stop0"]) if p["entry"] > p["stop0"] else 0})
                del pos[s]
        # 2) giá trị danh mục cuối phiên i
        mv = sum(p["qty"] * (C[s].iat[i] if C[s].iat[i] == C[s].iat[i] else p["entry"]) for s, p in pos.items())
        eq = cash + mv
        curve.append((dates[i], eq))
        # 3) tín hiệu cuối phiên i -> mua ở giá mở cửa phiên i+1
        slots = int(round(max_pos * float(light.iat[i] if light.iat[i] == light.iat[i] else 0))) - len(pos)
        if slots <= 0:
            continue
        row = SIG.iloc[i]
        cands = row[row].index.difference(list(pos))
        if not len(cands):
            continue
        sc_ = SCR.iloc[i][cands].sort_values(ascending=False)
        for s in sc_.index[:slots]:
            o1 = O[s].iat[i + 1]
            st = STP[s].iat[i]
            if not (o1 == o1 and st == st) or o1 <= st * 1.005:
                continue
            if o1 > C[s].iat[i] * 1.03:  # mở cửa tăng quá mạnh – bỏ, không đuổi giá
                continue
            dist = (o1 - st) / o1
            w = min(max_w, risk / max(dist, 0.03))
            spend = min(cash, eq * w)
            if spend < eq * 0.02:
                continue
            qty = spend / (o1 * (1 + cost_buy))
            cash -= spend
            pos[s] = {"qty": qty, "entry": o1, "stop": st, "stop0": st, "t1": o1 + SWING["target_r"] * (o1 - st), "i": i + 1, "below": 0}
    cv = pd.Series(dict(curve))
    if len(cv) < 60:
        return {"ok": False}
    yrs = (cv.index[-1] - cv.index[0]).days / 365.25
    cagr = (cv.iloc[-1] / cv.iloc[0]) ** (1 / yrs) - 1
    dd = float((cv / cv.cummax() - 1).min())
    r = cv.pct_change().dropna()
    vol = float(r.std() * np.sqrt(250))
    T = pd.DataFrame(trades)
    yearly = cv.resample("YE").last().pct_change()
    yearly.iloc[0] = cv.resample("YE").last().iloc[0] / cv.iloc[0] - 1
    m = cv.resample("ME").last()
    b = ix.loc[cv.index[0]:cv.index[-1]]
    return {"ok": True, "cagr": round(100 * cagr, 1), "max_dd": round(100 * dd, 1), "vol": round(100 * vol, 1),
            "sharpe": round((cagr - 0.03) / vol, 2) if vol else None, "trades": int(len(T)),
            "trades_per_year": round(len(T) / yrs, 0) if yrs else None,
            "win_rate": round(100 * float((T["ret"] > 0).mean()), 0) if len(T) else None,
            "avg_ret": round(100 * float(T["ret"].mean()), 2) if len(T) else None,
            "avg_win": round(100 * float(T.loc[T["ret"] > 0, "ret"].mean()), 1) if len(T) and (T["ret"] > 0).any() else None,
            "avg_loss": round(100 * float(T.loc[T["ret"] <= 0, "ret"].mean()), 1) if len(T) and (T["ret"] <= 0).any() else None,
            "avg_days": round(float(T["days"].mean()), 1) if len(T) else None,
            "exits": T["why"].value_counts().to_dict() if len(T) else {},
            "yearly": {str(k.year): round(100 * float(v), 1) for k, v in yearly.items() if v == v},
            "curve": [{"d": str(k.date()), "v": round(float(v), 4)} for k, v in m.items()],
            "bench_cagr": round(100 * ((b.iloc[-1] / b.iloc[0]) ** (1 / yrs) - 1), 1)}


def backtest_styles(prices, fq, divs, listing, cfg, bt_mod) -> dict:
    """Kiểm chứng từng phong cách trên cùng giai đoạn."""
    import copy
    out = {}
    idx = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"].sort_index()
    try:
        out["swing"] = backtest_swing(prices, idx)
    except Exception as e:  # noqa: BLE001
        out["swing"] = {"ok": False, "reason": str(e)}
    for key, alloc, trend, stop, ex in (("long", {"garp": 40, "defensive": 30, "dividend": 30}, "not_down", False, STYLES["long"]["exposure"]),
                                        ("income", {"dividend": 60, "defensive": 40}, "not_down", False, STYLES["income"]["exposure"])):
        c = copy.deepcopy(cfg)
        c["allocation"] = alloc
        c.setdefault("strategy", {})["trend_filter"] = trend
        c.setdefault("backtest", {})["use_stop"] = stop
        c["backtest"]["slots_per_basket"] = 10
        c["regime_exposure"] = ex
        try:
            r = bt_mod.run(prices, fq, divs, listing, c, do_sectors=False)
            cr = r.get("combo_regime") or {}
            out[key] = {"ok": bool(r.get("ok")), **{k: cr.get(k) for k in ("cagr", "max_dd", "vol", "sharpe", "yearly", "curve", "win_years", "n_years")}}
        except Exception as e:  # noqa: BLE001
            out[key] = {"ok": False, "reason": str(e)}
    return out
