"""Dữ liệu trong phiên (nguồn Vietcap – API công khai của trading.vietcap.com.vn).

- board(): bảng giá hiện tại – giá khớp, mở cửa, cao/thấp, KL, khối ngoại, giá ATO/ATC.
- bars(): nến 1 phút (≈ 6 tháng gần nhất) hoặc 1 giờ (≈ 3 năm).
- ticks(): từng lệnh khớp (mua/bán chủ động + phân loại Cá mập / Sói / Cừu theo giá trị lệnh) – lật trang 100 lệnh/lần.
- session_rows(): gộp nến phút/giờ thành 1 dòng/phiên: sáng (9:00–11:30), chiều (13:00–14:30), ATC (14:45).
- buckets(): nến 15 phút của từng phiên (để vẽ "đường đi trung bình trong ngày" và nhịp khối lượng theo giờ).
- news(): tin tức từ RSS (CafeF, VnExpress), gắn mã cổ phiếu xuất hiện trong tiêu đề / mô tả.
"""
from __future__ import annotations

import html
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import requests

from .http import FetchError, post
from .vci import TRADING

TZ = "Asia/Ho_Chi_Minh"
M_END, A_START, A_END = 11 * 60 + 30, 13 * 60, 14 * 60 + 30   # phút trong ngày


def _num(x):
    try:
        v = float(x)
        return None if np.isnan(v) else v
    except (TypeError, ValueError):
        return None


def board(symbols: list[str], chunk: int = 100) -> pd.DataFrame:
    rows = []
    for i in range(0, len(symbols), chunk):
        data = post("VCI", TRADING + "price/symbols/getList", {"symbols": symbols[i:i + chunk]}, timeout=30)
        for it in data or []:
            li, mi = it.get("listingInfo") or {}, it.get("matchPrice") or {}
            sym = li.get("symbol") or mi.get("symbol")
            if not sym:
                continue
            k = 1000.0
            g = lambda d, key: (_num(d.get(key)) or 0) / k if _num(d.get(key)) else None  # noqa: E731
            rows.append({
                "symbol": sym, "date": li.get("tradingDate"), "session": mi.get("session") or (it.get("bidAsk") or {}).get("session"),
                "ref": g(li, "refPrice"), "ceil": g(li, "ceiling"), "floor": g(li, "floor"),
                "price": g(mi, "matchPrice"), "open": g(mi, "openPrice"), "high": g(mi, "highest"), "low": g(mi, "lowest"),
                "avg": g(mi, "avgMatchPrice"), "ato": g(mi, "matchPriceATO"), "atc": g(mi, "matchPriceATC"),
                "vol": _num(mi.get("accumulatedVolume")) or 0.0, "value_bn": (_num(mi.get("accumulatedValue")) or 0.0) / 1000.0,
                "f_buy": _num(mi.get("foreignBuyValue")) or 0.0, "f_sell": _num(mi.get("foreignSellValue")) or 0.0,
                "time": mi.get("time") or mi.get("sendingTime"),
            })
        time.sleep(0.15)
    df = pd.DataFrame(rows)
    if not df.empty:
        df["f_net_bn"] = (df["f_buy"] - df["f_sell"]) / 1e9
        df = df.drop(columns=["f_buy", "f_sell"])
    return df


def bars(symbol: str, tf: str = "ONE_MINUTE", count_back: int = 400) -> pd.DataFrame:
    end = int((datetime.now() + timedelta(days=1)).timestamp())
    data = post("VCI", TRADING + "chart/OHLCChart/gap-chart",
                {"timeFrame": tf, "symbols": [symbol], "to": end, "countBack": count_back}, timeout=60)
    it = (data or [{}])[0] if data else {}
    if not it or not it.get("t"):
        raise FetchError(f"VCI bars {symbol} {tf}: rỗng")
    df = pd.DataFrame({"time": pd.to_datetime(pd.Series(it["t"]).astype("int64"), unit="s", utc=True).dt.tz_convert(TZ).dt.tz_localize(None),
                       "o": it["o"], "h": it["h"], "l": it["l"], "c": it["c"], "v": it["v"]})
    for c in "ohlc":
        df[c] = pd.to_numeric(df[c], errors="coerce") / 1000.0
    df["v"] = pd.to_numeric(df["v"], errors="coerce").fillna(0)
    return df.dropna(subset=["c"]).sort_values("time").reset_index(drop=True)


def ticks(symbol: str, max_pages: int = 60, since: datetime | None = None) -> pd.DataFrame:
    """Từng lệnh khớp hôm nay, lật trang về quá khứ (100 lệnh/trang)."""
    out, trunc, seen = [], None, set()
    for _ in range(max_pages):
        data = post("VCI", TRADING + "market-watch/LEData/getAll", {"symbol": symbol, "limit": 100, "truncTime": trunc}, timeout=30)
        if not data:
            break
        new = [d for d in data if d.get("id") not in seen]
        if not new:
            break
        for d in new:
            seen.add(d.get("id"))
        out.extend(new)
        last = min(int(float(d.get("truncTime") or 0)) for d in new)
        if trunc is not None and last >= int(trunc):
            break
        trunc = str(last)
        if since is not None and datetime.fromtimestamp(last) < since:
            break
        if len(data) < 100:
            break
    df = pd.DataFrame(out)
    if df.empty:
        return df
    df["time"] = pd.to_datetime(pd.to_numeric(df["truncTime"], errors="coerce"), unit="s", utc=True).dt.tz_convert(TZ).dt.tz_localize(None)
    df["price"] = pd.to_numeric(df["matchPrice"], errors="coerce") / 1000.0
    df["vol"] = pd.to_numeric(df["matchVol"], errors="coerce").fillna(0)
    df["side"] = df["matchType"].astype(str).str.lower().str[0].map({"b": "buy", "s": "sell"}).fillna("atc")
    df["kind"] = df.get("type", pd.Series(["sheep"] * len(df))).astype(str).str.lower()
    df["value_bn"] = df["price"] * df["vol"] / 1e6
    return df[["time", "price", "vol", "value_bn", "side", "kind"]].sort_values("time").reset_index(drop=True)


def tick_summary(t: pd.DataFrame) -> dict:
    """Mua/bán chủ động theo nhóm lệnh (cá mập / sói / cừu) và theo buổi sáng / chiều."""
    if t is None or t.empty:
        return {}
    t = t.copy()
    m = t["time"].dt.hour * 60 + t["time"].dt.minute
    t["part"] = np.where(m < A_START - 30, "m", np.where(m < A_END, "a", "atc"))
    res = {"n": int(len(t)), "first": str(t["time"].min()), "last": str(t["time"].max())}
    for kind in ("shark", "wolf", "sheep"):
        g = t[t["kind"] == kind]
        b, s = float(g.loc[g["side"] == "buy", "value_bn"].sum()), float(g.loc[g["side"] == "sell", "value_bn"].sum())
        res[kind] = {"buy": round(b, 2), "sell": round(s, 2), "net": round(b - s, 2)}
    for p in ("m", "a"):
        g = t[t["part"] == p]
        b, s = float(g.loc[g["side"] == "buy", "value_bn"].sum()), float(g.loc[g["side"] == "sell", "value_bn"].sum())
        gs = g[g["kind"] == "shark"]
        bs, ss = float(gs.loc[gs["side"] == "buy", "value_bn"].sum()), float(gs.loc[gs["side"] == "sell", "value_bn"].sum())
        res[p] = {"buy": round(b, 2), "sell": round(s, 2), "shark_net": round(bs - ss, 2)}
    tot = float(t["value_bn"].sum()) or 1.0
    res["shark_share"] = round(100 * float(t.loc[t["kind"] == "shark", "value_bn"].sum()) / tot, 1)
    return res


def _mins(ts: pd.Series) -> pd.Series:
    return ts.dt.hour * 60 + ts.dt.minute


def session_rows(df: pd.DataFrame, minute: bool) -> pd.DataFrame:
    """Nến phút (minute=True) hoặc giờ -> 1 dòng/phiên. Giá giờ: nến 11:00 kết thúc 11:30, nến 14:00 gồm cả ATC."""
    if df is None or df.empty:
        return pd.DataFrame()
    d = df.copy()
    d["date"] = d["time"].dt.normalize()
    mm = _mins(d["time"])
    if minute:
        d["part"] = np.where(mm < M_END, "m", np.where(mm < A_END, "a", "atc"))
    else:
        d["part"] = np.where(d["time"].dt.hour < 12, "m", "a")
    rows = []
    for day, g in d.groupby("date"):
        m, a, z = g[g["part"] == "m"], g[g["part"] == "a"], g[g["part"] == "atc"]
        if m.empty or a.empty:
            continue
        r = {"date": day, "o": float(g["o"].iloc[0]), "h": float(g["h"].max()), "l": float(g["l"].min()), "c": float(g["c"].iloc[-1]),
             "m_c": float(m["c"].iloc[-1]), "m_h": float(m["h"].max()), "m_l": float(m["l"].min()), "v_m": float(m["v"].sum()),
             "a_o": float(a["o"].iloc[0]), "a_h": float(a["h"].max()), "a_l": float(a["l"].min()), "v_a": float(a["v"].sum()),
             "pre_atc": float(a["c"].iloc[-1]) if minute else None, "v_atc": float(z["v"].sum()) if minute else None,
             "hi_t": int(_mins(g["time"]).iloc[int(g["h"].values.argmax())]), "lo_t": int(_mins(g["time"]).iloc[int(g["l"].values.argmin())]),
             "src": "m" if minute else "h"}
        rows.append(r)
    return pd.DataFrame(rows)


BUCKETS = [(9 * 60, "9:00"), (9 * 60 + 30, "9:30"), (10 * 60, "10:00"), (10 * 60 + 30, "10:30"), (11 * 60, "11:00"),
           (13 * 60, "13:00"), (13 * 60 + 30, "13:30"), (14 * 60, "14:00"), (14 * 60 + 30, "ATC")]


def bucket_of(minute_of_day: int) -> int:
    k = 0
    for i, (st, _) in enumerate(BUCKETS):
        if minute_of_day >= st:
            k = i
    return k


def buckets(df: pd.DataFrame) -> pd.DataFrame:
    """Nến phút -> nến 30 phút theo phiên (9 khung: 9:00 … 14:00, ATC)."""
    if df is None or df.empty:
        return pd.DataFrame()
    d = df.copy()
    d["date"] = d["time"].dt.normalize()
    d["b"] = [bucket_of(x) for x in _mins(d["time"])]
    g = d.groupby(["date", "b"])
    out = pd.DataFrame({"o": g["o"].first(), "h": g["h"].max(), "l": g["l"].min(), "c": g["c"].last(), "v": g["v"].sum()}).reset_index()
    return out


# ----------------------------------------------------------------- tin tức
FEEDS = {
    "CafeF – Chứng khoán": "https://cafef.vn/thi-truong-chung-khoan.rss",
    "CafeF – Doanh nghiệp": "https://cafef.vn/doanh-nghiep.rss",
    "VnExpress – Kinh doanh": "https://vnexpress.net/rss/kinh-doanh.rss",
    "VnExpress – Chứng khoán": "https://vnexpress.net/rss/kinh-doanh/chung-khoan.rss",
}
_TAG = re.compile(r"<[^>]+>")


def news(symbols: set[str], names: dict[str, str] | None = None) -> pd.DataFrame:
    """Tin mới nhất từ RSS; giữ tin có nhắc đến mã (chữ in hoa đứng riêng) hoặc tên viết tắt công ty."""
    names = names or {}
    rows = []
    for src, url in FEEDS.items():
        try:
            r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            if r.status_code != 200:
                continue
            root = ET.fromstring(r.content)
        except Exception:  # noqa: BLE001
            continue
        for it in root.iter("item"):
            title = html.unescape((it.findtext("title") or "").strip())
            desc = html.unescape(_TAG.sub(" ", it.findtext("description") or "")).strip()
            link = (it.findtext("link") or "").strip()
            pub = it.findtext("pubDate") or ""
            try:
                ts = pd.to_datetime(pub, utc=True).tz_convert(TZ).tz_localize(None)
            except (ValueError, TypeError):
                ts = pd.Timestamp.now()
            text = f"{title} {desc}"
            found = {w for w in re.findall(r"(?<![A-Z0-9])([A-Z][A-Z0-9]{2})(?![A-Z0-9])", text) if w in symbols}
            low = text.lower()
            for s, nm in names.items():
                if nm and len(nm) >= 4 and nm.lower() in low:
                    found.add(s)
            for s in found:
                rows.append({"symbol": s, "time": ts, "title": title[:240], "link": link, "src": src})
    df = pd.DataFrame(rows)
    return df.drop_duplicates(["symbol", "link"]) if not df.empty else df
