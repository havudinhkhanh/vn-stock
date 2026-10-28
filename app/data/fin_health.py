"""Sức khoẻ dữ liệu BCTC & định giá (kiểu nhật ký chẩn đoán của my-bit): mỗi lượt build đếm mã thiếu BCTC, thiếu chỉ tiêu,
BCTC chậm kỳ, không định giá được – kèm lý do – ghi ra data/fin_health.json (đẩy lên nhánh status) và site/data/health.json
(trang Dữ liệu cho admin). Mục tiêu: 100% mã có BCTC, có số liệu, có định giá (hoặc lý do rõ vì sao không)."""
from __future__ import annotations

import logging
from datetime import date

import numpy as np
import pandas as pd

log = logging.getLogger("health")

KEY = ("revenue", "net_income", "total_assets", "equity", "shares")
LABEL = {"revenue": "doanh thu", "net_income": "LNST", "total_assets": "tổng tài sản", "equity": "vốn chủ", "shares": "số CP",
         "pbt": "LN trước thuế", "cfo": "dòng tiền KD"}
DERIVED = {"equity": "vốn chủ = tổng tài sản − nợ phải trả", "pbt": "LN trước thuế = LNST + thuế TNDN",
           "shares": "số CP = vốn góp ÷ mệnh giá 10.000đ"}


def expected_quarter(today: date) -> tuple[int, int]:
    """Quý gần nhất mà mọi DN phải công bố BCTC: hạn chậm nhất ~45 ngày + vài ngày đăng tải → quý kết thúc ≥ 50 ngày trước."""
    y, m = today.year, today.month
    q = (m - 1) // 3          # quý vừa kết thúc
    if q == 0:
        y, q = y - 1, 4
    end = pd.Timestamp(year=y, month=3 * q, day=1) + pd.offsets.MonthEnd(0)
    if (pd.Timestamp(today) - end).days < 50:
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return y, q


def links(sym: str, news: pd.DataFrame | None) -> list[dict]:
    """Nguồn gốc BCTC: tin công bố BCTC của chính mã (link trực tiếp) + trang tải tài liệu."""
    out = []
    if news is not None and not news.empty:
        m = news[news["title"].astype(str).str.contains(r"(?i)báo cáo tài chính|\bBCTC\b|financial statement", regex=True)]
        for x in m.sort_values("time", ascending=False).head(4).itertuples():
            if getattr(x, "link", None):
                out.append({"t": "Tin công bố: " + str(x.title)[:90], "u": x.link, "d": str(pd.Timestamp(x.time).date())})
    out += [{"t": "Tải BCTC gốc (PDF) – Vietstock", "u": f"https://finance.vietstock.vn/{sym}/tai-tai-lieu.htm"},
            {"t": "Bảng BCTC chi tiết – Vietstock", "u": f"https://finance.vietstock.vn/{sym}/tai-chinh.htm"}]
    return out


def block(sym: str, qs: pd.DataFrame | None, ys: pd.DataFrame | None, news: pd.DataFrame | None, today: date, ctype: str = "CT") -> dict:
    """Thông tin BCTC cho trang mã: kỳ gần nhất, nguồn, chỉ tiêu suy ra, chậm kỳ, link."""
    ey, eq = expected_quarter(today)
    b = {"links": links(sym, news), "expected": f"Q{eq}/{ey}"}
    src = qs if qs is not None and not qs.empty else ys
    if src is None or src.empty:
        b.update(ok=False, why="Chưa tải được BCTC của mã này từ Vietcap/KBS – hệ thống thử lại mỗi lượt chạy.")
        return b
    L = src.sort_values(["year", "quarter"]).iloc[-1]
    q = int(L.get("quarter") or 0)
    b.update(ok=True, period=f"Q{q}/{int(L['year'])}" if q else f"Năm {int(L['year'])}", source=str(L.get("source") or ""),
             n_q=int(len(qs)) if qs is not None else 0, n_y=int(len(ys)) if ys is not None else 0)
    dv = str(L.get("derived") or "").split() if isinstance(L.get("derived"), str) else []
    if dv:
        b["derived"] = [DERIVED[k] for k in dv if k in DERIVED]
    na = lambda k: k not in L or L[k] is None or (isinstance(L[k], float) and np.isnan(L[k]))  # noqa: E731
    keys = KEY if ctype == "CT" else tuple(k for k in KEY if k != "revenue")   # NH/CTCK/BH: không có "doanh thu thuần"
    miss = [LABEL[k] for k in keys if na(k)]
    if ctype != "CT" and na("toi") and na("nii") and na("revenue"):
        miss.insert(0, "tổng thu nhập HĐ")
    if miss:
        b["missing"] = miss
    if q and (int(L["year"]), q) < (ey, eq):
        b["late"] = f"Kỳ gần nhất {b['period']} – chậm so với Q{eq}/{ey} (DN chưa công bố hoặc nguồn chưa cập nhật)"
    return b


def report(u: pd.DataFrame, details: dict, fq_by: dict, fy_by: dict, today: date) -> dict:
    ey, eq = expected_quarter(today)
    rows = []
    for s in u.index:
        d = details.get(s) or {}
        qs, ys = fq_by.get(s), fy_by.get(s)
        has = (qs is not None and not qs.empty) or (ys is not None and not ys.empty)
        val = d.get("val") or {}
        fa = d.get("fa") or {}
        bl = block(s, qs, ys, None, today, str(u.at[s, "ctype"]) if "ctype" in u else "CT") if has else {"ok": False}
        rows.append({"s": s, "fin": has, "period": bl.get("period"), "src": bl.get("source"), "late": bool(bl.get("late")),
                     "missing": bl.get("missing") or [], "derived": bool(bl.get("derived")), "page": s in details,
                     "val": bool(val.get("ok")), "reliable": bool(val.get("reliable")),
                     "why": (val.get("reason") if not val.get("ok") else None) or (fa.get("reason") if not fa.get("ok") else None),
                     "liq": float(u.at[s, "avg_value_bn"]) if "avg_value_bn" in u and pd.notna(u.at[s, "avg_value_bn"]) else 0.0})
    df = pd.DataFrame(rows)
    n = len(df)
    c = {"symbols": n, "pages": int(df["page"].sum()), "with_fin": int(df["fin"].sum()), "late": int(df["late"].sum()),
         "missing": int((df["missing"].str.len() > 0).sum()), "derived": int(df["derived"].sum()),
         "valued": int(df["val"].sum()), "reliable": int(df["reliable"].sum()),
         "src": df["src"].fillna("–").value_counts().to_dict(), "expected": f"Q{eq}/{ey}"}
    why = df.loc[~df["val"] & df["fin"], "why"].fillna("không rõ").value_counts().head(12).to_dict()
    lst = lambda m, k=60: df[m].sort_values("liq", ascending=False)["s"].head(k).tolist()  # noqa: E731
    out = {"at": str(today), "count": c, "no_val_why": why,
           "no_fin": lst(~df["fin"], 300), "late": lst(df["late"]), "missing": lst(df["missing"].str.len() > 0),
           "no_val": lst(~df["val"] & df["fin"], 120),
           "detail": {r.s: {k: getattr(r, k) for k in ("period", "src", "missing", "why")} for r in df[(~df["fin"]) | (~df["val"]) | df["late"] | (df["missing"].str.len() > 0)].itertuples()}}
    log.info("Sức khoẻ BCTC: %d mã · có BCTC %d (%.0f%%) · chậm kỳ (< %s) %d · thiếu chỉ tiêu %d · có định giá %d (%.0f%%), đáng tin %d · nguồn %s",
             n, c["with_fin"], 100 * c["with_fin"] / max(n, 1), c["expected"], c["late"], c["missing"], c["valued"],
             100 * c["valued"] / max(n, 1), c["reliable"], c["src"])
    if why:
        log.info("  Lý do chưa định giá: %s", "; ".join(f"{k} ({v})" for k, v in why.items()))
    if out["no_fin"]:
        log.info("  Chưa có BCTC (%d): %s", len(out["no_fin"]), ", ".join(out["no_fin"][:40]))
    return out
