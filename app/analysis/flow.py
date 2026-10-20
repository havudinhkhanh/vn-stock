"""Dòng tiền lớn (gom / xả / bứt phá) và tâm lý thị trường.

Gom âm thầm   10 phiên: KL trung bình ≥ 1,5 lần mức bình thường (trung vị 60 phiên TRƯỚC cửa sổ), ≥ 60% số phiên KL ≥ 1,3 lần,
              giá chỉ đi −3%…+6%, nến đóng cửa nửa trên (CLV > 0), KL phiên tăng > 1,2 lần KL phiên giảm.
Xả âm thầm    như trên nhưng giá −6%…+3%, đóng cửa nửa dưới, KL phiên giảm > phiên tăng (tỷ lệ < 0,8).
Bứt phá có KL đóng cửa vượt đỉnh 20 phiên trước với KL ≥ 1,5 lần trung vị 20 phiên.
Kiểm chứng (2016–nay, mã GTGD ≥ 2 tỷ): mỗi kiểu → lợi nhuận 20/60 phiên sau so với VN-Index, xác suất có "game" (+20% trong 60 phiên).

Tâm lý thị trường (0–100): trung bình xếp hạng (2 năm gần nhất) của độ rộng (% mã trên MA50), tỷ lệ phiên tăng/giảm 10 phiên,
đỉnh mới − đáy mới 52 tuần, thanh khoản so với 60 phiên, đà VN-Index 20 phiên. Kiểm chứng: nhóm điểm → VN-Index 20/60 phiên sau.
Chưa có lịch sử khối ngoại / margin nên chưa đưa vào.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

N = 10


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def features(P: dict) -> dict:
    C, H, L, V = P["C"], P["H"], P["L"], P["V"]
    ret = C.pct_change(fill_method=None)
    vmed = V.rolling(60, min_periods=40).median().shift(N)
    vr = V.rolling(N).mean() / vmed
    hi_days = (V >= 1.3 * vmed).astype(float).rolling(N).sum()
    pchg = C / C.shift(N) - 1
    clv = ((C - L) - (H - C)) / (H - L).replace(0, np.nan)
    clv_n = clv.rolling(N).mean()
    upv = V.where(ret > 0, 0).rolling(N).sum()
    dnv = V.where(ret < 0, 0).rolling(N).sum()
    ud = upv / dnv.replace(0, np.nan)
    acc = (vr >= 1.5) & (hi_days >= 0.6 * N) & (pchg > -0.03) & (pchg < 0.06) & (clv_n > 0) & (ud > 1.2)
    dist = (vr >= 1.5) & (hi_days >= 0.6 * N) & (pchg > -0.06) & (pchg < 0.03) & (clv_n < 0) & (ud < 0.8)
    hh20 = H.rolling(20).max().shift(1)
    brk = (C > hh20) & (V >= 1.5 * V.rolling(20).median().shift(1))
    acc_recent = acc.astype(float).rolling(15, min_periods=1).max() > 0
    obv = (np.sign(ret).fillna(0) * V).cumsum()
    obv_s = (obv - obv.shift(20)) / V.rolling(20).mean() / 20
    return {"vr": vr, "hi_days": hi_days, "pchg": pchg, "clv": clv_n, "ud": ud, "acc": acc, "dist": dist, "brk": brk,
            "acc_brk": acc_recent & brk, "obv_s": obv_s, "ret": ret}


def event_study(F: dict, C: pd.DataFrame, H: pd.DataFrame, bench: pd.Series, liq: pd.DataFrame) -> dict:
    b = bench.reindex(C.index).ffill()
    fw = {k: (C.shift(-k) / C - 1).sub(b.shift(-k) / b - 1, axis=0).replace([np.inf, -np.inf], np.nan) for k in (20, 60)}
    mx60 = H[::-1].rolling(60, min_periods=40).max()[::-1].shift(-1) / C - 1
    base = liq.copy()
    base.loc[base.index < pd.Timestamp("2016-01-01")] = False
    samp = np.zeros(len(C), bool)
    samp[::5] = True
    base = base & samp[:, None]
    mid = pd.Timestamp("2021-07-01")
    names = {"acc": "Gom âm thầm (KL lớn, giá đi ngang, đóng cao)", "dist": "Xả âm thầm (KL lớn, giá đi ngang/giảm, đóng thấp)",
             "brk": "Bứt phá đỉnh 20 phiên có KL", "acc_brk": "Gom rồi bứt phá (trong 15 phiên)"}
    out = {}
    for k, nm in list(names.items()) + [("_base", "Mốc: mọi mã thanh khoản")]:
        m = base if k == "_base" else base & F[k]
        x20, x60, z = fw[20].where(m), fw[60].where(m), mx60.where(m)
        v20 = x20.values[~np.isnan(x20.values)]
        if len(v20) < 30:
            out[k] = {"name": nm, "n": int(len(v20))}
            continue
        per = x20.mean(axis=1).dropna()
        t = per.mean() / (per.std(ddof=1) / np.sqrt(len(per))) if len(per) > 3 else None
        a, bb = x20[x20.index < mid].values, x20[x20.index >= mid].values
        a, bb = a[~np.isnan(a)], bb[~np.isnan(bb)]
        zz = z.values[~np.isnan(z.values)]
        v60 = x60.values[~np.isnan(x60.values)]
        out[k] = {"name": nm, "n": int(len(v20)), "r20": _r(100 * v20.mean()), "hit20": _r(100 * (v20 > 0).mean(), 0),
                  "r60": _r(100 * v60.mean()) if len(v60) else None, "game": _r(100 * (zz >= 0.2).mean(), 0) if len(zz) else None,
                  "t20": _r(t, 1), "r20_a": _r(100 * a.mean()) if len(a) > 20 else None, "r20_b": _r(100 * bb.mean()) if len(bb) > 20 else None}
    bg = (out.get("_base") or {}).get("game")
    for k in names:
        o = out.get(k) or {}
        o["useful"] = bool(o.get("t20") is not None and abs(o["t20"]) >= 2 and o.get("r20_a") is not None and o.get("r20_b") is not None
                           and np.sign(o["r20_a"]) == np.sign(o["r20_b"]))
        o["game_x"] = _r((o.get("game") or 0) - (bg or 0), 0) if o.get("game") is not None and bg is not None else None
    return out


def streak(mask: pd.Series) -> int:
    v = mask.values[::-1]
    n = 0
    for x in v:
        if not x:
            break
        n += 1
    return n


def current(F: dict, C: pd.DataFrame, liq_last: pd.Series, of: pd.DataFrame | None, shark: dict | None) -> list[dict]:
    rows = []
    of_by = {s: d.sort_values("date") for s, d in of.groupby("symbol")} if of is not None and not of.empty else {}
    for s in C.columns:
        if not bool(liq_last.get(s, False)):
            continue
        st = []
        if bool(F["acc"][s].iloc[-1]):
            st.append("acc")
        if bool(F["dist"][s].iloc[-1]):
            st.append("dist")
        if bool(F["brk"][s].iloc[-3:].any()):
            st.append("acc_brk" if bool(F["acc_brk"][s].iloc[-3:].any()) else "brk")
        rec = {"s": s, "st": st, "vr": _r(F["vr"][s].iloc[-1]), "pchg": _r(100 * F["pchg"][s].iloc[-1], 1), "ud": _r(F["ud"][s].iloc[-1]),
               "clv": _r(F["clv"][s].iloc[-1]), "obv": _r(F["obv_s"][s].iloc[-1]),
               "acc_days": streak(F["acc"][s].fillna(False)), "dist_days": streak(F["dist"][s].fillna(False)),
               "acc_20": int(F["acc"][s].iloc[-20:].sum()), "dist_20": int(F["dist"][s].iloc[-20:].sum())}
        d = of_by.get(s)
        if d is not None and len(d):
            t = d.tail(10)
            rec["delta10"] = _r(100 * t["delta"].sum() / max((t["buy"] + t["sell"]).sum(), 1), 1)
            rec["delta_pos"] = int((t["delta"] > 0).sum())
            rec["delta_n"] = int(len(t))
        if shark and s in shark:
            sh = shark[s][-5:]
            rec["shark5"] = _r(sum((x.get("shark") or {}).get("net") or 0 for x in sh), 1)
        rows.append(rec)
    return rows


def sentiment(C: pd.DataFrame, H: pd.DataFrame, V: pd.DataFrame, liq: pd.DataFrame, idx: pd.Series) -> dict:
    ret = C.pct_change(fill_method=None)
    ma50 = C.rolling(50).mean()
    nliq = liq.sum(axis=1).replace(0, np.nan)
    comp = {}
    comp["breadth"] = ((C > ma50) & liq).sum(axis=1) / nliq
    adv, dec = ((ret > 0) & liq).sum(axis=1), ((ret < 0) & liq).sum(axis=1)
    comp["ad10"] = adv.rolling(10).sum() / (adv.rolling(10).sum() + dec.rolling(10).sum()).replace(0, np.nan)
    hi52 = C >= H.rolling(250, min_periods=120).max().shift(1)
    lo52 = C <= C.rolling(250, min_periods=120).min().shift(1)
    comp["hilo"] = ((hi52 & liq).sum(axis=1) - (lo52 & liq).sum(axis=1)) / nliq
    val = (C * V / 1e6).where(liq).sum(axis=1)
    comp["turn"] = val / val.rolling(60).mean()
    ix = idx.reindex(C.index).ffill()
    comp["mom"] = ix / ix.shift(20) - 1
    D = pd.DataFrame(comp).dropna()
    D = D[D.index >= "2015-06-01"]
    R = D.rolling(500, min_periods=250).rank(pct=True)
    S = (100 * R.mean(axis=1)).dropna()
    test = {}
    for k in (20, 60):
        f = ix.reindex(S.index).shift(-k) / ix.reindex(S.index) - 1
        x = pd.concat([S.rename("s"), f.rename("f")], axis=1).dropna().iloc[::5]
        if len(x) < 50:
            continue
        q = pd.qcut(x["s"], 5, labels=False)
        test[str(k)] = {"ic": _r(x["s"].rank().corr(x["f"].rank()), 3), "n": int(len(x)),
                        "q": [{"q": int(a) + 1, "r": _r(100 * g.mean()), "hit": _r(100 * (g > 0).mean(), 0)} for a, g in x.groupby(q)["f"]],
                        "all": _r(100 * x["f"].mean())}
    try:
        play = playbook(S, ix)
    except Exception:  # noqa: BLE001
        play = None
    LAST["S"], LAST["ix"] = S, ix
    last = S.index[-1] if len(S) else None
    lab = lambda v: "Hưng phấn" if v >= 80 else "Lạc quan" if v >= 60 else "Trung tính" if v >= 40 else "Thận trọng" if v >= 20 else "Sợ hãi"  # noqa: E731
    comp_now = {}
    if last is not None:
        for k, nm in (("breadth", "% mã trên MA50"), ("ad10", "Tỷ lệ phiên tăng 10 ngày"), ("hilo", "Đỉnh mới − đáy mới 52 tuần"),
                      ("turn", "Thanh khoản so với 60 phiên"), ("mom", "VN-Index 20 phiên")):
            comp_now[k] = {"name": nm, "raw": _r(D[k].iloc[-1] * (100 if k in ("breadth", "ad10", "hilo", "mom") else 1), 2), "rank": _r(100 * R[k].iloc[-1], 0)}
    hist = S.iloc[-500:]
    return {"now": _r(S.iloc[-1], 0) if len(S) else None, "label": lab(S.iloc[-1]) if len(S) else None, "date": str(last.date()) if last is not None else None,
            "chg5": _r(S.iloc[-1] - S.iloc[-6], 0) if len(S) > 6 else None, "comp": comp_now, "test": test,
            "hist": {"t": [str(d.date()) for d in hist.index], "v": [_r(v, 1) for v in hist.values]},
            "breadth_pct": _r(100 * D["breadth"].iloc[-1], 0) if len(D) else None, "playbook": play}


LAST: dict = {}   # chuỗi tâm lý + VN-Index của lượt chạy gần nhất (rổ chỉ số dùng lại để kiểm chứng thời điểm vào)

STATES = {
    "fear_deep": ("Sợ hãi sau khi đã giảm sâu", "Tâm lý < 20 và VN-Index đã giảm ≥ 20% từ đỉnh",
                  "Vùng tích lũy dần cho dài hạn: giải ngân từng phần (chia 3–4 lần), ưu tiên rổ chỉ số / mã đầu ngành cơ bản tốt. Có thể còn giảm thêm vài % – không dồn hết một lần."),
    "fear_mid": ("Sợ hãi giữa đợt giảm", "Tâm lý < 20, VN-Index giảm 10–20% từ đỉnh",
                 "Lịch sử xấu nhất: thường còn giảm tiếp. CHƯA bắt đáy – giữ tiền, tôn trọng dừng lỗ; chờ tâm lý hồi lên > 50 hoặc VN-Index giảm sâu hơn (≥ 20%)."),
    "fear_shallow": ("Cú sốc đầu tiên", "Tâm lý < 20 khi VN-Index mới giảm < 10% từ đỉnh",
                     "Thường chưa phải đáy, hay là khởi đầu một đợt điều chỉnh. Không mua đuổi bắt đáy; mã đang nắm thì giữ kỷ luật dừng lỗ."),
    "recover": ("Sợ hãi vừa qua", "Tâm lý từ < 20 bật lên > 50 trong vòng 30 phiên",
                "Tín hiệu vào lại có xác nhận: có thể giải ngân dần theo danh sách MUA; đặt dừng lỗ dưới đáy vừa tạo."),
    "greed_up": ("Hưng phấn trong xu hướng tăng", "Tâm lý ≥ 80 và VN-Index trên MA200",
                 "Ở VN, hưng phấn + xu hướng tăng thường còn chạy tiếp – không bán chỉ vì “thị trường nóng”. Giữ mã mạnh, nâng dừng lỗ, không mua đuổi mã đã tăng nóng."),
    "greed_down": ("Hồi mạnh trong xu hướng giảm", "Tâm lý ≥ 80 nhưng VN-Index dưới MA200",
                   "Mẫu lịch sử ít (vài đợt, chủ yếu sau đáy 2020, 2023) và đa số là đầu sóng hồi phục – giải ngân từng phần, xác nhận thêm khi VN-Index vượt MA200."),
    "neutral_up": ("Bình thường – xu hướng tăng", "Tâm lý 20–80, VN-Index trên MA200",
                   "Đi theo kế hoạch: giải ngân theo danh sách MUA, giữ dừng lỗ."),
    "neutral_down": ("Bình thường – xu hướng giảm", "Tâm lý 20–80, VN-Index dưới MA200",
                     "1–3 tháng tới thường yếu hơn bình thường, nhưng 1 năm sau lịch sử lại tốt. Mua dần mã mạnh hơn thị trường, chưa dồn tỷ trọng; VN-Index vượt lại MA200 thì tăng dần."),
}


def _states(S: pd.Series, ix: pd.Series) -> pd.Series:
    ix = ix.reindex(S.index).ffill()
    dd = ix / ix.cummax() - 1
    up = ix > ix.rolling(200, min_periods=150).mean()
    st, last_fear = [], -10 ** 6
    for i, (v, d, u) in enumerate(zip(S.values, dd.values, up.values)):
        if v < 20:
            last_fear = i
            st.append("fear_deep" if d <= -0.20 else "fear_mid" if d <= -0.10 else "fear_shallow")
        elif v > 50 and 0 < i - last_fear <= 30:
            st.append("recover")
        elif v >= 80:
            st.append("greed_up" if u else "greed_down")
        else:
            st.append("neutral_up" if u else "neutral_down")
    return pd.Series(st, index=S.index)


def playbook(S: pd.Series, ix: pd.Series) -> dict:
    """Mỗi trạng thái tâm lý × mức giảm từ đỉnh × xu hướng: lịch sử VN-Index đi đâu sau đó, và hôm nay đang ở trạng thái nào."""
    ix = ix.reindex(S.index).ffill()
    st = _states(S, ix)
    out = []
    for k, (nm, cond, act) in STATES.items():
        m = (st == k).astype(int)
        rec = {"key": k, "name": nm, "cond": cond, "act": act, "days": int(m.sum()), "ep": int(((m == 1) & (m.shift(1).rolling(10, min_periods=1).max().fillna(0) == 0)).sum())}   # số đợt (cách nhau ≥ 10 phiên)
        for h in (20, 60, 120, 250):
            f = (ix.shift(-h) / ix - 1)[st == k].dropna()
            # lấy mẫu cách 5 phiên để bớt chồng lấn
            f5 = f.iloc[::5]
            rec[f"r{h}"] = _r(100 * f.mean(), 1) if len(f) >= 10 else None
            rec[f"w{h}"] = _r(100 * (f > 0).mean(), 0) if len(f) >= 10 else None
            rec[f"n{h}"] = int(len(f5))
        mdd = [(ix.iloc[i:i + 61].min() / ix.iloc[i] - 1) for i in range(len(ix) - 1) if st.iloc[i] == k]
        rec["dd60"] = _r(100 * float(np.mean(mdd)), 1) if len(mdd) >= 10 else None
        out.append(rec)
    base = {f"r{h}": _r(100 * (ix.shift(-h) / ix - 1).mean(), 1) for h in (20, 60, 120, 250)}
    pk = float(ix.cummax().iloc[-1])
    ma200 = ix.rolling(200, min_periods=150).mean()
    cur = st.iloc[-1]
    return {"now": cur, "name": STATES[cur][0], "act": STATES[cur][2], "states": out, "base": base,
            "vni": _r(ix.iloc[-1], 2), "peak": _r(pk, 2), "peak_date": str(ix.idxmax().date()), "dd": _r(100 * (ix.iloc[-1] / pk - 1), 1),
            "lvl20": _r(pk * 0.8, 0), "ma200": _r(ma200.iloc[-1], 0), "above200": bool(ix.iloc[-1] > ma200.iloc[-1]),
            "since": str(S.index[0].date())}
