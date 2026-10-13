"""Bản tin công khai cho SEO: mỗi phiên một bài HTML tĩnh (đọc được không cần JavaScript), trang mục lục,
sitemap.xml, robots.txt, rss.xml, ảnh chia sẻ (Open Graph) và dữ liệu cấu trúc (NewsArticle, FAQPage, BreadcrumbList).

Nguồn: kho bản tin hằng ngày (data/digest/*.json do digest.py tạo). Mỗi lượt chạy dựng lại toàn bộ bài từ kho
→ đổi mẫu bài thì mọi bài cũ cập nhật theo. Không nêu khuyến nghị mua/bán cụ thể (thông tin thị trường chung)."""
from __future__ import annotations

import hashlib
import html
import json
import logging
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("blog")
E = html.escape
BASE = "ban-tin"
SITE_NAME = "VN-Stock"
PER_PAGE = 30
IDX_NAME = {"VNINDEX": "VN-Index", "VN30": "VN30", "HNXINDEX": "HNX-Index", "UPCOMINDEX": "UPCoM-Index"}
LIGHT = {"green": "Xanh", "yellow": "Vàng", "red": "Đỏ"}


def _v(x, nd=2):
    if x is None:
        return "–"
    try:
        x = float(x)
        x += (1e-9 if x >= 0 else -1e-9) * max(1.0, abs(x))      # làm tròn nửa lên như bản tin (13,85 → 13,9)
        return f"{x:,.{nd}f}".replace(",", "_").replace(".", ",").replace("_", ".")
    except (TypeError, ValueError):
        return "–"


def _p(x, nd=2, sign=True):
    if x is None:
        return "–"
    return ("+" if sign and float(x) > 0 else "") + _v(x, nd) + "%"


def _dmy(d: str) -> str:
    return f"{d[8:10]}/{d[5:7]}/{d[:4]}"


def slug(d: str) -> str:
    return f"chung-khoan-hom-nay-{d[8:10]}-{d[5:7]}-{d[:4]}"


def url_of(site: str, d: str) -> str:
    return f"{site}/{BASE}/{slug(d)}/"


class _Pick:
    """Chọn cách diễn đạt ổn định theo ngày (cùng ngày luôn ra cùng câu, các ngày khác nhau đa dạng)."""
    def __init__(self, seed: str):
        self.h = int(hashlib.md5(seed.encode()).hexdigest(), 16)
        self.i = 0

    def __call__(self, opts):
        self.i += 1
        return opts[(self.h >> (self.i * 3)) % len(opts)]


def _move(chg: float | None) -> str:
    if chg is None:
        return "đi ngang"
    a = abs(chg)
    if a < 0.1:
        return "gần như đứng giá"
    w = "tăng" if chg > 0 else "giảm"
    if a >= 2:
        return f"{w} mạnh {_v(a)}%"
    if a >= 1:
        return f"{w} {_v(a)}%"
    return f"{w} nhẹ {_v(a)}%"


def title_of(D: dict) -> str:
    vn = (D.get("indices") or {}).get("VNINDEX") or {}
    chg = vn.get("chg")
    verb = "tăng" if (chg or 0) > 0 else "giảm" if (chg or 0) < 0 else "đi ngang"
    t = f"Chứng khoán hôm nay {_dmy(D['date'])}: VN-Index {verb} {_v(abs(chg or 0))}% về {_v(vn.get('close'))} điểm"
    return t if (chg or 0) != 0 else f"Chứng khoán hôm nay {_dmy(D['date'])}: VN-Index đi ngang quanh {_v(vn.get('close'))} điểm"


def desc_of(D: dict) -> str:
    b = D.get("breadth") or {}
    secs = [s for s in (D.get("sectors") or []) if (s.get("n") or 0) >= 3]
    val = D.get("value") or {}
    parts = [D.get("headline") or title_of(D)]
    if b:
        parts.append(f"{b.get('adv', 0)} mã tăng, {b.get('dec', 0)} mã giảm")
    if secs:
        parts.append(f"ngành mạnh nhất {secs[0]['name']} {_p(secs[0]['chg'], 1)}")
    if val.get("today") and "thanh khoản" not in parts[0]:
        parts.append(f"thanh khoản {_v(val['today'], 1)} nghìn tỷ")
    s = "; ".join(parts[1:])
    out = f"{parts[0].rstrip('.')}. {s[:1].upper() + s[1:]}." if s else parts[0]
    return out[:300]


def _svg_line(pts: list[tuple[str, float]], w=760, h=200) -> str:
    """Biểu đồ đường VN-Index (SVG tĩnh, không cần JavaScript)."""
    if len(pts) < 5:
        return ""
    ys = [p[1] for p in pts]
    lo, hi = min(ys), max(ys)
    rg = (hi - lo) or 1
    P, B = 8, 22
    X = lambda i: P + i * (w - 2 * P - 48) / (len(pts) - 1)  # noqa: E731
    Y = lambda v: P + (1 - (v - lo) / rg) * (h - P - B)  # noqa: E731
    line = " ".join(f"{X(i):.1f},{Y(v):.1f}" for i, (_, v) in enumerate(pts))
    up = ys[-1] >= ys[0]
    col = "#39C98B" if up else "#F05A5E"
    ticks = "".join(f'<text x="{X(i):.0f}" y="{h - 5}" font-size="11" fill="#7C8696" text-anchor="middle">{d[8:10]}/{d[5:7]}</text>'
                    for i, (d, _) in enumerate(pts) if i % max(1, len(pts) // 6) == 0)
    return (f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Diễn biến VN-Index {len(pts)} phiên gần nhất" class="bchart">'
            f'<defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="{col}" stop-opacity=".28"/><stop offset="1" stop-color="{col}" stop-opacity="0"/></linearGradient></defs>'
            f'<polygon points="{X(0):.1f},{h - B} {line} {X(len(pts) - 1):.1f},{h - B}" fill="url(#g)"/>'
            f'<polyline points="{line}" fill="none" stroke="{col}" stroke-width="2"/>'
            f'<text x="{w - 44}" y="{Y(hi) + 4:.0f}" font-size="11" fill="#7C8696">{_v(hi, 0)}</text>'
            f'<text x="{w - 44}" y="{Y(lo) + 4:.0f}" font-size="11" fill="#7C8696">{_v(lo, 0)}</text>{ticks}</svg>')


def _bars(rows: list[tuple[str, float]], w=760) -> str:
    """Thanh ngang % thay đổi theo ngành (SVG)."""
    if not rows:
        return ""
    rh, h = 24, 24 * len(rows) + 8
    m = max(abs(v) for _, v in rows) or 1
    mid = 300
    out = [f'<svg viewBox="0 0 {w} {h}" role="img" aria-label="Thay đổi giá theo ngành" class="bchart">']
    for i, (n, v) in enumerate(rows):
        y = 6 + i * rh
        bw = abs(v) / m * (w - mid - 70)
        col = "#39C98B" if v >= 0 else "#F05A5E"
        out.append(f'<text x="{mid - 10}" y="{y + 15}" font-size="12.5" fill="#C9CFD8" text-anchor="end">{E(n[:38])}</text>'
                   f'<rect x="{mid}" y="{y + 4}" width="{max(2, bw):.1f}" height="14" rx="2" fill="{col}"/>'
                   f'<text x="{mid + max(2, bw) + 6:.1f}" y="{y + 15}" font-size="12" fill="{col}">{_p(v, 1)}</text>')
    out.append("</svg>")
    return "".join(out)


def _sym(s: str, names: dict) -> str:
    n = names.get(s)
    return f"<b>{E(s)}</b>" + (f' <span class="nm">({E(n)})</span>' if n else "")


def _short(name: str | None) -> str | None:
    if not name:
        return None
    n = str(name)
    for p in ("Tổng Công ty Cổ phần ", "Công ty Cổ phần Tập đoàn ", "Công ty Cổ phần ", "Ngân hàng Thương mại Cổ phần ", "Ngân hàng TMCP ",
              "Tổng Công ty ", "Tập đoàn ", "Công ty "):
        if n.startswith(p):
            n = n[len(p):]
            break
    for sfx in (" - Công ty Cổ phần", " – Công ty Cổ phần", " - CTCP", " – CTCP", " (CTCP)", " Công ty Cổ phần"):
        if n.endswith(sfx):
            n = n[:-len(sfx)]
    return n[:40]


def article(D: dict, prev: dict | None, nxt: dict | None, hist: list[tuple[str, float]], names: dict, site: str, recent: list[dict], og: str | None) -> tuple[str, dict]:
    d = D["date"]
    pick = _Pick(d)
    ix = D.get("indices") or {}
    vn = ix.get("VNINDEX") or {}
    b = D.get("breadth") or {}
    val = D.get("value") or {}
    reg = D.get("regime") or {}
    sent = D.get("sentiment") or {}
    secs = [s for s in (D.get("sectors") or []) if (s.get("n") or 0) >= 3]
    title = title_of(D)
    desc = desc_of(D)
    url = url_of(site, d)
    # chuỗi phiên tăng/giảm & so với 5, 20 phiên
    closes = [c for _, c in hist]
    streak, sgn = 0, 0
    for i in range(len(closes) - 1, 0, -1):
        s_ = 1 if closes[i] > closes[i - 1] else -1 if closes[i] < closes[i - 1] else 0
        if sgn == 0:
            sgn = s_
        if s_ != sgn or s_ == 0:
            break
        streak += 1
    c5 = (closes[-1] / closes[-6] - 1) * 100 if len(closes) > 6 else None
    c20 = (closes[-1] / closes[-21] - 1) * 100 if len(closes) > 21 else None
    hi52 = max(closes[-250:]) if closes else None

    # ---- mở bài
    p_open = [f"Kết thúc phiên giao dịch ngày {_dmy(d)}, VN-Index {_move(vn.get('chg'))}, đóng cửa ở mức <b>{_v(vn.get('close'))} điểm</b>."]
    if streak >= 2:
        p_open.append(f"Đây là phiên {'tăng' if sgn > 0 else 'giảm'} thứ {streak + 0} liên tiếp của chỉ số." if streak >= 2 else "")
    if c5 is not None:
        p_open.append(pick([f"Tính trong 5 phiên gần nhất, chỉ số {_move(c5)}", f"So với một tuần trước, VN-Index {_move(c5)}"])
                      + (f"; trong 20 phiên {_move(c20)}." if c20 is not None else "."))
    if hi52 and vn.get("close"):
        gap = (vn["close"] / hi52 - 1) * 100
        p_open.append("Chỉ số đang ở vùng đỉnh 52 tuần." if gap > -1 else f"Chỉ số còn cách đỉnh 52 tuần {_v(abs(gap), 1)}%.")
    oth = [f"{IDX_NAME.get(k, k)} {_move(v.get('chg'))} ({_v(v.get('close'))} điểm)" for k, v in ix.items() if k != "VNINDEX" and v.get("close")]
    if oth:
        p_open.append(pick(["Trên các chỉ số khác, ", "Ở các sàn còn lại, ", "Cùng phiên, "]) + ", ".join(oth) + ".")

    # ---- độ rộng & thanh khoản
    p_br = []
    if b:
        tot = (b.get("adv", 0) or 0) + (b.get("dec", 0) or 0) + (b.get("unch", 0) or 0)
        more = "bên bán chiếm ưu thế" if b.get("dec", 0) > b.get("adv", 0) * 1.2 else "bên mua chiếm ưu thế" if b.get("adv", 0) > b.get("dec", 0) * 1.2 else "hai bên khá cân bằng"
        p_br.append(f"Độ rộng thị trường cho thấy {more}: <b>{b.get('adv', 0)} mã tăng</b> ({b.get('ceil', 0)} mã tăng trần), "
                    f"<b>{b.get('dec', 0)} mã giảm</b> ({b.get('floor', 0)} mã giảm sàn) và {b.get('unch', 0)} mã đứng giá trên tổng số {tot} mã có giao dịch.")
        if b.get("above50") is not None:
            p_br.append(f"Chỉ {_v(b['above50'], 0)}% cổ phiếu thanh khoản đang nằm trên đường trung bình 50 phiên (MA50)." if b["above50"] < 40 else
                        f"{_v(b['above50'], 0)}% cổ phiếu thanh khoản đang nằm trên đường trung bình 50 phiên (MA50).")
        if b.get("new_hi") is not None:
            p_br.append(f"Số mã lập đỉnh mới 52 tuần là {b['new_hi']}, số mã lập đáy mới là {b.get('new_lo', 0)}.")
    if val.get("today"):
        rel = (val["today"] / val["avg20"] - 1) * 100 if val.get("avg20") else None
        cmp_ = "" if rel is None else (f", cao hơn trung bình 20 phiên {_v(rel, 0)}%" if rel > 8 else f", thấp hơn trung bình 20 phiên {_v(abs(rel), 0)}%" if rel < -8 else ", xấp xỉ trung bình 20 phiên")
        p_br.append(pick(["Thanh khoản", "Giá trị giao dịch khớp lệnh", "Dòng tiền tham gia"]) + f" đạt khoảng <b>{_v(val['today'], 1)} nghìn tỷ đồng</b>{cmp_}.")

    # ---- ngành
    p_sec = []
    if secs:
        top, bot = secs[:3], [s for s in secs[::-1] if (s.get("chg") or 0) < 0][:3]
        p_sec.append(pick(["Về nhóm ngành, ", "Xét theo ngành, ", "Phân hoá theo ngành, "]) + "dẫn đầu là " +
                     ", ".join(f"<b>{E(s['name'])}</b> ({_p(s['chg'], 1)}, {s.get('up', 0)}/{s.get('n', 0)} mã tăng)" for s in top) + ".")
        if bot:
            p_sec.append("Ở chiều ngược lại, " + ", ".join(f"<b>{E(s['name'])}</b> ({_p(s['chg'], 1)})" for s in bot) + " là những nhóm yếu nhất phiên.")
        best = [x for s in top for x in (s.get("best") or [])[:1]]
        if best:
            p_sec.append("Cổ phiếu nổi bật trong các ngành dẫn dắt: " + ", ".join(f"{_sym(x[0], names)} {_p(x[1], 1)}" for x in best) + ".")

    # ---- tác động chỉ số
    pu, pd_ = D.get("pull_up") or [], D.get("pull_dn") or []
    p_imp = []
    if pu:
        p_imp.append(pick(["Những cổ phiếu đóng góp tích cực nhất cho VN-Index gồm ", "Lực đỡ chính cho chỉ số đến từ ", "Nhóm kéo chỉ số đi lên gồm "]) +
                     ", ".join(f"{_sym(s, names)} (+{_v(p, 1)} điểm, {_p(c, 1)})" for s, p, c in pu[:4]) + ".")
    if pd_:
        p_imp.append(pick(["Ngược lại, áp lực lớn nhất đến từ ", "Chiều ngược lại, các mã gây sức ép lên chỉ số là ", "Phía giảm, đè nặng nhất lên chỉ số là "]) +
                     ", ".join(f"{_sym(s, names)} ({_v(p, 1)} điểm, {_p(c, 1)})" for s, p, c in pd_[:4]) + ".")

    # ---- tâm lý & đèn
    p_mood = []
    if sent.get("now") is not None:
        ch5 = sent.get("chg5")
        p_mood.append(f"Chỉ số tâm lý thị trường của VN-Stock (thang 0–100, tổng hợp độ rộng, đà giá, thanh khoản) ở mức <b>{_v(sent['now'], 0)}</b> – "
                      f"{E(str(sent.get('label') or '').lower())}" + (f", {'tăng' if ch5 > 0 else 'giảm'} {_v(abs(ch5), 0)} điểm so với 5 phiên trước" if ch5 else "") + ".")
    if reg.get("light"):
        p_mood.append(f"Đèn thị trường đang ở trạng thái <b>{LIGHT.get(reg['light'], reg['light'])}</b> ({reg.get('score')}/{reg.get('max_score')} điều kiện kỹ thuật đạt): "
                      f"{E(reg.get('text') or '')}")
    fl = D.get("flow") or {}
    if fl.get("count"):
        c = fl["count"]
        p_mood.append(f"Về dòng tiền lớn, hệ thống ghi nhận {c.get('acc', 0)} mã có dấu hiệu gom hàng âm thầm, {c.get('dist', 0)} mã có dấu hiệu phân phối và "
                      f"{c.get('brk', 0)} mã bứt phá kèm khối lượng lớn.")

    # ---- bảng
    def tbl(head, rows, cls=""):
        return (f'<div class="tw"><table class="{cls}"><thead><tr>{"".join(f"<th>{h}</th>" for h in head)}</tr></thead><tbody>'
                + "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in rows) + "</tbody></table></div>")
    t_ix = tbl(["Chỉ số", "Đóng cửa", "Thay đổi"], [[E(IDX_NAME.get(k, k)), _v(v.get("close")), f'<span class="{"up" if (v.get("chg") or 0) > 0 else "down" if (v.get("chg") or 0) < 0 else ""}">{_p(v.get("chg"))}</span>']
                                                    for k, v in ix.items() if v.get("close")])
    mv = lambda L: [[_sym(x["s"], names), _v(x.get("price")), f'<span class="{"up" if x["chg"] > 0 else "down"}">{_p(x["chg"], 1)}</span>', E(x.get("sector") or ""), _v(x.get("val"), 0)] for x in L[:8]]  # noqa: E731
    t_up = tbl(["Mã", "Giá", "Thay đổi", "Ngành", "GTGD (tỷ)"], mv(D.get("gainers") or []))
    t_dn = tbl(["Mã", "Giá", "Thay đổi", "Ngành", "GTGD (tỷ)"], mv(D.get("losers") or []))
    unu = D.get("unusual") or []
    t_unu = tbl(["Mã", "Giá", "Thay đổi", "KL so với TB 20 phiên"], [[_sym(x["s"], names), _v(x.get("price")), f'<span class="{"up" if x["chg"] > 0 else "down" if x["chg"] < 0 else ""}">{_p(x["chg"], 1)}</span>', f'{_v(x.get("vx"), 1)} lần'] for x in unu[:8]]) if unu else ""
    evs = [e for e in (D.get("events") or []) if e.get("symbol")][:10]
    t_ev = tbl(["Ngày", "Mã", "Sự kiện"], [[_dmy(e["date"]), _sym(e["symbol"], names), E(e["title"])] for e in evs]) if evs else ""
    chart = _svg_line(hist[-60:])
    bars = _bars([(s["name"], s["chg"]) for s in (secs[:6] + [x for x in secs[::-1] if x["chg"] < 0][:4][::-1]) if s.get("chg") is not None]) if secs else ""

    # ---- hỏi đáp (FAQ – cũng đưa vào dữ liệu cấu trúc)
    faq = [(f"VN-Index hôm nay {_dmy(d)} tăng hay giảm?", f"VN-Index {_move(vn.get('chg'))}, đóng cửa ở {_v(vn.get('close'))} điểm.")]
    if b:
        faq.append((f"Phiên {_dmy(d)} có bao nhiêu mã tăng, giảm?", f"{b.get('adv', 0)} mã tăng ({b.get('ceil', 0)} mã trần), {b.get('dec', 0)} mã giảm ({b.get('floor', 0)} mã sàn), {b.get('unch', 0)} mã đứng giá."))
    if secs:
        faq.append((f"Ngành nào tăng mạnh nhất ngày {_dmy(d)}?", f"{secs[0]['name']} tăng {_v(secs[0]['chg'], 1)}%, tiếp theo là " + ", ".join(f"{s['name']} ({_p(s['chg'], 1)})" for s in secs[1:3]) + "."))
    if pu:
        faq.append(("Cổ phiếu nào tác động mạnh nhất tới VN-Index?", "Kéo chỉ số: " + ", ".join(f"{s} (+{_v(p, 1)} điểm)" for s, p, _ in pu[:3]) +
                    ("; đè chỉ số: " + ", ".join(f"{s} ({_v(p, 1)} điểm)" for s, p, _ in pd_[:3]) if pd_ else "") + "."))
    if val.get("today"):
        faq.append((f"Thanh khoản thị trường ngày {_dmy(d)} là bao nhiêu?", f"Khoảng {_v(val['today'], 1)} nghìn tỷ đồng" + (f", trung bình 20 phiên {_v(val.get('avg20'), 1)} nghìn tỷ." if val.get("avg20") else ".")))

    P = lambda L: "".join(f"<p>{x}</p>" for x in L if x)  # noqa: E731
    nav = (f'<nav class="pn">' + (f'<a rel="prev" href="/{BASE}/{slug(prev["date"])}/">← {E(title_of(prev))}</a>' if prev else "<span></span>")
           + (f'<a rel="next" href="/{BASE}/{slug(nxt["date"])}/">{E(title_of(nxt))} →</a>' if nxt else "<span></span>") + "</nav>")
    rel = "".join(f'<li><a href="/{BASE}/{slug(x["date"])}/">{E(title_of(x))}</a></li>' for x in recent if x["date"] != d)[:6000]
    body = f"""
<article class="post">
  <header class="ph"><p class="crumb"><a href="/{BASE}/">Bản tin chứng khoán</a> › {_dmy(d)}</p>
    <h1>{E(title)}</h1>
    <p class="meta"><time datetime="{d}">{_dmy(d)}</time> · Tổng hợp tự động sau phiên từ dữ liệu giao dịch HOSE, HNX, UPCoM</p>
    <p class="lead">{E(D.get('headline') or '')}</p></header>
  <section class="kpis">{''.join(f'<div><span>{E(IDX_NAME.get(k, k))}</span><b>{_v(v.get("close"))}</b><i class="{"up" if (v.get("chg") or 0) > 0 else "down" if (v.get("chg") or 0) < 0 else ""}">{_p(v.get("chg"))}</i></div>' for k, v in ix.items() if v.get("close"))}</section>
  {chart}
  <h2>Diễn biến VN-Index phiên {_dmy(d)}</h2><p>{" ".join(x for x in p_open if x)}</p>{t_ix}
  {f'<h2>Độ rộng và thanh khoản</h2><p>{" ".join(p_br)}</p>' if p_br else ''}
  {f'<h2>Nhóm ngành nổi bật</h2>{P(p_sec)}{bars}' if p_sec else ''}
  {f'<h2>Cổ phiếu tác động mạnh tới VN-Index</h2>{P(p_imp)}' if p_imp else ''}
  <h2>Cổ phiếu tăng mạnh nhất</h2>{t_up}
  <h2>Cổ phiếu giảm mạnh nhất</h2>{t_dn}
  {f'<h2>Khối lượng giao dịch đột biến</h2><p>Các mã có khối lượng khớp lệnh cao bất thường so với trung bình 20 phiên – thường là dấu hiệu dòng tiền lớn đang hành động.</p>{t_unu}' if t_unu else ''}
  {f'<h2>Tâm lý thị trường và dòng tiền</h2>{P(p_mood)}' if p_mood else ''}
  {f'<h2>Lịch sự kiện sắp tới</h2>{t_ev}' if t_ev else ''}
  <aside class="cta"><h3>Muốn biết nên làm gì với danh mục của mình?</h3>
    <p>VN-Stock phân tích hơn 400 cổ phiếu mỗi ngày: định giá (P/E, P/B, DCF), vùng mua – cắt lỗ, danh sách cổ phiếu đạt điều kiện, cảnh báo khi mã anh/chị đang nắm chạm mức thoát, báo cáo tuần.</p>
    <a class="btn" href="/login#signup">Đăng ký tài khoản</a> <a class="btn ghost" href="/login">Đăng nhập</a></aside>
  <h2>Câu hỏi thường gặp</h2>
  <div class="faq">{''.join(f'<details><summary>{E(q)}</summary><p>{E(a)}</p></details>' for q, a in faq)}</div>
  <p class="disc">Bài viết được tổng hợp tự động từ dữ liệu giao dịch, chỉ mang tính thông tin, không phải khuyến nghị mua bán chứng khoán. Nhà đầu tư tự chịu trách nhiệm với quyết định của mình.</p>
  {nav}
  {f'<h2>Bản tin các phiên gần đây</h2><ul class="rel">{rel}</ul>' if rel else ''}
</article>"""
    ld = [{"@context": "https://schema.org", "@type": "NewsArticle", "headline": title[:110], "description": desc, "datePublished": f"{d}T16:30:00+07:00",
           "dateModified": datetime.now(timezone.utc).isoformat(timespec="seconds"), "inLanguage": "vi", "mainEntityOfPage": url,
           "author": {"@type": "Organization", "name": SITE_NAME, "url": site}, "publisher": {"@type": "Organization", "name": SITE_NAME, "url": site},
           **({"image": [og]} if og else {}), "articleSection": "Chứng khoán", "keywords": "chứng khoán hôm nay, VN-Index, thị trường chứng khoán, nhận định chứng khoán"},
          {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]},
          {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
              {"@type": "ListItem", "position": 1, "name": "Bản tin chứng khoán", "item": f"{site}/{BASE}/"},
              {"@type": "ListItem", "position": 2, "name": _dmy(d), "item": url}]}]
    return page(title, desc, url, body, ld, og, kind="article", date=d), {"date": d, "title": title, "desc": desc, "url": url}


def page(title: str, desc: str, url: str, body: str, ld: list, og: str | None, kind="website", date=None, extra_head="") -> str:
    verify = os.environ.get("GOOGLE_SITE_VERIFICATION")
    return f"""<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)} | {SITE_NAME}</title>
<meta name="description" content="{E(desc)}">
<link rel="canonical" href="{E(url)}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="{kind}"><meta property="og:site_name" content="{SITE_NAME}"><meta property="og:locale" content="vi_VN">
<meta property="og:title" content="{E(title)}"><meta property="og:description" content="{E(desc)}"><meta property="og:url" content="{E(url)}">
{f'<meta property="og:image" content="{E(og)}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' if og else ''}
<meta name="twitter:card" content="{'summary_large_image' if og else 'summary'}">
{f'<meta property="article:published_time" content="{date}T16:30:00+07:00">' if date else ''}
{f'<meta name="google-site-verification" content="{E(verify)}">' if verify else ''}
<link rel="alternate" type="application/rss+xml" title="Bản tin chứng khoán {SITE_NAME}" href="/rss.xml">
<link rel="icon" href="/icon.svg">
<link rel="stylesheet" href="/{BASE}/blog.css">
{extra_head}
{''.join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)}
</head>
<body>
<header class="top"><a class="brand" href="/{BASE}/"><span class="dot"></span>{SITE_NAME}</a><nav><a href="/{BASE}/">Bản tin</a><a href="/login">Đăng nhập</a><a class="btn sm" href="/login#signup">Đăng ký</a></nav></header>
<main>{body}</main>
<footer><p>© {datetime.now().year} {SITE_NAME} · Bản tin chứng khoán Việt Nam tự động sau mỗi phiên · <a href="/rss.xml">RSS</a> · <a href="/sitemap.xml">Sitemap</a></p></footer>
</body>
</html>"""


def og_image(D: dict, path: Path) -> bool:
    """Ảnh chia sẻ 1200×630 (Facebook, Zalo, LinkedIn). Cần Pillow + phông DejaVu (có sẵn trên máy chạy Ubuntu)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return False
    fonts = ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    if not all(Path(f).exists() for f in fonts):
        return False
    vn = (D.get("indices") or {}).get("VNINDEX") or {}
    chg = vn.get("chg") or 0
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), (11, 17, 25))
    dr = ImageDraw.Draw(im)
    fb, fr = (lambda s: ImageFont.truetype(fonts[0], s)), (lambda s: ImageFont.truetype(fonts[1], s))
    brass, ivory, mute = (203, 167, 101), (236, 230, 217), (140, 150, 164)
    col = (57, 201, 139) if chg > 0 else (240, 90, 94) if chg < 0 else (240, 204, 72)
    dr.rectangle([0, 0, W, 10], fill=brass)
    dr.text((70, 60), "VN-Stock · Bản tin chứng khoán", font=fr(34), fill=brass)
    dr.text((70, 120), f"Phiên {_dmy(D['date'])}", font=fb(46), fill=ivory)
    dr.text((70, 215), "VN-Index", font=fr(40), fill=mute)
    dr.text((70, 265), _v(vn.get("close")), font=fb(150), fill=ivory)
    dr.text((70, 440), ("▲ " if chg > 0 else "▼ " if chg < 0 else "■ ") + _p(chg), font=fb(70), fill=col)
    b = D.get("breadth") or {}
    if b:
        dr.text((70, 545), f"{b.get('adv', 0)} mã tăng · {b.get('dec', 0)} mã giảm · thanh khoản {_v((D.get('value') or {}).get('today'), 1)} nghìn tỷ", font=fr(32), fill=mute)
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    return True


def build(site_dir: Path, store, idx_close, names: dict | None = None) -> int:
    site = (os.environ.get("SITE_URL") or "https://vn-stock.pages.dev").rstrip("/")
    arch = store.path("digest")
    D = []
    for f in sorted(arch.glob("*.json")):
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            if j.get("date") and (j.get("indices") or {}).get("VNINDEX"):
                D.append(j)
        except ValueError:
            continue
    if not D:
        return 0
    names = {k: _short(v) for k, v in (names or {}).items()}
    out = site_dir / BASE
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    css = Path(__file__).resolve().parent / "blog.css"         # nguồn nằm ngoài site/ban-tin (thư mục này dựng lại mỗi lượt)
    if css.exists():
        shutil.copy(css, out / "blog.css")
    hist_all = [(str(t.date()), float(v)) for t, v in idx_close.dropna().items()] if idx_close is not None else []
    meta = []
    for i, j in enumerate(D):
        d = j["date"]
        hist = [x for x in hist_all if x[0] <= d][-260:]
        og_path = out / "og" / f"{d}.png"
        og = f"{site}/{BASE}/og/{d}.png" if og_image(j, og_path) else None
        recent = D[max(0, i - 6):i][::-1]
        html_, m = article(j, D[i - 1] if i > 0 else None, D[i + 1] if i + 1 < len(D) else None, hist, names, site, recent, og)
        p = out / slug(d)
        p.mkdir(parents=True, exist_ok=True)
        (p / "index.html").write_text(html_, encoding="utf-8")
        meta.append(m)
    meta = meta[::-1]
    # ---- mục lục (phân trang)
    pages = [meta[i:i + PER_PAGE] for i in range(0, len(meta), PER_PAGE)]
    for k, chunk in enumerate(pages):
        u_ = f"{site}/{BASE}/" + (f"trang-{k + 1}/" if k else "")
        items = "".join(f'<li><a href="/{BASE}/{slug(m["date"])}/"><time datetime="{m["date"]}">{_dmy(m["date"])}</time><b>{E(m["title"])}</b><span>{E(m["desc"])}</span></a></li>' for m in chunk)
        pg = "".join(f'<a class="{"on" if n == k else ""}" href="/{BASE}/{"" if n == 0 else f"trang-{n + 1}/"}">{n + 1}</a>' for n in range(len(pages))) if len(pages) > 1 else ""
        body = f"""<section class="hero"><h1>Bản tin chứng khoán hằng ngày</h1>
          <p class="lead">Tổng hợp diễn biến thị trường chứng khoán Việt Nam sau mỗi phiên: VN-Index, độ rộng, thanh khoản, nhóm ngành dẫn dắt,
          cổ phiếu tác động mạnh, mã tăng giảm mạnh, khối lượng đột biến và lịch sự kiện – cập nhật lúc 16h30 các ngày giao dịch.</p></section>
          {('<section class="latest">' + _svg_line(hist_all[-120:]) + '</section>') if k == 0 and hist_all else ''}
          <ul class="list">{items}</ul>{f'<nav class="pg">{pg}</nav>' if pg else ''}"""
        ld = [{"@context": "https://schema.org", "@type": "CollectionPage", "name": "Bản tin chứng khoán hằng ngày", "url": u_, "inLanguage": "vi",
               "hasPart": [{"@type": "NewsArticle", "headline": m["title"][:110], "url": m["url"], "datePublished": f"{m['date']}T16:30:00+07:00"} for m in chunk[:10]]}]
        tgt = out if k == 0 else out / f"trang-{k + 1}"
        tgt.mkdir(parents=True, exist_ok=True)
        og0 = f"{site}/{BASE}/og/{chunk[0]['date']}.png" if (out / "og" / f"{chunk[0]['date']}.png").exists() else None
        (tgt / "index.html").write_text(page("Bản tin chứng khoán hằng ngày – VN-Index, ngành, cổ phiếu nổi bật" + (f" (trang {k + 1})" if k else ""),
                                             "Tổng hợp thị trường chứng khoán Việt Nam sau mỗi phiên: VN-Index, độ rộng, thanh khoản, ngành dẫn dắt, cổ phiếu tăng giảm mạnh, khối lượng đột biến, lịch sự kiện.",
                                             u_, body, ld, og0), encoding="utf-8")
    # ---- sitemap, robots, rss
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    urls = [(f"{site}/{BASE}/", now, "daily", "1.0")] + [(m["url"], m["date"], "monthly", "0.8") for m in meta] + [(f"{site}/{BASE}/trang-{k + 1}/", now, "daily", "0.5") for k in range(1, len(pages))]
    (site_dir / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
                                          + "".join(f"<url><loc>{E(u_)}</loc><lastmod>{lm}</lastmod><changefreq>{cf}</changefreq><priority>{pr}</priority></url>\n" for u_, lm, cf, pr in urls)
                                          + "</urlset>\n", encoding="utf-8")
    (site_dir / "robots.txt").write_text(f"User-agent: *\nAllow: /{BASE}/\nAllow: /sitemap.xml\nAllow: /rss.xml\nDisallow: /data/\nDisallow: /api/\nDisallow: /login\n\nSitemap: {site}/sitemap.xml\n", encoding="utf-8")
    rss_items = "".join(f"<item><title>{E(m['title'])}</title><link>{E(m['url'])}</link><guid>{E(m['url'])}</guid>"
                        f"<pubDate>{datetime.strptime(m['date'], '%Y-%m-%d').strftime('%a, %d %b %Y')} 16:30:00 +0700</pubDate><description>{E(m['desc'])}</description></item>" for m in meta[:30])
    (site_dir / "rss.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>Bản tin chứng khoán {SITE_NAME}</title><link>{site}/{BASE}/</link>'
                                      f"<description>Tổng hợp thị trường chứng khoán Việt Nam sau mỗi phiên</description><language>vi</language>{rss_items}</channel></rss>\n", encoding="utf-8")
    log.info("Bản tin công khai: %d bài, %d trang mục lục", len(meta), len(pages))
    return len(meta)
