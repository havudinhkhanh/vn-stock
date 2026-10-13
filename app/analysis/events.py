"""Mã "có sự kiện" (giá sụt mạnh kèm chuỗi phiên giảm sàn) và điểm vào SAU sự kiện.

Cờ sự kiện: giá ≤ −45% so với đỉnh 120 phiên VÀ ≥ 3 phiên giảm ≥ 6,5% trong 60 phiên.
Kiểm chứng 560 đợt (2016–2026, mã GTGD ≥ 1 tỷ), lợi nhuận vượt VN-Index, so với nhóm chứng = mọi mã thanh khoản mua cùng ngày:
  - mua ngay khi có cờ: 120 phiên sau −3,7% so với nhóm chứng (t −2,7); sau đó còn sụt thêm TB −35%;
  - mua nhịp hồi sớm (bật +25% từ đáy, lên lại MA20 sau ~35 phiên, lên MA50 sau ~70 phiên): vẫn thua nhóm chứng (−1,5% … −3,2% / 120 phiên);
  - mua khi sự kiện đã "nguội": ≥ 120 phiên từ lúc có cờ VÀ ≥ 60 phiên liền không có phiên giảm sàn (thường ~150 phiên ≈ 7 tháng):
        mọi mã: +2,3% / 60 phiên (t 2,3), +4,7% / 250 phiên; sụt sâu nhất sau khi mua TB −16% (so với −35% nếu mua ngay);
        DN có lãi & nợ vay/vốn < 1,5, giai đoạn 2022–2026: +3,2% / 120 phiên (t 2,1), +7,2% / 250 phiên (t 2,6), 31% số lần lãi ≥ 30% trong 1 năm;
        DN đang lỗ: không có lợi thế (≈ 0%).
  - chỉ 23% số đợt quay lại được ≥ 90% đỉnh trước sự kiện trong 1 năm → mục tiêu thận trọng.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

DD, DOWN, N_DOWN = -0.45, -0.065, 3
COOL_SINCE, COOL_QUIET, WINDOW_END = 120, 60, 300


def _r(x, nd=2):
    try:
        x = float(x)
        return None if np.isnan(x) or np.isinf(x) else round(x, nd)
    except (TypeError, ValueError):
        return None


def episode(close: pd.Series | None) -> dict | None:
    """Đợt sự kiện gần nhất (trong ~330 phiên) và giai đoạn hiện tại: active (đang / chưa nguội) hoặc window (đã nguội – vùng vào)."""
    if close is None:
        return None
    c = close.dropna()
    c = c[c > 0]
    if len(c) < 140:
        return None
    r = c.pct_change()
    dd = c / c.rolling(120, min_periods=60).max() - 1
    ldn = (r <= DOWN).astype(float).rolling(60, min_periods=20).sum()
    flag = ((dd <= DD) & (ldn >= N_DOWN)).values
    n = len(c)
    lo_i = max(0, n - 330)
    on = np.where(flag[lo_i:])[0] + lo_i
    if not len(on):
        return None
    st = on[0]
    for a, b in zip(on[:-1], on[1:]):
        if b - a >= 60:
            st = b
    since = n - 1 - st
    dn = np.where((r <= DOWN).values)[0]
    last_dn = dn[-1] if len(dn) else st
    quiet = n - 1 - last_dn
    seg = c.iloc[st:]
    pre_hi = float(c.iloc[max(0, st - 120):st + 1].max())
    low = float(seg.min())
    if since > WINDOW_END and not flag[-1]:
        return None          # quá ~14 tháng mà vẫn chưa "nguội" (hay biến động mạnh) → không còn coi là đợt sự kiện này
    active = bool(flag[-1]) or since < COOL_SINCE or quiet < COOL_QUIET
    if active:
        phase = "active"
    elif since <= WINDOW_END:
        phase = "window"
    else:
        return None
    return {"phase": phase, "start": str(c.index[st].date()), "since": int(since), "quiet": int(quiet), "flag_now": bool(flag[-1]),
            "pre_hi": _r(pre_hi), "low": _r(low), "low_date": str(seg.idxmin().date()), "price": _r(float(c.iloc[-1])),
            "dd_now": _r(100 * (float(c.iloc[-1]) / pre_hi - 1), 1), "from_low": _r(100 * (float(c.iloc[-1]) / low - 1), 1),
            "n_down": int(((r.iloc[st:] <= DOWN)).sum()),
            "wait_since": max(0, COOL_SINCE - int(since)), "wait_quiet": max(0, COOL_QUIET - int(quiet)),
            **({"cool": str(c.index[n - 1 - min(since - COOL_SINCE, quiet - COOL_QUIET)].date())} if phase == "window" else {})}


def entry_plan(ep: dict, quality: bool, fair: float | None) -> dict:
    """Kế hoạch cho mã đã qua giai đoạn nguội (phase = window)."""
    px = ep["price"]
    tgt = [x for x in (fair, ep["pre_hi"] * 0.9 if ep.get("pre_hi") else None) if x and x > px]
    t1 = round(min(tgt), 2) if tgt else round(px * 1.25, 2)
    return {"zone": [round(px * 0.97, 2), round(px * 1.02, 2)], "stop": round(px * 0.85, 2), "t1": t1, "t1_pct": _r(100 * (t1 / px - 1), 0),
            "split": "Mua 1/2 ngay, 1/2 khi giá chỉnh về vùng dưới (trong 20 phiên); nắm 6–12 tháng",
            "quality": quality,
            "edge": ("Lịch sử VN 2022–2026, DN có lãi & nợ thấp: 120 phiên sau hơn nhóm chứng +3,2%, 250 phiên +7,2%; 31% số lần lãi ≥ 30% trong 1 năm; "
                     "sụt sâu nhất sau khi mua TB −13%." if quality else
                     "DN đang lỗ hoặc nợ cao: lịch sử không có lợi thế sau sự kiện (≈ 0% so với nhóm chứng) – chỉ theo dõi.")}


def history(close: pd.Series | None, vni: pd.Series | None = None, max_n: int = 10) -> list[dict]:
    """Mọi đợt sự kiện trong lịch sử của mã (để đánh dấu lên biểu đồ và xem sau đó giá đi đâu).
    Mỗi đợt: ngày có cờ, đáy, ngày "nguội" (điểm vào theo quy tắc ≥ 120 phiên & ≥ 60 phiên liền không giảm sàn),
    và % giá sau 60 / 120 / 250 phiên tính từ điểm vào (kèm chênh lệch so với VN-Index)."""
    if close is None:
        return []
    c = close.dropna()
    c = c[c > 0]
    if len(c) < 140:
        return []
    r = c.pct_change()
    dd = c / c.rolling(120, min_periods=60).max() - 1
    dnm = (r <= DOWN).values
    ldn = pd.Series(dnm.astype(float), index=c.index).rolling(60, min_periods=20).sum()
    flag = ((dd <= DD) & (ldn >= N_DOWN)).values
    on = np.where(flag)[0]
    if not len(on):
        return []
    starts = [on[0]] + [b for a, b in zip(on[:-1], on[1:]) if b - a >= 60]
    n = len(c)
    cs = np.concatenate([[0], np.cumsum(dnm)])           # cs[i+1] = số phiên giảm sàn tới i
    v = vni.reindex(c.index).ffill() if vni is not None else None
    px = c.values
    out = []
    for k, st in enumerate(starts):
        nxt = starts[k + 1] if k + 1 < len(starts) else n
        cool = None
        for i in range(st + COOL_SINCE, min(n, st + WINDOW_END + 1, nxt)):
            if cs[i + 1] - cs[i + 1 - COOL_QUIET] == 0 and not flag[i]:
                cool = i
                break
        end = cool if cool is not None else min(n, nxt, st + WINDOW_END + 1) - 1
        seg = px[st:end + 1]
        lo_i = st + int(np.argmin(seg))
        pre_hi = float(px[max(0, st - 120):st + 1].max())
        e = {"start": str(c.index[st].date()), "px_start": _r(px[st]), "pre_hi": _r(pre_hi), "low_date": str(c.index[lo_i].date()), "low": _r(px[lo_i]),
             "dd_low": _r(100 * (px[lo_i] / pre_hi - 1), 0), "n_down": int(cs[end + 1] - cs[st])}
        # mua ngay khi có cờ → 120 phiên sau (để thấy vì sao không nên bắt dao rơi)
        if st + 120 < n:
            e["r_start120"] = _r(100 * (px[st + 120] / px[st] - 1), 1)
        if cool is not None:
            e["cool"] = str(c.index[cool].date())
            e["px_cool"] = _r(px[cool])
            for h in (60, 120, 250):
                if cool + h < n:
                    e[f"r{h}"] = _r(100 * (px[cool + h] / px[cool] - 1), 1)
                    if v is not None and pd.notna(v.iloc[cool]) and pd.notna(v.iloc[cool + h]) and v.iloc[cool] > 0:
                        e[f"x{h}"] = _r(e[f"r{h}"] - 100 * (float(v.iloc[cool + h]) / float(v.iloc[cool]) - 1), 1)
            w = px[cool:min(n, cool + 251)]
            e["mdd"] = _r(100 * (w.min() / px[cool] - 1), 0)
            e["mx"] = _r(100 * (w.max() / px[cool] - 1), 0)
            e["days"] = int(n - 1 - cool)
        else:
            e["open"] = bool(n - 1 - st <= WINDOW_END)     # đợt còn đang diễn ra (chưa nguội)
        out.append(e)
    return out[-max_n:]


def _d(x) -> str:
    t = pd.Timestamp(x)
    return f"{t.day:02d}/{t.month:02d}/{t.year % 100:02d}"


def _vn(x, nd=1) -> str:
    s = f"{abs(x):,.{nd}f}".replace(",", "_").replace(".", ",").replace("_", ".")
    return ("−" if x < 0 else "+") + s


def describe(e: dict, close: pd.Series, vol: pd.Series | None, vni: pd.Series | None, sec_ret, sec_name: str | None,
             fq: pd.DataFrame | None, news: list[dict] | None, sym: str) -> dict:
    """Mô tả một đợt sự kiện: sập theo thị trường / theo ngành / chuyện riêng DN, các phiên giảm sàn, thanh khoản lúc bán tháo,
    lợi nhuận quý quanh sự kiện, tin tức (nếu có) → câu tóm tắt dễ đọc."""
    c = close.dropna()
    c = c[c > 0]
    st = pd.Timestamp(e["start"])
    i_st = c.index.get_indexer([st])[0]
    pre = c.iloc[max(0, i_st - 120):i_st + 1]
    ph_d = pre.idxmax()
    low_d = pd.Timestamp(e["low_date"])
    out: dict = {"hi_date": str(ph_d.date())}
    sd = (float(c.loc[low_d]) / float(c.loc[ph_d]) - 1) * 100
    mk = None
    if vni is not None:
        v = vni.dropna()
        try:
            mk = (float(v.asof(low_d)) / float(v.asof(ph_d)) - 1) * 100
        except (TypeError, ValueError, ZeroDivisionError):
            mk = None
    sr = sec_ret(ph_d, low_d) if sec_ret else None
    out["mkt"] = _r(mk, 1)
    out["sec"] = _r(sr, 1)
    out["sec_name"] = sec_name
    if mk is not None and mk <= -25:
        kind = "market"
    elif sr is not None and sr <= -30:
        kind = "sector"
    else:
        kind = "company"
    out["kind"] = kind
    out["label"] = {"market": "Thị trường chung sập", "sector": f"Cả ngành {sec_name or ''} cùng sập".replace("  ", " "),
                    "company": "Chuyện riêng của doanh nghiệp"}[kind]
    # phiên giảm sàn (≤ −6,5%) từ đỉnh tới đáy
    r = c.pct_change()
    w = r.loc[ph_d:low_d]
    fl = (w <= DOWN).values
    n_fl, best, cur, b_from, c_from = int(fl.sum()), 0, 0, None, None
    for t, f in zip(w.index, fl):
        if f:
            cur += 1
            c_from = c_from or t
            if cur > best:
                best, b_from = cur, c_from
        else:
            cur, c_from = 0, None
    out["floors"] = {"n": n_fl, "streak": best, "from": str(b_from.date()) if b_from is not None else None,
                     "first": str(w.index[fl][0].date()) if n_fl else None, "days": int(len(w))}
    if vol is not None and n_fl:
        vv = vol.reindex(c.index)
        base = vv.iloc[max(0, c.index.get_loc(ph_d) - 60):c.index.get_loc(ph_d)].median()
        fv = vv.loc[w.index[fl]].median()
        if base and base > 0 and pd.notna(fv):
            out["vol_x"] = _r(fv / base, 2)
    # lợi nhuận quý quanh sự kiện
    fin = []
    if fq is not None and not fq.empty:
        q = fq.dropna(subset=["year", "quarter"]).copy()
        q["k"] = q["year"].astype(int) * 4 + q["quarter"].astype(int) - 1
        k0 = st.year * 4 + (st.month - 1) // 3
        col = "ni_parent" if "ni_parent" in q.columns and q["ni_parent"].notna().any() else "net_income"
        by = dict(zip(q["k"], q[col]))
        for k in range(k0 - 2, k0 + 3):
            if k in by and pd.notna(by[k]):
                fin.append({"q": f"Q{k % 4 + 1}/{(k // 4) % 100:02d}", "ni": _r(by[k], 1), "ly": _r(by.get(k - 4), 1)})
    out["fin"] = fin
    out["news"] = (news or [])[:6]
    d0, d1 = ph_d - pd.Timedelta(days=10), low_d + pd.Timedelta(days=5)
    out["search"] = (f"https://www.google.com/search?q={sym}+c%E1%BB%95+phi%E1%BA%BFu&tbs=cdr:1,cd_min:{d0.month}/{d0.day}/{d0.year},cd_max:{d1.month}/{d1.day}/{d1.year}")
    # câu tóm tắt
    T = [f"Từ đỉnh {_vn(float(c.loc[ph_d]), 2)[1:]} ({_d(ph_d)}) xuống đáy {_vn(float(c.loc[low_d]), 2)[1:]} ({_d(low_d)}): <b>{_vn(sd, 0)}%</b>"]
    ctx = []
    if mk is not None:
        ctx.append(f"VN-Index cùng kỳ {_vn(mk, 0)}%")
    if sr is not None:
        ctx.append(f"ngành {sec_name} (trung vị) {_vn(sr, 0)}%")
    if ctx:
        T[0] += ", trong khi " + ", ".join(ctx)
    T[0] += "."
    if kind == "market":
        T.append("→ Giai đoạn <b>cả thị trường bán tháo</b>" + (" nhưng mã giảm sâu hơn hẳn – có thêm yếu tố riêng." if sd < (mk or 0) - 25 else "; mã giảm theo thị trường."))
    elif kind == "sector":
        T.append(f"→ <b>Cả ngành cùng sập</b> (tin chung của ngành / chính sách)" + (", mã giảm sâu hơn ngành." if sd < (sr or 0) - 20 else "."))
    else:
        T.append("→ Thị trường và ngành không sập tương ứng: <b>nhiều khả năng là tin riêng của doanh nghiệp</b> "
                 "(lãnh đạo bị điều tra / bắt, BCTC bất thường hoặc kiểm toán ngoại trừ, cổ đông lớn bị call margin, vi phạm công bố thông tin, mất thanh khoản…).")
    if n_fl:
        s_ = f"{n_fl} phiên giảm ≥ 6,5% trong {len(w)} phiên"
        if best >= 2:
            s_ += f", dài nhất <b>{best} phiên giảm sàn liên tiếp</b> từ {_d(b_from)}"
        vx = out.get("vol_x")
        if vx is not None:
            s_ += (f"; khối lượng phiên sàn chỉ {_vn(vx, 1)[1:]}× bình thường → <b>trắng bên mua</b>, muốn bán cũng không bán được" if vx < 0.6 else
                   f"; khối lượng phiên sàn {_vn(vx, 1)[1:]}× bình thường → <b>bán tháo ồ ạt</b> (có thể có call margin)" if vx > 1.8 else
                   f"; khối lượng phiên sàn {_vn(vx, 1)[1:]}× bình thường")
        T.append(s_ + ".")
    if fin:
        neg = [f for f in fin if (f["ni"] or 0) < 0]
        T.append("Lợi nhuận sau thuế các quý quanh sự kiện (tỷ): " + " → ".join(f"{f['q']} {_vn(f['ni'], 0)}" for f in fin) +
                 (". Có quý <b>lỗ</b> – sự kiện đi kèm kết quả kinh doanh xấu đi." if neg and not all((f["ni"] or 0) < 0 for f in fin[:2]) else "."))
    out["text"] = " ".join(T)
    return out
