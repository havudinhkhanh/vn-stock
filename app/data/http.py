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
    "VCI_EVENTS": "https://trading.vietcap.com.vn",
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
    "VCI_EVENTS": Throttle(1.5),
    "TCBS": Throttle(3),
    "SSI": Throttle(3),
    "VND": Throttle(3),
    "CAFEF": Throttle(2),
    "KBS": Throttle(3),
    "OTHER": Throttle(2),
}

_local = threading.local()


NO_RETRY = {"VCI_EVENTS"}


def session(source: str = "") -> requests.Session:
    if source in NO_RETRY:
        s = getattr(_local, "s0", None)
        if s is None:
            s = requests.Session()
            s.mount("https://", HTTPAdapter(max_retries=0, pool_maxsize=8))
            _local.s0 = s
        return s
    s = getattr(_local, "s", None)
    if s is None:
        s = requests.Session()
        retry = Retry(
            total=int(__import__("os").environ.get("VNSTOCK_RETRIES", "3")),
            backoff_factor=1.0,
            respect_retry_after_header=False,
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


class Breaker:
    """Cầu dao: nguồn lỗi liên tiếp quá nhiều thì tạm ngắt, tránh kẹt cả lần chạy."""

    LIMITS = {"VCI_EVENTS": 4}

    def __init__(self, limit: int = 12, cooldown: float = 240.0):
        self.limit, self.cooldown = limit, cooldown
        self.fails: dict[str, int] = {}
        self.open_until: dict[str, float] = {}
        self.lock = threading.Lock()
        self.stats: dict[str, dict] = {}

    def check(self, source: str):
        with self.lock:
            until = self.open_until.get(source, 0)
        if until > time.monotonic():
            raise FetchError(f"{source}: tạm ngắt do lỗi liên tiếp")

    def ok(self, source: str):
        with self.lock:
            self.fails[source] = 0
            self.stats.setdefault(source, {"ok": 0, "fail": 0, "tripped": 0})["ok"] += 1

    def fail(self, source: str, err: str = ""):
        with self.lock:
            n = self.fails.get(source, 0) + 1
            self.fails[source] = n
            st = self.stats.setdefault(source, {"ok": 0, "fail": 0, "tripped": 0})
            st["fail"] += 1
            st["last_error"] = err[:160]
            if n >= self.LIMITS.get(source, self.limit):
                self.open_until[source] = time.monotonic() + self.cooldown
                self.fails[source] = 0
                st["tripped"] += 1
                log.warning("%s lỗi %d lần liên tiếp – tạm ngắt %ds", source, n, self.cooldown)


BREAKER = Breaker()


def request(source: str, method: str, url: str, *, params=None, payload=None,
            timeout: int = 25, expect_json: bool = True):
    BREAKER.check(source)
    try:
        res = _request(source, method, url, params=params, payload=payload, timeout=timeout,
                       expect_json=expect_json)
    except FetchError as e:
        # 404 / dữ liệu rỗng là "không có dữ liệu", không phải nguồn hỏng
        if "HTTP 404" not in str(e):
            BREAKER.fail(source, str(e))
        raise
    BREAKER.ok(source)
    return res


def _request(source: str, method: str, url: str, *, params=None, payload=None,
             timeout: int = 25, expect_json: bool = True):
    _THROTTLES.get(source, _THROTTLES["OTHER"]).wait()
    h = headers_for(source)
    try:
        if method == "GET":
            r = session(source).get(url, headers=h, params=params, timeout=timeout)
        else:
            body = payload if isinstance(payload, str) else json.dumps(payload or {})
            r = session(source).post(url, headers=h, params=params, data=body, timeout=timeout)
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
