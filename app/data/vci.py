"""Nguồn Vietcap (VCI) — API công khai mà web trading.vietcap.com.vn dùng.

Không cần tài khoản. Có thể thay đổi bất cứ lúc nào: mọi hàm đều ném FetchError
để lớp trên tự chuyển sang nguồn dự phòng.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta

import pandas as pd

from .http import FetchError, get, post

TRADING = "https://trading.vietcap.com.vn/api/"
MT = "https://mt.vietcap.com.vn/api/"
GRAPHQL = "https://api.vietcap.com.vn/data-mt/graphql"

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

    q = ("{CompaniesListingInfo { ticker organName icbName2 icbName3 icbName4 "
         "icbCode1 icbCode2 icbCode3 icbCode4 comTypeCode } }")
    try:
        icb = post("VCI", GRAPHQL, {"query": q, "variables": {}})["data"]["CompaniesListingInfo"]
        icb = pd.DataFrame(icb).rename(columns={"ticker": "symbol", "organName": "name_full"})
        df = df.merge(icb, on="symbol", how="left")
    except (FetchError, KeyError, TypeError):
        for c in ("icbName2", "icbName3", "icbName4", "comTypeCode"):
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


# ----------------------------------------------------------------- giá
def _chart(symbols: list[str], start: datetime, end: datetime) -> dict[str, pd.DataFrame]:
    payload = {"timeFrame": "ONE_DAY", "symbols": symbols,
               "from": int(start.timestamp()), "to": int(end.timestamp())}
    data = None
    for path in ("chart/OHLCChart/gap-chart", "chart/OHLCChart/gap"):
        try:
            data = post("VCI", TRADING + path, payload)
            break
        except FetchError as e:
            last = e
    if data is None:
        raise last  # noqa: F821
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


# ----------------------------------------------------------------- BCTC
_RATIO_FIELDS = (
    "ticker yearReport lengthReport updateDate revenue revenueGrowth netProfit "
    "netProfitGrowth ebitMargin roe roic roa pe pb eps currentRatio cashRatio quickRatio "
    "interestCoverage ae netProfitMargin grossMargin ev issueShare ps pcf bvps evPerEbitda "
    "at fat acp dso dpo ccc de le ebitda ebit dividend epsTTM charterCapital"
)


_mapping_cache: pd.DataFrame | None = None


def ratio_dictionary() -> pd.DataFrame:
    """Từ điển mã trường (ISA1, BSA2...) -> tên chỉ tiêu."""
    global _mapping_cache
    if _mapping_cache is not None:
        return _mapping_cache
    q = ("query Query { ListFinancialRatio { id type name unit isDefault fieldName "
         "en_Type en_Name tagName comTypeCode order } }")
    data = post("VCI", GRAPHQL, {"query": q, "variables": {}})["data"]["ListFinancialRatio"]
    _mapping_cache = pd.DataFrame(data)
    return _mapping_cache


def financial_raw(symbol: str, period: str = "Q") -> pd.DataFrame:
    """Toàn bộ chỉ tiêu BCTC thô (mã trường) theo quý (Q) hoặc năm (Y)."""
    mp = ratio_dictionary()
    codes = " ".join(sorted(set(mp["fieldName"].dropna().astype(str))))
    q = ("query Query($ticker: String!, $period: String!) { CompanyFinancialRatio("
         "ticker: $ticker, period: $period) { ratio { " + _RATIO_FIELDS + " " + codes +
         " } period } }")
    try:
        data = post("VCI", GRAPHQL, {"query": q, "variables": {"ticker": symbol, "period": period}})
    except FetchError:
        # Một số trường có thể không còn tồn tại -> hỏi tối thiểu
        q2 = q.replace(" " + codes, "")
        data = post("VCI", GRAPHQL, {"query": q2, "variables": {"ticker": symbol, "period": period}})
    rows = (((data or {}).get("data") or {}).get("CompanyFinancialRatio") or {}).get("ratio") or []
    return pd.DataFrame(rows)


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
