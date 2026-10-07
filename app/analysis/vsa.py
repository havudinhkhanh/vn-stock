"""Volume Spread Analysis (VSA) + sự kiện Wyckoff chi tiết.

VSA so sánh Nỗ lực (khối lượng) với Kết quả (biên độ nến, vị trí giá đóng cửa):
- Spread = high − low so với trung bình 20 phiên; Volume so với trung bình 20 phiên;
  Close position = (close − low)/(high − low): gần 1 đóng cửa ở đỉnh nến, gần 0 ở đáy nến.
Các tín hiệu chính (Tom Williams):
- Upthrust: tạo đỉnh mới trong phiên nhưng đóng cửa gần đáy nến, khối lượng lớn → cung lớn.
- Spring / Shakeout: thủng đáy gần nhất rồi đóng cửa gần đỉnh nến → rũ bỏ, cầu hấp thụ.
- No Demand: nến tăng biên hẹp, khối lượng thấp hơn 2 phiên trước → thiếu cầu.
- No Supply: nến giảm biên hẹp, khối lượng thấp hơn 2 phiên trước → hết cung.
- Stopping Volume: nến giảm, khối lượng rất lớn, đóng cửa ở nửa trên → tay to đỡ giá.
- Buying/Selling Climax: biên rộng, khối lượng cực lớn ở cuối xu hướng.
- Effort vs Result: khối lượng lớn nhưng biên hẹp (hấp thụ) hoặc khối lượng nhỏ nhưng biên rộng (không nỗ lực).
"""
from __future__ import annotations

import numpy as np
import pandas as pd


def _bars(df: pd.DataFrame) -> pd.DataFrame:
    d = df.copy()
    d["spread"] = d["high"] - d["low"]
    d["sp_ma"] = d["spread"].rolling(20, min_periods=10).mean()
    d["v_ma"] = d["volume"].rolling(20, min_periods=10).mean()
    d["sp_r"] = d["spread"] / d["sp_ma"]
    d["v_r"] = d["volume"] / d["v_ma"]
    rng = d["spread"].replace(0, np.nan)
    d["cpos"] = ((d["close"] - d["low"]) / rng).fillna(0.5)
    d["up"] = d["close"] > d["close"].shift()
    d["trend20"] = d["close"] / d["close"].rolling(20, min_periods=10).mean() - 1
    d["hh10"] = d["high"].shift().rolling(10, min_periods=5).max()
    d["ll10"] = d["low"].shift().rolling(10, min_periods=5).min()
    return d


def classify(df: pd.DataFrame, lookback: int = 30) -> list[dict]:
    d = _bars(df).iloc[-lookback:]
    v, out = d["volume"].values, []
    for k, (idx, r) in enumerate(d.iterrows()):
        if r["v_ma"] != r["v_ma"] or r["sp_ma"] != r["sp_ma"]:
            continue
        sig, bias, why = None, 0, ""
        v1 = v[k - 1] if k >= 1 else np.nan
        v2 = v[k - 2] if k >= 2 else np.nan
        narrow = r["sp_r"] < 0.75
        wide = r["sp_r"] > 1.4
        hv, uhv, lv = r["v_r"] > 1.5, r["v_r"] > 2.2, r["v_r"] < 0.8
        if r["high"] > r["hh10"] and r["cpos"] < 0.3 and hv:
            sig, bias, why = "Upthrust", -1, "lập đỉnh mới trong phiên nhưng đóng cửa gần đáy, khối lượng lớn → cung chặn"
        elif r["low"] < r["ll10"] and r["cpos"] > 0.6 and r["v_r"] > 1.0:
            sig, bias, why = "Spring / Shakeout", 1, "thủng đáy gần nhất rồi đóng cửa gần đỉnh nến → cầu hấp thụ"
        elif not r["up"] and uhv and r["cpos"] > 0.5 and r["trend20"] < -0.03:
            sig, bias, why = "Stopping Volume", 1, "giảm với khối lượng rất lớn nhưng đóng cửa nửa trên → có lực đỡ"
        elif r["up"] and uhv and wide and r["trend20"] > 0.08:
            sig, bias, why = "Buying Climax", -1, "tăng mạnh biên rộng, khối lượng cực lớn sau đà tăng dài → nguy cơ phân phối"
        elif not r["up"] and uhv and wide and r["trend20"] < -0.08 and r["cpos"] < 0.4:
            sig, bias, why = "Selling Climax", 1, "bán tháo biên rộng, khối lượng cực lớn sau đà giảm dài → có thể sắp tạo đáy"
        elif r["up"] and narrow and v1 == v1 and v2 == v2 and r["volume"] < min(v1, v2):
            sig, bias, why = "No Demand", -1, "tăng biên hẹp, khối lượng thấp hơn 2 phiên trước → thiếu cầu"
        elif (not r["up"]) and narrow and v1 == v1 and v2 == v2 and r["volume"] < min(v1, v2):
            sig, bias, why = "No Supply", 1, "giảm biên hẹp, khối lượng thấp hơn 2 phiên trước → cạn cung"
        elif hv and narrow:
            sig, bias = "Effort ≠ Result (hấp thụ)", (1 if r["cpos"] >= 0.5 else -1)
            why = "khối lượng lớn nhưng giá đi rất ít → " + ("cầu hấp thụ cung" if bias > 0 else "cung hấp thụ cầu")
        elif lv and wide:
            sig, bias = "Không nỗ lực (No effort)", (1 if r["up"] else -1)
            why = "biên rộng nhưng khối lượng thấp → di chuyển dễ bị đảo ngược"
        if sig:
            out.append({"date": str(pd.Timestamp(idx).date()), "signal": sig, "bias": bias, "why": why,
                        "vol_ratio": round(float(r["v_r"]), 2), "spread_ratio": round(float(r["sp_r"]), 2),
                        "close_pos": round(float(r["cpos"]), 2)})
    return out


def analyze(df: pd.DataFrame) -> dict:
    if len(df) < 40:
        return {"ok": False}
    sig = classify(df, 30)
    d = _bars(df).iloc[-20:]
    up = d[d["up"]]
    dn = d[~d["up"]]
    up_v = float(up["volume"].mean()) if len(up) else 0.0
    dn_v = float(dn["volume"].mean()) if len(dn) else 0.0
    ratio = up_v / dn_v if dn_v else None
    w = np.array([0.5 ** ((pd.Timestamp(d.index[-1]) - pd.Timestamp(s["date"])).days / 10) for s in sig]) if sig else np.array([])
    bias = float(np.clip(sum(s["bias"] * wi for s, wi in zip(sig, w)) / max(1.0, w.sum()) if sig else 0, -1, 1))
    if ratio:
        bias = float(np.clip(bias + 0.25 * np.tanh(np.log(ratio)), -1, 1))
    return {"ok": True, "signals": sig[-10:], "bias": round(bias, 2),
            "up_down_vol": round(ratio, 2) if ratio else None,
            "text": ("Khối lượng phiên tăng lớn hơn phiên giảm → cầu chủ động" if ratio and ratio > 1.15 else
                     "Khối lượng phiên giảm lớn hơn phiên tăng → cung chủ động" if ratio and ratio < 0.87 else
                     "Cung cầu cân bằng")}


# ------------------------------------------------------------------ Wyckoff chi tiết
def wyckoff_events(df: pd.DataFrame, window: int = 120) -> dict:
    """Gắn nhãn sự kiện Wyckoff trong nền giá gần nhất và xếp pha A–E."""
    if len(df) < window + 20:
        return {"ok": False}
    d = _bars(df).iloc[-window:]
    c, h, l = d["close"], d["high"], d["low"]
    prior = df["close"].iloc[-window - 60:-window]
    down_before = len(prior) > 20 and prior.iloc[-1] < prior.iloc[0] * 0.9
    up_before = len(prior) > 20 and prior.iloc[-1] > prior.iloc[0] * 1.1
    ev = []

    def add(i, name, desc):
        ev.append({"date": str(pd.Timestamp(d.index[i]).date()), "event": name, "desc": desc,
                   "price": round(float(c.iloc[i]), 2)})

    vr = d["v_r"].fillna(1).values
    sr = d["sp_r"].fillna(1).values
    if down_before or not up_before:
        # SC: đáy thấp nhất trong 60 phiên đầu cửa sổ với khối lượng/biên lớn
        first = d.iloc[:60]
        sc = int(np.argmin(first["low"].values))
        if vr[sc] > 1.5 or sr[sc] > 1.4:
            add(sc, "SC", "Selling Climax – bán tháo cực điểm, tay to bắt đầu gom")
            ar = sc + int(np.argmax(h.values[sc:sc + 25])) if sc + 3 < len(d) else None
            if ar is not None and ar > sc:
                add(ar, "AR", "Automatic Rally – hồi kỹ thuật, xác định đỉnh nền")
                rng_lo, rng_hi = float(l.iloc[sc]), float(h.iloc[ar])
                for i in range(ar + 3, len(d)):
                    if abs(l.iloc[i] / rng_lo - 1) < 0.04 and vr[i] < vr[sc] * 0.7 and not any(e["event"] == "ST" for e in ev):
                        add(i, "ST", "Secondary Test – test lại đáy với khối lượng nhỏ hơn")
                    if l.iloc[i] < rng_lo and c.iloc[i] > rng_lo and not any(e["event"] == "Spring" for e in ev):
                        add(i, "Spring", "Spring – rũ bỏ dưới đáy nền rồi kéo lên (pha C)")
                    if c.iloc[i] > rng_hi and vr[i] > 1.3 and not any(e["event"] == "SOS" for e in ev):
                        add(i, "SOS", "Sign of Strength – bứt phá khỏi nền với khối lượng lớn (pha D)")
                    if any(e["event"] == "SOS" for e in ev) and not any(e["event"] == "LPS" for e in ev):
                        sos_i = d.index.get_loc(pd.Timestamp([e for e in ev if e["event"] == "SOS"][0]["date"]))
                        if i > sos_i + 2 and l.iloc[i] <= rng_hi * 1.03 and c.iloc[i] > rng_hi * 0.98 and vr[i] < 1:
                            add(i, "LPS", "Last Point of Support – về test đỉnh nền cũ, cạn cung (điểm mua đẹp)")
    if up_before:
        first = d.iloc[:60]
        bc = int(np.argmax(first["high"].values))
        if vr[bc] > 1.5 or sr[bc] > 1.4:
            add(bc, "BC", "Buying Climax – mua đuổi cực điểm, tay to bắt đầu phân phối")
            ar = bc + int(np.argmin(l.values[bc:bc + 25])) if bc + 3 < len(d) else None
            if ar is not None and ar > bc:
                add(ar, "AR", "Automatic Reaction – giảm phản ứng, xác định đáy nền")
                rng_hi, rng_lo = float(h.iloc[bc]), float(l.iloc[ar])
                for i in range(ar + 3, len(d)):
                    if h.iloc[i] > rng_hi and c.iloc[i] < rng_hi and not any(e["event"] == "UTAD" for e in ev):
                        add(i, "UTAD", "Upthrust After Distribution – vượt đỉnh giả rồi bị bán xuống (pha C)")
                    if c.iloc[i] < rng_lo and vr[i] > 1.3 and not any(e["event"] == "SOW" for e in ev):
                        add(i, "SOW", "Sign of Weakness – thủng nền với khối lượng lớn (pha D)")
                    if any(e["event"] == "SOW" for e in ev) and not any(e["event"] == "LPSY" for e in ev):
                        sow_i = d.index.get_loc(pd.Timestamp([e for e in ev if e["event"] == "SOW"][0]["date"]))
                        if i > sow_i + 2 and h.iloc[i] >= rng_lo * 0.97 and c.iloc[i] < rng_lo * 1.02 and vr[i] < 1:
                            add(i, "LPSY", "Last Point of Supply – hồi lên test đáy nền cũ, thiếu cầu (điểm bán)")
    names = [e["event"] for e in ev]
    if "LPS" in names or ("SOS" in names and c.iloc[-1] > c.iloc[-20:].mean()):
        phase, bias = "Tích luỹ – pha D/E (bắt đầu tăng giá)", 0.8
    elif "Spring" in names:
        phase, bias = "Tích luỹ – pha C (đã Spring, chờ SOS)", 0.5
    elif "ST" in names or ("SC" in names and "AR" in names):
        phase, bias = "Tích luỹ – pha B (xây nền)", 0.2
    elif "LPSY" in names or "SOW" in names:
        phase, bias = "Phân phối – pha D/E (bắt đầu giảm giá)", -0.8
    elif "UTAD" in names:
        phase, bias = "Phân phối – pha C (đã UTAD)", -0.5
    elif "BC" in names:
        phase, bias = "Phân phối – pha A/B", -0.3
    else:
        phase, bias = "Không có cấu trúc Wyckoff rõ ràng", 0.0
    return {"ok": True, "phase": phase, "bias": bias, "events": sorted(ev, key=lambda e: e["date"])}
