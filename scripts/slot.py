"""Xác định lượt chạy (trong phiên / sau đóng cửa) và chống chạy trùng.

  python scripts/slot.py decide   -> ghi mode=intraday|full, slot=..., skip=true|false vào $GITHUB_OUTPUT
  python scripts/slot.py mark     -> đánh dấu lượt đã chạy xong (data/slots.json, lưu cùng bộ nhớ đệm)

Lượt tự động (lịch GitHub dự phòng hoặc hẹn giờ Cloudflare) được xếp theo GIỜ THỰC TẾ lúc chạy:
  9:00–14:29  -> 'noon'  (trong phiên)      14:30–14:45 -> 'atc' (trong phiên, trước khớp ATC)
  ≥ 14:46     -> 'close' (đầy đủ)           thứ 7       -> 'weekly' (đầy đủ: BCTC, cổ tức, backtest)
Nếu lượt đó hôm nay đã chạy xong (ví dụ Cloudflare đã kích hoạt, lịch GitHub tới trễ) thì bỏ qua.
Lượt anh bấm tay luôn chạy.
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

P = Path(os.environ.get("VNSTOCK_DATA", "data")) / "slots.json"


def _load() -> dict:
    try:
        return json.loads(P.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return {}


def _out(**kw):
    fn = os.environ.get("GITHUB_OUTPUT")
    lines = [f"{k}={v}" for k, v in kw.items()]
    print("\n".join(lines))
    if fn:
        with open(fn, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    st = os.environ.get("GITHUB_STEP_SUMMARY")
    if st:
        with open(st, "a", encoding="utf-8") as f:
            f.write(f"Lượt: **{kw.get('slot')}** · chế độ **{kw.get('mode')}** · bỏ qua: {kw.get('skip')} – {kw.get('why', '')}\n")


def decide():
    now = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh"))
    ev = os.environ.get("EVENT", "")
    auto = ev == "schedule" or os.environ.get("IN_AUTO", "false") == "true"
    mode_in = (os.environ.get("IN_MODE") or "").strip()
    if not auto:
        mode = mode_in if mode_in in ("intraday", "full") else "full"
        return _out(mode=mode, slot="manual", skip="false", date=now.strftime("%Y-%m-%d"), why="chạy tay")
    S = _load()
    m = now.hour * 60 + now.minute
    wd = now.weekday()
    day = now.strftime("%Y-%m-%d")
    if wd == 6:
        return _out(mode="full", slot="none", skip="true", date=day, why="chủ nhật")
    if wd == 5:
        slot, mode = "weekly", "full"
    elif m < 9 * 60:
        prev = now - timedelta(days=3 if wd == 0 else 1)
        pday = prev.strftime("%Y-%m-%d")
        if "close" in S.get(pday, []):
            return _out(mode="full", slot="close", skip="true", date=pday, why="lượt đóng cửa phiên trước đã chạy")
        return _out(mode="full", slot="close", skip="false", date=pday, why="bù lượt đóng cửa phiên trước bị lỡ")
    elif m < 14 * 60 + 30:
        slot, mode = "noon", "intraday"
    elif m < 14 * 60 + 46:
        slot, mode = "atc", "intraday"
    else:
        slot, mode = "close", "full"
    if mode_in == "full" and mode == "intraday":
        # Cloudflare gọi lượt 15:35 nhưng GitHub xếp hàng chạy sớm? (không xảy ra) – giữ theo giờ thực tế
        pass
    done = S.get(day, [])
    if slot in done:
        return _out(mode=mode, slot=slot, skip="true", date=day, why=f"lượt {slot} hôm nay đã chạy")
    if slot in ("noon", "atc") and "close" in done:
        return _out(mode=mode, slot=slot, skip="true", date=day, why="đã có lượt đóng cửa")
    return _out(mode=mode, slot=slot, skip="false", date=day, why="tự động")


def mark():
    slot, day = os.environ.get("SLOT", ""), os.environ.get("SLOT_DATE", "")
    if not slot or slot in ("manual", "none") or not day:
        return
    if slot in ("noon", "atc"):
        lp = P.parent / "live_last.json"
        try:
            if json.loads(lp.read_text(encoding="utf-8")).get("date") != day:
                print("Lượt trong phiên chưa có kết quả – không đánh dấu để lượt dự phòng chạy lại")
                return
        except Exception:  # noqa: BLE001
            return
    S = _load()
    S.setdefault(day, [])
    if slot not in S[day]:
        S[day].append(slot)
    keep = sorted(S)[-20:]
    P.parent.mkdir(parents=True, exist_ok=True)
    P.write_text(json.dumps({k: S[k] for k in keep}, ensure_ascii=False), encoding="utf-8")
    print("Đã đánh dấu", day, slot)


if __name__ == "__main__":
    {"decide": decide, "mark": mark}[sys.argv[1]]()
