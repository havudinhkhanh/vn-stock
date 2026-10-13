"""Tin công bố thông tin LỊCH SỬ quanh mỗi đợt "có sự kiện" (giá sập) – để biết sự kiện là chuyện gì.

Nguồn: Vietcap IQ /v1/news (lọc theo mã + khoảng ngày, có từ ~2018; chủ yếu tin CBTT của DN và của Sở GDCK:
giải trình giảm sàn, cổ đông lớn bán, giải chấp, cưỡng chế thuế, kiểm toán ngoại trừ, thay đổi nhân sự…).
Mỗi đợt chỉ tải một lần (khoá = mã + ngày có cờ + ngày đáy; đáy đổi thì tải lại)."""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pandas as pd

from . import store, vci
from .http import get

log = logging.getLogger("news_hist")
DONE = "news_hist_done.json"


def fetch(sym: str, d0: pd.Timestamp, d1: pd.Timestamp, max_pages: int = 4) -> list[dict]:
    rows = []
    for pg in range(max_pages):
        j = get("VCI", vci.IQ + "/v1/news", params={"ticker": sym, "fromDate": d0.strftime("%Y%m%d"), "toDate": d1.strftime("%Y%m%d"),
                                                     "page": pg, "size": 100}, timeout=30)
        d = (j or {}).get("data") or {}
        C = d.get("content") or []
        for x in C:
            t = x.get("newsTitle")
            if not t:
                continue
            rows.append({"symbol": sym, "time": pd.to_datetime(x.get("publicDate"), errors="coerce"), "title": " ".join(str(t).split())[:300],
                         "link": x.get("newsSourceLink") or None, "src": "Vietcap"})
        if len(C) < 100 or (d.get("totalPages") is not None and pg + 1 >= int(d["totalPages"])):
            break
    return rows


def update(prices: pd.DataFrame, symbols: list[str], budget_sec: float = 240, workers: int = 4) -> int:
    """Tải tin cho các đợt sự kiện chưa có. prices: bảng giá dài (symbol, date, close)."""
    from ..analysis import events as evx
    p = store.path(DONE)
    try:
        done = set(json.loads(p.read_text(encoding="utf-8"))) if p.exists() else set()
    except ValueError:
        done = set()
    vni = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"] if "VNINDEX" in set(prices["symbol"]) else None
    jobs = []
    sub = prices[prices["symbol"].isin(symbols)]
    for s, g in sub.groupby("symbol"):
        c = g.set_index("date")["close"].sort_index()
        c.index = pd.to_datetime(c.index)
        for e in evx.history(c, vni, max_n=10):
            if pd.Timestamp(e["start"]) < pd.Timestamp("2017-06-01"):
                continue
            k = f"{s}:{e['start']}:{e['low_date']}"
            if k in done:
                continue
            st = pd.Timestamp(e["start"])
            i = c.index.get_indexer([st])[0]
            hi_d = c.iloc[max(0, i - 120):i + 1].idxmax()
            jobs.append((k, s, hi_d - pd.Timedelta(days=20), pd.Timestamp(e["low_date"]) + pd.Timedelta(days=20)))
    if not jobs:
        return 0
    jobs.sort(key=lambda x: x[2], reverse=True)          # đợt gần đây trước
    t0, rows, ok = time.time(), [], []
    with ThreadPoolExecutor(workers) as ex:
        futs = {}
        for j in jobs:
            futs[ex.submit(fetch, j[1], j[2], j[3])] = j
        for f in as_completed(futs):
            j = futs[f]
            try:
                rows += f.result()
                ok.append(j[0])
            except Exception as e:  # noqa: BLE001
                log.debug("tin lịch sử %s lỗi: %s", j[0], e)
            if time.time() - t0 > budget_sec:
                for g_ in futs:
                    g_.cancel()
                break
    if rows:
        new = pd.DataFrame(rows).dropna(subset=["time"])
        old = store.read("news_hist")
        df = pd.concat([old, new], ignore_index=True) if old is not None and not old.empty else new
        df = df.drop_duplicates(["symbol", "time", "title"]).sort_values(["symbol", "time"]).reset_index(drop=True)
        store.write("news_hist", df)
    done |= set(ok)
    p.write_text(json.dumps(sorted(done)), encoding="utf-8")
    log.info("Tin lịch sử quanh sự kiện: %d/%d đợt, %d tin mới (%.0fs)", len(ok), len(jobs), len(rows), time.time() - t0)
    return len(ok)
