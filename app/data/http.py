"""HTTP client dùng chung: header giống trình duyệt, tự thử lại, giới hạn tốc độ."""
from __future__ import annotations

import json
import logging
import random
import threading
import time

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

log = logging.getLogger("http")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

BASE_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
    "User-Agent": UA,
}

ORIGINS = {
    "VCI": "https://trading.vietcap.com.vn",
    "TCBS": "https://tcinvest.tcbs.com.vn",
    "SSI": "https://iboard.ssi.com.vn",
    "VND": "https://dchart.vndirect.com.vn",
    "CAFEF": "https://cafef.vn",
    "KBS": "https://kbbuddywts.kbsec.com.vn",
}


class Throttle:
    """Giới hạn số request/giây cho mỗi nguồn để không bị chặn."""

    def __init__(self, per_sec: float):
        self.min_gap = 1.0 / per_sec
        self.lock = threading.Lock()
        self.last = 0.0

    def wait(self):
        with self.lock:
            now = time.monotonic()
            gap = self.last + self.min_gap - now
            if gap > 0:
                time.sleep(gap + random.uniform(0, 0.05))
            self.last = time.monotonic()


_THROTTLES = {
    "VCI": Throttle(4),
    "TCBS": Throttle(3),
    "SSI": Throttle(3),
    "VND": Throttle(3),
    "CAFEF": Throttle(2),
    "KBS": Throttle(3),
    "OTHER": Throttle(2),
}

_local = threading.local()


def session() -> requests.Session:
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        retry = Retry(
            total=int(__import__("os").environ.get("VNSTOCK_RETRIES", "4")),
            backoff_factor=1.5,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=frozenset(["GET", "POST"]),
            raise_on_status=False,
        )
        s.mount("https://", HTTPAdapter(max_retries=retry, pool_maxsize=16))
        _local.s = s
    return s


def headers_for(source: str) -> dict:
    h = dict(BASE_HEADERS)
    origin = ORIGINS.get(source)
    if origin:
        h["Origin"] = origin
        h["Referer"] = origin + "/"
    return h


class FetchError(RuntimeError):
    pass


def request(source: str, method: str, url: str, *, params=None, payload=None,
            timeout: int = 30, expect_json: bool = True):
    _THROTTLES.get(source, _THROTTLES["OTHER"]).wait()
    h = headers_for(source)
    try:
        if method == "GET":
            r = session().get(url, headers=h, params=params, timeout=timeout)
        else:
            body = payload if isinstance(payload, str) else json.dumps(payload or {})
            r = session().post(url, headers=h, params=params, data=body, timeout=timeout)
    except requests.RequestException as e:  # mạng lỗi
        raise FetchError(f"{source} {url}: {e}") from e
    if r.status_code != 200:
        raise FetchError(f"{source} {url}: HTTP {r.status_code} {r.text[:200]}")
    if not expect_json:
        return r.text
    try:
        return r.json()
    except ValueError as e:
        raise FetchError(f"{source} {url}: không phải JSON: {r.text[:200]}") from e


def get(source, url, **kw):
    return request(source, "GET", url, **kw)


def post(source, url, payload=None, **kw):
    return request(source, "POST", url, payload=payload, **kw)
