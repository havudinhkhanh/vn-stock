#!/usr/bin/env python3
"""VN-Stock – lệnh chạy.

  python run.py all            # tải dữ liệu + phân tích + xuất web (dùng hằng ngày)
  python run.py update         # chỉ tải dữ liệu
  python run.py build          # chỉ phân tích & xuất web từ dữ liệu đã có
  python run.py serve          # mở web trên máy: http://localhost:8000
  python run.py stock FPT      # in nhanh phân tích 1 mã ra màn hình
  python run.py probe          # kiểm tra các nguồn dữ liệu còn hoạt động không
  python run.py demo           # tạo dữ liệu GIẢ LẬP để xem thử giao diện (không phải dữ liệu thật)

Tuỳ chọn: --fin (bắt buộc tải lại BCTC), --backtest (chạy lại backtest), --no-backtest,
          --only FPT,VCB,HPG (chỉ chạy vài mã cho nhanh), --notify (gửi Telegram)
"""
from __future__ import annotations

import argparse
import logging
import sys


def main() -> None:
    ap = argparse.ArgumentParser(description="VN-Stock")
    ap.add_argument("cmd", choices=["all", "update", "build", "serve", "stock", "probe", "demo", "notify"])
    ap.add_argument("symbol", nargs="?")
    ap.add_argument("--fin", action="store_true")
    ap.add_argument("--backtest", action="store_true")
    ap.add_argument("--no-backtest", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--notify", action="store_true")
    ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                        datefmt="%H:%M:%S")
    only = [s.strip().upper() for s in a.only.split(",") if s.strip()] or None

    if a.cmd == "probe":
        if a.symbol == "intraday":
            from app.data import probe_intra
            probe_intra.run()
            return
        from app.data import probe
        rep = probe.run()
        bad = [k for k, v in rep.items() if isinstance(v, dict) and v.get("ok") is False]
        print(f"\n{len(bad)} nguồn lỗi: {bad}")
        return
    if a.cmd == "demo":
        from app import demo
        demo.make()
        from app import build
        build.run(force_backtest=True)
        print("Đã tạo dữ liệu giả lập. Chạy: python run.py serve")
        return
    if a.cmd in ("all", "update"):
        from app.data import update
        update.run(force_fin=a.fin, only=only)
    if a.cmd in ("all", "build"):
        from app import build
        # chạy thử vài mã: không chạy backtest để khỏi ghi đè kết quả của lần chạy đầy đủ
        res = build.run(skip_backtest=a.no_backtest or bool(only), force_backtest=a.backtest and not only, only=only)
        if a.notify or a.cmd == "all":
            from app import notify
            notify.send(res["today"], dry=not a.notify)
    if a.cmd == "notify":
        import json
        from app import config, notify
        today = json.loads((config.OUT_DIR / "today.json").read_text(encoding="utf-8"))
        notify.send(today)
    if a.cmd == "serve":
        import functools
        import http.server
        from app import config
        h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(config.SITE_DIR))
        print(f"Mở trình duyệt: http://localhost:{a.port}  (Ctrl+C để dừng)")
        http.server.ThreadingHTTPServer(("", a.port), h).serve_forever()
    if a.cmd == "stock":
        import json
        from app import config
        if not a.symbol:
            sys.exit("Ví dụ: python run.py stock FPT")
        p = config.OUT_DIR / "stocks" / f"{a.symbol.upper()}.json"
        if not p.exists():
            sys.exit(f"Chưa có phân tích cho {a.symbol}. Chạy: python run.py all --only {a.symbol}")
        d = json.loads(p.read_text(encoding="utf-8"))
        r, v, t = d["row"], d.get("valuation") or {}, d["ta"]
        print(f"\n{d['symbol']} – {d['name']} ({d['exchange']}, {d['industry']})")
        print(f"Giá {r['price']} | P/E {r['pe']} | P/B {r['pb']} | ROE {r['roe']}% | F-Score {r['fscore']}")
        print(f"Giá trị hợp lý {v.get('fair')} (vùng {v.get('fair_lo')}–{v.get('fair_hi')}) → {v.get('verdict')}")
        print(f"Mua dưới {v.get('buy_below')} | Kỹ thuật: {t.get('label')} ({t.get('score')}/100), {t.get('trend_vi')}")
        print(f"Điểm tổng hợp {r.get('composite')} | Rổ: {', '.join(d['baskets']) or '—'}")
        lv = d.get("levels") or {}
        print(f"Vùng mua {lv.get('zone')} | Cắt lỗ {lv.get('stop')} | Mục tiêu {lv.get('t1')} / {lv.get('t2')}")


if __name__ == "__main__":
    main()
