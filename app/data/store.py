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
    # cột kiểu object lẫn số/chữ (do nguồn khác nhau) -> ép về số nếu được, để ghi parquet không lỗi
    for c in df.columns:
        if df[c].dtype == object and c not in keys:
            conv = pd.to_numeric(df[c], errors="coerce")
            if conv.notna().sum() >= df[c].notna().sum() * 0.9:
                df[c] = conv
            else:
                df[c] = df[c].astype("string")
    write(name, df)
    return df


SRC_RANK = {"VCI": 3, "TCBS": 2, "KBS": 1}


def upsert_fin(name: str, new: pd.DataFrame, keys: list[str] = ("symbol", "year", "quarter")) -> pd.DataFrame:
    """Ghi BCTC theo thứ tự tin cậy nguồn (VCI > TCBS > KBS) và theo TỪNG Ô:
    - nguồn mới tin cậy hơn hoặc bằng → lấy dòng mới, ô trống lấy lại từ dòng cũ cùng nguồn;
    - nguồn mới kém tin cậy hơn → giữ dòng cũ, chỉ điền vào ô cũ đang trống.
    Không bao giờ để một nguồn dự phòng thiếu chỉ tiêu ghi đè số đầy đủ của nguồn chính (lỗi PVT 10/2026)."""
    keys = list(keys)
    old = read(name)
    if new is None or new.empty:
        return old
    new = new.drop_duplicates(keys, keep="last")
    if old.empty:
        df = new
    else:
        o = old.set_index(keys)
        n = new.set_index(keys)
        cols = list(dict.fromkeys(list(o.columns) + list(n.columns)))
        o, n = o.reindex(columns=cols), n.reindex(columns=cols)
        both = o.index.intersection(n.index)
        ro = o.loc[both, "source"].map(SRC_RANK).fillna(0)
        rn = n.loc[both, "source"].map(SRC_RANK).fillna(0)
        win_new = both[(rn >= ro).values]
        win_old = both[(rn < ro).values]
        same = both[(rn == ro).values]
        merged_new = n.loc[win_new].copy()
        if len(same):
            merged_new.loc[same] = n.loc[same].combine_first(o.loc[same])
        merged_old = o.loc[win_old].combine_first(n.loc[win_old].drop(columns=["source"]))
        rest_o = o.drop(index=both)
        rest_n = n.drop(index=both)
        df = pd.concat([rest_o, rest_n, merged_new, merged_old]).reset_index()
    df = df.sort_values(keys).reset_index(drop=True)
    for c in df.columns:
        if df[c].dtype == object and c not in keys:
            conv = pd.to_numeric(df[c], errors="coerce")
            if conv.notna().sum() >= df[c].notna().sum() * 0.9 and df[c].notna().any():
                df[c] = conv
            else:
                df[c] = df[c].astype("string")
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
