"""Chia cổ tức / thưởng cổ phiếu và cổ tức tiền: đưa giá, số cổ phiếu, EPS, BVPS, cổ tức về CÙNG một gốc.

Vì sao cần:
  - Sau ngày GDKHQ cổ tức cổ phiếu / thưởng r%, giá tham chiếu giảm còn giá ÷ (1 + r) ngay, nhưng số cổ phiếu niêm yết (và EPS ở
    nhiều nguồn) chỉ cập nhật khi cổ phiếu mới lên sàn – thường 2–6 tuần sau. Trong khoảng đó P/E, P/B tính theo số cổ phiếu cũ
    THẤP GIẢ đúng bằng 1/(1 + r) (vd. chia 50% → P/E trông rẻ hơn 33%) và giá trị hợp lý / cổ phiếu CAO GIẢ (1 + r) lần.
  - Cổ tức tiền các năm trước được công bố theo số cổ phiếu lúc đó; sau mỗi lần chia cổ phiếu, 1 cổ phiếu cũ = (1 + r) cổ phiếu
    mới → cổ tức / cổ phiếu hiện tại phải chia (1 + r). Không chỉnh thì lợi suất cổ tức, tỷ lệ chi trả, DDM đều cao giả
    (giá đã điều chỉnh là theo gốc hiện tại).
  - Cổ tức tiền sau ngày khoá sổ của BCTC gần nhất: vốn chủ trên BCTC vẫn còn khoản tiền này → BVPS cao giả một khoản = cổ tức.
  - Trước GDKHQ cổ tức tiền, giá còn "gồm quyền": P/E trừ cổ tức = (giá − cổ tức sắp nhận) ÷ EPS – để so với mã đã chia xong.
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _stock(dv: pd.DataFrame | None) -> pd.DataFrame:
    if dv is None or dv.empty:
        return pd.DataFrame(columns=["ex_date", "cash_pct"])
    s = dv[~dv["method"].astype(str).str.contains("cash|tiền", na=False)]
    return s[(s["cash_pct"] > 0) & (s["cash_pct"] < 5)].sort_values("ex_date")


def cash_per_current_share(divs: pd.DataFrame, asof) -> pd.DataFrame:
    """Bản sao bảng cổ tức: cổ tức TIỀN quy về số cổ phiếu hiện tại (chia Π(1 + r) của các lần chia cổ phiếu SAU ngày đó,
    đã GDKHQ tới `asof`). Cột 'cash_raw' giữ số gốc đã công bố."""
    if divs is None or divs.empty:
        return divs
    d = divs.copy()
    d["ex_date"] = pd.to_datetime(d["ex_date"])
    d["cash_raw"] = d["cash_pct"]
    asof = pd.Timestamp(asof)
    is_cash = d["method"].astype(str).str.contains("cash|tiền", na=False)
    st = d[~is_cash & (d["cash_pct"] > 0) & (d["cash_pct"] < 5) & (d["ex_date"] <= asof)]
    if st.empty:
        return d
    by = {s: g[["ex_date", "cash_pct"]].values for s, g in st.groupby("symbol")}
    fac = np.ones(len(d))
    for i, (s, ex, c) in enumerate(zip(d["symbol"].values, d["ex_date"].values, is_cash.values)):
        if not c or s not in by:
            continue
        for e2, r in by[s]:
            if e2 > ex:
                fac[i] *= 1 + float(r)
    d["cash_pct"] = np.where(is_cash, d["cash_pct"] / fac, d["cash_pct"])
    d["split_fac"] = fac
    return d


def shares_after_splits(sym: str, listed: float | None, listed_date, dv: pd.DataFrame | None, last_date,
                        pre_log: dict) -> tuple[float | None, dict | None]:
    """Số cổ phiếu ĐÚNG với giá hiện tại. listed = số CP niêm yết lấy từ nguồn (có thể chưa cộng CP mới chia).
    pre_log: {(sym, 'YYYY-MM-DD'): số CP ghi lại TRƯỚC ngày GDKHQ}. Trả về (số CP, thông tin điều chỉnh hoặc None)."""
    if not listed:
        return listed, None
    st = _stock(dv)
    last = pd.Timestamp(last_date)
    rec = st[(st["ex_date"] <= last) & (st["ex_date"] > last - pd.Timedelta(days=150))]
    if rec.empty:
        return listed, None
    sh, used = float(listed), []
    ld = pd.Timestamp(listed_date) if listed_date is not None else None
    for r in rec.itertuples():
        key = (sym, str(pd.Timestamp(r.ex_date).date()))
        pre = pre_log.get(key)
        if pre is None and ld is not None and ld < pd.Timestamp(r.ex_date):
            pre = float(listed)                # số CP lấy trước GDKHQ → chắc chắn chưa cộng phần chia
        if pre is None:
            continue
        exp = pre * (1 + float(r.cash_pct))
        if sh < exp * 0.985:                   # nguồn chưa cập nhật cổ phiếu mới
            used.append({"ex_date": key[1], "ratio": round(float(r.cash_pct), 4), "pre": round(pre, 2), "post": round(exp, 2)})
            sh = exp
    if not used:
        return listed, None
    return sh, {"listed": round(float(listed), 2), "shares": round(sh, 2), "events": used, "factor": round(sh / float(listed), 4)}


def upcoming(dv: pd.DataFrame | None, last_date, days: int = 75) -> dict:
    """Cổ tức tiền / cổ phiếu sắp GDKHQ (giá hiện tại còn gồm quyền)."""
    out = {"cash": [], "stock": []}
    if dv is None or dv.empty:
        return out
    last = pd.Timestamp(last_date)
    d = dv[(pd.to_datetime(dv["ex_date"]) > last) & (pd.to_datetime(dv["ex_date"]) <= last + pd.Timedelta(days=days))]
    for r in d.sort_values("ex_date").itertuples():
        cash = "cash" in str(r.method) or "tiền" in str(r.method)
        raw = getattr(r, "cash_raw", r.cash_pct)
        (out["cash"] if cash else out["stock"]).append({"ex_date": str(pd.Timestamp(r.ex_date).date()),
                                                        **({"dps": round(float(raw) * 10000)} if cash else {"ratio": round(float(raw), 4)})})
    return out


def cash_since(dv: pd.DataFrame | None, since, last_date) -> float:
    """Tổng cổ tức tiền (đồng / cổ phiếu hiện tại) đã GDKHQ sau ngày `since` (ngày khoá sổ BCTC) tới phiên gần nhất."""
    if dv is None or dv.empty or since is None:
        return 0.0
    ex = pd.to_datetime(dv["ex_date"])
    c = dv[dv["method"].astype(str).str.contains("cash|tiền", na=False) & (ex > pd.Timestamp(since)) & (ex <= pd.Timestamp(last_date))]
    return float(c["cash_pct"].sum() * 10000)
