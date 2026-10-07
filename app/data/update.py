"""Điều phối cập nhật dữ liệu: danh sách mã, giá, BCTC, cổ tức.

Mỗi loại dữ liệu có nhiều nguồn; nguồn lỗi thì tự chuyển nguồn kế tiếp.
Kết quả "sức khoẻ" từng nguồn ghi vào data/meta.json để hiển thị trên web.
"""
from __future__ import annotations

import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from .. import config
from . import normalize, store, tcbs, vci, yahoo
from .http import FetchError

log = logging.getLogger("update")

INDICES = ["VNINDEX", "HNXINDEX", "UPCOMINDEX", "VN30"]
HISTORY_START = datetime(2014, 1, 1)


# ------------------------------------------------------------------ listing
def update_listing(force: bool = False) -> pd.DataFrame:
    cur = store.read("listing")
    if not force and not cur.empty and store.age_days("listing") < 7:
        return cur
    try:
        df = vci.listing()
        if len(df) < 300:
            raise FetchError(f"listing quá ít mã: {len(df)}")
        store.write("listing", df)
        store.touch("listing", source="VCI", count=len(df))
        log.info("Danh sách mã: %d mã", len(df))
        return df
    except FetchError as e:
        log.warning("Không cập nhật được danh sách mã: %s", e)
        if cur.empty:
            raise
        return cur


# ------------------------------------------------------------------ prices
def _fallback_price(sym: str, start: datetime) -> tuple[pd.DataFrame | None, str]:
    is_index = sym in INDICES
    days = max(30, (datetime.now() - start).days)
    try:
        df = tcbs.prices(sym, count_back=int(days * 0.72) + 10, is_index=is_index)
        return df[df["date"] >= start - timedelta(days=1)], "TCBS"
    except FetchError:
        pass
    try:
        if not is_index or sym == "VNINDEX":
            df = yahoo.prices(sym, years=max(1, days // 365 + 1))
            return df[df["date"] >= start - timedelta(days=1)], "YAHOO"
    except FetchError:
        pass
    return None, "FAIL"


def update_prices(symbols: list[str], workers: int = 4) -> pd.DataFrame:
    cur = store.read("prices")
    last = cur.groupby("symbol")["date"].max() if not cur.empty else pd.Series(dtype="datetime64[ns]")
    symbols = list(dict.fromkeys(INDICES + symbols))
    groups: dict[datetime, list[str]] = {}
    for s in symbols:
        if s in last.index:
            st = (last[s] - timedelta(days=7)).to_pydatetime()
            st = datetime(st.year, st.month, st.day)
        else:
            st = HISTORY_START
        groups.setdefault(st, []).append(s)

    frames, used = [], Counter()
    jobs = []
    for st, syms in groups.items():
        full = st == HISTORY_START
        bs = 5 if full else 40
        for i in range(0, len(syms), bs):
            jobs.append((st, syms[i:i + bs]))

    def run(job):
        st, chunk = job
        got, src = {}, Counter()
        try:
            got = vci.prices(chunk, st, batch=len(chunk))
            src["VCI"] += len(got)
        except FetchError as e:
            log.debug("VCI giá lỗi %s: %s", chunk[:3], e)
        missing = [s for s in chunk if s not in got]
        for s in missing:
            df, name = _fallback_price(s, st)
            src[name] += 1
            if df is not None and not df.empty:
                got[s] = df
        out = []
        for s, df in got.items():
            df = df.copy()
            df["symbol"] = s
            out.append(df)
        return out, src

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(run, j) for j in jobs]
        for n, f in enumerate(as_completed(futs), 1):
            out, src = f.result()
            frames.extend(out)
            used.update(src)
            if n % 20 == 0:
                log.info("Giá: %d/%d lô", n, len(jobs))

    new = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not new.empty:
        new = new[["symbol", "date", "open", "high", "low", "close", "volume"]]
        new = new.dropna(subset=["close"])
        new["volume"] = pd.to_numeric(new["volume"], errors="coerce").fillna(0)
    df = store.upsert("prices", new, ["symbol", "date"])
    store.touch("prices", sources=dict(used), rows=len(df),
                last_date=str(df["date"].max().date()) if not df.empty else None)
    log.info("Giá: nguồn %s, tổng %d dòng", dict(used), len(df))
    return df


# ------------------------------------------------------------------ BCTC
def _fin_one(sym: str, ctype: str) -> tuple[list[pd.DataFrame], str]:
    # Nguồn 1: VCI GraphQL (2 request/mã)
    try:
        mp = vci.ratio_dictionary()
        q = normalize.normalize_vci(sym, vci.financial_raw(sym, "Q"), mp, ctype, yearly=False)
        y = normalize.normalize_vci(sym, vci.financial_raw(sym, "Y"), mp, ctype, yearly=True)
        if not q.empty or not y.empty:
            return [q, y], "VCI"
    except (FetchError, KeyError, TypeError, ValueError) as e:
        log.debug("VCI BCTC %s lỗi: %s", sym, e)
    # Nguồn 2: TCBS (8 request/mã)
    try:
        res = []
        for yearly in (False, True):
            parts = {}
            for kind in ("incomestatement", "balancesheet", "cashflow", "financialratio"):
                try:
                    parts[kind] = tcbs.statement(sym, kind, yearly)
                except FetchError:
                    parts[kind] = None
            if parts["incomestatement"] is None and parts["balancesheet"] is None:
                raise FetchError("TCBS rỗng")
            res.append(normalize.normalize_tcbs(sym, parts["incomestatement"],
                                                parts["balancesheet"], parts["cashflow"],
                                                parts["financialratio"], yearly))
        return res, "TCBS"
    except FetchError as e:
        log.debug("TCBS BCTC %s lỗi: %s", sym, e)
    return [], "FAIL"


def update_financials(listing: pd.DataFrame, symbols: list[str], workers: int = 4) -> None:
    ctype = dict(zip(listing["symbol"], listing.get("com_type", "CT")))
    frames, used = [], Counter()
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(_fin_one, s, ctype.get(s, "CT")): s for s in symbols}
        for n, f in enumerate(as_completed(futs), 1):
            res, src = f.result()
            used[src] += 1
            frames.extend([r for r in res if r is not None and not r.empty])
            if n % 100 == 0:
                log.info("BCTC: %d/%d mã (%s)", n, len(symbols), dict(used))
    if frames:
        allf = normalize.finalize(pd.concat(frames, ignore_index=True))
        store.upsert("fin_q", allf[allf["quarter"] > 0], ["symbol", "year", "quarter"])
        store.upsert("fin_y", allf[allf["quarter"] == 0], ["symbol", "year", "quarter"])
    store.touch("financials", sources=dict(used), symbols=len(symbols))
    log.info("BCTC xong: %s", dict(used))


def update_dividends(symbols: list[str], workers: int = 4) -> None:
    frames, used = [], Counter()

    def one(s):
        try:
            return tcbs.dividends(s), "TCBS"
        except FetchError:
            return None, "FAIL"

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for df, src in ex.map(one, symbols):
            used[src] += 1
            if df is not None and not df.empty:
                frames.append(df)
    if frames:
        new = pd.concat(frames, ignore_index=True).dropna(subset=["ex_date"])
        store.upsert("dividends", new, ["symbol", "ex_date", "method"])
    store.touch("dividends", sources=dict(used))
    log.info("Cổ tức: %s", dict(used))


# ------------------------------------------------------------------ main
def liquid_symbols(prices: pd.DataFrame, min_value_bn: float) -> list[str]:
    if prices.empty:
        return []
    recent = prices[prices["date"] >= prices["date"].max() - timedelta(days=45)]
    val = (recent["close"] * recent["volume"] / 1e6).groupby(recent["symbol"]).mean()
    return sorted(val[val >= min_value_bn].index)


def run(force_fin: bool = False, only: list[str] | None = None) -> None:
    listing = update_listing()
    exch = set(config.get("universe.exchanges", ["HOSE", "HNX", "UPCOM"]))
    syms = sorted(listing.loc[listing["exchange"].isin(exch), "symbol"])
    if only:
        syms = [s for s in syms if s in only] or only
    prices = update_prices(syms)

    weekday = datetime.now().weekday()
    due = (weekday == int(config.get("schedule.financials_refresh_weekday", 5))
           or store.age_days("financials") > 7 or force_fin)
    if due:
        fin_syms = liquid_symbols(prices, float(config.get("universe.fin_min_avg_value_bn", 0.3)))
        fin_syms = [s for s in fin_syms if s in set(syms)]
        if only:
            fin_syms = [s for s in syms if s in only]
        log.info("Tải BCTC cho %d mã", len(fin_syms))
        update_financials(listing, fin_syms)
        update_dividends(fin_syms)
    else:
        log.info("Chưa tới lịch tải BCTC (cập nhật gần nhất %.1f ngày trước)",
                 store.age_days("financials"))
