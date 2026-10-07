"""Đọc danh mục anh nhập trên web.

Trên web, danh mục được lưu vào Cloudflare KV (riêng tư, sau lớp đăng nhập).
Khi chạy hằng ngày, GitHub Actions đọc lại qua API Cloudflare để tư vấn & nhắn Telegram.
Khi chạy trên máy, có thể dùng file portfolio.json ở thư mục gốc.
"""
from __future__ import annotations

import json
import logging
import os

import requests

from .config import ROOT

log = logging.getLogger("portfolio")


def _from_kv(key: str = "portfolio") -> dict | None:
    acc = os.environ.get("CF_ACCOUNT_ID")
    tok = os.environ.get("CF_API_TOKEN")
    ns = os.environ.get("CF_KV_NAMESPACE_ID")
    if not (acc and tok and ns):
        return None
    url = f"https://api.cloudflare.com/client/v4/accounts/{acc}/storage/kv/namespaces/{ns}/values/{key}"
    try:
        r = requests.get(url, headers={"Authorization": f"Bearer {tok}"}, timeout=20)
        if r.status_code == 404:
            return {}
        r.raise_for_status()
        return r.json()
    except Exception as e:  # noqa: BLE001
        log.warning("Không đọc được danh mục từ Cloudflare KV: %s", e)
        return None


def load_holdings() -> tuple[list[dict], float, float | None]:
    data = _from_kv()
    if data is None:
        p = ROOT / "portfolio.json"
        if p.exists():
            data = json.loads(p.read_text(encoding="utf-8"))
        else:
            data = {}
    holdings = [h for h in (data.get("holdings") or []) if h.get("symbol")]
    return holdings, float(data.get("cash") or 0), (float(data["capital"]) if data.get("capital") else None)


def load_overrides() -> dict:
    """Giả định dự phóng anh đã sửa trên web: {mã: {g1: 0.12, gm: 0.3, ...}}."""
    data = _from_kv("assumptions")
    if data is None:
        p = ROOT / "assumptions.json"
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return {k.upper(): v for k, v in (data or {}).items() if isinstance(v, dict)}
