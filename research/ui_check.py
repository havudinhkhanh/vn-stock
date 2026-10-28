"""Kiểm tra giao diện điện thoại trên dữ liệu THẬT: dựng trang, mở bằng WebKit (lõi Safari/iPhone) và Chromium,
tìm phần tử tràn ngang / viền lạ ở mép phải, chụp ảnh. Kết quả ở research_out/ui/ (nhánh status → research/).
Chạy trên GitHub qua research.yml với script=ui_check."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

OUT = os.path.join("research_out", "ui")
ROUTES = os.environ.get("UI_ROUTES", "#/,#/market,#/screener,#/watch,#/portfolio,#/swing,#/sector,#/digest,#/s/FPT,#/s/PVT,#/s/VCB,#/s/HPG").split(",")

PROBE = r"""() => {
  const W = document.documentElement.clientWidth, H = innerHeight, bad = [], edge = [];
  for (const e of document.querySelectorAll('body *')) {
    const R = e.getBoundingClientRect(); if (!R.width || !R.height) continue;
    const c = getComputedStyle(e);
    if (R.right > W + 1 && c.position !== 'fixed') {
      let p = e.parentElement, clip = false;
      while (p && p !== document.body) { const o = getComputedStyle(p); if (/(hidden|auto|scroll|clip)/.test(o.overflowX) && p.getBoundingClientRect().right <= W + 1) { clip = true; break; } p = p.parentElement; }
      if (!clip) bad.push(e.tagName + '.' + String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className).slice(0, 40) + ' r=' + Math.round(R.right) + ' w=' + Math.round(R.width));
    }
    if (R.right >= W - 14 && R.right <= W + 1 && R.height > 120 && (c.borderRightWidth !== '0px' || c.outlineStyle !== 'none' || c.boxShadow !== 'none'))
      edge.push(e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 30) + ' r=' + Math.round(R.right) + ' h=' + Math.round(R.height) + ' br=' + c.borderRightWidth + ' ' + c.borderRightColor + ' ol=' + c.outlineStyle + ' sh=' + c.boxShadow.slice(0, 30));
  }
  return { W, iw: innerWidth, sw: document.documentElement.scrollWidth, bsw: document.body.scrollWidth, bad: bad.slice(0, 15), edge: edge.slice(0, 15), active: document.activeElement && (document.activeElement.tagName + '#' + document.activeElement.id) };
}"""


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    if os.environ.get("UI_SKIP_BUILD") != "1":
        from app import build
        build.run(skip_backtest=True)
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "playwright"], check=True)
    subprocess.run([sys.executable, "-m", "playwright", "install", "--with-deps", "webkit", "chromium"], check=True)
    srv = ThreadingHTTPServer(("127.0.0.1", 8799), partial(SimpleHTTPRequestHandler, directory="site"))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    from playwright.sync_api import sync_playwright
    rep = {}
    with sync_playwright() as pw:
        for eng in ("webkit", "chromium"):
            br = getattr(pw, eng).launch()
            for dev in ("iPhone 13", "iPhone 13 landscape"):
                ctx = br.new_context(**pw.devices[dev])
                pg = ctx.new_page()
                errs: list[str] = []
                pg.on("pageerror", lambda e: errs.append(str(e)))
                for r in ROUTES:
                    try:
                        pg.goto("http://127.0.0.1:8799/" + r, wait_until="load", timeout=60000)
                        time.sleep(3)
                        pg.mouse.wheel(0, 400); time.sleep(0.5); pg.mouse.wheel(0, -400); time.sleep(0.5)
                        info = pg.evaluate(PROBE)
                    except Exception as e:  # noqa: BLE001
                        info = {"err": str(e)[:300]}
                    key = f"{eng}|{dev}|{r}"
                    rep[key] = info
                    print(key, json.dumps(info, ensure_ascii=False))
                    if dev == "iPhone 13":
                        try:
                            pg.screenshot(path=os.path.join(OUT, f"{eng}_{r.replace('#/', '').replace('/', '_') or 'home'}.png"))
                        except Exception:  # noqa: BLE001
                            pass
                rep[f"{eng}|{dev}|errors"] = errs[:10]
                ctx.close()
            br.close()
    srv.shutdown()
    with open(os.path.join(OUT, "report.json"), "w", encoding="utf-8") as f:
        json.dump(rep, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
