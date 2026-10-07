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


def load_profile() -> dict:
    """Khẩu vị đầu tư anh chỉnh trên web (tab Danh mục → Khẩu vị). Rỗng = dùng config.yaml."""
    data = _from_kv("profile")
    if data is None:
        p = ROOT / "profile.json"
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return data if isinstance(data, dict) else {}


def apply_profile(cfg: dict, prof: dict) -> list[str]:
    """Ghi đè cấu hình bằng khẩu vị trên web. Trả về danh sách mục đã đổi (để ghi log & hiện trên web)."""
    changed = []
    if not prof:
        return changed
    al = prof.get("allocation")
    if isinstance(al, dict) and sum(float(v or 0) for v in al.values()) > 0:
        cfg["allocation"] = {k: float(al.get(k, 0) or 0) for k in ("garp", "growth", "defensive", "dividend", "value")}
        changed.append("phân bổ rổ")
    risk = cfg.setdefault("risk", {})
    for k in ("max_positions", "max_stop_loss_pct", "margin_of_safety", "risk_per_trade", "max_weight_per_stock",
              "max_weight_per_sector", "max_drawdown_target"):
        if prof.get(k) not in (None, ""):
            risk[k] = float(prof[k]) if k not in ("max_positions",) else int(prof[k])
            changed.append(k)
    stg = cfg.setdefault("strategy", {})
    if prof.get("trend_filter") in ("up", "above200", "not_down"):
        stg["trend_filter"] = prof["trend_filter"]; changed.append("trend_filter")
    if prof.get("min_mcap_bn") not in (None, ""):
        stg["min_mcap_bn"] = float(prof["min_mcap_bn"]); changed.append("min_mcap_bn")
    ex = prof.get("exposure")
    if isinstance(ex, dict):
        cfg["regime_exposure"] = {k: float(ex[k]) for k in ("green", "yellow", "red") if ex.get(k) not in (None, "")}
        changed.append("tỷ trọng theo đèn")
    cfg["exclude_sectors"] = [str(x) for x in (prof.get("exclude_sectors") or [])]
    cfg["exclude_symbols"] = [str(x).upper() for x in (prof.get("exclude_symbols") or [])]
    if cfg["exclude_sectors"] or cfg["exclude_symbols"]:
        changed.append("loại trừ ngành/mã")
    return changed


def load_overrides() -> dict:
    """Giả định dự phóng anh đã sửa trên web: {mã: {g1: 0.12, gm: 0.3, ...}}."""
    data = _from_kv("assumptions")
    if data is None:
        p = ROOT / "assumptions.json"
        data = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}
    return {k.upper(): v for k, v in (data or {}).items() if isinstance(v, dict)}
