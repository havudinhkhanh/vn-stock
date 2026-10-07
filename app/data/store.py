"""Lưu trữ dữ liệu dạng parquet trong thư mục data/."""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from ..config import DATA_DIR


def path(name: str) -> Path:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    return DATA_DIR / name


def read(name: str) -> pd.DataFrame:
    p = path(f"{name}.parquet")
    if not p.exists():
        return pd.DataFrame()
    return pd.read_parquet(p)


def write(name: str, df: pd.DataFrame) -> None:
    p = path(f"{name}.parquet")
    tmp = p.with_suffix(".tmp")
    df.to_parquet(tmp, index=False)
    tmp.replace(p)


def upsert(name: str, new: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    old = read(name)
    if old.empty:
        df = new
    elif new.empty:
        df = old
    else:
        df = pd.concat([old, new], ignore_index=True)
    df = df.drop_duplicates(keys, keep="last").sort_values(keys).reset_index(drop=True)
    write(name, df)
    return df


def meta() -> dict:
    p = path("meta.json")
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {}


def save_meta(m: dict) -> None:
    path("meta.json").write_text(json.dumps(m, ensure_ascii=False, indent=2, default=str),
                                 encoding="utf-8")


def touch(key: str, **extra) -> None:
    m = meta()
    m[key] = {"at": datetime.now().isoformat(timespec="seconds"), **extra}
    save_meta(m)


def age_days(key: str) -> float:
    m = meta().get(key)
    if not m:
        return 1e9
    return (datetime.now() - datetime.fromisoformat(m["at"])).total_seconds() / 86400
