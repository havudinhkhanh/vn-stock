"""Kiểm tra nguồn dữ liệu trong phiên: nến phút/giờ (độ sâu lịch sử), khớp lệnh, bảng giá, tin tức,
và quyền của token Cloudflare / GitHub (chạy: python run.py probe intraday)."""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta

import requests

from ..config import DATA_DIR
from . import vci
from .http import get, post


def _ts(x):
    try:
        return datetime.fromtimestamp(int(x) + 7 * 3600).strftime("%Y-%m-%d %H:%M")
    except Exception:  # noqa: BLE001
        return str(x)


def run() -> dict:
    rep: dict = {"at": datetime.now().isoformat()}
    out = DATA_DIR / "probe_report.json"
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    def save():
        out.write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    end = int((datetime.now() + timedelta(days=1)).timestamp())
    for tf in ("ONE_MINUTE", "ONE_HOUR", "ONE_DAY"):
        for cb in (300, 5000, 30000):
            k = f"chart.{tf}.{cb}"
            t0 = time.time()
            try:
                d = post("VCI", vci.TRADING + "chart/OHLCChart/gap-chart",
                         {"timeFrame": tf, "symbols": ["FPT"], "to": end, "countBack": cb}, timeout=60)
                it = (d or [{}])[0]
                t = it.get("t") or []
                rep[k] = {"n": len(t), "first": _ts(t[0]) if t else None, "last": _ts(t[-1]) if t else None,
                          "tail": [[_ts(a), o, h, l, c, v] for a, o, h, l, c, v in
                                   list(zip(t, it.get("o", []), it.get("h", []), it.get("l", []), it.get("c", []), it.get("v", [])))[-6:]],
                          "keys": list(it.keys()), "sec": round(time.time() - t0, 1)}
            except Exception as e:  # noqa: BLE001
                rep[k] = {"error": str(e)[:300]}
            print(k, rep[k] if "error" in rep[k] else {x: rep[k][x] for x in ("n", "first", "last", "sec")}, flush=True)
            save()
    # nến phút nhiều mã một lần
    try:
        d = post("VCI", vci.TRADING + "chart/OHLCChart/gap-chart",
                 {"timeFrame": "ONE_MINUTE", "symbols": ["FPT", "HPG", "VNM", "SSI", "DIG"], "to": end, "countBack": 5000}, timeout=60)
        rep["chart.minute.multi"] = [{"s": x.get("symbol"), "n": len(x.get("t") or []), "first": _ts((x.get("t") or [0])[0])} for x in d or []]
    except Exception as e:  # noqa: BLE001
        rep["chart.minute.multi"] = str(e)[:300]
    print("multi", rep["chart.minute.multi"], flush=True)
    # khớp lệnh từng lệnh
    try:
        t0 = time.time()
        raw = post("VCI", vci.TRADING + "market-watch/LEData/getAll", {"symbol": "HPG", "limit": 30000, "truncTime": None}, timeout=60)
        rep["ticks.HPG"] = {"n": len(raw or []), "sample": (raw or [])[:3], "last": (raw or [])[-2:], "sec": round(time.time() - t0, 1),
                            "bytes": len(json.dumps(raw))}
    except Exception as e:  # noqa: BLE001
        rep["ticks.HPG"] = str(e)[:300]
    print("ticks", {k: v for k, v in rep["ticks.HPG"].items() if k != "sample"} if isinstance(rep["ticks.HPG"], dict) else rep["ticks.HPG"], flush=True)
    try:
        raw = post("VCI", vci.TRADING + "price/symbols/getList", {"symbols": ["FPT", "HPG"]})
        rep["board.raw"] = raw[:1]
    except Exception as e:  # noqa: BLE001
        rep["board.raw"] = str(e)[:300]
    save()
    # tin tức (thử vài nguồn)
    news = {
        "vci_iq_news": ("VCI", vci.IQ + "/v1/company/FPT/news", {"page": 0, "size": 5}),
        "vci_iq_news2": ("VCI", vci.IQ + "/v1/news", {"ticker": "FPT", "page": 0, "size": 5}),
        "vci_iq_events": ("VCI", vci.IQ + "/v1/company/FPT/events", {"page": 0, "size": 5}),
        "tcbs_activity": ("TCBS", "https://apipubaws.tcbs.com.vn/tcanalysis/v1/ticker/FPT/activity-news", {"page": 0, "size": 5}),
        "tcbs_events": ("TCBS", "https://apipubaws.tcbs.com.vn/tcanalysis/v1/ticker/FPT/events-news", {"page": 0, "size": 5}),
    }
    for k, (src, url, params) in news.items():
        try:
            d = get(src, url, params=params, timeout=20)
            rep["news." + k] = json.dumps(d, ensure_ascii=False)[:1500]
        except Exception as e:  # noqa: BLE001
            rep["news." + k] = "ERR " + str(e)[:200]
        print("news", k, rep["news." + k][:200], flush=True)
    for k, url in (("cafef_rss", "https://cafef.vn/thi-truong-chung-khoan.rss"), ("vnexpress_rss", "https://vnexpress.net/rss/kinh-doanh.rss")):
        try:
            r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
            rep["news." + k] = f"{r.status_code} {r.text[:600]}"
        except Exception as e:  # noqa: BLE001
            rep["news." + k] = "ERR " + str(e)[:200]
        print("news", k, rep["news." + k][:150], flush=True)
    save()
    # quyền token
    tok, acc = os.environ.get("CF_API_TOKEN"), os.environ.get("CF_ACCOUNT_ID")
    rep["gh_dispatch_token_set"] = bool(os.environ.get("GH_DISPATCH_TOKEN"))
    if tok and acc:
        h = {"Authorization": f"Bearer {tok}"}
        for k, url in (("verify", "https://api.cloudflare.com/client/v4/user/tokens/verify"),
                       ("workers", f"https://api.cloudflare.com/client/v4/accounts/{acc}/workers/scripts"),
                       ("subdomain", f"https://api.cloudflare.com/client/v4/accounts/{acc}/workers/subdomain"),
                       ("pages", f"https://api.cloudflare.com/client/v4/accounts/{acc}/pages/projects")):
            try:
                r = requests.get(url, headers=h, timeout=20)
                j = r.json()
                rep["cf." + k] = {"status": r.status_code, "success": j.get("success"), "errors": j.get("errors"),
                                  "n": len(j.get("result") or []) if isinstance(j.get("result"), list) else None,
                                  "names": [x.get("id") or x.get("name") for x in j.get("result") or []][:10] if isinstance(j.get("result"), list) else j.get("result")}
            except Exception as e:  # noqa: BLE001
                rep["cf." + k] = str(e)[:200]
            print("cf", k, rep["cf." + k], flush=True)
    else:
        rep["cf"] = "no token"
    gt = os.environ.get("GH_DISPATCH_TOKEN")
    if gt:
        try:
            r = requests.get("https://api.github.com/repos/" + os.environ.get("GITHUB_REPOSITORY", "") + "/actions/workflows",
                             headers={"Authorization": f"Bearer {gt}", "Accept": "application/vnd.github+json"}, timeout=20)
            rep["gh_token_workflows"] = r.status_code
        except Exception as e:  # noqa: BLE001
            rep["gh_token_workflows"] = str(e)[:200]
    print("gh token", rep["gh_dispatch_token_set"], rep.get("gh_token_workflows"), flush=True)
    save()
    return rep
