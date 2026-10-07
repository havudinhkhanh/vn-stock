"""Nguồn Vietcap (VCI) — API công khai mà web trading.vietcap.com.vn dùng.

Không cần tài khoản. Có thể thay đổi bất cứ lúc nào: mọi hàm đều ném FetchError
để lớp trên tự chuyển sang nguồn dự phòng.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta

import pandas as pd

from .http import FetchError, get, post

TRADING = "https://trading.vietcap.com.vn/api/"
MT = "https://mt.vietcap.com.vn/api/"
GRAPHQL = "https://trading.vietcap.com.vn/data-mt/graphql"
IQ = "https://iq.vietcap.com.vn/api/iq-insight-service"

INDEX_MAP = {"VNINDEX": "VNINDEX", "HNXINDEX": "HNXIndex", "UPCOMINDEX": "HNXUpcomIndex",
             "VN30": "VN30"}

# Loại doanh nghiệp theo ngành ICB cấp 4 (để đọc đúng mẫu BCTC)
BANK_ICB4 = {"Ngân hàng", "Quản lý tài sản", "Tài chính cá nhân"}
SEC_ICB4 = {"Môi giới chứng khoán"}
INS_ICB4 = {"Bảo hiểm nhân thọ", "Bảo hiểm phi nhân thọ", "Tái bảo hiểm"}


def com_type(icb4: str | None) -> str:
    if not icb4:
        return "CT"
    if icb4 in BANK_ICB4:
        return "NH"
    if icb4 in SEC_ICB4:
        return "CK"
    if icb4 in INS_ICB4:
        return "BH"
    return "CT"


# ----------------------------------------------------------------- danh sách
def listing() -> pd.DataFrame:
    """Toàn bộ mã cổ phiếu + sàn + ngành ICB."""
    raw = None
    for base in (TRADING, MT):
        try:
            raw = get("VCI", base + "price/symbols/getAll")
            break
        except FetchError:
            continue
    if not raw:
        raise FetchError("VCI listing: không lấy được danh sách mã")
    df = pd.DataFrame(raw)
    df = df.rename(columns={"symbol": "symbol", "board": "exchange", "organName": "name",
                            "organShortName": "short_name", "type": "type"})
    if "type" in df:
        df = df[df["type"].astype(str).str.upper().isin(["STOCK"])]
    df["exchange"] = df["exchange"].replace({"HSX": "HOSE"}).astype(str).str.upper()
    df = df[df["exchange"].isin(["HOSE", "HNX", "UPCOM"])]
    df = df[df["symbol"].astype(str).str.len() == 3]

    try:
        icb = industries()
        df = df.merge(icb, on="symbol", how="left")
    except (FetchError, KeyError, TypeError, ValueError):
        for c in ("icbName2", "icbName3", "icbName4", "comTypeCode", "name_full"):
            df[c] = None
    if "name" not in df:
        df["name"] = df.get("name_full")
    df["name"] = df["name"].fillna(df.get("name_full"))
    df["com_type"] = [c if isinstance(c, str) and c in ("CT", "NH", "CK", "BH") else com_type(i4)
                      for c, i4 in zip(df.get("comTypeCode", [None] * len(df)), df["icbName4"])]
    keep = ["symbol", "exchange", "name", "icbName2", "icbName3", "icbName4", "com_type"]
    out = df[[c for c in keep if c in df]].rename(
        columns={"icbName2": "sector", "icbName3": "industry", "icbName4": "subindustry"})
    return out.drop_duplicates("symbol").reset_index(drop=True)


def industries() -> pd.DataFrame:
    """Phân ngành ICB cấp 1-4 + loại doanh nghiệp (CT/NH/CK/BH) cho mọi mã."""
    data = get("VCI", f"{IQ}/v2/company/search-bar", params={"language": 1}).get("data") or []
    rows = []
    for c in data:
        r = {"symbol": c.get("code"), "name_full": c.get("name"), "comTypeCode": c.get("comTypeCode")}
        for lv in (1, 2, 3, 4):
            v = c.get(f"icbLv{lv}") or {}
            r[f"icbName{lv}"] = v.get("name") if isinstance(v, dict) else None
        rows.append(r)
    if not rows:
        raise FetchError("VCI search-bar rỗng")
    return pd.DataFrame(rows).drop_duplicates("symbol")


# ----------------------------------------------------------------- giá
def _chart(symbols: list[str], start: datetime, end: datetime) -> dict[str, pd.DataFrame]:
    """Giá ngày. gap-chart nhận 'to' + 'countBack' (số phiên); 'gap' (cũ) nhận 'from' + 'to'."""
    days = max(5, (end - start).days)
    count_back = int(days * 5 / 7) + 10
    tries = [
        ("chart/OHLCChart/gap-chart", {"timeFrame": "ONE_DAY", "symbols": symbols,
                                        "to": int(end.timestamp()), "countBack": count_back}),
        ("chart/OHLCChart/gap", {"timeFrame": "ONE_DAY", "symbols": symbols,
                                  "from": int(start.timestamp()), "to": int(end.timestamp())}),
    ]
    data, last = None, None
    for path, payload in tries:
        try:
            data = post("VCI", TRADING + path, payload)
            break
        except FetchError as e:
            last = e
    if data is None:
        raise last
    out = {}
    for item in data or []:
        sym = item.get("symbol")
        if not sym or not item.get("t"):
            continue
        df = pd.DataFrame({
            "date": pd.to_datetime(pd.Series(item["t"]).astype("int64"), unit="s", utc=True)
            .dt.tz_convert("Asia/Ho_Chi_Minh").dt.tz_localize(None).dt.normalize(),
            "open": item["o"], "high": item["h"], "low": item["l"],
            "close": item["c"], "volume": item["v"],
        })
        out[sym] = df
    return out


def prices(symbols: list[str], start: datetime, end: datetime | None = None,
           batch: int = 20) -> dict[str, pd.DataFrame]:
    """Giá ngày (đã điều chỉnh) cho nhiều mã. Giá cổ phiếu quy về nghìn đồng."""
    end = end or (datetime.now() + timedelta(days=1))
    res: dict[str, pd.DataFrame] = {}
    idx_rev = {v.upper(): k for k, v in INDEX_MAP.items()}
    for i in range(0, len(symbols), batch):
        chunk = symbols[i:i + batch]
        req = [INDEX_MAP.get(s, s) for s in chunk]
        got = _chart(req, start, end)
        for sym, df in got.items():
            key = idx_rev.get(sym.upper(), sym.upper())
            if key not in INDEX_MAP:
                # VCI trả giá cổ phiếu theo đồng -> quy về nghìn đồng như bảng điện
                df[["open", "high", "low", "close"]] /= 1000.0
            res[key] = df
    return res


# ----------------------------------------------------------------- BCTC (Vietcap IQ)
SECTIONS = {"IS": "INCOME_STATEMENT", "BS": "BALANCE_SHEET", "CF": "CASH_FLOW"}
_metrics_cache: dict[str, pd.DataFrame] = {}


def metrics(symbol: str, ctype: str = "CT") -> pd.DataFrame:
    """Từ điển mã trường -> tên chỉ tiêu (theo loại doanh nghiệp, lưu tạm để đỡ gọi lại)."""
    if ctype in _metrics_cache:
        return _metrics_cache[ctype]
    data = get("VCI", f"{IQ}/v1/company/{symbol}/financial-statement/metrics").get("data") or {}
    rows = []
    for sec, items in data.items():
        for it in items or []:
            rows.append({"section": str(sec).upper(), "field": it.get("field"), "parent": it.get("parent"),
                         "en": it.get("titleEn") or it.get("fullTitleEn"), "vi": it.get("titleVi") or it.get("fullTitleVi"),
                         "level": it.get("level")})
    df = pd.DataFrame(rows)
    if df.empty:
        raise FetchError(f"VCI metrics {symbol}: rỗng")
    df = df.dropna(subset=["field"])
    df = df[df["field"].astype(str).str.len() > 0].drop_duplicates(["section", "field"])
    _metrics_cache[ctype] = df
    return df


def statement(symbol: str, section: str) -> dict[str, pd.DataFrame]:
    """Một loại báo cáo (IS/BS/CF): trả về {'years': df, 'quarters': df} với mã trường gốc."""
    data = get("VCI", f"{IQ}/v1/company/{symbol}/financial-statement",
               params={"section": SECTIONS[section]}).get("data") or {}
    return {k: pd.DataFrame(data.get(k) or []) for k in ("years", "quarters")}


def ratios(symbol: str) -> pd.DataFrame:
    data = get("VCI", f"{IQ}/v1/company/{symbol}/statistics-financial").get("data") or []
    return pd.DataFrame(data)


def dividends(symbol: str, years: int = 12) -> pd.DataFrame:
    """Lịch sử cổ tức tiền mặt & cổ phiếu từ lịch sự kiện (mã sự kiện DIV, ISS)."""
    to = datetime.now()
    fr = to - timedelta(days=365 * years)
    rows, page = [], 0
    while page < 6:
        data = get("VCI_EVENTS", f"{IQ}/v1/events", params={
            "ticker": symbol, "fromDate": fr.strftime("%Y%m%d"), "toDate": to.strftime("%Y%m%d"),
            "eventCode": "DIV,ISS", "page": page, "size": 50}, timeout=20).get("data") or {}
        content = data.get("content") if isinstance(data, dict) else data
        if not content:
            break
        rows.extend(content)
        if isinstance(data, dict) and data.get("last", True):
            break
        page += 1
    return pd.DataFrame(rows)


def _pick(row: dict, *names):
    for n in names:
        if n in row and row[n] not in (None, ""):
            return row[n]
    return None


def parse_dividends(symbol: str, raw: pd.DataFrame) -> pd.DataFrame:
    """Chuẩn hoá sự kiện DIV (cổ tức tiền) / ISS (cổ phiếu thưởng, cổ tức cổ phiếu).

    cash_pct: tỷ lệ trên mệnh giá 10.000đ (0,15 = 1.500đ/cp)."""
    cols = ["symbol", "ex_date", "year", "cash_pct", "method"]
    if raw is None or raw.empty:
        return pd.DataFrame(columns=cols)
    out = []
    for r in raw.to_dict("records"):
        code = str(_pick(r, "eventCode", "eventListCode", "eventType", "code") or "").upper()
        d = _pick(r, "exrightDate", "exRightDate", "exDate", "recordDate", "issueDate", "publicDate", "displayDate")
        if isinstance(d, (int, float)):
            d = pd.to_datetime(d, unit="ms", errors="coerce")
        else:
            d = pd.to_datetime(d, errors="coerce")
        if pd.isna(d):
            continue
        val = _pick(r, "valuePerShare", "value", "cashValue", "dividendValue")
        ratio = _pick(r, "ratio", "exerciseRatio", "dividendRatio", "rate")
        try:
            val = float(val) if val is not None else None
        except (TypeError, ValueError):
            val = None
        try:
            ratio = float(ratio) if ratio is not None else None
        except (TypeError, ValueError):
            ratio = None
        is_cash = code.startswith("DIV") and "ISS" not in code
        if not is_cash:
            title = f"{r.get('eventTitleVi') or ''} {r.get('eventTitleEn') or ''}".lower()
            # chỉ tính cổ tức bằng cổ phiếu / cổ phiếu thưởng; bỏ ESOP, chào bán, phát hành riêng lẻ
            if not re.search(r"cổ tức|thưởng|bonus|stock dividend|dividend", title):
                continue
        if val is not None and val > 50:          # đồng / cổ phiếu
            pct = val / 10000
        elif ratio is not None:
            pct = ratio / 100 if ratio > 1 else ratio
        else:
            continue
        out.append({"symbol": symbol, "ex_date": d.normalize().tz_localize(None) if d.tzinfo else d.normalize(),
                    "year": d.year, "cash_pct": pct, "method": "cash" if is_cash else "stock"})
    return pd.DataFrame(out, columns=cols)


def snapshot(symbols: list[str]) -> pd.DataFrame:
    """Bảng giá hiện tại (giá trần/sàn/tham chiếu, khối ngoại...)."""
    out = []
    for i in range(0, len(symbols), 100):
        data = post("VCI", TRADING + "price/symbols/getList", {"symbols": symbols[i:i + 100]})
        for it in data or []:
            li = it.get("listingInfo", {}) or {}
            mi = it.get("matchPrice", {}) or {}
            bi = it.get("bidAsk", {}) or {}
            out.append({
                "symbol": li.get("symbol"),
                "ref": li.get("refPrice"), "ceiling": li.get("ceiling"), "floor": li.get("floor"),
                "price": mi.get("matchPrice"), "volume": mi.get("accumulatedVolume"),
                "foreign_buy": mi.get("foreignBuyVolume"), "foreign_sell": mi.get("foreignSellVolume"),
                "foreign_room": mi.get("currentRoom"),
            })
        time.sleep(0.2)
    return pd.DataFrame(out)
