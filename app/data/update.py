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
from . import kbs, normalize, store, vci, yahoo
from .http import BREAKER, FetchError

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
    days = max(30, (datetime.now() - start).days + 5)
    try:
        df = kbs.prices(sym, days=days, is_index=is_index)
        return df[df["date"] >= start - timedelta(days=1)], "KBS"
    except FetchError:
        pass
    try:
        if not is_index:
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
        new = new[["symbol", "date", "open", "high", "low", "close", "volume"]].copy()
        for c in ("open", "high", "low", "close", "volume"):
            new[c] = pd.to_numeric(new[c], errors="coerce").astype("float64")
        new["date"] = pd.to_datetime(new["date"], errors="coerce")
        new = new.dropna(subset=["close", "date"])
        new["volume"] = new["volume"].fillna(0)
    # Phát hiện điều chỉnh giá (chia thưởng, cổ tức): nguồn đã sửa lại giá quá khứ -> tải lại toàn bộ lịch sử mã đó
    if not new.empty and not cur.empty:
        adj = detect_adjustments(cur, new)
        if adj:
            log.info("Phát hiện %d mã có điều chỉnh giá quá khứ: %s", len(adj),
                     ", ".join(f"{k}×{v:.3f}" for k, v in list(adj.items())[:15]))
            full = refetch_full(list(adj))
            if not full.empty:
                cur = cur[~cur["symbol"].isin(full["symbol"].unique())]
                new = pd.concat([new[~new["symbol"].isin(full["symbol"].unique())], full], ignore_index=True)
                store.write("prices", cur)
            store.upsert("adjust_events", pd.DataFrame(
                [{"symbol": k, "detected": pd.Timestamp.now().normalize(), "ratio": v} for k, v in adj.items()]),
                ["symbol", "detected"])
    df = store.upsert("prices", new, ["symbol", "date"])
    log.info("Thống kê request: %s", BREAKER.stats)
    store.touch("prices", sources=dict(used), rows=len(df),
                last_date=str(df["date"].max().date()) if not df.empty else None)
    log.info("Giá: nguồn %s, tổng %d dòng", dict(used), len(df))
    return df


def detect_adjustments(cur: pd.DataFrame, new: pd.DataFrame, tol: float = 0.015) -> dict[str, float]:
    """So giá mới với giá đã lưu ở các ngày trùng nhau (trừ ngày gần nhất). Lệch -> nguồn đã điều chỉnh."""
    last_day = new["date"].max()
    ov = new[new["date"] < last_day][["symbol", "date", "close"]].merge(
        cur[["symbol", "date", "close"]], on=["symbol", "date"], suffixes=("_new", "_old"))
    ov = ov[(ov["close_old"] > 0) & (ov["close_new"] > 0)]
    if ov.empty:
        return {}
    ratio = (ov["close_new"] / ov["close_old"]).groupby(ov["symbol"]).agg(["median", "count"])
    hit = ratio[(ratio["count"] >= 2) & ((ratio["median"] - 1).abs() > tol)]
    return {s: float(r["median"]) for s, r in hit.iterrows() if s not in INDICES}


def refetch_full(symbols: list[str]) -> pd.DataFrame:
    frames = []
    for i in range(0, len(symbols), 5):
        chunk = symbols[i:i + 5]
        try:
            got = vci.prices(chunk, HISTORY_START, batch=len(chunk))
        except FetchError:
            got = {}
        for s_, d in got.items():
            frames.append(d.assign(symbol=s_))
    if not frames:
        return pd.DataFrame()
    out = pd.concat(frames, ignore_index=True)[["symbol", "date", "open", "high", "low", "close", "volume"]]
    for c in ("open", "high", "low", "close", "volume"):
        out[c] = pd.to_numeric(out[c], errors="coerce").astype("float64")
    return out.dropna(subset=["close"])


# ------------------------------------------------------------------ BCTC
def _fin_one(sym: str, ctype: str) -> tuple[list[pd.DataFrame], str]:
    # Nguồn 1: Vietcap IQ (4–5 request/mã, có cả năm lẫn quý)
    try:
        mp = vci.metrics(sym, ctype)
        stmts = {sec: vci.statement(sym, sec) for sec in ("IS", "BS", "CF")}
        try:
            rt = vci.ratios(sym)
        except FetchError:
            rt = None
        df = normalize.normalize_iq(sym, stmts, mp, rt)
        if not df.empty:
            return [df], "VCI"
    except (FetchError, KeyError, TypeError, ValueError) as e:
        log.debug("VCI BCTC %s lỗi: %s", sym, e)
    # Nguồn 2: KBS (6 request/mã)
    try:
        res = []
        for yearly in (False, True):
            reps = []
            for kind in ("IS", "BS", "CF"):
                try:
                    reps.append(kbs.finance(sym, kind, yearly, periods=8 if yearly else 12))
                except FetchError:
                    reps.append(None)
            df = normalize.normalize_kbs(sym, reps, yearly)
            if not df.empty:
                res.append(df)
        if res:
            return res, "KBS"
    except (FetchError, KeyError, TypeError, ValueError) as e:
        log.debug("KBS BCTC %s lỗi: %s", sym, e)
    return [], "FAIL"


def update_financials(listing: pd.DataFrame, symbols: list[str], workers: int = 4, mark: bool = True) -> None:
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
    if mark:
        store.touch("financials", sources=dict(used), symbols=len(symbols))
    log.info("BCTC xong: %s · request: %s", dict(used), BREAKER.stats)


def update_dividends(symbols: list[str], workers: int = 2, mark: bool = True) -> None:
    """Cổ tức từ lịch sự kiện Vietcap. Máy chủ này chậm nên mỗi lần chỉ tải một phần,
    luân phiên: mã chưa có dữ liệu trước, rồi đến mã lâu chưa cập nhật nhất."""
    per_run = int(config.get("data.dividends_per_run", 120))
    meta = store.read("div_meta")
    last = dict(zip(meta["symbol"], pd.to_datetime(meta["fetched"]))) if not meta.empty else {}
    order = sorted(symbols, key=lambda s: (s in last, last.get(s, pd.Timestamp(0))))
    todo = order[:per_run]
    frames, used, done = [], Counter(), []
    stop = {"flag": False}

    def one(s):
        if stop["flag"]:
            return s, None, "SKIP"
        try:
            years = 2 if s in last else 12
            return s, vci.parse_dividends(s, vci.dividends(s, years=years)), "VCI"
        except FetchError as e:
            if "tạm ngắt" in str(e):
                stop["flag"] = True
            return s, None, "FAIL"

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for s, df, src in ex.map(one, todo):
            used[src] += 1
            if src == "VCI":
                done.append(s)
                if df is not None and not df.empty:
                    frames.append(df)
    if frames:
        new = pd.concat(frames, ignore_index=True).dropna(subset=["ex_date"])
        store.upsert("dividends", new, ["symbol", "ex_date", "method"])
    if done:
        now = pd.Timestamp.now().normalize()
        store.upsert("div_meta", pd.DataFrame({"symbol": done, "fetched": now}), ["symbol"])
    if mark:
        store.touch("dividends", sources=dict(used))
    remaining = len([s for s in symbols if s not in last and s not in set(done)])
    log.info("Cổ tức: %s · còn %d mã chưa có lịch sử (sẽ tải dần ở các lần sau) · request: %s",
             dict(used), remaining, BREAKER.stats)


def update_shares(symbols: list[str], workers: int = 2) -> None:
    """Số cổ phiếu hiện tại (trang thông tin DN của Vietcap – máy chủ chậm nên tải luân phiên theo lô)."""
    per_run = int(config.get("data.shares_per_run", 120))
    cur = store.read("shares_now")
    last = dict(zip(cur["symbol"], pd.to_datetime(cur["date"]))) if not cur.empty else {}
    symbols = sorted(symbols, key=lambda s: (s in last, last.get(s, pd.Timestamp(0))))[:per_run]
    rows, used = [], Counter()

    def one(s):
        try:
            return s, vci.shares_now(s)
        except FetchError:
            return s, None

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for s, v in ex.map(one, symbols):
            used["ok" if v else "fail"] += 1
            if v:
                rows.append({"symbol": s, "shares_now": v, "date": pd.Timestamp.now().normalize()})
    if rows:
        store.upsert("shares_now", pd.DataFrame(rows), ["symbol"])
    log.info("Số cổ phiếu hiện tại: %s", dict(used))


def update_orderflow(symbols: list[str], session_date, workers: int = 3) -> None:
    """Footprint phiên (mua/bán chủ động theo bước giá) cho các mã thanh khoản nhất. Lưu thành lịch sử."""
    from ..analysis.orderflow import session_stats
    rows, fps, used = [], [], Counter()

    def one(s):
        try:
            return s, vci.price_depth(s)
        except FetchError:
            return s, None

    with ThreadPoolExecutor(max_workers=workers) as ex:
        for s, fp in ex.map(one, symbols):
            if fp is None or fp.empty:
                used["fail"] += 1
                continue
            used["ok"] += 1
            st = session_stats(fp)
            if st:
                rows.append({"symbol": s, "date": session_date, **{k: st[k] for k in
                             ("buy", "sell", "undef", "delta", "delta_pct", "poc", "val", "vah", "vwap")}})
                fps.append(fp.assign(symbol=s, date=session_date))
    if rows:
        store.upsert("orderflow", pd.DataFrame(rows), ["symbol", "date"])
        store.write("footprint", pd.concat(fps, ignore_index=True))
    log.info("Dòng lệnh (footprint) phiên %s: %s", session_date, dict(used))


# ------------------------------------------------------------------ trong phiên: phiên sáng/chiều/ATC, nến 30 phút, lệnh cá mập, tin
def update_intraday(symbols: list[str], focus: list[str], budget_sec: float = 420, tick_budget_sec: float = 150) -> dict:
    """Mỗi lượt sau đóng cửa:
    - nến phút 2 phiên gần nhất của mọi mã trong danh sách (≈ 1 request/mã) -> dòng phiên + nến 30 phút;
    - tải dần lịch sử: nến giờ ~3 năm và nến phút ~6 tháng cho mã chưa có (giới hạn theo thời gian mỗi lượt);
    - lệnh khớp theo Cá mập / Sói / Cừu cho các mã anh nắm/theo dõi;
    Mọi bước đều có giới hạn thời gian để không làm chậm lượt chạy."""
    import time as _t
    from . import intraday as itd
    t0 = _t.time()
    ses_old = store.read("isess")
    have_m = set(ses_old.loc[ses_old["src"] == "m", "symbol"]) if not ses_old.empty else set()
    have_h = set(ses_old.loc[ses_old["src"] == "h", "symbol"]) if not ses_old.empty else set()
    stats = Counter()
    ses_new, bk_new = [], []

    def minute(s, cb):
        try:
            df = itd.bars(s, "ONE_MINUTE", cb)
            return s, df
        except FetchError:
            return s, None

    # 1) phiên gần nhất cho mã đã có lịch sử phút; mã chưa có -> tải 6 tháng (nặng hơn, làm dần)
    inc = [s for s in symbols if s in have_m]
    new = [s for s in symbols if s not in have_m]
    jobs = [(s, 700) for s in inc] + [(s, 30000) for s in new]
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {}
        for s, cb in jobs:
            futs[ex.submit(minute, s, cb)] = cb
        for f in as_completed(futs):
            s, df = f.result()
            if df is None or df.empty:
                stats["m_fail"] += 1
                continue
            stats["m_ok" if futs[f] < 1000 else "m_backfill"] += 1
            sr = itd.session_rows(df, True)
            if not sr.empty:
                ses_new.append(sr.assign(symbol=s))
            bk = itd.buckets(df)
            if not bk.empty:
                bk_new.append(bk.assign(symbol=s))
            if _t.time() - t0 > budget_sec:
                for g in futs:
                    g.cancel()
                stats["m_stopped"] = 1
                break
    # 2) nến giờ ~3 năm cho mã chưa có (để có lịch sử sáng/chiều dài)
    hjobs = [s for s in symbols if s not in have_h][:200]
    for s in hjobs:
        if _t.time() - t0 > budget_sec + 120:
            stats["h_stopped"] = 1
            break
        try:
            df = itd.bars(s, "ONE_HOUR", 5000)
            sr = itd.session_rows(df, False)
            if not sr.empty:
                ses_new.append(sr.assign(symbol=s))
                stats["h_backfill"] += 1
        except FetchError:
            stats["h_fail"] += 1
    if ses_new:
        add = pd.concat(ses_new, ignore_index=True)
        add["date"] = pd.to_datetime(add["date"])
        if not ses_old.empty:
            ses_old["date"] = pd.to_datetime(ses_old["date"])
        df = pd.concat([ses_old, add], ignore_index=True) if not ses_old.empty else add
        # cùng một phiên: dữ liệu phút luôn ưu tiên hơn dữ liệu giờ; cùng nguồn thì bản mới nhất thắng
        df["_p"] = (df["src"] == "m").astype(int)
        df["_o"] = np.arange(len(df))
        df = df.sort_values(["symbol", "date", "_p", "_o"]).drop_duplicates(["symbol", "date"], keep="last")
        df = df.drop(columns=["_p", "_o"]).reset_index(drop=True)
        store.write("isess", df)
    if bk_new:
        bk = pd.concat(bk_new, ignore_index=True)
        old = store.read("ibk")
        df = pd.concat([old, bk], ignore_index=True) if not old.empty else bk
        df["date"] = pd.to_datetime(df["date"])
        df = df.drop_duplicates(["symbol", "date", "b"], keep="last")
        df = df[df["date"] >= df["date"].max() - pd.Timedelta(days=200)]
        store.write("ibk", df.sort_values(["symbol", "date", "b"]).reset_index(drop=True))
    # 3) lệnh khớp Cá mập/Sói/Cừu cho mã anh nắm / theo dõi (hôm nay)
    t1 = _t.time()
    rows = []
    now = datetime.now(tz=__import__("zoneinfo").ZoneInfo("Asia/Ho_Chi_Minh")).replace(tzinfo=None)
    for s in focus:
        if _t.time() - t1 > tick_budget_sec:
            stats["t_stopped"] = 1
            break
        try:
            tk = itd.ticks(s, max_pages=60, since=now.replace(hour=9, minute=0, second=0))
            tk = tk[tk["time"].dt.date == now.date()] if not tk.empty else tk
            sm = itd.tick_summary(tk)
            if sm:
                rows.append({"symbol": s, "date": pd.Timestamp(now.date()), "json": __import__("json").dumps(sm, ensure_ascii=False)})
                stats["t_ok"] += 1
        except FetchError:
            stats["t_fail"] += 1
    if rows:
        store.upsert("shark", pd.DataFrame(rows), ["symbol", "date"])
    stats["sec"] = round(_t.time() - t0)
    log.info("Dữ liệu trong phiên: %s", dict(stats))
    store.touch("intraday", **{k: int(v) for k, v in stats.items()})
    return dict(stats)


def update_news(symbols: list[str]) -> None:
    from . import intraday as itd
    try:
        df = itd.news(set(symbols))
    except Exception as e:  # noqa: BLE001
        log.warning("Tin tức lỗi: %s", e)
        return
    if df.empty:
        log.info("Tin tức: không có tin nhắc mã nào")
        return
    old = store.read("news")
    df = pd.concat([old, df], ignore_index=True) if not old.empty else df
    df["time"] = pd.to_datetime(df["time"])
    df = df.drop_duplicates(["symbol", "link"], keep="first")
    df = df[df["time"] >= pd.Timestamp.now() - pd.Timedelta(days=180)]
    store.write("news", df.sort_values("time").reset_index(drop=True))
    log.info("Tin tức: %d tin gắn mã (lưu %d)", int(df["time"].ge(pd.Timestamp.now() - pd.Timedelta(days=1)).sum()), len(df))


def focus_symbols() -> list[str]:
    """Mã anh đang nắm + đang theo dõi (để lấy lệnh cá mập và cảnh báo trong phiên)."""
    try:
        from ..portfolio_store import load_holdings, load_watchlist
        hs, _, _ = load_holdings()
        wl = load_watchlist()
        out = [h["symbol"].upper() for h in hs] + [w["symbol"].upper() for w in wl]
        return list(dict.fromkeys(out))
    except Exception:  # noqa: BLE001
        return []


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
        update_financials(listing, fin_syms, mark=not only)
    else:
        log.info("Chưa tới lịch tải BCTC (cập nhật gần nhất %.1f ngày trước)",
                 store.age_days("financials"))
    div_syms = liquid_symbols(prices, float(config.get("universe.fin_min_avg_value_bn", 0.3)))
    # dòng lệnh phiên: chỉ khi chạy sau giờ đóng cửa của ngày có giao dịch
    now = datetime.now(tz=__import__("zoneinfo").ZoneInfo("Asia/Ho_Chi_Minh"))
    last_session = prices["date"].max() if not prices.empty else None
    if last_session is not None and pd.Timestamp(last_session).date() == now.date() and now.hour * 60 + now.minute >= 14 * 60 + 50:
        top = liquid_symbols(prices, float(config.get("data.orderflow_min_value_bn", 5)))
        top = [s for s in top if s in set(syms)][: int(config.get("data.orderflow_top", 250))]
        update_orderflow(top if not only else [s for s in syms if s in only], pd.Timestamp(last_session).normalize())
    else:
        log.info("Bỏ qua dòng lệnh: chưa hết phiên hoặc hôm nay không giao dịch")
    try:
        icfg = config.get("intraday", {}) or {}
        iu = liquid_symbols(prices, float(icfg.get("min_value_bn", 2)))
        vals = prices[prices["date"] >= prices["date"].max() - timedelta(days=45)]
        vv = (vals["close"] * vals["volume"] / 1e6).groupby(vals["symbol"]).mean()
        iu = sorted([s for s in iu if s in set(syms)], key=lambda x: -vv.get(x, 0))[: int(icfg.get("max_symbols", 450))]
        foc = focus_symbols()
        iu = list(dict.fromkeys(foc + iu)) if not only else [s for s in syms if s in only]
        update_intraday(iu, foc[: int(icfg.get("tick_symbols", 12))], float(icfg.get("budget_sec", 420)), float(icfg.get("tick_budget_sec", 150)))
    except Exception as e:  # noqa: BLE001
        log.exception("Dữ liệu trong phiên lỗi: %s", e)
    try:
        update_news(syms)
    except Exception as e:  # noqa: BLE001
        log.warning("Tin tức lỗi: %s", e)
    update_shares([s for s in div_syms if s in set(syms)] if not only else [s for s in syms if s in only])
    div_syms = [s for s in div_syms if s in set(syms)] if not only else [s for s in syms if s in only]
    update_dividends(div_syms, mark=not only)
