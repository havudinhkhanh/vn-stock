"""Tin tức nhiều nguồn, gắn mã cổ phiếu và phân loại tin "có tác động" (pháp lý, nợ, niêm yết, điều tra…).

Nguồn:
- RSS báo tài chính VN (CafeF, Vietstock, VnExpress, VnEconomy, Tuổi Trẻ, Thanh Niên, Dân trí, Người Lao Động, ZNews, Tin nhanh CK…)
- Google News (tiếng Việt + tiếng Anh) tìm theo mã + tên thương hiệu cho nhóm mã quan trọng (đang nắm / theo dõi / thanh khoản lớn)
  → bắt được tin quốc tế (Reuters, Bloomberg, tòa án nước ngoài…) và các báo không có RSS.
- Vietcap IQ: công bố thông tin của DN / Sở GDCK theo mã.
Gắn mã: chữ in hoa 3 ký tự đứng riêng HOẶC tên thương hiệu (Vietjet, Vingroup, Hòa Phát…) – trước đây chỉ theo mã nên bỏ sót tin
kiểu "Tòa án Anh phong tỏa tài sản Vietjet"."""
from __future__ import annotations

import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote_plus

import pandas as pd
import requests

log = logging.getLogger("news")
TZ = "Asia/Ho_Chi_Minh"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"}
_TAG = re.compile(r"<[^>]+>")

FEEDS = {
    "CafeF": ["https://cafef.vn/thi-truong-chung-khoan.rss", "https://cafef.vn/doanh-nghiep.rss", "https://cafef.vn/tai-chinh-ngan-hang.rss",
              "https://cafef.vn/bat-dong-san.rss", "https://cafef.vn/vi-mo-dau-tu.rss"],
    "Vietstock": ["https://vietstock.vn/830/chung-khoan/co-phieu.rss", "https://vietstock.vn/737/doanh-nghiep/hoat-dong-kinh-doanh.rss",
                  "https://vietstock.vn/739/chung-khoan/giao-dich-noi-bo.rss", "https://vietstock.vn/1636/nhan-dinh-phan-tich/nhan-dinh-thi-truong.rss",
                  "https://vietstock.vn/746/doanh-nghiep/co-tuc.rss", "https://vietstock.vn/764/doanh-nghiep/tang-von-m-a.rss"],
    "VnExpress": ["https://vnexpress.net/rss/kinh-doanh.rss", "https://vnexpress.net/rss/kinh-doanh/chung-khoan.rss", "https://vnexpress.net/rss/phap-luat.rss"],
    "VnEconomy": ["https://vneconomy.vn/chung-khoan.rss", "https://vneconomy.vn/doanh-nghiep.rss", "https://vneconomy.vn/tai-chinh.rss"],
    "Tuổi Trẻ": ["https://tuoitre.vn/rss/kinh-doanh.rss", "https://tuoitre.vn/rss/phap-luat.rss"],
    "Thanh Niên": ["https://thanhnien.vn/rss/kinh-te.rss"],
    "Dân trí": ["https://dantri.com.vn/rss/kinh-doanh.rss"],
    "Người Lao Động": ["https://nld.com.vn/rss/kinh-te.rss"],
    "ZNews": ["https://znews.vn/rss/kinh-doanh-tai-chinh.rss"],
    "Tin nhanh CK": ["https://www.tinnhanhchungkhoan.vn/rss/chung-khoan-1.rss", "https://www.tinnhanhchungkhoan.vn/rss/doanh-nghiep-3.rss"],
    "VietnamPlus": ["https://www.vietnamplus.vn/rss/kinhte-311.rss"],
}

# tên thương hiệu → mã (chỉ những tên đủ đặc trưng để không nhầm); mã 3 chữ in hoa vẫn bắt riêng
ALIASES = {
    "VIC": ["Vingroup"], "VHM": ["Vinhomes"], "VRE": ["Vincom Retail"], "VPL": ["Vinpearl"], "VJC": ["Vietjet", "VietJet Air", "Vietjet Air", "Vietjet Aviation"],
    "HVN": ["Vietnam Airlines"], "ACV": ["Tổng công ty Cảng hàng không"], "VNM": ["Vinamilk"], "MSN": ["Masan Group", "Tập đoàn Masan"], "MCH": ["Masan Consumer"],
    "MSR": ["Masan High-Tech", "Masan Tungsten"], "MML": ["Masan MEATLife"], "MWG": ["Thế Giới Di Động", "Thế giới Di động", "Bách Hóa Xanh", "Bách hoá Xanh"],
    "FRT": ["FPT Retail", "Long Châu", "FPT Shop"], "HPG": ["Hòa Phát", "Hoà Phát"], "HSG": ["Hoa Sen"], "NKG": ["Thép Nam Kim"], "GVR": ["Tập đoàn Cao su", "Cao su Việt Nam"],
    "GAS": ["PV Gas", "PV GAS"], "PLX": ["Petrolimex"], "POW": ["PV Power"], "BSR": ["Bình Sơn", "Lọc hóa dầu Bình Sơn", "Lọc dầu Dung Quất"], "PVS": ["PTSC"],
    "PVD": ["PV Drilling"], "PVT": ["PVTrans", "PV Trans"], "VCB": ["Vietcombank"], "BID": ["BIDV"], "CTG": ["VietinBank", "Vietinbank"], "TCB": ["Techcombank"],
    "MBB": ["MB Bank", "MBBank", "Ngân hàng Quân đội"], "VPB": ["VPBank"], "STB": ["Sacombank"], "HDB": ["HDBank"], "TPB": ["TPBank"], "LPB": ["LPBank", "LienVietPostBank", "Lộc Phát"],
    "EIB": ["Eximbank"], "SSB": ["SeABank"], "NAB": ["Nam A Bank"], "VAB": ["VietABank"], "ABB": ["ABBank"], "BVB": ["BVBank"], "KLB": ["KienlongBank"], "SGB": ["Saigonbank"],
    "VND": ["VNDirect", "VNDIRECT"], "HCM": ["Chứng khoán HSC"], "VCI": ["Chứng khoán Vietcap"], "VCK": ["VPBankS"], "TCX": ["Techcom Securities", "TCBS"],
    "NVL": ["Novaland"], "PDR": ["Phát Đạt"], "DXG": ["Đất Xanh"], "KDH": ["Khang Điền"], "NLG": ["Nam Long Group", "Tập đoàn Nam Long"], "CEO": ["CEO Group"],
    "KBC": ["Kinh Bắc"], "IDC": ["IDICO"], "BCM": ["Becamex"], "SZC": ["Sonadezi Châu Đức"], "GEX": ["Gelex", "GELEX"], "VGC": ["Viglacera"], "DGC": ["Hóa chất Đức Giang", "Đức Giang"],
    "DPM": ["Đạm Phú Mỹ", "PVFCCo"], "DCM": ["Đạm Cà Mau"], "SAB": ["Sabeco"], "BHN": ["Habeco"], "VHC": ["Vĩnh Hoàn"], "ANV": ["Nam Việt"], "DGW": ["Digiworld"],
    "VTP": ["Viettel Post"], "CTR": ["Viettel Construction"], "VGI": ["Viettel Global"], "GMD": ["Gemadept"], "HAH": ["Vận tải Hải An"], "VSC": ["Viconship"], "VOS": ["Vosco"],
    "HAG": ["Hoàng Anh Gia Lai", "HAGL"], "DBC": ["Dabaco"], "QNS": ["Đường Quảng Ngãi"], "KDC": ["Kido"], "SBT": ["TTC AgriS"], "HT1": ["Xi măng Hà Tiên"],
    "BMP": ["Nhựa Bình Minh"], "NTP": ["Nhựa Tiền Phong"], "VCG": ["Vinaconex"], "CTD": ["Coteccons"], "HHV": ["Đèo Cả"], "TCH": ["Hoàng Huy"], "ITA": ["Tân Tạo"],
    "VEA": ["VEAM"], "VNZ": ["VNG"], "CMG": ["Tập đoàn CMC"], "DHG": ["Dược Hậu Giang"], "IMP": ["Imexpharm"], "DBD": ["Bidiphar"], "HUT": ["Tasco"], "THD": ["Thaiholdings"],
    "TLG": ["Thiên Long"], "YEG": ["Yeah1"], "SCS": ["Saigon Cargo"], "PNJ": ["Phú Nhuận"], "REE": ["Cơ điện lạnh REE"], "PC1": ["Tập đoàn PC1"], "EVF": ["EVNFinance"],
    "VIB": ["Ngân hàng VIB"], "OCB": ["Ngân hàng OCB"], "MSB": ["Ngân hàng MSB"], "SHB": ["Ngân hàng SHB"], "ACB": ["Ngân hàng ACB"], "SSI": ["Chứng khoán SSI"],
}
# tên tiếng Anh dùng để tìm Google News quốc tế (DN có giao dịch/vay nợ/kiện tụng ở nước ngoài)
INTL = {"VJC": "Vietjet", "VIC": "Vingroup", "VHM": "Vinhomes", "HVN": "Vietnam Airlines", "MSN": "Masan Group", "NVL": "Novaland", "VNM": "Vinamilk", "HPG": "Hoa Phat",
        "FPT": "FPT Corporation", "VCB": "Vietcombank", "TCB": "Techcombank", "VPB": "VPBank", "GAS": "PV Gas", "PLX": "Petrolimex", "MWG": "Mobile World Investment",
        "SAB": "Sabeco", "BID": "BIDV", "CTG": "VietinBank", "ACV": "Airports Corporation of Vietnam", "VRE": "Vincom Retail"}

# tin "có tác động": (mẫu, nhóm, dấu, mức). mức 2 = nghiêm trọng (báo ngay cho mã đang nắm/theo dõi), 1 = đáng chú ý
RULES = [
    (r"phong t[ỏo]a|đóng băng tài sản|kê biên|freez|asset freeze|receiver|tịch thu|thu giữ tài sản", "Pháp lý – tài sản bị phong tỏa/kê biên", -1, 2),
    (r"khởi tố|bắt tạm giam|bị bắt|truy tố|truy nã|xét xử|arrest|indict|prosecut", "Pháp lý – lãnh đạo/DN bị khởi tố, bắt", -1, 2),
    (r"khởi kiện|bị kiện|kiện tụng|tranh chấp|phán quyết|bản án|thua kiện|lawsuit|\bsued\b|\bsues\b|court|judg(e)?ment|arbitration|trọng tài", "Pháp lý – kiện tụng/phán quyết", -1, 2),
    (r"vỡ nợ|mất khả năng thanh toán|chậm trả|chậm thanh toán|nợ quá hạn|default|insolven|phá sản|bankrupt", "Nợ – chậm trả/vỡ nợ", -1, 2),
    (r"h[uủ]y niêm yết|đình chỉ giao dịch|hạn chế giao dịch|tạm (ngừng|dừng) giao dịch|kiểm soát đặc biệt|diện cảnh báo|diện kiểm soát|delist", "Niêm yết – hủy/đình chỉ/cảnh báo", -1, 2),
    (r"bị điều tra|điều tra (?:sai phạm|vụ|hành vi)|thao túng|lừa đảo|gian lận|investigat|probe|fraud|manipulat", "Điều tra – gian lận/thao túng", -1, 2),
    (r"bị thanh tra|kết luận thanh tra|thanh tra (?:chỉ ra|phát hiện|kiến nghị)|kiểm tra đột xuất", "Thanh tra – chỉ ra sai phạm/tồn tại", -1, 1),
    (r"bị giải chấp|bán giải chấp|giải chấp cổ phiếu|cưỡng chế thuế|bị cưỡng chế", "Cổ đông lớn bị giải chấp/cưỡng chế", -1, 2),
    (r"xử phạt|bị phạt|phạt hành chính|\bfine[ds]?\b", "Bị xử phạt", -1, 1),
    (r"ý kiến ngoại trừ|từ chối đưa ra ý kiến|kiểm toán ngoại trừ|lưu ý kiểm toán|nghi ngờ khả năng hoạt động liên tục", "BCTC – kiểm toán ngoại trừ", -1, 2),
    (r"lỗ (kỷ lục|nặng|lớn)|thua lỗ|lãi giảm mạnh|lợi nhuận giảm mạnh|giảm \d+% lợi nhuận", "Kết quả kinh doanh xấu", -1, 1),
    (r"từ nhiệm|miễn nhiệm|thôi chức|resign", "Nhân sự cấp cao thay đổi", 0, 1),
    (r"lãi kỷ lục|lợi nhuận kỷ lục|vượt kế hoạch|lãi tăng mạnh|lợi nhuận tăng mạnh|record profit", "Kết quả kinh doanh tốt", 1, 1),
    (r"trúng thầu|ký kết hợp đồng|hợp đồng (lớn|trị giá)|được cấp phép|phê duyệt dự án|chấp thuận đầu tư", "Hợp đồng / dự án mới", 1, 1),
    (r"mua lại cổ phiếu|cổ phiếu quỹ|đăng ký mua|chia cổ tức|tạm ứng cổ tức|buyback", "Cổ tức / mua lại cổ phiếu", 1, 1),
]
_RULES = [(re.compile(p, re.I), t, s, v) for p, t, s, v in RULES]


def classify(text: str) -> tuple[str | None, int, int]:
    best = (None, 0, 0)
    for rx, tag, sign, sev in _RULES:
        if rx.search(text) and sev > best[2]:
            if tag.startswith("Niêm yết") and re.search(r"trái phiếu|chứng quyền|bond", text, re.I):
                continue      # hủy niêm yết trái phiếu / chứng quyền đáo hạn: chuyện thường
            best = (tag, sign, sev)
    return best


def classify_for(symbol: str, title: str) -> tuple[str | None, int, int]:
    """Phân loại theo TIÊU ĐỀ (mô tả của Google News chứa tên báo, vd "Báo Thanh tra"). Tin chỉ ở mức nghiêm trọng khi
    mã/thương hiệu nằm ngay trong tiêu đề và tiêu đề không phải tin tổng hợp nhiều mã (≥ 3 mã → chỉ còn mức 1)."""
    tag, sign, sev = classify(title)
    if sev >= 2:
        ts = tag_symbols(title, set(ALIASES) | {symbol})
        if symbol not in ts or len(ts) >= 3:
            sev = 1
    return tag, sign, sev


def _alias_rx() -> list[tuple[re.Pattern, str]]:
    out = []
    for s, names in ALIASES.items():
        for nm in names:
            out.append((re.compile(r"(?<![\w])" + re.escape(nm) + r"(?![\w])", re.I if not nm.isupper() else 0), s))
    return out


_ALX = _alias_rx()


# mã trùng chữ viết tắt thông dụng (tiền tệ, TP.HCM, CEO, CPI…): chỉ nhận khi có ngữ cảnh chứng khoán hoặc tên thương hiệu
AMBIG = {"API", "BIG", "BOT", "CAR", "CEO", "CNN", "CPI", "NAV", "ONE", "PPP", "PRO", "SEA", "TOP", "TPP", "USD", "VIP", "VND", "HCM", "DHA", "GAS", "OIL", "ART", "LAS", "PET", "FIT", "TIG", "ICT", "IDC", "ITC", "VTV", "STK", "HAI", "SAM", "NET", "MCP", "SGP", "TTT"}
_CTX = r"(?i:cổ phiếu|mã|cp|hose|hnx|upcom|hsx|ticker|shares of)\s*:?\s*"


def tag_symbols(text: str, symbols: set[str]) -> set[str]:
    found = set()
    for w in re.findall(r"(?<![A-Za-z0-9.])([A-Z][A-Z0-9]{2})(?![A-Za-z0-9])", text):
        if w not in symbols:
            continue
        if w in AMBIG and not re.search(_CTX + w + r"(?![A-Z0-9])|" + w + r"\s*\((?:HOSE|HNX|UPCOM|UPCoM|HSX)", text):
            continue
        found.add(w)
    for rx, s in _ALX:
        if s in symbols and rx.search(text):
            found.add(s)
    return found


def _parse_rss(content: bytes, src: str) -> list[dict]:
    root = ET.fromstring(content)
    out = []
    for it in root.iter("item"):
        title = html.unescape((it.findtext("title") or "").strip())
        desc = html.unescape(_TAG.sub(" ", it.findtext("description") or "")).strip()
        link = (it.findtext("link") or "").strip()
        s_el = it.find("source")
        src2 = (s_el.text or "").strip() if s_el is not None and s_el.text else src
        pub = it.findtext("pubDate") or ""
        try:
            ts = pd.to_datetime(pub, utc=True).tz_convert(TZ).tz_localize(None)
        except (ValueError, TypeError):
            ts = pd.Timestamp.now()
        if src2 != src and title.endswith(" - " + src2):     # Google News: "Tiêu đề - Tên báo"
            title = title[: -len(src2) - 3]
        out.append({"title": title, "desc": desc[:400], "link": link, "src": src2, "time": ts})
    return out


def _get(url: str, src: str) -> tuple[str, list[dict]]:
    try:
        r = requests.get(url, timeout=20, headers=UA)
        if r.status_code != 200:
            return src, []
        return src, _parse_rss(r.content, src)
    except Exception:  # noqa: BLE001
        return src, []


def fetch(symbols: set[str], focus: list[str], max_focus: int = 60, workers: int = 8, budget_sec: float = 150) -> tuple[pd.DataFrame, dict]:
    """→ (bảng tin gắn mã, thống kê theo nguồn)."""
    t0 = time.time()
    jobs = [(u, src) for src, L in FEEDS.items() for u in L]
    for s in focus[:max_focus]:
        q = f'"{s}"' + "".join(f' OR "{a}"' for a in ALIASES.get(s, [])[:2])
        jobs.append((f"https://news.google.com/rss/search?q={quote_plus(q + ' when:7d')}&hl=vi&gl=VN&ceid=VN:vi", "Google News"))
        if s in INTL:
            jobs.append((f"https://news.google.com/rss/search?q={quote_plus(chr(34) + INTL[s] + chr(34) + ' when:7d')}&hl=en-US&gl=US&ceid=US:en", "Google News (EN)"))
    items, stats = [], {}
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = [ex.submit(_get, u, src) for u, src in jobs]
        for f in as_completed(futs):
            src, L = f.result()
            stats[src] = stats.get(src, 0) + len(L)
            items += L
            if time.time() - t0 > budget_sec:
                break
    rows = []
    for x in items:
        text = f"{x['title']} {x['desc']}"
        syms = tag_symbols(text, symbols)
        if not syms:
            continue
        for s in syms:
            tag, sign, sev = classify_for(s, x["title"])
            rows.append({"symbol": s, "time": x["time"], "title": x["title"][:240], "link": x["link"], "src": x["src"], "tag": tag, "sign": sign, "sev": sev})
    df = pd.DataFrame(rows)
    if not df.empty:
        df["k"] = df["title"].str.lower().str.replace(r"\W+", " ", regex=True).str.strip()
        df = df.sort_values("time").drop_duplicates(["symbol", "k"], keep="first").drop(columns="k")
    return df, stats


def save(df: pd.DataFrame) -> pd.DataFrame:
    """Gộp vào kho tin (180 ngày), phân loại lại tin cũ chưa có nhãn, bỏ trùng theo mã + tiêu đề."""
    from . import store
    old = store.read("news")
    df = pd.concat([old, df], ignore_index=True) if not old.empty else df.copy()
    df["time"] = pd.to_datetime(df["time"])
    for c in ("tag", "sign", "sev"):
        if c not in df:
            df[c] = None
    cl = [classify_for(str(sy), str(t or "")) for sy, t in zip(df["symbol"], df["title"])]   # phân loại lại theo quy tắc hiện hành
    df["tag"] = [x[0] for x in cl]
    df["sign"] = [x[1] for x in cl]
    df["sev"] = [x[2] for x in cl]
    df["sev"] = pd.to_numeric(df["sev"], errors="coerce").fillna(0).astype(int)
    df["sign"] = pd.to_numeric(df["sign"], errors="coerce").fillna(0).astype(int)
    df["k"] = df["title"].fillna("").str.lower().str.replace(r"\W+", " ", regex=True).str.strip()
    df = df.sort_values("time").drop_duplicates(["symbol", "k"], keep="first").drop(columns="k")
    df = df[df["time"] >= pd.Timestamp.now() - pd.Timedelta(days=180)].reset_index(drop=True)
    # bỏ tin gắn nhầm mã trùng chữ viết tắt (USD/VND, TP.HCM, CEO…) của các lượt trước
    bad = df["symbol"].isin(AMBIG) & ~df.apply(lambda r: r["symbol"] in tag_symbols(str(r["title"]), {r["symbol"]}), axis=1) & (df["src"] != "Công bố thông tin")
    df = df[~bad].reset_index(drop=True)
    store.write("news", df)
    return df
