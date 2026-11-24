"""Dựng riêng phần "Giá theo lợi nhuận / doanh thu" vào phần web đã dựng (site/data) – dùng ở lượt "Đăng web nhanh" để có số thật ngay,
không cần chờ lượt đầy đủ (lượt đầy đủ vẫn tự dựng phần này trong build.py). Không tải dữ liệu, không gửi thông báo.
Chạy: python -m app.fundcorr_site"""
from __future__ import annotations

import json
import logging
import sys

import pandas as pd

from . import config
from .analysis import fundcorr as fcr_
from .analysis import peers as pr_
from .build import dump
from .data import store

log = logging.getLogger("fundcorr_site")
INDEX_SYMS = {"VNINDEX", "VN30", "HNXINDEX", "UPCOMINDEX", "HNX30"}


def main() -> int:
    out = config.OUT_DIR
    prices, fin_q, listing = store.read("prices"), store.read("fin_q"), store.read("listing")
    if prices.empty or fin_q.empty or listing.empty or not (out / "meta.json").exists():
        log.warning("Thiếu dữ liệu hoặc chưa có phần web đã dựng – bỏ qua")
        return 0
    prices["date"] = pd.to_datetime(prices["date"])
    idx = prices[prices["symbol"] == "VNINDEX"].set_index("date")["close"].sort_index()
    wide = prices[~prices["symbol"].isin(INDEX_SYMS)].pivot_table(index="date", columns="symbol", values="close").sort_index().ffill(limit=5)
    u = listing.set_index("symbol").copy()
    for c in ("sector", "industry", "subindustry", "name", "com_type"):
        if c not in u:
            u[c] = None
    u["sector"] = u["sector"].fillna("Khác"); u["industry"] = u["industry"].fillna(u["sector"])
    u = pr_.assign_all(u)
    u["peer_label"] = u["peer"].map(pr_.label)
    # nhóm so sánh & ngành đúng như web đang hiện (gồm cả nhóm anh tự đổi) – lấy từ bảng Bộ lọc đã dựng
    try:
        sc = json.loads((out / "screener.json").read_text(encoding="utf-8"))
        ix = {c: i for i, c in enumerate(sc["cols"])}
        for r in sc["rows"]:
            s = r[ix["symbol"]]
            if s in u.index:
                for c in ("peer_label", "sector"):
                    if c in ix and r[ix[c]]:
                        u.at[s, c] = r[ix[c]]
    except Exception as e:  # noqa: BLE001
        log.warning("Không đọc được screener.json: %s", e)
    u["ctype"] = u["com_type"].fillna("CT")
    pub, rows, det = fcr_.build(wide, idx, fin_q, u)
    if not pub:
        log.warning("Không dựng được bảng tương quan")
        return 0
    asof = json.loads((out / "meta.json").read_text(encoding="utf-8")).get("data_date") or str(idx.index[-1].date())
    pub["asof"] = asof
    dump(out / "fundcorr.json", pub)
    dump(out / "fundcorr_s.json", {"asof": asof, "cols": rows[0], "rows": rows[1:], "rel": pub.get("rel")})
    n = 0
    for p in (out / "stocks").glob("*.json"):
        s = p.stem
        if s not in det:
            continue
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            d["fc"] = det[s]
            dump(p, d)
            n += 1
        except Exception as e:  # noqa: BLE001
            log.warning("Ghi %s lỗi: %s", s, e)
    log.info("Đã ghi bảng tương quan: %d nhóm so sánh, %d ngành, %d mã có khung ở trang mã", len(pub["groups"]["peer"]), len(pub["groups"]["sector"]), n)
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", datefmt="%H:%M:%S")
    sys.exit(main())
