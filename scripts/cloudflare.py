"""Tiện ích Cloudflare cho GitHub Actions.

  python scripts/cloudflare.py kv             -> in CF_KV_NAMESPACE_ID=... (tạo KV 'vnstock' nếu chưa có)
  python scripts/cloudflare.py wrangler-toml  -> in nội dung wrangler.toml để deploy Pages + Functions
"""
from __future__ import annotations

import json
import os
import sys

import requests

API = "https://api.cloudflare.com/client/v4"
TITLE = "vnstock"


def _h():
    return {"Authorization": f"Bearer {os.environ['CF_API_TOKEN']}", "Content-Type": "application/json"}


def kv_id() -> str:
    acc = os.environ["CF_ACCOUNT_ID"]
    r = requests.get(f"{API}/accounts/{acc}/storage/kv/namespaces", headers=_h(), params={"per_page": 100}, timeout=20)
    r.raise_for_status()
    for ns in r.json()["result"]:
        if ns["title"] == TITLE:
            return ns["id"]
    r = requests.post(f"{API}/accounts/{acc}/storage/kv/namespaces", headers=_h(),
                      data=json.dumps({"title": TITLE}), timeout=20)
    r.raise_for_status()
    return r.json()["result"]["id"]


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "kv":
        print(f"CF_KV_NAMESPACE_ID={kv_id()}")
    elif cmd == "wrangler-toml":
        ns = os.environ.get("CF_KV_NAMESPACE_ID") or kv_id()
        owner = os.environ.get("OWNER_EMAIL", "")
        repo = os.environ.get("GH_REPO", "")
        print(f'''name = "vn-stock"
pages_build_output_dir = "site"
compatibility_date = "2024-09-23"

[[kv_namespaces]]
binding = "VNSTOCK_KV"
id = "{ns}"

[vars]
OWNER_EMAIL = "{owner}"
GH_REPO = "{repo}"
''')
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
