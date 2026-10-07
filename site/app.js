/* VN-Stock – giao diện web (vanilla JS, không cần build) */
"use strict";

// ================================================================ tiện ích
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (x) => x !== null && x !== undefined && x !== "" && typeof x !== "boolean" && !Number.isNaN(Number(x));
const nf = (x, d = 2) => (isNum(x) ? Number(x).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const pct = (x, d = 1, sign = true) => (isNum(x) ? (sign && x > 0 ? "+" : "") + nf(x, d) + "%" : "—");
const cls = (x) => (!isNum(x) ? "" : x > 0 ? "up" : x < 0 ? "down" : "ref");
const bn = (x) => (isNum(x) ? nf(x, 0) + " tỷ" : "—");
const vnd = (x) => (isNum(x) ? nf(x, 0) + " đ" : "—");
const big = (x) => !isNum(x) ? "—" : Math.abs(x) >= 1e6 ? nf(x / 1e6, 1) + " tr" : Math.abs(x) >= 1e3 ? nf(x / 1e3, 1) + " k" : nf(x, 0);
const mcapFmt = (x) => !isNum(x) ? "—" : x >= 1e6 ? nf(x / 1e6, 2) + " triệu tỷ" : x >= 1000 ? nf(x / 1000, 1) + " nghìn tỷ" : nf(x, 0) + " tỷ";
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const enc = encodeURIComponent;
const LIGHT_VI = { green: "Xanh", yellow: "Vàng", red: "Đỏ" };
const BASKET_SHORT = { garp: "GARP", dividend: "Cổ tức", value: "Giá trị", defensive: "Phòng thủ", growth: "Tăng trưởng" };
const TREND_VI = { up: "Tăng", side: "Đi ngang", down: "Giảm" };
const QUAD_COLOR = { "Dẫn dắt": "--up", "Suy yếu": "--ref", "Tụt hậu": "--down", "Cải thiện": "--floor" };
const qcol = (q) => css(QUAD_COLOR[q] || "--ink-3");
const lsGet = (k, d) => { try { const v = localStorage.getItem("vnstock_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem("vnstock_" + k, JSON.stringify(v)); } catch (e) { /* bỏ qua */ } };

const cache = {};
async function load(path) {
  if (cache[path]) return cache[path];
  const r = await fetch(path + (path.includes("?") ? "" : `?v=${window.__ver || ""}`), { cache: "no-cache" });
  if (!r.ok) throw new Error(`Không tải được ${path} (HTTP ${r.status})`);
  return (cache[path] = await r.json());
}
async function tryLoad(path) { try { return await load(path); } catch (e) { return null; } }
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function scoreColor(v) {
  if (!isNum(v)) return "var(--sunk)";
  const t = Math.max(0, Math.min(1, v / 100));
  const a = t < 0.5 ? css("--down") : css("--up");
  const alpha = Math.round(Math.abs(t - 0.5) * 2 * 60 + 10);
  return `color-mix(in srgb, ${a} ${alpha}%, transparent)`;
}
const scoreCell = (v) => `<span class="score" style="background:${scoreColor(v)}">${isNum(v) ? Math.round(v) : "—"}</span>`;
const biasPill = (b, txt) => { if (!isNum(b)) return `<span class="pill">—</span>`; const k = b >= 0.25 ? "buy" : b <= -0.25 ? "sell" : ""; return `<span class="pill ${k}">${txt ?? (b >= 0.25 ? "Tăng" : b <= -0.25 ? "Giảm" : "Trung tính")} ${b > 0 ? "+" : ""}${nf(b, 2)}</span>`; };
const minibar = (v, color) => `<div class="minibar" title="${isNum(v) ? Math.round(v) : "—"}"><i style="width:${Math.max(0, Math.min(100, v || 0))}%;background:${color || scoreColor(v)}"></i></div>`;
const kpis = (items, lg = false, extra = "") => `<dl class="kpis ${lg ? "lg" : ""} ${extra}">${items.filter(Boolean).map(([k, v, c, t]) => `<div${t ? ` title="${esc(t)}"` : ""}><dt>${k}</dt><dd class="${c || ""}">${v ?? "—"}</dd></div>`).join("")}</dl>`;
const panel = (title, body, meta = "", extra = "") => `<section class="panel ${extra}"><div class="ph"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>${body}</section>`;

// ================================================================ danh mục (lưu trên Cloudflare KV, dự phòng localStorage)
const Store = {
  async get(key) {
    try {
      const r = await fetch(`api/${key}`, { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) return { data: await r.json(), remote: true };
    } catch (e) { /* chạy trên máy: không có API */ }
    return { data: lsGet(key, null), remote: false };
  },
  async put(key, data) {
    lsSet(key, data);
    try {
      const r = await fetch(`api/${key}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) return true;
    } catch (e) { /* bỏ qua */ }
    return false;
  },
};

// ================================================================ chỉ báo cho biểu đồ
const IND = {
  sma(a, n) { const o = []; let s = 0; for (let i = 0; i < a.length; i++) { s += a[i]; if (i >= n) s -= a[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; },
  ema(a, n) { const k = 2 / (n + 1); const o = []; let e = null; for (let i = 0; i < a.length; i++) { if (i === n - 1) { e = a.slice(0, n).reduce((x, y) => x + y, 0) / n; } else if (i >= n) e = a[i] * k + e * (1 - k); o.push(i >= n - 1 ? e : null); } return o; },
  bb(a, n = 20, k = 2) { const m = IND.sma(a, n); const up = [], lo = []; for (let i = 0; i < a.length; i++) { if (m[i] == null) { up.push(null); lo.push(null); continue; } let v = 0; for (let j = i - n + 1; j <= i; j++) v += (a[j] - m[i]) ** 2; const sd = Math.sqrt(v / n); up.push(m[i] + k * sd); lo.push(m[i] - k * sd); } return { m, up, lo }; },
  rsi(a, n = 14) { const o = [null]; let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; const G = Math.max(d, 0), L = Math.max(-d, 0); if (i <= n) { g += G / n; l += L / n; o.push(i === n ? (l === 0 ? 100 : 100 - 100 / (1 + g / l)) : null); } else { g = (g * (n - 1) + G) / n; l = (l * (n - 1) + L) / n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); } } return o; },
  macd(a) { const f = IND.ema(a, 12), s = IND.ema(a, 26); const line = a.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null)); const valid = line.filter((x) => x != null); const sigv = IND.ema(valid, 9); const off = line.length - valid.length; const sig = line.map((_, i) => (i >= off ? sigv[i - off] : null)); return { line, sig, hist: line.map((x, i) => (x != null && sig[i] != null ? x - sig[i] : null)) }; },
  obv(c, v) { const o = [0]; for (let i = 1; i < c.length; i++) o.push(o[i - 1] + (c[i] > c[i - 1] ? v[i] : c[i] < c[i - 1] ? -v[i] : 0)); return o; },
};

// ================================================================ mô hình dự phóng (giống hệt app/analysis/forecast.py)
const FC = {
  project(base, a) {
    const n = base.years, rows = [], shares = base.shares;
    let equity = base.equity, rev = base.revenue, niPrev = base.ni;
    const rev0 = base.revenue;
    for (let t = 1; t <= n; t++) {
      const g = a.g1 + (a.gterm - a.g1) * (t - 1) / Math.max(1, n - 1);
      let ni, fcfe, row;
      if (base.model === "CT") {
        rev = rev * (1 + g);
        const gp = rev * a.gm, sga = rev * a.sga, interest = base.interest * Math.pow(rev / rev0, 0.5);
        const other = base.other * Math.pow(0.8, t);
        const pbt = gp - sga - interest + other;
        const tax = Math.max(0, pbt * a.tax);
        ni = (pbt - tax) * (1 - base.minority);
        fcfe = ni * a.conv;
        row = { revenue: rev, gross_profit: gp, sga, interest, pbt, ni };
      } else {
        ni = niPrev * (1 + g);
        const roe = equity > 0 ? ni / equity : a.roe_cap;
        fcfe = ni * (1 - g / Math.max(roe, 0.05));
        row = { ni };
      }
      const eps = ni * 1000 / shares, dps = Math.max(0, eps * a.payout);
      const eqPrev = equity;
      equity = equity + ni - dps * shares / 1000;
      Object.assign(row, { year_offset: t, g, eps, dps, fcfe, equity, bvps: equity * 1000 / shares, roe: eqPrev > 0 ? ni / eqPrev : null });
      rows.push(row);
      niPrev = ni;
    }
    return rows;
  },
  dcf(base, a, rows, ke) {
    const g = a.gterm; if (ke <= g + 0.01) ke = g + 0.01;
    let pv = 0; rows.forEach((r) => (pv += r.fcfe / Math.pow(1 + ke, r.year_offset)));
    const last = rows[rows.length - 1];
    const roeT = Math.min(Math.max(last.roe ?? 0.12, 0.06), 0.25);
    const tv = (last.ni * (1 + g) * (1 - g / roeT)) / (ke - g);
    const val = pv + tv / Math.pow(1 + ke, rows.length);
    return val > 0 ? val / base.shares : null;
  },
  ddm(base, a, rows, ke) {
    if (a.payout <= 0.05) return null;
    const g = a.gterm; if (ke <= g + 0.01) ke = g + 0.01;
    let pv = 0; rows.forEach((r) => (pv += r.dps / Math.pow(1 + ke, r.year_offset)));
    const tv = (rows[rows.length - 1].dps * (1 + g)) / (ke - g);
    const v = (pv + tv / Math.pow(1 + ke, rows.length)) / 1000;
    return v > 0 ? v : null;
  },
};

// ================================================================ dữ liệu dùng chung
let SCREENER = null;
async function screenerRows() {
  if (SCREENER) return SCREENER;
  const s = await load("data/screener.json");
  SCREENER = s.rows.map((r) => Object.fromEntries(s.cols.map((c, i) => [c, r[i]])));
  SCREENER.forEach((r) => { if (isNum(r.ret_6m)) r.ret_6m_pct = r.ret_6m * 100; if (isNum(r.ret_12_1)) r.ret_12_1_pct = r.ret_12_1 * 100; if (isNum(r.vol_1y)) r.vol_1y_pct = r.vol_1y * 100; if (isNum(r.payout)) r.payout_pct = r.payout * 100; });
  return SCREENER;
}
// Độ tin cậy đo trên dữ liệu VN (backtest.pattern_stats) – tra theo tên tín hiệu
let PSTATS = {};
function relOf(name) { return PSTATS[name] || null; }
function relTag(name, short = false) {
  const r = relOf(name);
  if (!r) return short ? `<small class="faint">chưa đo</small>` : `<small class="faint">chưa đủ mẫu để đo độ tin cậy</small>`;
  const t = `đúng ${nf(r.hit_rate, 0)}%/${nf(r.n, 0)} lần, vượt VNI ${pct(r.avg_excess, 1)}`;
  return `<small class="${r.useful ? "up" : "muted"}" title="Đo trên dữ liệu VN, 20 phiên sau tín hiệu">${short ? t : "Độ tin cậy: " + t + (r.useful ? " → được cộng điểm" : " → chỉ tham khảo")}</small>`;
}

// ================================================================ khung trang
function setTab(r) { $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.r === r)); }
const app = () => $("#app");
const charts = [];
function disposeCharts() { while (charts.length) { try { charts.pop().remove(); } catch (e) { /* đã huỷ */ } } }

async function route() {
  disposeCharts();
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/");
  const r = parts[0], arg = parts.slice(1).map((x) => decodeURIComponent(x));
  window.scrollTo(0, 0);
  try {
    if (!r) { setTab("today"); await viewToday(); }
    else if (r === "market") { setTab("market"); await viewMarket(); }
    else if (r === "sector") { setTab("sector"); await viewSector(arg[0], arg[1]); }
    else if (r === "portfolio") { setTab("portfolio"); await viewPortfolio(); }
    else if (r === "screener") { setTab("screener"); await viewScreener(arg[0]); }
    else if (r === "backtest") { setTab("backtest"); await viewBacktest(); }
    else if (r === "s" && arg[0]) { setTab(""); await viewStock(arg[0].toUpperCase(), arg[1]); }
    else if (r === "guide") { setTab(""); await viewGuide(); }
    else { app().innerHTML = `<div class="empty">Không có trang này. <a href="#/">Về trang Hôm nay</a></div>`; }
  } catch (e) {
    console.error(e);
    app().innerHTML = `<div class="panel"><h2>Chưa có dữ liệu để hiển thị</h2><p>${esc(e.message)}</p>
      <p class="muted">Hệ thống cập nhật mỗi chiều sau 15h35. Nếu đây là lần đầu, chờ lượt chạy đầu tiên hoàn tất (khoảng 30–60 phút).</p></div>`;
  }
  app().focus({ preventScroll: true });
}

// ================================================================ đồ thị SVG nhỏ (không cần thư viện)
function lineSvg(series, opt = {}) {
  // series: [{name,color,pts:[{x(label),y}] , dash, width}]
  const W = opt.w || 640, H = opt.h || 180, pl = 34, pr = 8, pt = 8, pb = 18;
  const all = series.flatMap((s) => s.pts.map((p) => p.y)).filter(isNum).concat(opt.hlines ? opt.hlines.map((h) => h.y) : []);
  if (!all.length) return `<p class="muted">Chưa có số liệu.</p>`;
  let mn = Math.min(...all), mx = Math.max(...all);
  if (opt.zero) { mn = Math.min(mn, 0); mx = Math.max(mx, 0); }
  if (mx === mn) { mx += 1; mn -= 1; }
  const pad = (mx - mn) * 0.06; mn -= pad; mx += pad;
  const n = Math.max(...series.map((s) => s.pts.length));
  const X = (i) => pl + (i / Math.max(1, n - 1)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - mn) / (mx - mn)) * (H - pt - pb);
  let s = `<svg class="svgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "biểu đồ")}">`;
  for (let k = 0; k <= 3; k++) { const v = mn + (mx - mn) * k / 3; s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line-2)"/><text x="2" y="${Y(v) + 3}">${nf(v, opt.dec ?? 1)}</text>`; }
  (opt.hlines || []).forEach((h) => { s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(h.y)}" y2="${Y(h.y)}" stroke="${h.color || "var(--ink-3)"}" stroke-dasharray="4 3"/>${h.label ? `<text x="${W - pr - 2}" y="${Y(h.y) - 3}" text-anchor="end" style="fill:${h.color || "var(--ink-3)"}">${esc(h.label)}</text>` : ""}`; });
  series.forEach((se) => {
    if (se.bars) {
      const bw = Math.max(1, (W - pl - pr) / n - 1);
      se.pts.forEach((p, i) => { if (!isNum(p.y)) return; const y0 = Y(0), y1 = Y(p.y); s += `<rect x="${X(i) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.abs(y1 - y0)}" fill="${p.y >= 0 ? css("--up") : css("--down")}" opacity=".7"><title>${esc(p.x)}: ${nf(p.y, opt.dec ?? 1)}</title></rect>`; });
      return;
    }
    const d = se.pts.map((p, i) => (isNum(p.y) ? `${X(i)},${Y(p.y)}` : null)).filter(Boolean).join(" ");
    s += `<polyline fill="none" stroke="${se.color}" stroke-width="${se.width || 1.6}" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} points="${d}"/>`;
  });
  const ref = series[0].pts;
  const step = Math.ceil(ref.length / (opt.ticks || 6));
  ref.forEach((p, i) => { if (i % step === 0 || i === ref.length - 1) s += `<text x="${X(i)}" y="${H - 4}" text-anchor="middle">${esc(p.x)}</text>`; });
  s += `</svg>`;
  const legend = series.filter((x) => x.name).map((x) => `<span><i style="background:${x.color}"></i>${esc(x.name)}</span>`).join("");
  return s + (legend ? `<div class="leg">${legend}</div>` : "");
}

function scatterSvg(pts, opt = {}) {
  // pts: [{x,y,r,label,color,href,title}]
  const W = opt.w || 640, H = opt.h || 360, pl = 40, pr = 12, pt = 10, pb = 28;
  const P = pts.filter((p) => isNum(p.x) && isNum(p.y));
  if (!P.length) return `<p class="muted">Không đủ số liệu cho biểu đồ.</p>`;
  const qx = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.round(q * (s.length - 1))]; };
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y);
  let x0 = opt.xmin ?? (opt.clip ? qx(xs, 0.05) : Math.min(...xs)), x1 = opt.xmax ?? (opt.clip ? qx(xs, 0.95) : Math.max(...xs));
  let y0 = opt.ymin ?? (opt.clip ? qx(ys, 0.05) : Math.min(...ys)), y1 = opt.ymax ?? (opt.clip ? qx(ys, 0.95) : Math.max(...ys));
  if (opt.cx != null) { const dx = Math.max(Math.abs(x1 - opt.cx), Math.abs(opt.cx - x0)) || 1; x0 = opt.cx - dx; x1 = opt.cx + dx; }
  if (opt.cy != null) { const dy = Math.max(Math.abs(y1 - opt.cy), Math.abs(opt.cy - y0)) || 1; y0 = opt.cy - dy; y1 = opt.cy + dy; }
  if (x1 === x0) { x1 += 1; x0 -= 1; } if (y1 === y0) { y1 += 1; y0 -= 1; }
  const px = (x1 - x0) * 0.07, py = (y1 - y0) * 0.08; x0 -= px; x1 += px; y0 -= py; y1 += py;
  const X = (v) => pl + ((Math.max(x0, Math.min(x1, v)) - x0) / (x1 - x0)) * (W - pl - pr);
  const Y = (v) => pt + (1 - (Math.max(y0, Math.min(y1, v)) - y0) / (y1 - y0)) * (H - pt - pb);
  let s = `<svg class="svgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(opt.label || "biểu đồ phân tán")}">`;
  if (opt.quads) {
    const cx = X(opt.cx), cy = Y(opt.cy);
    opt.quads.forEach(([qx1, qy1, qx2, qy2, col, lab, ax, ay]) => {
      const L = qx1 ? cx : pl, R = qx2 ? cx : W - pr, T = qy1 ? cy : pt, B = qy2 ? cy : H - pb;
      s += `<rect x="${Math.min(L, R)}" y="${Math.min(T, B)}" width="${Math.abs(R - L)}" height="${Math.abs(B - T)}" fill="${col}" opacity=".07"/>`;
      s += `<text x="${ax === "r" ? W - pr - 4 : pl + 4}" y="${ay === "t" ? pt + 12 : H - pb - 5}" text-anchor="${ax === "r" ? "end" : "start"}" style="fill:${col};font-weight:600">${esc(lab)}</text>`;
    });
  }
  for (let k = 0; k <= 4; k++) {
    const vx = x0 + (x1 - x0) * k / 4, vy = y0 + (y1 - y0) * k / 4;
    s += `<line x1="${X(vx)}" x2="${X(vx)}" y1="${pt}" y2="${H - pb}" stroke="var(--line-2)"/><text x="${X(vx)}" y="${H - pb + 12}" text-anchor="middle">${nf(vx, opt.xdec ?? 1)}</text>`;
    s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(vy)}" y2="${Y(vy)}" stroke="var(--line-2)"/><text x="${pl - 4}" y="${Y(vy) + 3}" text-anchor="end">${nf(vy, opt.ydec ?? 1)}</text>`;
  }
  if (opt.cx != null) s += `<line x1="${X(opt.cx)}" x2="${X(opt.cx)}" y1="${pt}" y2="${H - pb}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  if (opt.cy != null) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(opt.cy)}" y2="${Y(opt.cy)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  s += `<text x="${W - pr}" y="${H - 2}" text-anchor="end" style="font-weight:600">${esc(opt.xl || "")} →</text>`;
  s += `<text x="${pl + 2}" y="${pt + 2}" dominant-baseline="hanging" style="font-weight:600" transform="translate(0,${opt.quads ? 14 : 0})">↑ ${esc(opt.yl || "")}</text>`;
  P.forEach((p) => {
    if (p.tail && p.tail.length > 1) s += `<polyline fill="none" stroke="${p.color}" stroke-width="1.2" opacity=".55" points="${p.tail.filter((t) => isNum(t.x) && isNum(t.y)).map((t) => `${X(t.x)},${Y(t.y)}`).join(" ")}"/>`;
  });
  const sorted = [...P].sort((a, b) => (b.r || 4) - (a.r || 4));
  sorted.forEach((p) => {
    const dot = `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${p.r || 4}" fill="${p.color || css("--brand")}" fill-opacity="${p.hl ? 0.95 : 0.6}" stroke="${p.hl ? css("--ink") : "none"}" stroke-width="1.5"><title>${esc(p.title || p.label)}</title></circle>`;
    const lab = p.label && (opt.labels !== false) ? `<text x="${X(p.x) + (p.r || 4) + 2}" y="${Y(p.y) + 3}" style="fill:var(--ink);font-weight:${p.hl ? 700 : 500}">${esc(p.label)}</text>` : "";
    s += p.href ? `<a href="${p.href}">${dot}${lab}</a>` : dot + lab;
  });
  return s + `</svg>`;
}

function barsSvg(rows, keys, colors, labels) {
  if (!rows.length) return `<p class="muted">Chưa có số liệu.</p>`;
  const W = 640, H = 190, pad = 34, n = rows.length, gw = (W - pad) / n, bw = Math.max(3, (gw - 6) / keys.length);
  const vals = rows.flatMap((r) => keys.map((k) => r[k] ?? 0));
  const mx = Math.max(1, ...vals), mn = Math.min(0, ...vals);
  const y = (v) => H - 22 - ((v - mn) / (mx - mn)) * (H - 40);
  let s = `<svg class="svgchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(labels.join(", "))}">`;
  s += `<line x1="${pad}" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)"/>`;
  rows.forEach((r, i) => {
    keys.forEach((k, j) => { const v = r[k] ?? 0; const x = pad + i * gw + 3 + j * bw; s += `<rect x="${x}" y="${Math.min(y(v), y(0))}" width="${bw - 1}" height="${Math.abs(y(v) - y(0))}" fill="${colors[j]}" rx="1.5"><title>${esc(r.period)} ${esc(labels[j])}: ${nf(v, 0)} tỷ</title></rect>`; });
    if (n <= 14 || i % 2 === 0) s += `<text x="${pad + i * gw + gw / 2}" y="${H - 6}" text-anchor="middle">${esc(r.period)}</text>`;
  });
  s += `<text x="2" y="12">${nf(mx, 0)}</text></svg>`;
  return s + `<div class="leg">${labels.map((l, i) => `<span><i style="background:${colors[i]}"></i>${esc(l)}</span>`).join("")}</div>`;
}

// ================================================================ lightweight-charts
function themeOpts() {
  return {
    layout: { background: { color: "transparent" }, textColor: css("--ink-2"), fontFamily: "Be Vietnam Pro, system-ui", fontSize: 11 },
    grid: { vertLines: { color: css("--line-2") }, horzLines: { color: css("--line-2") } },
    rightPriceScale: { borderColor: css("--line") }, timeScale: { borderColor: css("--line") },
    crosshair: { mode: 0 }, localization: { locale: "vi-VN" },
  };
}
function mkChart(el, extra = {}) {
  const c = LightweightCharts.createChart(el, { ...themeOpts(), autoSize: true, ...extra });
  charts.push(c);
  return c;
}
const ser = (t, v) => t.map((d, i) => (v[i] == null || Number.isNaN(v[i]) ? null : { time: d, value: v[i] })).filter(Boolean);
function candleChart(el, o, opts = {}) {
  const c = mkChart(el);
  const cs = c.addCandlestickSeries({ upColor: css("--up"), downColor: css("--down"), borderVisible: false, wickUpColor: css("--up"), wickDownColor: css("--down") });
  cs.setData(o.t.map((d, i) => ({ time: d, open: o.o[i], high: o.h[i], low: o.l[i], close: o.c[i] })));
  if (opts.volume !== false) {
    const vs = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
    vs.setData(o.t.map((d, i) => ({ time: d, value: o.v[i], color: o.c[i] >= (o.c[i - 1] ?? o.c[i]) ? css("--up") + "55" : css("--down") + "55" })));
  }
  return { c, cs };
}

// ================================================================ xếp hạng trong ngành ("phương án")
// [nhãn, hướng (+1 cao là tốt / -1 thấp là tốt), định dạng, chỉ tính khi > 0]
const FACT = {
  composite: ["Điểm tổng hợp", 1, "score"], upside: ["Tiềm năng", 1, "pct"], pe: ["P/E", -1, "x1", true], pb: ["P/B", -1, "x2", true],
  ps: ["P/S", -1, "x2", true], ev_ebitda: ["EV/EBITDA", -1, "x1", true], earnings_yield: ["Lợi suất LN", 1, "p1"], fcf_yield: ["Lợi suất FCF", 1, "p1"],
  roe: ["ROE", 1, "p1"], roe_avg5: ["ROE TB 5N", 1, "p1"], roa: ["ROA", 1, "p1"], roic: ["ROIC", 1, "p1"], gross_margin: ["Biên gộp", 1, "p1"],
  net_margin: ["Biên ròng", 1, "p1"], cfo_ni: ["CFO/LN", 1, "x2"], de: ["Vay/Vốn", -1, "x2"], fscore: ["F-Score", 1, "i"],
  rev_yoy: ["DT 12T", 1, "pct"], ni_yoy: ["LN 12T", 1, "pct"], rev_q_yoy: ["DT quý", 1, "pct"], ni_q_yoy: ["LN quý", 1, "pct"],
  rev_cagr3: ["DT CAGR3", 1, "pct"], ni_cagr3: ["LN CAGR3", 1, "pct"], ni_growth_streak: ["Quý LN tăng", 1, "i"],
  div_yield: ["Cổ tức", 1, "p1"], cash_years: ["Năm trả TM", 1, "i"], beta: ["Beta", -1, "x2"], vol_1y_pct: ["Biến động 1N", -1, "p0"],
  low_vol: ["Điểm ít biến động", 1, "score"], rs_rating: ["RS", 1, "i"], ta_score: ["Điểm KT", 1, "i"], ret_6m_pct: ["Giá 6T", 1, "pct"],
  chg3m: ["Giá 3T", 1, "pct"], from_hi52: ["Cách đỉnh 52T", 1, "pct"], momentum: ["Điểm động lượng", 1, "score"],
  smc: ["SMC", 1, "score"], vsa: ["VSA", 1, "score"], wyckoff_ev: ["Wyckoff", 1, "score"], orderflow: ["Order Flow", 1, "score"],
  quality: ["Điểm chất lượng", 1, "score"], value: ["Điểm giá trị", 1, "score"], growth: ["Điểm tăng trưởng", 1, "score"], dividend: ["Điểm cổ tức", 1, "score"],
  mcap_bn: ["Vốn hoá", 1, "bn"], avg_value_bn: ["GTGD/ngày", 1, "x1"],
};
const PRESETS = {
  best: { name: "Tốt nhất ngành", tag: "đã kiểm chứng", desc: "Đúng công thức đã backtest theo ngành: ROE, tăng trưởng LN 12T, P/E thấp, F-Score, sức mạnh giá 6 tháng – mỗi yếu tố 20%. Hệ thống thật chỉ mua khi mã có xu hướng tăng.", w: { roe: 20, ni_yoy: 20, pe: 20, fscore: 20, ret_6m_pct: 20 }, guard: { profit: true } },
  garp: { name: "GARP", desc: "Tăng trưởng với giá hợp lý: LN tăng đều, ROE cao, P/E thấp so với ngành.", w: { pe: 25, ni_cagr3: 20, ni_yoy: 15, roe: 20, fscore: 10, upside: 10 }, guard: { profit: true } },
  growth: { name: "Tăng trưởng", desc: "Doanh thu & lợi nhuận tăng nhanh nhất ngành, giá đang khoẻ (RS).", w: { ni_yoy: 20, rev_yoy: 15, ni_q_yoy: 15, ni_cagr3: 15, rev_cagr3: 10, rs_rating: 15, roe: 10 }, guard: { profit: true } },
  value: { name: "Giá trị", desc: "Rẻ nhất ngành theo nhiều thước đo và còn nhiều dư địa so với giá trị hợp lý.", w: { pe: 20, pb: 20, ev_ebitda: 15, fcf_yield: 15, upside: 20, fscore: 10 }, guard: { profit: true } },
  quality: { name: "Chất lượng", desc: "Doanh nghiệp tốt nhất ngành: sinh lời cao, ra tiền thật, ít nợ.", w: { roe: 20, roic: 20, gross_margin: 15, cfo_ni: 15, fscore: 15, de: 15 } },
  dividend: { name: "Cổ tức", desc: "Cổ tức tiền mặt cao, trả đều nhiều năm, dòng tiền tự do đủ chi, ít nợ.", w: { div_yield: 35, cash_years: 20, fcf_yield: 15, fscore: 15, de: 15 }, guard: { profit: true } },
  defensive: { name: "Phòng thủ", desc: "Ít biến động, beta thấp, nợ thấp, ROE ổn định 5 năm.", w: { low_vol: 20, beta: 15, de: 15, roe_avg5: 15, fscore: 15, cfo_ni: 10, div_yield: 10 } },
  smart: { name: "Dòng tiền thông minh", desc: "Theo dấu chân tổ chức: cấu trúc SMC, VSA, sự kiện Wyckoff, Order Flow và sức mạnh giá. Thiên về thời điểm, nên kết hợp với một phương án cơ bản.", w: { smc: 30, vsa: 25, wyckoff_ev: 20, orderflow: 15, rs_rating: 10 } },
  momentum: { name: "Động lượng", desc: "Giá mạnh nhất ngành: điểm kỹ thuật, RS, hiệu suất 3–6 tháng và gần đỉnh 52 tuần.", w: { ta_score: 25, rs_rating: 25, chg3m: 15, ret_6m_pct: 15, from_hi52: 20 } },
  custom: { name: "Tuỳ chỉnh", desc: "Tự chọn yếu tố và trọng số.", w: null },
};
function pctlRank(rows, key) {
  const [, dir, , pos] = FACT[key] || ["", 1];
  const vals = rows.map((r) => r[key]).map((v) => (isNum(v) ? Number(v) : null));
  const valid = vals.map((v, i) => [v, i]).filter(([v]) => v != null && (!pos || v > 0));
  const out = new Array(rows.length).fill(null);
  if (pos) vals.forEach((v, i) => { if (v != null && v <= 0) out[i] = 0; });
  if (valid.length === 1) { out[valid[0][1]] = 50; return out; }
  valid.sort((a, b) => (a[0] - b[0]) * dir);
  let i = 0;
  while (i < valid.length) {
    let j = i; while (j + 1 < valid.length && valid[j + 1][0] === valid[i][0]) j++;
    const p = ((i + j) / 2) / (valid.length - 1) * 100;
    for (let k = i; k <= j; k++) out[valid[k][1]] = p;
    i = j + 1;
  }
  return out;
}
function rankGroup(rows, weights) {
  const keys = Object.entries(weights).filter(([k, w]) => w > 0 && FACT[k]);
  const P = Object.fromEntries(keys.map(([k]) => [k, pctlRank(rows, k)]));
  const totW = keys.reduce((s, [, w]) => s + w, 0) || 1;
  return rows.map((r, i) => {
    let s = 0, ws = 0;
    const pc = {};
    keys.forEach(([k, w]) => { const p = P[k][i]; pc[k] = p; if (p != null) { s += p * w; ws += w; } });
    const cover = ws / totW;
    // thiếu dữ liệu bị coi như đứng giữa-dưới (30) để không được lợi
    const score = ws ? (s + 30 * (totW - ws)) / totW : null;
    return { r, score, pc, cover };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}
function fmtFact(k, v) {
  const f = (FACT[k] || [])[2];
  if (!isNum(v)) return "—";
  if (f === "pct") return `<span class="${cls(v)}">${pct(v, 0)}</span>`;
  if (f === "p1") return nf(v, 1) + "%";
  if (f === "p0") return nf(v, 0) + "%";
  if (f === "x1") return nf(v, 1);
  if (f === "x2") return nf(v, 2);
  if (f === "i") return nf(v, 0);
  if (f === "bn") return mcapFmt(v);
  if (f === "score") return nf(v, 0);
  return nf(v);
}

// ================================================================ HÔM NAY
function lamps(light) {
  return `<div class="lamps" role="img" aria-label="Đèn thị trường: ${LIGHT_VI[light] || light}">
    ${["red", "yellow", "green"].map((c) => `<div class="lamp ${c} ${c === light ? "on" : ""}"></div>`).join("")}</div>`;
}
function capitalOf(pf) { return pf && isNum(pf.capital) ? Number(pf.capital) : null; }
function sharesFor(capital, w, price) {
  if (!capital || !price) return null;
  return Math.floor((capital * w / 100) / (price * 1000) / 100) * 100;
}
const wyShort = (p) => String(p || "—").replace("Không có cấu trúc Wyckoff rõ ràng", "—").replace(/\s*\(.*\)\s*/, "").replace("Tích luỹ – pha ", "Tích luỹ ").replace("Phân phối – pha ", "Phân phối ");
function miniTable(rows, cols) {
  return `<div class="tw"><table><thead><tr>${cols.map(([, n, l]) => `<th class="${l ? "l" : ""}">${n}</th>`).join("")}</tr></thead><tbody>
    ${rows.map((r) => `<tr>${cols.map(([k, , l, f]) => `<td class="${k === "symbol" ? "sym" : l ? "l" : ""}">${f ? f(r) : k === "symbol" ? `<a href="#/s/${r.symbol}">${r.symbol}</a>` : esc(r[k] ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

async function viewToday() {
  const [t, meta, pfr, rows, secs] = await Promise.all([load("data/today.json"), load("data/meta.json"), Store.get("portfolio"), screenerRows(), tryLoad("data/sectors.json")]);
  const pf = pfr.data || {};
  const reg = t.regime, plan = t.plan, ix = reg.index || {}, br = reg.breadth_now || {};
  const capital = capitalOf(pf) ?? t.capital;
  const stale = (Date.now() - new Date(meta.data_date).getTime()) / 864e5 > 4;
  const held = new Set((pf.holdings || []).map((h) => String(h.symbol).toUpperCase()));
  const pos = (t.portfolio && t.portfolio.positions) || [];
  const sells = pos.filter((p) => p.severity >= 1);
  const holds = pos.filter((p) => p.severity < 1);

  const pickRow = (p) => {
    const sh = sharesFor(capital, p.weight, p.zone[1]);
    return `<a class="act" href="#/s/${p.symbol}"><div class="act-in">
      <div class="act-head"><span class="sym">${p.symbol}</span><span class="pill buy">MUA</span>
        <span class="pill">${esc(BASKET_SHORT[p.basket] || p.basket)}</span>${held.has(p.symbol) ? '<span class="pill brand">đang nắm</span>' : ""}
        <small class="faint">${esc(p.sector || "")}</small>
        <span style="margin-left:auto">giá <b>${nf(p.price)}</b> · điểm ${scoreCell(p.score)}</span></div>
      <div class="act-nums">
        <div><small>Vùng mua</small><b>${nf(p.zone[0])} – ${nf(p.zone[1])}</b></div>
        <div><small>Cắt lỗ</small><b class="down">${nf(p.stop)}</b> <small style="display:inline">${pct(p.stop_pct, 0)}</small></div>
        <div><small>Mục tiêu 1 / 2</small><b class="up">${nf(p.t1)} / ${nf(p.t2)}</b></div>
        <div><small>Tỷ trọng</small><b>${nf(p.weight, 1)}%</b>${sh ? ` <small style="display:inline">≈ ${nf(sh, 0)} cp</small>` : ""}</div>
      </div>
      <div class="tags"><span class="pill">P/E ${nf(p.pe, 1)}</span><span class="pill">ROE ${nf(p.roe, 0)}%</span><span class="pill">F ${nf(p.fscore, 0)}/9</span>
        <span class="pill">Cổ tức ${nf(p.div_yield, 1)}%</span><span class="pill">Lời/lỗ ${nf(p.rr, 1)}x</span><span class="pill ${p.ta_label?.includes("Mua") ? "buy" : ""}">KT: ${esc(p.ta_label || "—")}</span></div>
      <div class="why">${esc(p.why || "")}</div></div></a>`;
  };
  const sellRow = (p) => `<a class="act ${p.severity >= 2 ? "sell" : "wait"}" href="#/s/${p.symbol}"><div class="act-in">
      <div class="act-head"><span class="sym">${p.symbol}</span><span class="pill ${p.severity >= 2 ? "sell" : "wait"}">${esc(p.action)}</span>
      <span style="margin-left:auto">lãi/lỗ <b class="${cls(p.pnl_pct)}">${pct(p.pnl_pct)}</b></span></div>
      <div class="act-nums"><div><small>Giá</small><b>${nf(p.price)}</b></div><div><small>Giá vốn</small><b>${nf(p.cost)}</b></div>
      <div><small>Điểm dừng</small><b>${nf(p.stop)}</b></div><div><small>Giá trị hợp lý</small><b>${nf(p.fair)}</b></div></div>
      <div class="why">${esc((p.reasons || []).join("; "))}</div></div></a>`;

  const liq = rows.filter((r) => r.liquid_ok);
  const topComp = liq.filter((r) => r.trend === "up" && isNum(r.composite)).sort((a, b) => b.composite - a.composite).slice(0, 10);
  const smartTop = liq.filter((r) => isNum(r.smc) && isNum(r.vsa)).map((r) => ({ ...r, _sm: (r.smc + r.vsa + (r.wyckoff_ev ?? 50)) / 3 })).sort((a, b) => b._sm - a._sm).slice(0, 8);
  const lead = (secs?.sector || []).filter((s) => s.quadrant === "Dẫn dắt" || s.quadrant === "Cải thiện").sort((a, b) => (b.rs_ratio + b.rs_mom) - (a.rs_ratio + a.rs_mom)).slice(0, 6);

  app().innerHTML = `
  ${stale ? `<div class="note" style="margin-bottom:10px">Dữ liệu ngày ${esc(meta.data_date)} – đã cũ hơn 4 ngày. Lượt chạy tự động có thể đang lỗi; xem tab Actions trên GitHub.</div>` : ""}
  <div class="g g-today">
    <div class="stack">
      <section class="panel">
        <div class="signal">${lamps(reg.light)}
          <div><div class="exposure">${reg.exposure}% <small style="font-size:.8rem;font-weight:500">cổ phiếu tối đa</small></div>
          <small>Đèn ${LIGHT_VI[reg.light]} · ${reg.score}/${reg.max_score} điều kiện · phiên ${esc(t.date)}</small></div></div>
        <p style="margin-top:8px">${esc(reg.text)}</p>
        <ul class="checks">${reg.checks.map((c) => `<li class="${c.ok ? "ok" : ""}">${esc(c.name)}</li>`).join("")}</ul>
      </section>
      ${panel("VN-Index", kpis([["Đóng cửa", nf(ix.close)], ["Hôm nay", pct(ix.chg1d, 2), cls(ix.chg1d)], ["1 tháng", pct(ix.chg1m), cls(ix.chg1m)], ["Từ đầu năm", pct(ix.chgytd), cls(ix.chgytd)],
        ["MA50", nf(ix.sma50, 0)], ["MA200", nf(ix.sma200, 0)], ["Cách đỉnh 52T", pct(ix.from_hi52), "down"], ["RSI", nf(ix.rsi, 0)],
        ["Tăng / giảm", `<span class="up">${br.adv ?? "—"}</span> / <span class="down">${br.dec ?? "—"}</span>`], ["Đỉnh / đáy 52T", `${br.new_hi ?? "—"} / ${br.new_lo ?? "—"}`],
        ["% trên MA50", nf(br.above50, 0) + "%"], ["Ngày phân phối", reg.distribution_days]]), `<a href="#/market">chi tiết</a>`)}
      ${panel("Phân bổ vốn", kpis([...Object.entries(t.allocation || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => [esc(BASKET_SHORT[k] || k), v + "%"]),
        ["Tối đa mã", t.risk?.max_positions], ["Biên an toàn", (t.risk?.margin_of_safety ?? "—") + "%"], ["Rủi ro/lệnh", (t.risk?.risk_per_trade ?? "—") + "% vốn"], ["Cắt lỗ tối đa", (t.risk?.max_stop_loss_pct ?? "—") + "%"]]),
        `<a href="#/guide">cách chọn mã</a>`)}
      <section class="panel"><button class="btn" id="runNow">Chạy lại phân tích ngay</button>
        <p class="muted" id="runMsg" style="font-size:.76rem">Tự chạy lúc 15h35 các ngày giao dịch. Bấm khi muốn cập nhật sớm (10–30 phút).</p></section>
    </div>

    <div class="stack">
      ${sells.length ? panel("Danh mục – cần xử lý", `<div class="acts">${sells.map(sellRow).join("")}</div>`, `${sells.length} mã`) : ""}
      ${panel("Mua theo kế hoạch", plan.picks.length ? `<div class="acts">${plan.picks.map(pickRow).join("")}</div>` :
        `<div class="empty">Hôm nay không có mã nào đạt đủ điều kiện mua. Giữ tiền mặt là một quyết định đúng.</div>`,
        `${plan.picks.length} mã · ${nf(plan.invested, 0)}% vốn · tiền mặt ${nf(plan.cash, 0)}%`)}
      ${!capital ? `<p class="muted" style="font-size:.78rem">Nhập vốn ở tab <a href="#/portfolio">Danh mục</a> để thấy số cổ phiếu cần mua cho từng mã.</p>` : ""}
      ${holds.length ? panel("Đang nắm – giữ nguyên", `<div class="acts">${holds.map((p) => `
        <a class="act hold" href="#/s/${p.symbol}"><div class="act-in"><div class="act-head"><span class="sym">${p.symbol}</span><span class="pill">GIỮ</span>
        <span style="margin-left:auto">lãi/lỗ <b class="${cls(p.pnl_pct)}">${pct(p.pnl_pct)}</b></span></div>
        <div class="why">${esc((p.reasons || []).join("; "))}</div></div></a>`).join("")}</div>`) : ""}
      ${plan.watch.length ? panel("Theo dõi – chờ điểm mua", miniTable(plan.watch, [["symbol", "Mã"], ["basket", "Rổ", 1, (w) => esc(BASKET_SHORT[w.basket] || w.basket)],
        ["score", "Điểm", 0, (w) => scoreCell(w.score)], ["price", "Giá", 0, (w) => nf(w.price)], ["zone", "Vùng mua", 0, (w) => `${nf(w.zone[0])}–${nf(w.zone[1])}`],
        ["upside", "Tiềm năng", 0, (w) => `<span class="${cls(w.upside)}">${pct(w.upside, 0)}</span>`], ["pe", "P/E", 0, (w) => nf(w.pe, 1)], ["roe", "ROE", 0, (w) => nf(w.roe, 0) + "%"],
        ["reason", "Đang chờ", 1, (w) => `<span style="white-space:normal">${esc(w.reason)}</span>`]]), `${plan.watch.length} mã`, "flush") : ""}
    </div>

    <div class="stack col3">
      ${lead.length ? panel("Ngành đang mạnh lên", miniTable(lead, [["name", "Ngành", 1, (s) => `<span class="quad" style="background:${qcol(s.quadrant)}"></span><a href="#/sector/${enc(s.name)}">${esc(s.name)}</a>`],
        ["r1m", "1 tháng", 0, (s) => `<span class="${cls(s.r1m)}">${pct(s.r1m, 0)}</span>`],
        ["leaders", "Đầu ngành", 1, (s) => (s.leaders || []).slice(0, 2).map((x) => `<a href="#/s/${x.symbol}">${x.symbol}</a>`).join(" ")]]), `<a href="#/sector">mọi ngành</a>`, "flush") : ""}
      ${panel("Điểm cao nhất (xu hướng tăng)", miniTable(topComp, [["symbol", "Mã"], ["composite", "Điểm", 0, (r) => scoreCell(r.composite)], ["upside", "Tiềm năng", 0, (r) => `<span class="${cls(r.upside)}">${pct(r.upside, 0)}</span>`],
        ["pe", "P/E", 0, (r) => nf(r.pe, 1)], ["roe", "ROE", 0, (r) => nf(r.roe, 0)], ["ta_label", "KT", 1, (r) => `<small>${esc(r.ta_label || "")}</small>`]]), `<a href="#/screener">bộ lọc</a>`, "flush")}
      ${panel("Dấu chân tổ chức mạnh", miniTable(smartTop, [["symbol", "Mã"], ["_sm", "TB", 0, (r) => scoreCell(r._sm)], ["smc", "SMC", 0, (r) => nf(r.smc, 0)], ["vsa", "VSA", 0, (r) => nf(r.vsa, 0)],
        ["wy_phase", "Wyckoff", 1, (r) => `<small title="${esc(r.wy_phase || "")}">${esc(wyShort(r.wy_phase))}</small>`]]), "SMC · VSA · Wyckoff", "flush")}
    </div>
  </div>
  <p class="faint" style="margin-top:14px;font-size:.74rem">Cập nhật ${esc(meta.generated)} · ${nf(meta.symbols, 0)} mã · ${nf(meta.deep, 0)} mã phân tích sâu · Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư có giấy phép.</p>`;
  runNow(meta);
}

async function runNow(meta) {
  const b = $("#runNow"); if (!b) return;
  b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await fetch("api/run", { method: "POST" });
      if (r.ok) { $("#runMsg").textContent = "Đã yêu cầu chạy lại. Khoảng 10–30 phút nữa tải lại trang để xem kết quả."; return; }
    } catch (e) { /* không có API */ }
    const url = meta.repo ? `https://github.com/${meta.repo}/actions/workflows/daily.yml` : "https://github.com";
    $("#runMsg").innerHTML = `Chưa cài nút chạy từ web. Mở <a href="${url}" target="_blank" rel="noopener">GitHub Actions</a> → bấm <b>Run workflow</b>.`;
    b.disabled = false;
  };
}

// ================================================================ THỊ TRƯỜNG
function rrgSvg(list, hl, opt = {}) {
  const q = [[0, 0, 1, 1, css("--floor"), "Cải thiện", "l", "t"], [1, 0, 0, 1, css("--up"), "Dẫn dắt", "r", "t"],
    [0, 1, 1, 0, css("--down"), "Tụt hậu", "l", "b"], [1, 1, 0, 0, css("--ref"), "Suy yếu", "r", "b"]];
  return scatterSvg(list.map((s) => ({ x: s.rs_ratio, y: s.rs_mom, r: Math.max(3.5, Math.min(11, Math.sqrt((s.mcap_bn || 1) / 3000))), label: opt.short ? s.name.split(" ")[0] : s.name,
    color: qcol(s.quadrant), href: `#/sector/${enc(s.name)}`, tail: opt.labels === false ? null : s.rrg_tail, hl: s.name === hl, title: `${s.name}: RS-Ratio ${nf(s.rs_ratio, 1)}, RS-Momentum ${nf(s.rs_mom, 1)} (${s.quadrant})` })),
  { cx: 100, cy: 100, quads: q, clip: true, xl: opt.w ? "RS-Ratio" : "Sức mạnh tương đối (RS-Ratio)", yl: opt.w ? "RS-Mom" : "Động lượng RS", h: opt.h || 380, w: opt.w, labels: opt.labels !== false, label: "Biểu đồ xoay vòng ngành" });
}
function heatColor(v, scale = 6) { return !isNum(v) ? "var(--ink-3)" : `color-mix(in srgb, ${v >= 0 ? css("--up") : css("--down")} ${Math.min(100, 35 + Math.abs(v) * scale)}%, #2a2f36)`; }

async function viewMarket() {
  const [m, secs] = await Promise.all([load("data/market.json"), tryLoad("data/sectors.json")]);
  const reg = m.regime, ix = reg.index || {}, br = reg.breadth_now || {};
  const r1d = Object.fromEntries((m.sectors || []).map((s) => [s.sector, s.r1d]));
  const S = (secs?.sector || []).map((s) => ({ ...s, r1d: r1d[s.name] }));
  const st = { idx: "VNINDEX", per: lsGet("heatPer", "r1m"), sort: "mcap_bn", asc: false };
  const idxKpis = Object.entries(m.indices).map(([k, v]) => [esc(k), `${nf(v.close)}<br><small class="${cls(v.chg)}">${pct(v.chg, 2)}</small>`]);
  app().innerHTML = `
  <div class="ph"><h1>Thị trường</h1><span class="meta">phiên ${esc(m.date)}</span></div>
  ${kpis([...idxKpis, ["Đèn", `${LIGHT_VI[reg.light]} · ${reg.exposure}%`, reg.light === "green" ? "up" : reg.light === "red" ? "down" : "ref"], ["Điều kiện đạt", `${reg.score}/${reg.max_score}`],
    ["Tăng / giảm", `<span class="up">${br.adv ?? "—"}</span> / <span class="down">${br.dec ?? "—"}</span>`], ["Đỉnh / đáy 52T", `${br.new_hi ?? "—"} / ${br.new_lo ?? "—"}`],
    ["% trên MA50", nf(br.above50, 0) + "%"], ["% trên MA200", nf(br.above200, 0) + "%"], ["Ngày phân phối", reg.distribution_days, reg.distribution_days >= 6 ? "down" : ""],
    ["RSI VN-Index", nf(ix.rsi, 0)], ["Cách đỉnh 52T", pct(ix.from_hi52), "down"], ["KT chỉ số", `${esc(m.index_ta.label)} ${m.index_ta.score}`]])}
  <div class="g g-main sec">
    <section class="panel"><div class="ph"><h2>Chỉ số</h2><span class="seg" id="ixSel">${Object.keys(m.indices).map((k) => `<button data-i="${k}" class="${k === st.idx ? "on" : ""}">${k}</button>`).join("")}</span>
      <span class="meta leg"><span><i style="background:${css("--brand")}"></i>MA50</span><span><i style="background:${css("--ref")}"></i>MA200</span></span></div>
      <div class="chart md" id="ixChart"></div></section>
    <section class="panel"><div class="ph"><h2>Xoay vòng ngành (RRG)</h2><span class="meta">so với VN-Index · đuôi = 12 tuần</span></div>
      ${S.length ? rrgSvg(S, null, { short: true, h: 330 }) : `<p class="muted">Có sau lượt chạy kế tiếp.</p>`}
      <p class="faint" style="font-size:.72rem">Ngành đi theo vòng: Cải thiện → Dẫn dắt → Suy yếu → Tụt hậu. Bấm vào chấm để xem ngành.</p></section>
  </div>
  <div class="g g3 sec">
    <section class="panel"><div class="ph"><h2>Độ rộng thị trường</h2><span class="meta">% mã trên MA50 / MA200</span></div><div class="chart sm" id="brChart"></div>
      <div class="leg"><span><i style="background:${css("--brand")}"></i>% trên MA50</span><span><i style="background:${css("--ref")}"></i>% trên MA200</span></div></section>
    <section class="panel"><div class="ph"><h2>Kỹ thuật VN-Index</h2><span class="meta">${esc(m.index_ta.trend_vi)}</span></div>
      <div class="gauge"><i style="left:${m.index_ta.score}%"></i></div>
      ${kpis(Object.entries(m.index_ta.groups || {}).map(([g, s]) => [esc(g), `${esc(s.signal)} <small>${s.score}</small>`, s.signal === "Mua" ? "up" : s.signal === "Bán" ? "down" : ""]))}
      <div class="sec">${wavesBlock(m.index_waves, true)}</div></section>
    <section class="panel"><div class="ph"><h2>Mô hình & mức giá VN-Index</h2></div>${patternsList(m.index_waves)}${levelsKv(m.index_waves)}</section>
  </div>
  <section class="panel sec"><div class="ph"><h2>Bản đồ ngành</h2><span class="seg" id="perSel">${[["r1d", "1 ngày"], ["r1w", "1 tuần"], ["r1m", "1 tháng"], ["r3m", "3 tháng"], ["r6m", "6 tháng"], ["r1y", "1 năm"]].map(([k, n]) => `<button data-p="${k}" class="${k === st.per ? "on" : ""}">${n}</button>`).join("")}</span>
    <span class="meta">gia quyền theo thanh khoản · bấm để xem ngành</span></div><div class="heat" id="heat"></div></section>
  <section class="panel flush sec"><div class="ph"><h2>Bảng ngành</h2><span class="meta">trung vị các mã trong ngành</span></div><div class="tw"><table id="secTbl"></table></div></section>`;

  const drawIdx = () => {
    disposeCharts();
    const o = m.indices[st.idx].ohlc;
    const { c } = candleChart($("#ixChart"), o);
    c.addLineSeries({ color: css("--brand"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ser(o.t, IND.sma(o.c, 50)));
    c.addLineSeries({ color: css("--ref"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ser(o.t, IND.sma(o.c, 200)));
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - 260), to: o.t.length + 2 });
    const bc = mkChart($("#brChart"));
    const a = bc.addLineSeries({ color: css("--brand"), lineWidth: 2, priceLineVisible: false });
    const b = bc.addLineSeries({ color: css("--ref"), lineWidth: 2, priceLineVisible: false });
    a.setData(m.breadth.filter((x) => x.a50 != null).map((x) => ({ time: x.d, value: x.a50 })));
    b.setData(m.breadth.filter((x) => x.a200 != null).map((x) => ({ time: x.d, value: x.a200 })));
    a.createPriceLine({ price: 50, color: css("--ink-3"), lineStyle: 2, axisLabelVisible: false });
    bc.timeScale().fitContent();
  };
  drawIdx();
  $$("#ixSel button").forEach((b) => (b.onclick = () => { st.idx = b.dataset.i; $$("#ixSel button").forEach((x) => x.classList.toggle("on", x === b)); drawIdx(); }));
  const src = S.length ? S : (m.sectors || []).map((s) => ({ ...s, name: s.sector }));
  const drawHeat = () => {
    $("#heat").innerHTML = [...src].sort((a, b) => (b[st.per] ?? -999) - (a[st.per] ?? -999)).map((s) => `<a href="#/sector/${enc(s.name)}" style="background:${heatColor(s[st.per], st.per === "r1y" || st.per === "r6m" ? 2 : st.per === "r3m" ? 3 : 6)}">
      <b>${pct(s[st.per])}</b>${esc(s.name)}<br><small style="color:#fff;opacity:.85">${s.n} mã · ${nf(s.above50, 0)}% trên MA50${s.quadrant ? " · " + esc(s.quadrant) : ""}</small></a>`).join("");
  };
  drawHeat();
  $$("#perSel button").forEach((b) => (b.onclick = () => { st.per = b.dataset.p; lsSet("heatPer", st.per); $$("#perSel button").forEach((x) => x.classList.toggle("on", x === b)); drawHeat(); }));
  const C = [["name", "Ngành", "l"], ["quadrant", "Vòng", "q"], ["n", "Số mã", "i"], ["mcap_bn", "Vốn hoá", "bn"], ["value_bn", "GTGD", "i"], ["r1d", "1N", "p"], ["r1w", "1T", "p"], ["r1m", "1Th", "p"], ["r3m", "3Th", "p"], ["r1y", "1 năm", "p"],
    ["above50", ">MA50", "p0"], ["above200", ">MA200", "p0"], ["rs_ratio", "RS", "x1"], ["pe_med", "P/E", "x1"], ["pe_pctl_hist", "P/E vs LS", "p0"], ["pb_med", "P/B", "x2"],
    ["roe_med", "ROE", "x1"], ["ni_yoy_med", "LN 12T", "p"], ["rev_yoy_med", "DT 12T", "p"], ["div_med", "Cổ tức", "x1"], ["upside_med", "Tiềm năng", "p"], ["composite_med", "Điểm", "s"], ["smc_bias", "SMC", "x2"]];
  const drawT = () => {
    const rows = [...src].sort((a, b) => { const x = a[st.sort], y = b[st.sort]; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (st.asc ? 1 : -1); });
    $("#secTbl").innerHTML = `<thead><tr>${C.map(([k, n, f]) => `<th data-k="${k}" class="${f === "l" || f === "q" ? "l" : ""} ${k === "name" ? "sym" : ""} ${st.sort === k ? "sorted" + (st.asc ? " asc" : "") : ""}">${n}</th>`).join("")}</tr></thead><tbody>
      ${rows.map((s) => `<tr>${C.map(([k, , f]) => { const v = s[k];
        const t = k === "name" ? `<a href="#/sector/${enc(v)}">${esc(v)}</a>` : f === "q" ? `<span class="quad" style="background:${qcol(v)}"></span>${esc(v || "—")}` : f === "p" ? `<span class="${cls(v)}">${pct(v, 1)}</span>` : f === "p0" ? (isNum(v) ? nf(v, 0) + "%" : "—")
          : f === "bn" ? mcapFmt(v) : f === "i" ? nf(v, 0) : f === "x1" ? nf(v, 1) : f === "s" ? scoreCell(v) : nf(v, 2);
        return `<td class="${k === "name" ? "sym" : f === "q" ? "l" : ""}">${t}</td>`; }).join("")}</tr>`).join("")}</tbody>`;
    $$("#secTbl th").forEach((th) => (th.onclick = () => { if (st.sort === th.dataset.k) st.asc = !st.asc; else { st.sort = th.dataset.k; st.asc = th.dataset.k === "name"; } drawT(); }));
  };
  drawT();
}

// ================================================================ SÓNG & MÔ HÌNH (dùng chung)
function reliab(r) {
  if (!r) return `<small class="faint">chưa đủ mẫu để đo độ tin cậy</small>`;
  return `<small class="${r.useful ? "up" : "muted"}">Độ tin cậy trên dữ liệu VN: đúng ${nf(r.hit_rate, 0)}% trong ${nf(r.n, 0)} lần, vượt VN-Index TB ${pct(r.avg_excess, 2)} sau 20 phiên → ${r.useful ? "được dùng khi chấm điểm" : "chỉ để tham khảo"}</small>`;
}
function wavesBlock(w, compact = false) {
  if (!w) return `<p class="muted">Chưa có.</p>`;
  const el = w.elliott || {};
  const scen = (s, title) => !s ? "" : `<div style="margin-top:6px"><h3>${title}: ${esc(s.where)}</h3>
    <div class="tags" style="margin:4px 0">${s.points.map((p) => `<span class="pill">${esc(p.label)} · ${nf(p.price)} <small class="faint">${esc(p.date)}</small></span>`).join("")}</div>
    ${s.targets.length ? `<p>Mục tiêu: <b>${s.targets.map((x) => nf(x)).join(" / ")}</b>${s.invalidation ? ` · sai nếu qua <b>${nf(s.invalidation)}</b>` : ""}</p>` : s.invalidation ? `<p>Sai nếu qua <b>${nf(s.invalidation)}</b></p>` : ""}
    <p class="faint" style="font-size:.76rem">${esc((s.notes || []).join(" · "))} – mức khớp ${nf((s.confidence || 0) * 100, 0)}%</p></div>`;
  const wy = w.wyckoff || {}, dw = w.dow || {};
  return `
   <div><h3>Elliott</h3>${el.ok ? scen(el.main, "Kịch bản chính") + (compact ? "" : scen(el.alt, "Kịch bản thay thế")) : `<p class="muted">${esc(el.reason || "Không đếm được")}</p>`}${reliab(el.reliability)}</div>
   <div style="margin-top:8px"><h3>Wyckoff (nền giá): ${esc(wy.phase || "—")}</h3>
     ${(wy.events || []).length ? `<div>${wy.events.map((e) => `<div class="ev"><time>${esc(e.date)}</time><span>${esc(e.event)}</span></div>`).join("")}</div>` : ""}
     ${wy.range ? `<p class="faint" style="font-size:.76rem">Nền 60 phiên: ${nf(wy.range[0])} – ${nf(wy.range[1])} (rộng ${nf(wy.width_pct, 1)}%)</p>` : ""}${reliab(wy.reliability)}</div>
   <div style="margin-top:8px"><h3>Dow</h3><p>Chính: <b>${esc(dw.primary || "—")}</b> · Phụ: ${esc(dw.secondary || "—")}</p>${reliab(dw.reliability)}</div>
   ${compact ? "" : `<div style="margin-top:8px"><h3>Mô hình giá & Harmonic</h3>${patternsList(w)}</div>`}`;
}
function patternsList(w) {
  const pats = ((w || {}).patterns || []).concat((w || {}).harmonics || []);
  return pats.length ? pats.map((p) => `<div class="ev"><time class="${p.bias > 0 ? "up" : p.bias < 0 ? "down" : ""}">${p.bias > 0 ? "▲ tăng" : p.bias < 0 ? "▼ giảm" : "•"}</time>
     <span><b>${esc(p.name)}</b> – ${esc(p.status || "")}<br><small>${p.trigger ? `Kích hoạt ${nf(p.trigger)}` : ""}${p.prz ? `Vùng đảo chiều ${nf(p.prz)}` : ""}${p.target ? ` · mục tiêu ${nf(p.target)}` : ""}${p.stop ? ` · cắt lỗ ${nf(p.stop)}` : ""}</small><br>${reliab(p.reliability || relOf(p.name))}</span></div>`).join("")
    : `<p class="muted">Không phát hiện mô hình rõ ràng trong 60 phiên gần đây.</p>`;
}
function levelsKv(w) {
  const lv = (w || {}).levels || {}, f = (w || {}).fib || {};
  return `<div class="g g2 sec"><div><h3>Kháng cự / hỗ trợ</h3><dl class="kv">${(lv.resistance || []).map((z) => `<dt>Kháng cự <small>(${z.touches} lần)</small></dt><dd class="down">${nf(z.price)}</dd>`).join("")}
    ${(lv.support || []).map((z) => `<dt>Hỗ trợ <small>(${z.touches} lần)</small></dt><dd class="up">${nf(z.price)}</dd>`).join("")}</dl></div>
    ${f.swing ? `<div><h3>Fibonacci <small class="muted">${esc(f.swing.direction)} ${nf(f.swing.low)}–${nf(f.swing.high)}</small></h3><dl class="kv">
      ${Object.entries(f.retracement).map(([k, v]) => `<dt>Thoái lui ${(Number(k) * 100).toFixed(1)}%</dt><dd>${nf(v)}</dd>`).join("")}
      ${Object.entries(f.extension).map(([k, v]) => `<dt>Mở rộng ${(Number(k) * 100).toFixed(1)}%</dt><dd>${nf(v)}</dd>`).join("")}</dl></div>` : ""}</div>`;
}

// ================================================================ NGÀNH
function groupMembers(g, rows) {
  const S = new Set(g.sectors || []), I = new Set(g.industries || []), Y = new Set(g.symbols || []), X = new Set(g.exclude || []);
  return rows.filter((r) => !X.has(r.symbol) && (S.has(r.sector) || I.has(r.industry) || Y.has(r.symbol)));
}
function aggRec(M) {
  const med = (k, pos) => { const a = M.map((r) => r[k]).filter((v) => isNum(v) && (!pos || v > 0)).map(Number).sort((x, y) => x - y); if (!a.length) return null; const h = a.length / 2; return a.length % 2 ? a[Math.floor(h)] : (a[h - 1] + a[h]) / 2; };
  const liq = M.filter((r) => (r.avg_value_bn ?? 0) > 0.3);
  const wr = (k) => { let s = 0, w = 0; liq.forEach((r) => { if (isNum(r[k])) { s += r[k] * r.avg_value_bn; w += r.avg_value_bn; } }); return w ? s / w : null; };
  const sum = (k) => M.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  return { n: M.length, n_sec: new Set(M.map((r) => r.sector)).size, mcap_bn: sum("mcap_bn"), value_bn: sum("avg_value_bn"), r1w: wr("chg1w"), r1m: wr("chg1m"), r3m: wr("chg3m"), r1y: wr("chg1y"),
    pe_med: med("pe", true), pb_med: med("pb", true), roe_med: med("roe"), ni_yoy_med: med("ni_yoy"), rev_yoy_med: med("rev_yoy"), div_med: med("div_yield"), fscore_med: med("fscore"), de_med: med("de"),
    upside_med: med("upside"), composite_med: med("composite"), up_pct: M.length ? 100 * M.filter((r) => r.trend === "up").length / M.length : null };
}
function groupEditor(g, rows) {
  const tree = {};
  rows.forEach((r) => { if (!r.sector) return; const t = (tree[r.sector] = tree[r.sector] || { n: 0, ind: {} }); t.n++; if (r.industry) t.ind[r.industry] = (t.ind[r.industry] || 0) + 1; });
  const S = new Set(g.sectors), I = new Set(g.industries);
  return `<section class="panel" id="gEdit" ${g.id === "new" ? "" : "hidden"}><div class="ph"><h2>${g.id === "new" ? "Tự nhóm ngành / mã" : "Sửa nhóm"}</h2><span class="meta">tick ngành cấp 2 (lấy cả ngành) hoặc từng nhóm ngành cấp 3, thêm mã lẻ nếu muốn</span></div>
    <div class="filters"><div class="field w200"><label for="gName">Tên nhóm</label><input id="gName" value="${esc(g.name)}" placeholder="ví dụ: Hưởng lợi đầu tư công" style="width:240px"></div>
      <div class="field" style="flex:1;min-width:220px"><label for="gSyms">Thêm mã lẻ (cách nhau dấu phẩy/khoảng trắng)</label><input id="gSyms" value="${esc((g.symbols || []).join(", "))}" placeholder="HPG, VCG, PLC" autocapitalize="characters"></div>
      <div class="field" style="flex:1;min-width:180px"><label for="gEx">Loại trừ mã</label><input id="gEx" value="${esc((g.exclude || []).join(", "))}" placeholder="ví dụ ROS" autocapitalize="characters"></div></div>
    <div class="views" style="margin:8px 0 4px"><small class="muted" style="align-self:center">Mẫu nhanh:</small>${GROUP_TEMPLATES.map((x, i) => `<button data-tpl="${i}">${esc(x.name)}</button>`).join("")}</div>
    <div class="gtree">${Object.entries(tree).sort((a, b) => b[1].n - a[1].n).map(([sn, t]) => `<div class="gnode"><label class="gsec"><input type="checkbox" data-gs="${esc(sn)}" ${S.has(sn) ? "checked" : ""}> <b>${esc(sn)}</b> <small class="faint">${t.n}</small></label>
      ${Object.keys(t.ind).length > 1 || Object.keys(t.ind)[0] !== sn ? Object.entries(t.ind).sort((a, b) => b[1] - a[1]).map(([iname, n]) => `<label class="gind"><input type="checkbox" data-gi="${esc(iname)}" data-parent="${esc(sn)}" ${I.has(iname) || S.has(sn) ? "checked" : ""} ${S.has(sn) ? "disabled" : ""}> ${esc(iname)} <small class="faint">${n}</small></label>`).join("") : ""}</div>`).join("")}</div>
    <p style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button class="btn primary" id="gSave">Lưu nhóm & chạy phương án</button>${g.id !== "new" ? `<button class="btn" id="gDel">Xoá nhóm</button><button class="btn" id="gClose">Đóng</button>` : ""}<small class="muted" id="gCnt"></small></p></section>`;
}
const GROUP_TEMPLATES = [
  { name: "Đầu tư công", sectors: ["Xây dựng và Vật liệu"], industries: ["Kim loại"], symbols: [] },
  { name: "Tài chính (NH + CK + BH)", sectors: ["Ngân hàng", "Dịch vụ tài chính", "Bảo hiểm"], industries: [], symbols: [] },
  { name: "Tiêu dùng", sectors: ["Thực phẩm và đồ uống", "Bán lẻ", "Hàng cá nhân & Gia dụng"], industries: [], symbols: [] },
  { name: "Năng lượng & tiện ích", sectors: ["Dầu khí", "Điện, nước & xăng dầu khí đốt"], industries: [], symbols: [] },
  { name: "Xuất khẩu & KCN", sectors: [], industries: ["Vận tải", "Hóa chất"], symbols: [] },
  { name: "Phòng thủ", sectors: ["Y tế", "Điện, nước & xăng dầu khí đốt", "Viễn thông"], industries: [], symbols: [] },
];
function bindGroupEditor(g, GROUPS, rows) {
  const box = $("#gEdit"); if (!box) return;
  const parseSyms = (v) => [...new Set(String(v).toUpperCase().split(/[^A-Z0-9]+/).filter((x) => /^[A-Z0-9]{3}$/.test(x)))];
  const collect = () => {
    const sectors = $$("[data-gs]", box).filter((x) => x.checked).map((x) => x.dataset.gs);
    const ss = new Set(sectors);
    const industries = $$("[data-gi]", box).filter((x) => x.checked && !ss.has(x.dataset.parent)).map((x) => x.dataset.gi);
    return { name: $("#gName").value.trim(), sectors, industries, symbols: parseSyms($("#gSyms").value), exclude: parseSyms($("#gEx").value) };
  };
  const upd = () => { const c = collect(); $("#gCnt").textContent = `→ ${groupMembers(c, rows).length} mã`; };
  $$("[data-gs]", box).forEach((cb) => (cb.onchange = () => { $$(`[data-gi][data-parent="${CSS.escape(cb.dataset.gs)}"]`, box).forEach((x) => { x.disabled = cb.checked; x.checked = cb.checked; }); upd(); }));
  $$("[data-gi], #gSyms, #gEx", box).forEach((x) => (x.oninput = upd));
  $$("[data-tpl]", box).forEach((b) => (b.onclick = () => {
    const tp = GROUP_TEMPLATES[Number(b.dataset.tpl)];
    if (!$("#gName").value.trim()) $("#gName").value = tp.name;
    $$("[data-gs]", box).forEach((cb) => { cb.checked = tp.sectors.includes(cb.dataset.gs); });
    $$("[data-gi]", box).forEach((x) => { const ps = tp.sectors.includes(x.dataset.parent); x.disabled = ps; x.checked = ps || tp.industries.includes(x.dataset.gi); });
    upd();
  }));
  upd();
  const persist = async (list) => { const ok = await Store.put("groups", { list }); toast(ok ? "Đã lưu nhóm và đồng bộ" : "Đã lưu nhóm trên trình duyệt này"); };
  $("#gSave").onclick = async () => {
    const c = collect();
    if (!c.name) { toast("Đặt tên cho nhóm"); $("#gName").focus(); return; }
    if (!groupMembers(c, rows).length) { toast("Nhóm chưa có mã nào"); return; }
    const id = g.id === "new" ? "g" + Date.now().toString(36) : g.id;
    const list = GROUPS.filter((x) => x.id !== id).concat([{ id, ...c, updated: new Date().toISOString() }]);
    await persist(list);
    const h = `#/sector/${enc(id)}/g`;
    if (location.hash === h) route(); else location.hash = h;
  };
  if ($("#gDel")) $("#gDel").onclick = async () => { await persist(GROUPS.filter((x) => x.id !== g.id)); lsSet("lastSecHash", null); location.hash = "#/sector"; };
  if ($("#gClose")) $("#gClose").onclick = () => (box.hidden = true);
  if ($("#gEditBtn")) $("#gEditBtn").onclick = () => { box.hidden = !box.hidden; if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "start" }); };
}
async function viewSector(name, lvArg) {
  const [secs, rows, m, t, gr] = await Promise.all([load("data/sectors.json"), screenerRows(), load("data/market.json"), load("data/today.json"), Store.get("groups")]);
  const L2 = secs.sector || [], L3 = secs.industry || [];
  const byName2 = Object.fromEntries(L2.map((s) => [s.name, s])), byName3 = Object.fromEntries(L3.map((s) => [s.name, s]));
  let GROUPS = gr.data && Array.isArray(gr.data.list) ? gr.data.list : [];
  const isGroup = lvArg === "g";
  const group = isGroup ? (name === "new" ? { id: "new", name: "", sectors: [], industries: [], symbols: [] } : GROUPS.find((g) => g.id === name)) : null;
  if (isGroup && !group) { lsSet("lastSecHash", null); location.hash = "#/sector"; return; }
  if (!name) {
    const lh = lsGet("lastSecHash", null);
    if (lh && lh.includes("/g") && lh !== "#/sector/new/g") { location.hash = lh; return; }
    name = lsGet("lastSector", null);
    if (!name || !(byName2[name] || byName3[name])) name = (L2.find((s) => s.quadrant === "Dẫn dắt") || L2[0] || {}).name;
    if (!name) { app().innerHTML = `<div class="empty">Chưa có dữ liệu ngành – có sau lượt chạy kế tiếp.</div>`; return; }
  }
  if (isGroup) lsSet("lastSecHash", location.hash); else lsSet("lastSecHash", null);
  const level = isGroup ? "group" : lvArg === "l3" || (!byName2[name] && (byName3[name] || rows.some((r) => r.industry === name))) ? "industry" : "sector";
  if (!isGroup) lsSet("lastSector", name);
  const members = isGroup ? groupMembers(group, rows) : rows.filter((r) => r[level] === name);
  const rec = isGroup ? aggRec(members) : level === "sector" ? byName2[name] : byName3[name];
  const parent = isGroup ? null : level === "sector" ? name : (rows.find((r) => r.industry === name) || {}).sector;
  const subInd = [...new Set(rows.filter((r) => r.sector === parent).map((r) => r.industry).filter(Boolean))]
    .map((n) => ({ name: n, n: rows.filter((r) => r.industry === n).length, rec: byName3[n] })).sort((a, b) => b.n - a.n);
  const picks = new Set((t.plan?.picks || []).map((p) => p.symbol));
  const st = lsGet("secState", {}); st.preset = st.preset || "best"; st.minVal = st.minVal ?? 1; st.uptrend = !!st.uptrend; st.exch = st.exch || "";
  st.x = st.x || "pe"; st.y = st.y || "roe"; st.sort = "score"; st.asc = false;
  let customW = lsGet("customW", { ...PRESETS.best.w });

  const link = (n, lv) => `#/sector/${enc(n)}${lv === "industry" ? "/l3" : ""}`;
  const side = L2.map((s) => `<button data-go="${esc(link(s.name, "sector"))}" class="${level === "sector" && s.name === name ? "on" : ""}">
      <span><span class="quad" style="background:${qcol(s.quadrant)}"></span>${esc(s.name)}</span><small class="${cls(s.r1m)}">${pct(s.r1m, 0)}</small><small class="faint">${s.n}</small></button>
      ${s.name === parent ? subInd.map((x) => `<button class="sub ${level === "industry" && x.name === name ? "on" : ""}" data-go="${esc(link(x.name, "industry"))}"><span>${x.rec ? `<span class="quad" style="background:${qcol(x.rec.quadrant)}"></span>` : ""}${esc(x.name)}</span><small class="${cls(x.rec?.r1m)}">${x.rec ? pct(x.rec.r1m, 0) : ""}</small><small class="faint">${x.n}</small></button>`).join("") : ""}`).join("");
  const gCount = (g) => groupMembers(g, rows).length;
  const gside = `<div class="faint" style="font-size:.68rem;padding:6px 8px 2px;letter-spacing:.04em">NHÓM CỦA TÔI</div>` + GROUPS.map((g) => `<button data-go="#/sector/${enc(g.id)}/g" class="${isGroup && group.id === g.id ? "on" : ""}"><span>★ ${esc(g.name)}</span><small></small><small class="faint">${gCount(g)}</small></button>`).join("")
    + `<button data-go="#/sector/new/g" class="${isGroup && group.id === "new" ? "on" : ""}"><span class="up">＋ Tự nhóm ngành / mã</span><small></small><small></small></button><div class="faint" style="font-size:.68rem;padding:8px 8px 2px;letter-spacing:.04em">NGÀNH CÓ SẴN</div>`;
  const gopts = `<optgroup label="Nhóm của tôi">${GROUPS.map((g) => `<option value="#/sector/${enc(g.id)}/g" ${isGroup && group.id === g.id ? "selected" : ""}>★ ${esc(g.name)} (${gCount(g)})</option>`).join("")}<option value="#/sector/new/g" ${isGroup && group.id === "new" ? "selected" : ""}>＋ Tự nhóm ngành / mã</option></optgroup><optgroup label="Ngành có sẵn">`;
  const opts = L2.map((s) => `<option value="${esc(link(s.name, "sector"))}" ${level === "sector" && s.name === name ? "selected" : ""}>${esc(s.name)} (${s.n})</option>
      ${s.name === parent ? subInd.map((x) => `<option value="${esc(link(x.name, "industry"))}" ${level === "industry" && x.name === name ? "selected" : ""}>  └ ${esc(x.name)} (${x.n})</option>`).join("") : ""}`).join("");
  const bt = level === "sector" ? (secs.backtest || {})[name] : null;
  const factOpts = (sel) => Object.entries(FACT).map(([k, [n]]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${esc(n)}</option>`).join("");

  app().innerHTML = `
  <div class="g g-side">
    <aside class="panel flush"><div class="ph"><h2>Ngành</h2><span class="meta">1 tháng · số mã</span></div>
      <div class="only-m" style="padding:0 10px 10px"><select id="secSel" style="width:100%;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--surface)">${gopts}${opts}</optgroup></select></div>
      <div class="sec-list only-d" style="padding:0 6px 8px">${gside}${side}</div>
      <div class="only-d" style="padding:4px 10px 10px">${L2.length ? rrgSvg(L2, level === "sector" ? name : parent || "", { short: true, labels: false, h: 260, w: 300 }) : ""}</div></aside>
    <div class="stack">
      <div class="ph" style="margin:0"><h1>${esc(isGroup ? group.name || "Nhóm mới" : name)}</h1>
        ${rec?.quadrant ? `<span class="pill" style="color:${qcol(rec.quadrant)}"><span class="quad" style="background:${qcol(rec.quadrant)}"></span>${esc(rec.quadrant)}</span>` : ""}
        <span class="pill">${isGroup ? `Nhóm tự tạo · ${group.sectors.length} ngành, ${group.industries.length} nhóm ngành, ${group.symbols.length} mã lẻ` : level === "sector" ? "Ngành cấp 2" : "Nhóm ngành cấp 3"}${level === "industry" && parent ? " · thuộc " + esc(parent) : ""}</span>
        ${isGroup && group.id !== "new" ? `<button class="chip" id="gEditBtn">Sửa nhóm</button>` : ""}
        <span class="meta">${members.length} mã · ${members.filter((r) => r.liquid_ok).length} mã thanh khoản</span></div>
      ${isGroup ? groupEditor(group, rows) : ""}
      ${isGroup ? (members.length ? kpis([["Số ngành", rec.n_sec], ["Vốn hoá", mcapFmt(rec.mcap_bn)], ["GTGD/ngày", bn(rec.value_bn)], ["1 tuần", pct(rec.r1w), cls(rec.r1w)], ["1 tháng", pct(rec.r1m), cls(rec.r1m)],
          ["3 tháng", pct(rec.r3m), cls(rec.r3m)], ["1 năm", pct(rec.r1y), cls(rec.r1y)], ["% xu hướng tăng", nf(rec.up_pct, 0) + "%"], ["P/E trung vị", nf(rec.pe_med, 1)], ["P/B", nf(rec.pb_med)], ["ROE", pct(rec.roe_med, 1, false)],
          ["LN 12T", pct(rec.ni_yoy_med), cls(rec.ni_yoy_med)], ["DT 12T", pct(rec.rev_yoy_med), cls(rec.rev_yoy_med)], ["Cổ tức", pct(rec.div_med, 1, false)], ["F-Score", nf(rec.fscore_med, 1)], ["Vay/Vốn", nf(rec.de_med)],
          ["Tiềm năng TV", pct(rec.upside_med), cls(rec.upside_med)], ["Điểm TV", scoreCell(rec.composite_med)]]) : `<div class="empty">Nhóm chưa có mã nào – chọn ngành hoặc nhập mã ở khung trên.</div>`)
      : rec ? kpis([["Vốn hoá", mcapFmt(rec.mcap_bn)], ["GTGD/ngày", bn(rec.value_bn)], ["1 tuần", pct(rec.r1w), cls(rec.r1w)], ["1 tháng", pct(rec.r1m), cls(rec.r1m)], ["3 tháng", pct(rec.r3m), cls(rec.r3m)],
        ["6 tháng", pct(rec.r6m), cls(rec.r6m)], ["1 năm", pct(rec.r1y), cls(rec.r1y)], ["% trên MA50", nf(rec.above50, 0) + "%"], ["% trên MA200", nf(rec.above200, 0) + "%"],
        ["RS-Ratio / Mom", `${nf(rec.rs_ratio, 1)} / ${nf(rec.rs_mom, 1)}`], ["P/E trung vị", nf(rec.pe_med, 1)], ["P/E so lịch sử", isNum(rec.pe_pctl_hist) ? `rẻ hơn ${nf(100 - rec.pe_pctl_hist, 0)}% thời gian` : "—", "", "Tỷ lệ các quý trong 6 năm có P/E ngành cao hơn hiện tại"],
        ["P/B", nf(rec.pb_med)], ["ROE", nf(rec.roe_med, 1) + "%"], ["LN 12T", pct(rec.ni_yoy_med), cls(rec.ni_yoy_med)], ["DT 12T", pct(rec.rev_yoy_med), cls(rec.rev_yoy_med)],
        ["Cổ tức", nf(rec.div_med, 1) + "%"], ["F-Score", nf(rec.fscore_med, 1)], ["Vay/Vốn", nf(rec.de_med)], ["Tiềm năng TV", pct(rec.upside_med), cls(rec.upside_med)],
        ["Điểm TV", scoreCell(rec.composite_med)], ["SMC TB", isNum(rec.smc_bias) ? `<span class="${rec.smc_bias >= 0.25 ? "up" : rec.smc_bias <= -0.25 ? "down" : ""}">${nf(rec.smc_bias, 2)}</span>` : "—"]])
        : `<p class="note">Nhóm ngành nhỏ (dưới 3 mã thanh khoản) nên chưa có chỉ số ngành – vẫn xếp hạng được các mã bên dưới.</p>`}
      ${isGroup && members.length ? `<section class="panel flush"><div class="ph"><h2>Thành phần nhóm</h2><span class="meta">theo ngành gốc · alpha = kết quả backtest chọn mã trong ngành đó</span></div><div class="tw"><table id="gComp"></table></div></section>` : ""}
      ${rec && !isGroup ? `<div class="g g2">
        <section class="panel"><div class="ph"><h2>Chỉ số ngành so với VN-Index</h2><span class="meta">1 năm, cùng gốc 100</span></div><div class="chart sm" id="secIdx"></div>
          <div class="leg"><span><i style="background:${css("--brand")}"></i>${esc(name)}</span><span><i style="background:${css("--ink-3")}"></i>VN-Index</span></div></section>
        <section class="panel"><div class="ph"><h2>P/E ngành theo quý</h2><span class="meta">trung vị các mã có lãi</span></div>
          ${rec.pe_hist ? lineSvg([{ name: "P/E trung vị", color: css("--brand"), pts: rec.pe_hist.map((p) => ({ x: p.p, y: p.v })) }], { h: 200, hlines: [{ y: rec.pe_med, label: "hiện tại " + nf(rec.pe_med, 1), color: css("--ref") }], label: "P/E ngành" })
            + `<p class="faint" style="font-size:.74rem">P/E hiện tại cao hơn ${nf(rec.pe_pctl_hist, 0)}% số quý trong lịch sử. Thấp (&lt;30%) = ngành đang rẻ so với chính nó.</p>` : `<p class="muted">Chưa đủ lịch sử P/E.</p>`}</section></div>` : ""}

      <section class="panel"><div class="ph"><h2>Chạy phương án lọc trong ngành</h2><span class="meta">xếp hạng phần trăm so với chính các mã cùng ngành</span></div>
        <div class="views" id="presets">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" class="${k === st.preset ? "on" : ""}">${esc(p.name)}${p.tag ? ` <small>✓</small>` : ""}</button>`).join("")}</div>
        <p id="pDesc" class="muted" style="font-size:.8rem"></p>
        <div class="filters" style="margin-top:6px">
          <div class="field w60"><label>GTGD ≥ (tỷ)</label><input id="sV" inputmode="decimal" value="${st.minVal}"></div>
          <div class="field w90"><label>Sàn</label><select id="sE"><option value="">Cả 3 sàn</option>${["HOSE", "HNX", "UPCOM"].map((e) => `<option ${st.exch === e ? "selected" : ""}>${e}</option>`).join("")}</select></div>
          <label style="display:flex;gap:5px;align-items:center;font-size:.8rem"><input type="checkbox" id="sP"> Chỉ mã có lãi</label>
          <label style="display:flex;gap:5px;align-items:center;font-size:.8rem"><input type="checkbox" id="sU" ${st.uptrend ? "checked" : ""}> Chỉ xu hướng tăng (như hệ thống mua)</label>
          ${isGroup ? `<label style="display:flex;gap:5px;align-items:center;font-size:.8rem" title="Bật: ngân hàng so với ngân hàng, thép so với thép rồi mới gộp lại. Tắt: so tất cả mã trong nhóm với nhau."><input type="checkbox" id="sR" ${st.relative !== false ? "checked" : ""}> So với ngành gốc của từng mã</label>` : ""}
        </div>
        <div id="custom" class="sec" hidden></div></section>
      <div class="podium" id="podium"></div>
      <section class="panel flush"><div class="ph"><h2>Bảng xếp hạng</h2><span class="meta" id="rkMeta"></span></div><div class="tw tall"><table id="rk"></table></div>
        <p class="faint" style="font-size:.72rem;padding:6px 12px">Màu nền mỗi ô = thứ hạng trong ngành (xanh đậm = tốt nhất ngành, đỏ = kém nhất). Thiếu số liệu bị tính như hạng 30/100.</p></section>
      <div class="g g2">
        <section class="panel"><div class="ph"><h2>Bản đồ trong ngành</h2><span class="meta">
          <select id="sx" aria-label="Trục ngang">${factOpts(st.x)}</select> × <select id="sy" aria-label="Trục dọc">${factOpts(st.y)}</select></span></div>
          <div id="scatter"></div><p class="faint" style="font-size:.72rem">Bóng to = vốn hoá lớn · màu = điểm phương án · viền đậm = top 3.</p></section>
        <section class="panel"><div class="ph"><h2>Kiểm chứng chọn mã trong ngành</h2><span class="meta">${bt ? `${esc(secs.backtest_range?.[0] || "")} → ${esc(secs.backtest_range?.[1] || "")}` : ""}</span></div>
          ${bt ? `${kpis([["Top 3 / năm", pct(bt.top.cagr), cls(bt.top.cagr)], ["Cả ngành / năm", pct(bt.all.cagr), cls(bt.all.cagr)], ["Vượt trội (alpha)", pct(bt.alpha), cls(bt.alpha)],
            ["Sụt tối đa top 3", pct(bt.top.max_dd), "down"], ["Sụt tối đa ngành", pct(bt.all.max_dd), "down"], ["Sharpe top / ngành", `${nf(bt.top.sharpe)} / ${nf(bt.all.sharpe)}`], ["Số mã TB trong ngành", nf(bt.avg_n, 0)], ["Số tháng", bt.months]])}
            <div class="chart sm sec" id="secBt"></div><div class="leg"><span><i style="background:${css("--up")}"></i>Top 3 "Tốt nhất ngành"</span><span><i style="background:${css("--ink-3")}"></i>Mua đều cả ngành</span></div>
            <div class="tw sec"><table><thead><tr><th class="l">Năm</th>${Object.keys(bt.top.yearly || {}).map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
              <tr><td class="l">Top 3</td>${Object.values(bt.top.yearly || {}).map((v) => `<td class="${cls(v)}">${pct(v, 0)}</td>`).join("")}</tr>
              <tr><td class="l">Cả ngành</td>${Object.values(bt.all.yearly || {}).map((v) => `<td class="${cls(v)}">${pct(v, 0)}</td>`).join("")}</tr></tbody></table></div>
            <p class="${bt.alpha > 0 ? "" : "note"}" style="font-size:.78rem;margin-top:6px">${bt.alpha > 0 ? `Ở ngành này, chọn 3 mã theo phương án "Tốt nhất ngành" mỗi tháng đã thắng mua đều cả ngành ${pct(bt.alpha)}/năm.`
              : `Ở ngành này, chọn mã theo công thức <b>chưa thắng</b> mua đều cả ngành (${pct(bt.alpha)}/năm) – đừng kỳ vọng nhiều vào việc chọn mã; ưu tiên thời điểm vào ngành và cắt lỗ.`}
              Lần chọn gần nhất: ${(bt.last_picks || []).map((s) => `<a href="#/s/${s}">${s}</a>`).join(", ") || "không có mã đạt (xu hướng giảm)"}.</p>`
            : isGroup ? `<p class="muted">Nhóm tự tạo chưa có backtest riêng. Xem cột <b>Alpha chọn mã</b> ở bảng Thành phần nhóm: ngành nào alpha dương thì xếp hạng trong ngành đó đáng tin hơn.</p>`
            : `<p class="muted">Backtest chỉ chạy cho ngành cấp 2 có đủ mã thanh khoản và BCTC.${level === "industry" && parent && (secs.backtest || {})[parent] ? ` Xem ngành <a href="${link(parent, "sector")}">${esc(parent)}</a>.` : ""}</p>`}</section>
      </div>
    </div>
  </div>`;

  $$("[data-go]").forEach((b) => (b.onclick = () => (location.hash = b.dataset.go)));
  $("#secSel").onchange = (e) => (location.hash = e.target.value);
  const save = () => lsSet("secState", { preset: st.preset, minVal: st.minVal, uptrend: st.uptrend, exch: st.exch, x: st.x, y: st.y, relative: st.relative });
  const weights = () => (st.preset === "custom" ? customW : PRESETS[st.preset].w);

  const drawCustom = () => {
    const box = $("#custom");
    box.hidden = st.preset !== "custom";
    if (box.hidden) return;
    box.innerHTML = `<div class="weights">${Object.entries(customW).map(([k, w]) => `<div class="w-item"><header><b>${esc(FACT[k]?.[0] || k)}</b><span><output>${w}</output>
      <button class="chip" data-rm="${k}" aria-label="Bỏ ${esc(FACT[k]?.[0] || k)}">✕</button></span></header>
      <input type="range" min="0" max="50" step="5" value="${w}" data-cw="${k}"><p>${FACT[k]?.[1] < 0 ? "thấp hơn là tốt" : "cao hơn là tốt"}${FACT[k]?.[3] ? " · chỉ tính khi > 0" : ""}</p></div>`).join("")}</div>
      <div class="filters" style="margin-top:6px"><div class="field w200"><label>Thêm yếu tố</label><select id="cAdd"><option value="">— chọn —</option>${Object.entries(FACT).filter(([k]) => !(k in customW)).map(([k, [n]]) => `<option value="${k}">${esc(n)}</option>`).join("")}</select></div>
      <button class="btn" id="cReset">Lấy theo "Tốt nhất ngành"</button></div>`;
    $$("[data-cw]").forEach((el) => (el.oninput = () => { customW[el.dataset.cw] = Number(el.value); el.parentElement.querySelector("output").textContent = el.value; lsSet("customW", customW); draw(); }));
    $$("[data-rm]").forEach((b) => (b.onclick = () => { delete customW[b.dataset.rm]; lsSet("customW", customW); drawCustom(); draw(); }));
    $("#cAdd").onchange = (e) => { if (e.target.value) { customW[e.target.value] = 15; lsSet("customW", customW); drawCustom(); draw(); } };
    $("#cReset").onclick = () => { customW = { ...PRESETS.best.w }; lsSet("customW", customW); drawCustom(); draw(); };
  };

  let ranked = [];
  const draw = () => {
    const P = PRESETS[st.preset];
    $("#pDesc").innerHTML = `<b>${esc(P.name)}</b>: ${esc(P.desc)}${P.w ? ` <span class="faint">(${Object.entries(P.w).map(([k, w]) => `${FACT[k][0]} ${w}%`).join(" · ")})</span>` : ""}`;
    const profit = $("#sP").checked;
    const minV = Number(String(st.minVal).replace(",", ".")) || 0;
    const base = members.filter((r) => (r.avg_value_bn ?? 0) >= minV && (!st.exch || r.exchange === st.exch) && (!profit || (isNum(r.pe) && r.pe > 0) || (isNum(r.eps) && r.eps > 0)));
    const W = weights();
    // xếp hạng phần trăm trên toàn bộ mã đạt điều kiện thanh khoản (để so cùng mặt bằng), sau đó mới lọc xu hướng
    if (isGroup && st.relative !== false) {
      // xếp hạng trong ngành gốc (nhóm ngành cấp 3 nếu đủ ≥ 4 mã, không thì ngành cấp 2, không thì cả nhóm) rồi gộp
      const cnt = (k, v) => base.filter((r) => r[k] === v).length;
      const buckets = {};
      base.forEach((r) => { const key = r.industry && cnt("industry", r.industry) >= 4 ? "i:" + r.industry : r.sector && cnt("sector", r.sector) >= 4 ? "s:" + r.sector : "_all"; (buckets[key] = buckets[key] || []).push(r); });
      const full = Object.fromEntries(rankGroup(base, W).map((x) => [x.r.symbol, x]));
      ranked = Object.entries(buckets).flatMap(([k, g]) => (k === "_all" ? g.map((r) => full[r.symbol]) : rankGroup(g, W))).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    } else ranked = rankGroup(base, W);
    ranked = ranked.filter((x) => !st.uptrend || x.r.trend === "up");
    const keys = Object.keys(W).filter((k) => W[k] > 0 && FACT[k]);
    $("#rkMeta").textContent = `${ranked.length}/${members.length} mã · ${keys.length} yếu tố`;
    // bục
    $("#podium").innerHTML = ranked.slice(0, 3).map((x, i) => {
      const r = x.r;
      const fs = keys.map((k) => [k, x.pc[k]]).filter(([, p]) => p != null).sort((a, b) => b[1] - a[1]);
      const good = fs.slice(0, 3), bad = fs.length > 3 ? fs[fs.length - 1] : null;
      return `<section class="panel"><div class="ph"><span class="rank">#${i + 1} trong ${ranked.length}</span><span class="meta">${scoreCell(x.score)}</span></div>
        <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap"><a class="sym" style="font-size:1.15rem" href="#/s/${r.symbol}">${r.symbol}</a><b>${nf(r.price)}</b><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)}</small>
          ${picks.has(r.symbol) ? '<span class="pill buy">MUA hôm nay</span>' : ""}${r.trend === "down" ? '<span class="pill sell">xu hướng giảm</span>' : r.trend === "up" ? '<span class="pill buy">xu hướng tăng</span>' : '<span class="pill">đi ngang</span>'}</div>
        <small class="faint" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name || "")}</small>
        <ul class="checks">${good.map(([k, p]) => `<li class="ok">${esc(FACT[k][0])} ${fmtFact(k, r[k])} <small class="faint">– hơn ${nf(p, 0)}% ngành</small></li>`).join("")}
          ${bad ? `<li>${esc(FACT[bad[0]][0])} ${fmtFact(bad[0], r[bad[0]])} <small class="faint">– điểm yếu</small></li>` : ""}</ul>
        <p style="font-size:.78rem">Hợp lý <b>${nf(r.fair)}</b> · tiềm năng <b class="${cls(r.upside)}">${pct(r.upside, 0)}</b> · KT <b>${esc(r.ta_label || "—")}</b> · điểm TH <b>${nf(r.composite, 0)}</b></p></section>`;
    }).join("") || `<div class="empty">Không mã nào đạt điều kiện. Thử hạ GTGD tối thiểu hoặc bỏ lọc xu hướng.</div>`;
    // bảng
    const cols = [["_i", "#"], ["symbol", "Mã"], ["score", "Điểm PA"], ...keys.map((k) => [k, FACT[k][0], "f"]), ["price", "Giá"], ["chg1m", "1 tháng"], ["upside", "Tiềm năng"], ["ta_label", "Kỹ thuật", "l"],
      ["trend", "Xu hướng", "l"], ["composite", "Điểm TH"], ["smc", "SMC"], ["avg_value_bn", "GTGD"], ["mcap_bn", "Vốn hoá"], ["_tag", "", "l"]];
    const val = (x, k) => (k === "score" ? x.score : k === "_i" ? null : x.r[k]);
    const rowsS = st.sort === "score" ? ranked : [...ranked].sort((a, b) => { const p = val(a, st.sort), q = val(b, st.sort); if (p == null) return 1; if (q == null) return -1; return (p > q ? 1 : p < q ? -1 : 0) * (st.asc ? 1 : -1); });
    $("#rk").innerHTML = `<thead><tr>${cols.map(([k, n, f]) => `<th data-k="${k}" class="${k === "symbol" ? "sym" : f === "l" ? "l" : ""} ${st.sort === k ? "sorted" + (st.asc ? " asc" : "") : ""}">${esc(n)}</th>`).join("")}</tr></thead><tbody>
      ${rowsS.map((x) => { const r = x.r; const rank = ranked.indexOf(x) + 1;
        return `<tr class="${rank <= 3 ? "hl" : ""}">${cols.map(([k, , f]) => {
          if (k === "_i") return `<td>${rank}</td>`;
          if (k === "symbol") return `<td class="sym"><a href="#/s/${r.symbol}" title="${esc(r.name || "")}">${r.symbol}</a></td>`;
          if (k === "score") return `<td>${scoreCell(x.score)}${x.cover < 0.7 ? ' <small class="faint" title="thiếu số liệu">*</small>' : ""}</td>`;
          if (f === "f") return `<td style="background:${isNum(x.pc[k]) ? scoreColor(x.pc[k]) : "transparent"}">${fmtFact(k, r[k])}</td>`;
          if (k === "price") return `<td>${nf(r.price)}</td>`;
          if (k === "chg1m" || k === "upside") return `<td class="${cls(r[k])}">${pct(r[k], 0)}</td>`;
          if (k === "trend") return `<td class="l ${r.trend === "up" ? "up" : r.trend === "down" ? "down" : ""}">${TREND_VI[r.trend] || "—"}</td>`;
          if (k === "composite" || k === "smc") return `<td>${scoreCell(r[k])}</td>`;
          if (k === "avg_value_bn") return `<td>${nf(r[k], 1)}</td>`;
          if (k === "mcap_bn") return `<td>${mcapFmt(r[k])}</td>`;
          if (k === "_tag") return `<td class="l">${picks.has(r.symbol) ? '<span class="pill buy">MUA</span> ' : ""}${Object.keys(BASKET_SHORT).filter((b) => r["in_" + b]).map((b) => `<span class="pill">${BASKET_SHORT[b]}</span>`).join(" ")}</td>`;
          return `<td class="l">${esc(r[k] ?? "—")}</td>`;
        }).join("")}</tr>`; }).join("")}</tbody>`;
    $$("#rk th").forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (k === "_i" || k === "_tag") { st.sort = "score"; st.asc = false; } else if (st.sort === k) st.asc = !st.asc; else { st.sort = k; st.asc = FACT[k]?.[1] === -1 || k === "symbol"; } draw(); }));
    drawScatter();
    if (isGroup && $("#gComp")) {
      const bySec = {};
      members.forEach((r) => { (bySec[r.sector || "Khác"] = bySec[r.sector || "Khác"] || []).push(r); });
      const totM = members.reduce((a, r) => a + (r.mcap_bn || 0), 0) || 1;
      $("#gComp").innerHTML = `<thead><tr><th class="l">Ngành gốc</th><th>Số mã</th><th>Tỷ trọng vốn hoá</th><th>1 tháng (ngành)</th><th class="l">Vòng</th><th>Alpha chọn mã</th><th class="l">Mạnh nhất trong nhóm</th></tr></thead><tbody>
        ${Object.entries(bySec).sort((a, b) => b[1].length - a[1].length).map(([sn, M]) => { const sr = byName2[sn], b = (secs.backtest || {})[sn]; const best = ranked.filter((x) => x.r.sector === sn).slice(0, 3);
          return `<tr><td class="l"><a href="#/sector/${enc(sn)}">${esc(sn)}</a></td><td>${M.length}</td><td>${pct(M.reduce((a, r) => a + (r.mcap_bn || 0), 0) / totM * 100, 0, false)}</td>
          <td class="${cls(sr?.r1m)}">${pct(sr?.r1m)}</td><td class="l">${sr ? `<span class="quad" style="background:${qcol(sr.quadrant)}"></span>${esc(sr.quadrant)}` : "—"}</td>
          <td class="${cls(b?.alpha)}">${b ? pct(b.alpha) : "—"}</td><td class="l">${best.map((x) => `<a href="#/s/${x.r.symbol}">${x.r.symbol}</a> <small class="faint">${nf(x.score, 0)}</small>`).join(" · ") || "—"}</td></tr>`; }).join("")}</tbody>`;
    }
  };
  const drawScatter = () => {
    const top = new Set(ranked.slice(0, 3).map((x) => x.r.symbol));
    $("#scatter").innerHTML = scatterSvg(ranked.map((x) => ({ x: x.r[st.x], y: x.r[st.y], r: Math.max(3, Math.min(16, Math.sqrt((x.r.mcap_bn || 100) / 400))), label: x.r.symbol,
      color: !isNum(x.score) ? css("--ink-3") : x.score >= 60 ? css("--up") : x.score >= 40 ? css("--ref") : css("--down"), hl: top.has(x.r.symbol), href: `#/s/${x.r.symbol}`,
      title: `${x.r.symbol}: ${FACT[st.x][0]} ${fmtFact(st.x, x.r[st.x]).replace(/<[^>]+>/g, "")}, ${FACT[st.y][0]} ${fmtFact(st.y, x.r[st.y]).replace(/<[^>]+>/g, "")} · điểm ${nf(x.score, 0)}` })),
    { xl: FACT[st.x][0], yl: FACT[st.y][0], clip: true, h: 320, labels: ranked.length <= 40 });
  };
  $$("#presets button").forEach((b) => (b.onclick = () => {
    st.preset = b.dataset.p; save();
    $$("#presets button").forEach((x) => x.classList.toggle("on", x === b));
    if (st.preset === "custom" && !Object.keys(customW).length) customW = { ...PRESETS.best.w };
    $("#sP").checked = !!PRESETS[st.preset].guard?.profit;
    st.sort = "score"; drawCustom(); draw();
  }));
  $("#sP").checked = !!PRESETS[st.preset].guard?.profit;
  $("#sV").oninput = (e) => { st.minVal = e.target.value; save(); draw(); };
  $("#sE").onchange = (e) => { st.exch = e.target.value; save(); draw(); };
  $("#sP").onchange = draw;
  $("#sU").onchange = (e) => { st.uptrend = e.target.checked; save(); draw(); };
  if ($("#sR")) $("#sR").onchange = (e) => { st.relative = e.target.checked; save(); draw(); };
  if (isGroup) bindGroupEditor(group, GROUPS, rows);
  $("#sx").onchange = (e) => { st.x = e.target.value; save(); drawScatter(); };
  $("#sy").onchange = (e) => { st.y = e.target.value; save(); drawScatter(); };
  drawCustom(); draw();

  // biểu đồ
  if (rec && rec.index?.length) {
    const c = mkChart($("#secIdx"), { rightPriceScale: { borderColor: css("--line") } });
    const vi = m.indices.VNINDEX?.ohlc;
    const s1 = rec.index.filter((p) => isNum(p.v));
    const base1 = s1[0].v;
    c.addLineSeries({ color: css("--brand"), lineWidth: 2, priceLineVisible: false }).setData(s1.map((p) => ({ time: p.d, value: (p.v / base1) * 100 })));
    if (vi) {
      const map = Object.fromEntries(vi.t.map((d, i) => [d, vi.c[i]]));
      const first = s1.find((p) => map[p.d] != null);
      if (first) {
        const b0 = map[first.d];
        c.addLineSeries({ color: css("--ink-3"), lineWidth: 1, priceLineVisible: false }).setData(s1.filter((p) => map[p.d] != null).map((p) => ({ time: p.d, value: (map[p.d] / b0) * 100 })));
      }
    }
    c.timeScale().fitContent();
  }
  if (bt && bt.curve?.length) {
    const c = mkChart($("#secBt"), { rightPriceScale: { mode: 1, borderColor: css("--line") } });
    c.addLineSeries({ color: css("--up"), lineWidth: 2, priceLineVisible: false }).setData(bt.curve.map((p) => ({ time: p.d, value: p.top })));
    c.addLineSeries({ color: css("--ink-3"), lineWidth: 1, priceLineVisible: false }).setData(bt.curve.map((p) => ({ time: p.d, value: p.all })));
    c.timeScale().fitContent();
  }
}

// ================================================================ DANH MỤC
async function viewPortfolio() {
  const [{ data, remote }, t, rows] = await Promise.all([Store.get("portfolio"), load("data/today.json"), screenerRows()]);
  const pf = data || { holdings: [], cash: 0, capital: null };
  pf.holdings = pf.holdings || [];
  const priceOf = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const adv = Object.fromEntries(((t.portfolio && t.portfolio.positions) || []).map((p) => [p.symbol, p]));
  const render = () => {
    let mv = 0, costT = 0, day = 0;
    const bySec = {};
    pf.holdings.forEach((h) => { const r = priceOf[h.symbol]; const px = r ? r.price : h.cost; const v = h.qty * px * 1000; mv += v; costT += h.qty * h.cost * 1000;
      if (r && isNum(r.chg1d)) day += v - v / (1 + r.chg1d / 100); const s = r?.sector || "Khác"; bySec[s] = (bySec[s] || 0) + v; });
    const total = mv + Number(pf.cash || 0);
    const denom = capitalOf(pf) || total;
    app().innerHTML = `
    <div class="ph"><h1>Danh mục của tôi</h1><span class="meta">${remote ? "Đã đồng bộ mọi thiết bị" : "Đang lưu trong trình duyệt này (chưa kết nối máy chủ)"}</span></div>
    ${kpis([["Tổng tài sản", vnd(total)], ["Giá trị cổ phiếu", vnd(mv)], ["Tiền mặt", vnd(pf.cash)], ["Lãi/lỗ tạm tính", `${vnd(mv - costT)} <small>${pct(costT ? (mv / costT - 1) * 100 : null)}</small>`, cls(mv - costT)],
      ["Hôm nay", vnd(day), cls(day)], ["Tỷ trọng cổ phiếu", pct(denom ? mv / denom * 100 : null, 0, false) + ` <small>/ tối đa ${t.regime.exposure}%</small>`, denom && mv / denom * 100 > t.regime.exposure ? "down" : ""],
      ["Số mã", pf.holdings.length + ` <small>/ tối đa ${t.risk?.max_positions ?? "—"}</small>`], t.portfolio?.drawdown_1y != null ? ["Sụt từ đỉnh 1 năm", pct(t.portfolio.drawdown_1y), cls(t.portfolio.drawdown_1y)] : null], true)}
    ${(t.portfolio?.warnings || []).map((w) => `<p class="note" style="margin-top:6px">${esc(w)}</p>`).join("")}
    <div class="g g-main sec">
      <section class="panel flush"><div class="ph"><h2>Mã đang nắm</h2><span class="meta">tư vấn cập nhật sau mỗi lượt chạy</span></div><div class="tw"><table><thead><tr>
        <th class="sym">Mã</th><th>KL</th><th>Giá vốn</th><th>Giá</th><th>Hôm nay</th><th>Lãi/lỗ</th><th>Giá trị</th><th>Tỷ trọng</th><th>Hợp lý</th><th class="l">Kỹ thuật</th><th class="l">Tư vấn</th><th></th></tr></thead><tbody>
      ${pf.holdings.length ? pf.holdings.map((h, i) => { const r = priceOf[h.symbol]; const px = r ? r.price : null; const a = adv[h.symbol]; const v = h.qty * (px ?? h.cost) * 1000;
        return `<tr><td class="sym"><a href="#/s/${h.symbol}">${h.symbol}</a></td><td>${nf(h.qty, 0)}</td><td>${nf(h.cost)}</td><td>${nf(px)}</td><td class="${cls(r?.chg1d)}">${pct(r?.chg1d, 1)}</td>
        <td class="${cls(px && (px / h.cost - 1))}">${pct(px ? (px / h.cost - 1) * 100 : null)}</td><td>${big(v)}</td><td>${pct(denom ? v / denom * 100 : null, 1, false)}</td><td>${nf(r?.fair)}</td>
        <td class="l">${esc(r?.ta_label || "—")}</td>
        <td class="wrap">${a ? `<b class="${a.severity >= 2 ? "down" : a.severity === 1 ? "ref" : ""}">${esc(a.action)}</b> – ${esc((a.reasons || []).join("; "))}` : `<small class="muted">Tư vấn có sau lượt chạy kế tiếp</small>`}</td>
        <td><button class="btn" data-del="${i}" aria-label="Xoá ${h.symbol}">Xoá</button></td></tr>`; }).join("")
        : `<tr><td colspan="12" class="l" style="text-align:center;padding:16px">Chưa có mã nào. Thêm mã đang nắm ở bên cạnh.</td></tr>`}
      </tbody></table></div></section>
      <div class="stack">
        ${panel("Vốn", `<div class="filters"><div class="field"><label for="cap">Tổng vốn cho chứng khoán (đồng)</label><input id="cap" inputmode="numeric" value="${pf.capital ?? ""}" placeholder="500000000"></div>
          <div class="field"><label for="cash">Tiền mặt hiện có (đồng)</label><input id="cash" inputmode="numeric" value="${pf.cash ?? ""}"></div><button class="btn primary" id="saveCap">Lưu</button></div>
          <p class="faint" style="font-size:.74rem">Vốn dùng để tính số cổ phiếu cần mua và tỷ trọng.</p>`)}
        ${panel("Thêm / cập nhật mã", `<div class="filters">
          <div class="field w60"><label for="hs">Mã</label><input id="hs" placeholder="FPT" autocapitalize="characters"></div>
          <div class="field w90"><label for="hq">KL (cp)</label><input id="hq" inputmode="numeric" placeholder="1000"></div>
          <div class="field w90"><label for="hc">Giá vốn (nghìn)</label><input id="hc" inputmode="decimal" placeholder="95,5"></div>
          <div class="field w140"><label for="hd">Ngày mua</label><input id="hd" type="date"></div>
          <div class="field w140"><label for="hb">Mua theo rổ</label><select id="hb"><option value="">Không rõ</option>${Object.entries(BASKET_SHORT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
          <button class="btn primary" id="add">Lưu mã</button></div><p class="faint" style="font-size:.74rem">Nhập lại cùng mã để cập nhật. Giá vốn theo nghìn đồng như bảng điện.</p>`)}
        ${Object.keys(bySec).length ? panel("Phân bổ theo ngành", `<div class="tw"><table><tbody>${Object.entries(bySec).sort((a, b) => b[1] - a[1]).map(([s, v]) => `<tr><td class="l">${esc(s)}</td>
          <td style="width:45%">${minibar(denom ? v / denom * 100 / ((t.risk?.max_weight_per_sector || 30) / 100) : 0, denom && v / denom * 100 > (t.risk?.max_weight_per_sector || 30) ? css("--down") : css("--brand"))}</td><td>${pct(denom ? v / denom * 100 : null, 1, false)}</td></tr>`).join("")}</tbody></table></div>
          <p class="faint" style="font-size:.72rem">Vạch đầy = chạm trần ${t.risk?.max_weight_per_sector ?? 30}% vốn/ngành.</p>`) : ""}
      </div>
    </div>`;
    $("#saveCap").onclick = async () => { pf.capital = Number(String($("#cap").value).replace(/\D/g, "")) || null; pf.cash = Number(String($("#cash").value).replace(/\D/g, "")) || 0; await save(); };
    $("#add").onclick = async () => {
      const s = $("#hs").value.trim().toUpperCase(); const q = Number(String($("#hq").value).replace(/\D/g, ""));
      const c = Number(String($("#hc").value).replace(",", "."));
      if (!/^[A-Z0-9]{3}$/.test(s) || !q || !c) { toast("Nhập đủ mã (3 ký tự), khối lượng và giá vốn"); return; }
      const h = { symbol: s, qty: q, cost: c, date: $("#hd").value || new Date().toISOString().slice(0, 10), basket: $("#hb").value || null };
      const i = pf.holdings.findIndex((x) => x.symbol === s);
      if (i >= 0) pf.holdings[i] = h; else pf.holdings.push(h);
      await save();
    };
    $$("[data-del]").forEach((b) => (b.onclick = async () => { pf.holdings.splice(Number(b.dataset.del), 1); await save(); }));
  };
  async function save() {
    pf.updated = new Date().toISOString();
    const ok = await Store.put("portfolio", pf);
    toast(ok ? "Đã lưu và đồng bộ" : "Đã lưu trên trình duyệt này");
    render();
  }
  render();
}

// ================================================================ BỘ LỌC
const COLDEF = {
  symbol: ["Mã", "sym"], name: ["Tên", "name"], exchange: ["Sàn", "l"], sector: ["Ngành", "l"], industry: ["Nhóm ngành", "l"], subindustry: ["Ngành cấp 4", "l"],
  price: ["Giá", "x2"], chg1d: ["Hôm nay", "pct"], chg1w: ["1 tuần", "pct"], chg1m: ["1 tháng", "pct"], chg3m: ["3 tháng", "pct"], chg1y: ["1 năm", "pct"],
  ret_12_1_pct: ["12–1 tháng", "pct"], avg_value_bn: ["GTGD/ngày", "x1"], mcap_bn: ["Vốn hoá", "bn"],
  composite: ["Điểm", "score"], upside: ["Tiềm năng", "pct"], fair: ["Hợp lý", "x2"], buy_below: ["Mua dưới", "x2"], verdict: ["Định giá", "l"],
  pe: ["P/E", "x1"], pb: ["P/B", "x2"], ps: ["P/S", "x2"], ev_ebitda: ["EV/EBITDA", "x1"], earnings_yield: ["LS lợi nhuận", "p1"], fcf_yield: ["LS FCF", "p1"],
  roe: ["ROE", "p1"], roe_avg5: ["ROE TB5", "p1"], roa: ["ROA", "p1"], roic: ["ROIC", "p1"], gross_margin: ["Biên gộp", "p1"], net_margin: ["Biên ròng", "p1"], cfo_ni: ["CFO/LN", "x2"], de: ["Vay/Vốn", "x2"],
  fscore: ["F-Score", "i"], rev_yoy: ["DT 12T", "pct"], ni_yoy: ["LN 12T", "pct"], rev_q_yoy: ["DT quý", "pct"], ni_q_yoy: ["LN quý", "pct"], rev_cagr3: ["DT CAGR3", "pct"], ni_cagr3: ["LN CAGR3", "pct"],
  ni_growth_streak: ["Quý LN tăng", "i"], eps: ["EPS (đ)", "i"], bvps: ["BVPS (đ)", "i"], div_yield: ["Cổ tức", "p1"], payout_pct: ["Tỷ lệ chi trả", "p0"], cash_years: ["Năm trả TM", "i"],
  ta_score: ["Điểm KT", "i"], ta_label: ["Kỹ thuật", "l"], trend: ["Xu hướng", "trend"], rsi: ["RSI", "i"], from_hi52: ["Cách đỉnh 52T", "pct"], beta: ["Beta", "x2"], vol_1y_pct: ["Biến động", "p0"],
  rs_rating: ["RS", "i"], canslim_flags: ["CANSLIM đạt", "l"], ind_rank: ["Hạng ngành", "rank"],
  smc: ["SMC", "score"], smc_bias: ["SMC hướng", "bias"], smc_zone: ["Vị trí P/D", "zone"], vsa: ["VSA", "score"], vsa_bias: ["VSA hướng", "bias"], wyckoff_ev: ["Wyckoff", "score"], wy_phase: ["Pha Wyckoff", "wy"],
  orderflow: ["Order Flow", "score"], of_bias: ["OF hướng", "bias"], of_delta5: ["Delta 5 phiên", "dp"],
  piotroski: ["Piotroski", "score"], magic_formula: ["Magic F.", "score"], value: ["Giá trị", "score"], quality: ["Chất lượng", "score"], growth: ["Tăng trưởng", "score"], dividend: ["Cổ tức", "score"],
  momentum: ["Động lượng", "score"], canslim: ["CANSLIM", "score"], low_vol: ["Ít biến động", "score"],
};
const VIEWS = {
  overview: ["Tổng quan", ["symbol", "exchange", "sector", "price", "chg1d", "chg1m", "composite", "upside", "verdict", "pe", "pb", "roe", "ni_yoy", "fscore", "div_yield", "ta_label", "trend", "avg_value_bn", "ind_rank"]],
  valuation: ["Định giá", ["symbol", "sector", "price", "fair", "buy_below", "upside", "verdict", "pe", "pb", "ps", "ev_ebitda", "earnings_yield", "fcf_yield", "mcap_bn", "value", "magic_formula"]],
  quality: ["Chất lượng", ["symbol", "sector", "roe", "roe_avg5", "roa", "roic", "gross_margin", "net_margin", "cfo_ni", "de", "fscore", "quality", "piotroski", "composite"]],
  growth: ["Tăng trưởng", ["symbol", "sector", "rev_yoy", "ni_yoy", "rev_q_yoy", "ni_q_yoy", "rev_cagr3", "ni_cagr3", "ni_growth_streak", "eps", "pe", "growth", "canslim", "canslim_flags"]],
  dividend: ["Cổ tức", ["symbol", "sector", "price", "div_yield", "payout_pct", "cash_years", "fcf_yield", "de", "fscore", "roe", "dividend", "upside"]],
  tech: ["Kỹ thuật", ["symbol", "price", "chg1d", "chg1w", "chg1m", "chg3m", "chg1y", "ret_12_1_pct", "rsi", "from_hi52", "beta", "vol_1y_pct", "ta_score", "ta_label", "trend", "rs_rating", "momentum", "avg_value_bn"]],
  smart: ["Tạo lập & dòng tiền", ["symbol", "sector", "price", "chg1m", "smc", "smc_bias", "smc_zone", "vsa", "vsa_bias", "wyckoff_ev", "wy_phase", "orderflow", "of_bias", "of_delta5", "ta_label", "trend"]],
  methods: ["Điểm phương pháp", ["symbol", "sector", "composite", "piotroski", "magic_formula", "value", "quality", "growth", "dividend", "momentum", "canslim", "low_vol", "smc", "vsa", "wyckoff_ev", "orderflow"]],
};
const METHOD_REL = { smc: "SMC – tổng hợp", vsa: "VSA – tổng hợp", wyckoff_ev: "Wyckoff – sự kiện (SC/Spring/SOS/UTAD…)" };
function fmtCol(r, k) {
  const f = (COLDEF[k] || ["", "l"])[1], v = k === "composite" && r._score != null ? r._score : r[k];
  if (f === "sym") return `<a href="#/s/${v}" title="${esc(r.name || "")}">${v}</a>`;
  if (f === "score") return scoreCell(v);
  if (f === "pct") return `<span class="${cls(v)}">${pct(v)}</span>`;
  if (f === "p1") return isNum(v) ? nf(v, 1) + "%" : "—";
  if (f === "p0") return isNum(v) ? nf(v, 0) + "%" : "—";
  if (f === "i") return isNum(v) ? nf(v, 0) : "—";
  if (f === "x1") return nf(v, 1);
  if (f === "bn") return mcapFmt(v);
  if (f === "trend") return `<span class="${v === "up" ? "up" : v === "down" ? "down" : ""}">${TREND_VI[v] || "—"}</span>`;
  if (f === "rank") return isNum(v) ? `${nf(v, 0)}/${r.ind_n ?? "—"}` : "—";
  if (f === "bias") return isNum(v) ? `<span class="${v >= 0.25 ? "up" : v <= -0.25 ? "down" : "muted"}">${v > 0 ? "+" : ""}${nf(v, 2)}</span>` : "—";
  if (f === "zone") return isNum(v) ? `<span class="${v < 40 ? "up" : v > 60 ? "down" : ""}" title="0 = đáy biên độ (Discount), 100 = đỉnh (Premium)">${nf(v, 0)}%</span>` : "—";
  if (f === "dp") return isNum(v) ? `<span class="${cls(v)}">${pct(v * 100, 1)}</span>` : "—";
  if (f === "wy") return `<small title="${esc(v ?? "")}">${esc(wyShort(v))}</small>`;
  if (f === "x2") return nf(v);
  return esc(v ?? "—");
}

async function viewScreener(arg) {
  const [rows, meth] = await Promise.all([screenerRows(), load("data/methods.json")]);
  const W = { ...meth.weights, ...lsGet("weights", {}) };
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  const st = { exch: "", sec: "", ind: "", basket: arg || "", minVal: 3, maxPE: "", minROE: "", minF: "", minDiv: "", minUp: "", minScore: "", trend: "", text: "", sort: "composite", asc: false, view: lsGet("scrView", "overview") };
  const ps = meth.pattern_stats || {};
  app().innerHTML = `
  <div class="ph"><h1>Bộ lọc & phương pháp chọn mã</h1><span class="meta"><a href="#/guide">giải thích các phương pháp</a></span></div>
  <section class="panel"><div class="filters">
    <div class="field w140"><label>Rổ</label><select id="fB"><option value="">Tất cả mã</option>${Object.entries(meth.baskets).map(([k, b]) => `<option value="${k}" ${st.basket === k ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
    <div class="field w90"><label>Sàn</label><select id="fE"><option value="">Cả 3 sàn</option><option>HOSE</option><option>HNX</option><option>UPCOM</option></select></div>
    <div class="field w200"><label>Ngành</label><select id="fS"><option value="">Tất cả ngành</option>${sectors.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
    <div class="field w200"><label>Nhóm ngành</label><select id="fI"><option value="">Tất cả</option></select></div>
    <div class="field w90"><label>Xu hướng</label><select id="fTr"><option value="">Mọi</option><option value="up">Tăng</option><option value="side">Đi ngang</option><option value="down">Giảm</option><option value="notdown">Không giảm</option></select></div>
    <div class="field w140"><label>Tìm mã / tên</label><input id="fT" placeholder="ví dụ thép"></div>
    <div class="field w60"><label>GTGD ≥ tỷ</label><input id="fV" inputmode="decimal" value="3"></div>
    <div class="field w60"><label>P/E ≤</label><input id="fPE" inputmode="decimal"></div>
    <div class="field w60"><label>ROE ≥ %</label><input id="fR" inputmode="decimal"></div>
    <div class="field w60"><label>F-Score ≥</label><input id="fF" inputmode="numeric"></div>
    <div class="field w60"><label>Cổ tức ≥ %</label><input id="fD" inputmode="decimal"></div>
    <div class="field w60"><label>Tiềm năng ≥ %</label><input id="fU" inputmode="decimal"></div>
    <div class="field w60"><label>Điểm ≥</label><input id="fSc" inputmode="decimal"></div>
    <button class="btn" id="fClear">Xoá lọc</button>
  </div><p class="muted" id="bRule" style="margin-top:6px;font-size:.78rem"></p></section>
  <div class="views" id="views">${Object.entries(VIEWS).map(([k, [n]]) => `<button data-v="${k}" class="${k === st.view ? "on" : ""}">${esc(n)}</button>`).join("")}
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center"><small id="cnt" class="muted"></small><button class="btn" id="toGroup" title="Lưu các mã đang lọc thành một nhóm để chạy phương án ở tab Ngành">Lưu thành nhóm</button><button class="btn" id="csv">Tải CSV</button></span></div>
  <section class="panel flush"><div class="tw tall"><table id="scr"></table></div></section>
  <details class="panel sec"><summary>Trọng số các phương pháp (đổi cách tính cột Điểm)</summary>
    <div class="weights" style="margin-top:8px">${Object.entries(meth.methods).map(([k, m]) => `
      <div class="w-item"><header><b>${esc(m.name)}</b><output id="wo_${k}">${W[k] ?? 0}</output></header>
      <input type="range" min="0" max="40" step="5" value="${W[k] ?? 0}" data-w="${k}" aria-label="Trọng số ${esc(m.name)}"><p>${esc(m.desc)}</p>
      ${METHOD_REL[k] ? `<div class="rel">${relTag(METHOD_REL[k])}</div>` : k === "orderflow" ? `<div class="rel faint">Dữ liệu khớp lệnh chỉ có từ ngày hệ thống bắt đầu lưu – chưa đo được độ tin cậy.</div>` : ""}</div>`).join("")}</div>
    <p style="margin-top:8px"><button class="btn" id="wReset">Về trọng số mặc định</button> <small class="muted">Chỉ đổi cách xếp hạng trên trang này. Danh sách MUA dùng trọng số trong config.yaml.${ps.symbols ? ` Độ tin cậy đo trên ${ps.symbols} mã.` : ""}</small></p>
  </details>`;

  const fillInd = () => {
    const inds = [...new Set(rows.filter((r) => !st.sec || r.sector === st.sec).map((r) => r.industry).filter(Boolean))].sort();
    $("#fI").innerHTML = `<option value="">Tất cả</option>` + inds.map((s) => `<option ${s === st.ind ? "selected" : ""}>${esc(s)}</option>`).join("");
  };
  fillInd();
  const recompute = () => rows.forEach((r) => {
    let s = 0, ws = 0;
    for (const [k, w] of Object.entries(W)) { if (w > 0 && isNum(r[k])) { s += r[k] * w; ws += Number(w); } }
    r._score = ws ? s / ws : null;
  });
  let filtered = [];
  const draw = () => {
    recompute();
    const num = (x) => (x === "" || x == null ? null : Number(String(x).replace(",", ".")));
    const minVal = num(st.minVal), maxPE = num(st.maxPE), minR = num(st.minROE), minF = num(st.minF), minD = num(st.minDiv), minU = num(st.minUp), minS = num(st.minScore);
    const txt = st.text.toLowerCase();
    filtered = rows.filter((r) => (!st.exch || r.exchange === st.exch) && (!st.sec || r.sector === st.sec) && (!st.ind || r.industry === st.ind) && (!st.basket || r["in_" + st.basket] === true)
      && (!st.trend || (st.trend === "notdown" ? r.trend !== "down" : r.trend === st.trend))
      && (minVal == null || (r.avg_value_bn ?? 0) >= minVal) && (maxPE == null || (isNum(r.pe) && r.pe > 0 && r.pe <= maxPE))
      && (minR == null || (r.roe ?? -1e9) >= minR) && (minF == null || (r.fscore ?? -1) >= minF) && (minD == null || (r.div_yield ?? 0) >= minD)
      && (minU == null || (r.upside ?? -1e9) >= minU) && (minS == null || (r._score ?? -1) >= minS)
      && (!txt || r.symbol.toLowerCase().includes(txt) || String(r.name || "").toLowerCase().includes(txt) || String(r.industry || "").toLowerCase().includes(txt) || String(r.sector || "").toLowerCase().includes(txt)));
    const k = st.sort === "composite" ? "_score" : st.sort;
    filtered.sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (st.asc ? 1 : -1); });
    const cols = VIEWS[st.view][1];
    $("#cnt").textContent = `${filtered.length} mã${filtered.length > 500 ? " (hiện 500)" : ""}`;
    $("#scr").innerHTML = `<thead><tr>${cols.map((c) => { const f = COLDEF[c][1]; return `<th data-k="${c}" class="${f === "sym" ? "sym" : ["l", "trend", "wy"].includes(f) ? "l" : ""} ${st.sort === c ? "sorted" + (st.asc ? " asc" : "") : ""}">${esc(COLDEF[c][0])}</th>`; }).join("")}</tr></thead>
      <tbody>${filtered.slice(0, 500).map((r) => `<tr>${cols.map((c) => { const f = COLDEF[c][1]; return `<td class="${f === "sym" ? "sym" : ["l", "trend", "wy"].includes(f) ? "l" : ""}">${fmtCol(r, c)}</td>`; }).join("")}</tr>`).join("")}</tbody>`;
    $$("#scr th").forEach((th) => (th.onclick = () => { if (st.sort === th.dataset.k) st.asc = !st.asc; else { st.sort = th.dataset.k; st.asc = ["pe", "pb", "ps", "ev_ebitda", "de", "beta", "vol_1y_pct", "symbol", "ind_rank"].includes(th.dataset.k); } draw(); }));
    const b = meth.baskets[st.basket];
    $("#bRule").innerHTML = b ? `<b>Điều kiện rổ ${esc(b.name)}</b> (rủi ro ${esc(b.risk)}): ${esc(b.rule)}` : (st.sec ? `Muốn xếp hạng sâu trong ngành ${esc(st.sec)} theo từng phương án? <a href="#/sector/${enc(st.ind || st.sec)}${st.ind ? "/l3" : ""}">Mở trang Ngành</a>.` : "");
  };
  $$("input[data-w]").forEach((el) => (el.oninput = () => { W[el.dataset.w] = Number(el.value); $("#wo_" + el.dataset.w).textContent = el.value; lsSet("weights", W); draw(); }));
  $("#wReset").onclick = () => { Object.assign(W, meth.weights); try { localStorage.removeItem("vnstock_weights"); } catch (e) { /* bỏ qua */ } viewScreener(st.basket); };
  const bind = (id, key, after) => ($(id).oninput = () => { st[key] = $(id).value; if (after) after(); draw(); });
  bind("#fB", "basket"); bind("#fE", "exch"); bind("#fS", "sec", () => { st.ind = ""; fillInd(); }); bind("#fI", "ind"); bind("#fTr", "trend"); bind("#fT", "text"); bind("#fV", "minVal");
  bind("#fPE", "maxPE"); bind("#fR", "minROE"); bind("#fF", "minF"); bind("#fD", "minDiv"); bind("#fU", "minUp"); bind("#fSc", "minScore");
  $("#fClear").onclick = () => viewScreener("");
  $$("#views [data-v]").forEach((b) => (b.onclick = () => { st.view = b.dataset.v; lsSet("scrView", st.view); $$("#views [data-v]").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  $("#toGroup").onclick = async () => {
    if (!filtered.length) { toast("Không có mã nào để lưu"); return; }
    if (filtered.length > 300) { toast("Lọc bớt còn tối đa 300 mã rồi lưu"); return; }
    const { data } = await Store.get("groups");
    const list = data && Array.isArray(data.list) ? data.list : [];
    const id = "g" + Date.now().toString(36);
    const nm = [st.basket && meth.baskets[st.basket]?.name, st.ind || st.sec, st.text].filter(Boolean).join(" · ") || "Từ bộ lọc";
    list.push({ id, name: `${nm} (${new Date().toLocaleDateString("vi-VN")})`, sectors: [], industries: [], symbols: filtered.map((r) => r.symbol), exclude: [], updated: new Date().toISOString() });
    const ok = await Store.put("groups", { list });
    toast(ok ? "Đã lưu nhóm" : "Đã lưu nhóm trên trình duyệt này");
    location.hash = `#/sector/${id}/g`;
  };
  $("#csv").onclick = () => {
    const cols = VIEWS[st.view][1];
    const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
    const csv = "﻿" + [cols.map((c) => q(COLDEF[c][0])).join(","), ...filtered.map((r) => cols.map((c) => q(c === "composite" ? r._score?.toFixed(1) : r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `vnstock-${st.view}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  draw();
}

// ================================================================ KIỂM CHỨNG (BACKTEST)
async function viewBacktest() {
  const [b, meth, t, secs] = await Promise.all([load("data/backtest.json"), load("data/methods.json"), load("data/today.json"), tryLoad("data/sectors.json")]);
  if (!b.ok) { app().innerHTML = `<h1>Kiểm chứng</h1><div class="empty">${esc(b.reason || "Backtest chưa chạy – sẽ có sau lượt chạy cuối tuần.")}</div>`; return; }
  const series = [["combo", b.combo, css("--brand")], ["combo_regime", b.combo_regime, css("--up")], ["bench", b.benchmark, css("--ink-3")]];
  const bas = Object.entries(b.baskets);
  const palette = [css("--ref"), css("--ceil"), css("--floor"), css("--down"), "#7C8A99"];
  const statRow = (name, s, c) => `<tr><td class="l"><i class="quad" style="background:${c || "transparent"}"></i>${esc(name)}</td><td class="${cls(s.cagr)}"><b>${pct(s.cagr)}</b></td><td class="down">${pct(s.max_dd)}</td><td>${nf(s.vol, 1)}%</td><td>${nf(s.sharpe)}</td><td>${s.win_years ?? "—"}/${s.n_years ?? "—"}</td><td>${s.avg_count ?? ""}</td></tr>`;
  const years = [...new Set([b.benchmark, b.combo, ...bas.map(([, v]) => v)].flatMap((s) => Object.keys(s.yearly || {})))].sort();
  const ps = meth.pattern_stats || {};
  const SB = Object.entries(b.sectors || secs?.backtest || {}).sort((x, y) => (y[1].alpha ?? -99) - (x[1].alpha ?? -99));
  const grp = (k) => k.startsWith("SMC") ? "SMC" : k.startsWith("VSA") ? "VSA" : k.startsWith("Wyckoff") ? "Wyckoff" : ["Elliott", "Dow", "Harmonic"].includes(k) ? "Sóng" : "Mô hình giá";
  const pst = Object.entries(ps.stats || {});
  app().innerHTML = `
  <div class="ph"><h1>Kiểm chứng bằng dữ liệu quá khứ</h1><span class="meta">${esc(b.start)} → ${esc(b.end)} · ${b.months} tháng · tái cơ cấu hằng tháng, chỉ dùng thông tin đã có tại thời điểm đó</span></div>
  ${kpis([["Hệ thống + đèn / năm", pct(b.combo_regime.cagr), cls(b.combo_regime.cagr)], ["Sụt tối đa", pct(b.combo_regime.max_dd), "down"], ["VN-Index / năm", pct(b.benchmark.cagr), cls(b.benchmark.cagr)],
    ["VN-Index sụt", pct(b.benchmark.max_dd), "down"], ["Sharpe", nf(b.combo_regime.sharpe)], ["Mục tiêu / năm", "30%"], ["Chấp nhận sụt", (t.risk?.max_drawdown_target ?? 25) + "%"]], true)}
  <div class="g g-main sec">
    <section class="panel"><div class="ph"><h2>Tăng trưởng tài sản (thang log)</h2></div><div class="chart md" id="btChart"></div>
      <div class="leg" style="margin-top:6px">${series.map(([, s, c]) => `<span><i style="background:${c}"></i>${esc(s.name)}</span>`).join("")}
        ${bas.map(([, s], i) => `<span><i style="background:${palette[i % palette.length]}"></i>${esc(s.name)}</span>`).join("")}</div></section>
    <section class="panel flush"><div class="ph"><h2>Kết quả</h2></div><div class="tw"><table><thead><tr><th class="l">Chiến lược</th><th>Lãi kép/năm</th><th>Sụt tối đa</th><th>Biến động</th><th>Sharpe</th><th>Năm lãi</th><th>Số mã</th></tr></thead><tbody>
      ${statRow(b.combo.name, b.combo, css("--brand"))}${statRow(b.combo_regime.name, b.combo_regime, css("--up"))}${statRow("VN-Index", b.benchmark, css("--ink-3"))}
      ${bas.map(([, s], i) => statRow("Rổ " + s.name, s, palette[i % palette.length])).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.74rem;padding:6px 12px">So hai dòng đầu với mục tiêu 30%/năm để biết kỳ vọng thực tế.</p></section>
  </div>
  <section class="panel flush sec"><div class="ph"><h2>Từng năm</h2></div><div class="tw"><table><thead><tr><th class="l">Chiến lược</th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
    ${[[b.combo.name, b.combo], [b.combo_regime.name, b.combo_regime], ["VN-Index", b.benchmark], ...bas.map(([, s]) => [s.name, s])].map(([n, s]) =>
      `<tr><td class="l">${esc(n)}</td>${years.map((y) => `<td class="${cls(s.yearly?.[y])}">${pct(s.yearly?.[y], 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>
  <div class="g g2 sec">
    <section class="panel flush"><div class="ph"><h2>Chọn mã trong từng ngành</h2><span class="meta">top 3 "Tốt nhất ngành" vs mua đều cả ngành</span></div>
      ${SB.length ? `<div class="tw"><table><thead><tr><th class="l">Ngành</th><th>Top 3/năm</th><th>Cả ngành/năm</th><th>Alpha</th><th>Sụt top 3</th><th>Số mã</th><th class="l">Chọn gần nhất</th></tr></thead><tbody>
        ${SB.map(([n, s]) => `<tr><td class="l"><a href="#/sector/${enc(n)}">${esc(n)}</a></td><td class="${cls(s.top?.cagr)}">${pct(s.top?.cagr)}</td><td class="${cls(s.all?.cagr)}">${pct(s.all?.cagr)}</td>
          <td class="${cls(s.alpha)}"><b>${pct(s.alpha)}</b></td><td class="down">${pct(s.top?.max_dd, 0)}</td><td>${nf(s.avg_n, 0)}</td><td class="l">${(s.last_picks || []).map((x) => `<a href="#/s/${x}">${x}</a>`).join(" ") || "—"}</td></tr>`).join("")}</tbody></table></div>
        <p class="faint" style="font-size:.74rem;padding:6px 12px">Alpha dương = ở ngành đó, chọn mã theo cơ bản + xu hướng thật sự có ích. Alpha âm = khó chọn mã, nên coi trọng thời điểm vào ngành.</p>`
        : `<p class="muted" style="padding:0 12px 12px">Có sau lượt backtest kế tiếp.</p>`}</section>
    <section class="panel flush"><div class="ph"><h2>Độ tin cậy sóng, mô hình & tạo lập</h2><span class="seg" id="pg">${["Tất cả", "SMC", "VSA", "Wyckoff", "Sóng", "Mô hình giá"].map((g, i) => `<button data-g="${g}" class="${i === 0 ? "on" : ""}">${g}</button>`).join("")}</span></div>
      <p class="faint" style="font-size:.74rem;padding:0 12px">Đo trên ${ps.symbols ?? "—"} mã thanh khoản, ${ps.years ?? "—"} năm: ${ps.horizon_days ?? 20} phiên sau tín hiệu giá có đi đúng hướng (so với VN-Index) không. Chỉ tín hiệu đúng ≥ 55% và lợi thế > 0,5% được cộng/trừ điểm kỹ thuật.</p>
      <div class="tw" style="max-height:520px"><table id="pt"></table></div></section>
  </div>
  <section class="panel sec"><div class="ph"><h2>Giới hạn cần biết</h2></div><ul style="margin:0;padding-left:18px;font-size:.82rem">${b.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>`;
  const drawPT = (g) => {
    const L = pst.filter(([k]) => g === "Tất cả" || grp(k) === g).sort((x, y) => (y[1].useful - x[1].useful) || (y[1].hit_rate - x[1].hit_rate));
    $("#pt").innerHTML = `<thead><tr><th class="l">Tín hiệu</th><th class="l">Nhóm</th><th>Số lần</th><th>Đúng</th><th>Vượt VNI TB</th><th class="l">Dùng?</th></tr></thead><tbody>
      ${L.length ? L.map(([k, v]) => `<tr><td class="l">${esc(k)}</td><td class="l"><small>${grp(k)}</small></td><td>${nf(v.n, 0)}</td><td>${nf(v.hit_rate, 1)}%</td><td class="${cls(v.avg_excess)}">${pct(v.avg_excess, 2)}</td>
        <td class="l">${v.useful ? '<b class="up">Có</b>' : '<small class="muted">Tham khảo</small>'}</td></tr>`).join("") : `<tr><td colspan="6" class="l" style="padding:12px">Chưa có số liệu – có sau lượt backtest kế tiếp.</td></tr>`}</tbody>`;
  };
  drawPT("Tất cả");
  $$("#pg button").forEach((x) => (x.onclick = () => { $$("#pg button").forEach((y) => y.classList.toggle("on", y === x)); drawPT(x.dataset.g); }));
  const c = mkChart($("#btChart"), { rightPriceScale: { mode: 1, borderColor: css("--line") } });
  const add = (s, color, w = 2) => { const l = c.addLineSeries({ color, lineWidth: w, priceLineVisible: false, lastValueVisible: false }); l.setData(s.curve.map((p) => ({ time: p.d, value: p.v }))); };
  series.forEach(([, s, col]) => add(s, col, 3));
  bas.forEach(([, s], i) => add(s, palette[i % palette.length], 1));
  c.timeScale().fitContent();
}

// ================================================================ CHI TIẾT MÃ
const METHOD_NAMES = { piotroski: "Piotroski", magic_formula: "Magic Formula", value: "Giá trị", quality: "Chất lượng", growth: "Tăng trưởng", dividend: "Cổ tức", momentum: "Sức mạnh giá",
  canslim: "CANSLIM", low_vol: "Biến động thấp", smc: "SMC", vsa: "VSA", wyckoff_ev: "Wyckoff sự kiện", orderflow: "Order Flow" };
const VSA_SHORT = { "No Supply": "NS", "No Demand": "ND", "Stopping Volume": "SV", "Selling Climax": "SC", "Buying Climax": "BC", "Upthrust": "UT", "Test": "T", "Effort to Rise": "ER", "Effort to Fall": "EF", "Shakeout": "SO" };

async function viewStock(sym, tabArg) {
  let d;
  const [rows, secs] = await Promise.all([screenerRows(), tryLoad("data/sectors.json")]);
  try { d = await load(`data/stocks/${sym}.json`); }
  catch (e) {
    const r = rows.find((x) => x.symbol === sym);
    app().innerHTML = r ? `<div class="ph"><h1>${sym}</h1><span class="meta">${esc(r.exchange)} · ${esc(r.sector || "")}</span></div><div class="panel"><p>${esc(r.name)} – thanh khoản quá thấp (${nf(r.avg_value_bn, 2)} tỷ/ngày) nên hệ thống không phân tích sâu.</p>
      ${kpis([["Giá", nf(r.price)], ["P/E", nf(r.pe, 1)], ["P/B", nf(r.pb)], ["ROE", pct(r.roe, 1, false)], ["Cổ tức", pct(r.div_yield, 1, false)], ["Vốn hoá", mcapFmt(r.mcap_bn)]])}</div>`
      : `<div class="empty">Không tìm thấy mã ${esc(sym)}.</div>`;
    return;
  }
  const r = d.row, v = d.valuation || {}, ta = d.ta, fa = d.fa || {}, w = d.waves || {};
  const o = d.ohlc;
  const last = o.c[o.c.length - 1], prev = o.c[o.c.length - 2];
  const chg = (last / prev - 1) * 100;
  const lv = d.levels;
  const sm = w.smc || {}, vs = w.vsa || {}, wy2 = w.wyckoff2 || {}, of = w.orderflow || {};
  const secRec = (secs?.sector || []).find((s) => s.name === d.sector);
  const sc = d.scores || {};
  app().innerHTML = `
  <div class="stock-head">
    <div><h1>${sym} <small class="muted" style="font-size:.8rem;font-weight:400">${esc(d.exchange)} · <a href="#/sector/${enc(d.sector || "")}">${esc(d.sector || "")}</a>${d.industry && d.industry !== d.sector ? ` › <a href="#/sector/${enc(d.industry)}/l3">${esc(d.industry)}</a>` : ""}</small></h1>
      <div class="muted" style="font-size:.8rem">${esc(d.name)}</div></div>
    <div class="px">${nf(last)}</div><div class="${cls(chg)}" style="font-weight:600">${pct(chg, 2)}</div>
    <div class="tags" style="margin-left:auto">${d.in_plan ? '<span class="pill buy">Trong danh sách MUA</span>' : ""}${(d.baskets || []).map((b) => `<span class="pill brand">${esc(BASKET_SHORT[b] || b)}</span>`).join("")}
      <span class="pill ${r.trend === "up" ? "buy" : r.trend === "down" ? "sell" : ""}">Xu hướng ${TREND_VI[r.trend] || "—"}</span>
      ${secRec ? `<span class="pill" title="Vị trí ngành trên biểu đồ xoay vòng"><span class="quad" style="background:${qcol(secRec.quadrant)}"></span>Ngành ${esc(secRec.quadrant)}</span>` : ""}
      ${isNum(r.ind_rank) ? `<span class="pill">Hạng ${nf(r.ind_rank, 0)}/${r.ind_n} trong ngành</span>` : ""}</div>
  </div>
  ${kpis([["Vốn hoá", mcapFmt(fa.mcap_bn ?? r.mcap_bn)], ["P/E", nf(fa.pe ?? r.pe, 1)], ["P/B", nf(fa.pb ?? r.pb)], ["EPS (đ)", nf(fa.eps ?? r.eps, 0)], ["ROE", pct(fa.roe ?? r.roe, 1, false)],
    ["LN 12T", pct(fa.ni_yoy ?? r.ni_yoy), cls(fa.ni_yoy ?? r.ni_yoy)], ["DT 12T", pct(fa.rev_yoy ?? r.rev_yoy), cls(fa.rev_yoy ?? r.rev_yoy)], ["Cổ tức", pct(fa.dividend?.yield ?? r.div_yield, 1, false)],
    ["F-Score", `${r.fscore ?? "—"}/9`], ["Vay/Vốn", nf(fa.de ?? r.de)], ["Beta", nf(d.beta)], ["GTGD/ngày", bn(r.avg_value_bn)], ["RS", `${sc.rs_rating ?? r.rs_rating ?? "—"}/100`],
    ["1 tháng", pct(r.chg1m), cls(r.chg1m)], ["1 năm", pct(r.chg1y), cls(r.chg1y)], ["Cách đỉnh 52T", pct(ta.from_hi52_pct), "down"]])}
  <div class="g g-main sec">
    <div>
      <div class="toolbar" id="tools"></div>
      <div class="chart" id="pChart"></div>
      <div class="chart xs" id="oChart" style="margin-top:4px"></div>
      ${recentSignals(d)}
    </div>
    <div class="stack">
      <section class="panel"><div class="ph"><h2>Kế hoạch giao dịch</h2><span class="meta">${d.timing?.ok ? '<b class="up">đủ điều kiện kỹ thuật</b>' : '<b class="ref">chưa đến lúc</b>'}</span></div>
        ${lv ? kpis([["Vùng mua", `${nf(lv.zone[0])}–${nf(lv.zone[1])}`], ["Cắt lỗ", `${nf(lv.stop)} <small>${pct(lv.stop_pct, 0)}</small>`, "down"], ["Mục tiêu 1", `${nf(lv.t1)} <small>${pct(lv.t1_pct, 0)}</small>`, "up"], ["Mục tiêu 2", nf(lv.t2), "up"], ["Lời / lỗ", nf(lv.rr, 1) + "x"], ["Trạng thái", lv.state === "now" ? "Mua được" : "Chờ giá"]], false, "c2")
          : `<p class="muted">Chưa có kế hoạch (thiếu định giá hoặc kỹ thuật).</p>`}
        ${d.timing && !d.timing.ok ? `<p class="note" style="margin-top:6px">${esc(d.timing.reason)}</p>` : ""}</section>
      <section class="panel"><div class="ph"><h2>Định giá: ${esc(v.verdict || "chưa định giá được")}</h2><span class="meta">điểm ${scoreCell(r.composite)}</span></div>
        ${v.ok ? kpis([["Hợp lý", nf(v.fair)], ["Khoảng", `${nf(v.fair_lo)}–${nf(v.fair_hi)}`], ["Mua dưới", nf(v.buy_below)], ["Tiềm năng", pct(v.upside), cls(v.upside)]], false, "c2") : `<p class="muted">${esc(v.reason || "")}</p>`}
        ${v.warning ? `<p class="note" style="margin-top:6px">${esc(v.warning)}</p>` : ""}</section>
      <section class="panel"><div class="ph"><h2>Kỹ thuật: ${esc(ta.label)}</h2><span class="meta">${ta.score}/100</span></div><div class="gauge"><i style="left:${ta.score}%"></i></div>
        ${kpis(Object.entries(ta.groups || {}).map(([g, s]) => [esc(g), `${esc(s.signal)} <small>${s.score}</small>`, s.signal === "Mua" ? "up" : s.signal === "Bán" ? "down" : ""]))}
        <p class="muted" style="font-size:.78rem;margin-top:4px">${esc(ta.trend_vi)}</p></section>
      <section class="panel"><div class="ph"><h2>Dấu chân tổ chức</h2><a class="meta" href="#/s/${sym}/sm">chi tiết</a></div>
        <dl class="kv"><dt>SMC</dt><dd>${sm.ok ? `${esc(sm.trend_vi)} ${biasPill(sm.bias, " ")}` : "—"}</dd>
          <dt>Premium/Discount</dt><dd>${sm.range ? esc(sm.range.zone.split(" (")[0]) + ` <small>${nf(sm.range.pos_pct, 0)}%</small>` : "—"}</dd>
          <dt>VSA</dt><dd>${vs.ok ? biasPill(vs.bias) : "—"}</dd>
          <dt>Wyckoff</dt><dd style="white-space:normal">${esc(wy2.phase || "—")}</dd>
          <dt>Order Flow</dt><dd>${of.ok ? `${biasPill(of.bias)} <small>${of.days} phiên</small>` : '<small class="faint">đang tích luỹ dữ liệu</small>'}</dd></dl></section>
    </div>
  </div>
  <div class="subtabs" role="tablist">${[["ov", "Tổng quan"], ["ta", "Kỹ thuật"], ["wv", "Sóng & mô hình"], ["sm", "Tạo lập & dòng tiền"], ["fa", "Cơ bản"], ["vl", "Dự phóng & định giá"], ["pe", "Cùng ngành"]]
    .map(([k, n]) => `<button role="tab" data-t="${k}">${n}</button>`).join("")}</div>
  <div id="tab"></div>`;

  // ---- biểu đồ giá
  const { c, cs } = candleChart($("#pChart"), o);
  const C = o.c;
  const tset = new Set(o.t);
  const overlays = {
    MA20: () => [[IND.sma(C, 20), css("--floor")]], MA50: () => [[IND.sma(C, 50), css("--brand")]], MA200: () => [[IND.sma(C, 200), css("--ref")]],
    EMA21: () => [[IND.ema(C, 21), css("--ceil")]],
    Bollinger: () => { const b = IND.bb(C); return [[b.up, css("--ink-3")], [b.m, css("--ink-3")], [b.lo, css("--ink-3")]]; },
  };
  const active = new Set(["MA50", "MA200"]);
  const lines = {};
  const drawOv = (k) => {
    (lines[k] || []).forEach((s) => c.removeSeries(s));
    lines[k] = [];
    if (!active.has(k)) return;
    overlays[k]().forEach(([vals, col]) => { const s = c.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(ser(o.t, vals)); lines[k].push(s); });
  };
  const L = { lv: true, smc: false, el: false, vsa: false, wy: false };
  const priceLines = [];
  const pl = (price, color, title, style = 2) => isNum(price) && priceLines.push(cs.createPriceLine({ price, color, lineStyle: style, lineWidth: 1, title, axisLabelVisible: true }));
  const drawLines = () => {
    priceLines.splice(0).forEach((p) => cs.removePriceLine(p));
    if (L.lv) {
      if (v.ok && v.reliable && v.fair) pl(v.fair, css("--up"), "Hợp lý");
      if (v.ok && v.reliable && v.buy_below) pl(v.buy_below, css("--brand"), "Mua dưới");
      if (lv) pl(lv.stop, css("--down"), "Cắt lỗ");
      ((w.levels || {}).support || []).slice(0, 2).forEach((z) => pl(z.price, css("--ink-3"), "Hỗ trợ", 3));
      ((w.levels || {}).resistance || []).slice(0, 2).forEach((z) => pl(z.price, css("--ink-3"), "Kháng cự", 3));
    }
    if (L.smc && sm.ok) {
      if (sm.bull_ob) { pl(sm.bull_ob.top, css("--up"), "OB mua", 1); pl(sm.bull_ob.bottom, css("--up"), "", 1); }
      if (sm.bear_ob) { pl(sm.bear_ob.top, css("--down"), "OB bán", 1); pl(sm.bear_ob.bottom, css("--down"), "", 1); }
      (sm.fvg || []).filter((f) => f.filled < 1 && Math.abs((f.top + f.bottom) / 2 / last - 1) < 0.2).slice(-3)
        .forEach((f) => pl((f.top + f.bottom) / 2, f.dir > 0 ? css("--floor") : css("--ceil"), `FVG ${f.dir > 0 ? "tăng" : "giảm"}`, 3));
      (sm.liquidity?.buy_side || []).slice(0, 1).forEach((x) => pl(x.price, css("--ref"), "Thanh khoản đỉnh", 3));
      (sm.liquidity?.sell_side || []).slice(0, 1).forEach((x) => pl(x.price, css("--ref"), "Thanh khoản đáy", 3));
      if (sm.range) pl(sm.range.eq, css("--ink-3"), "Cân bằng 50%", 4);
    }
  };
  const markers = () => {
    const M = [];
    const add = (time, pos, color, shape, text) => { if (tset.has(time)) M.push({ time, position: pos, color, shape, text }); };
    if (L.el && w.elliott?.ok) {
      const pts = w.elliott.main.points; const upFirst = pts[0].price < (pts[1]?.price ?? pts[0].price);
      pts.forEach((p, i) => add(p.date, (i % 2 === 0) === upFirst ? "belowBar" : "aboveBar", css("--ceil"), "circle", p.label));
    }
    if (L.smc && sm.ok) {
      (sm.events || []).forEach((e) => add(e.date, e.dir > 0 ? "belowBar" : "aboveBar", e.dir > 0 ? css("--up") : css("--down"), e.dir > 0 ? "arrowUp" : "arrowDown", e.type));
      (sm.sweeps || []).forEach((e) => add(e.date, e.dir > 0 ? "belowBar" : "aboveBar", css("--ref"), "circle", "Quét"));
    }
    if (L.vsa && vs.ok) (vs.signals || []).forEach((x) => add(x.date, x.bias > 0 ? "belowBar" : "aboveBar", x.bias > 0 ? css("--floor") : css("--ceil"), "square", VSA_SHORT[x.signal] || x.signal));
    if (L.wy && wy2.ok) (wy2.events || []).forEach((x) => add(x.date, ["SC", "ST", "Spring", "LPS", "SOS"].includes(x.event) ? "belowBar" : "aboveBar", css("--brand"), "circle", x.event));
    return M.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  };
  const redraw = () => { drawLines(); cs.setMarkers(markers()); };
  $("#tools").innerHTML = Object.keys(overlays).map((k) => `<button class="chip ${active.has(k) ? "on" : ""}" data-ov="${k}">${k}</button>`).join("") +
    `<span class="faint">|</span>` + [["lv", "Mức giá"], ["smc", "SMC"], ["vsa", "VSA"], ["wy", "Wyckoff"], ["el", "Elliott"]].map(([k, n]) => `<button class="chip ${L[k] ? "on" : ""}" data-l="${k}">${n}</button>`).join("") +
    `<span style="margin-left:auto" class="seg" id="osc"><button class="on" data-o="rsi">RSI</button><button data-o="macd">MACD</button><button data-o="vol">KL</button><button data-o="obv">OBV</button>${of.history?.length ? '<button data-o="delta">Delta</button>' : ""}</span>`;
  Object.keys(overlays).forEach(drawOv);
  redraw();
  $$("[data-ov]").forEach((b) => (b.onclick = () => { const k = b.dataset.ov; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); drawOv(k); }));
  $$("[data-l]").forEach((b) => (b.onclick = () => { L[b.dataset.l] = !L[b.dataset.l]; b.classList.toggle("on"); redraw(); }));
  c.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - 200), to: o.t.length + 3 });
  const oc = mkChart($("#oChart"), { timeScale: { visible: false } });
  let oser = [];
  const drawOsc = (k) => {
    oser.forEach((s) => oc.removeSeries(s)); oser = [];
    const line = (col) => { const s = oc.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }); oser.push(s); return s; };
    if (k === "rsi") { const s = line(css("--ceil")); s.setData(ser(o.t, IND.rsi(C))); s.createPriceLine({ price: 70, color: css("--down"), lineStyle: 2 }); s.createPriceLine({ price: 30, color: css("--up"), lineStyle: 2 }); }
    if (k === "macd") { const m = IND.macd(C); const h = oc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }); oser.push(h); h.setData(o.t.map((t, i) => (m.hist[i] == null ? null : { time: t, value: m.hist[i], color: m.hist[i] >= 0 ? css("--up") : css("--down") })).filter(Boolean));
      line(css("--brand")).setData(ser(o.t, m.line)); line(css("--ref")).setData(ser(o.t, m.sig)); }
    if (k === "vol") { const h = oc.addHistogramSeries({ priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }); oser.push(h); h.setData(o.t.map((t, i) => ({ time: t, value: o.v[i], color: css("--ink-3") }))); line(css("--brand")).setData(ser(o.t, IND.sma(o.v, 20))); }
    if (k === "obv") { const ob = IND.obv(C, o.v); line(css("--floor")).setData(ser(o.t, ob)); line(css("--ref")).setData(ser(o.t, IND.ema(ob, 20))); }
    if (k === "delta") { const h = oc.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false }); oser.push(h); h.setData(of.history.filter((x) => tset.has(x.d)).map((x) => ({ time: x.d, value: x.delta, color: x.delta >= 0 ? css("--up") : css("--down") }))); }
  };
  drawOsc("rsi");
  $$("#osc button").forEach((b) => (b.onclick = () => { $$("#osc button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); drawOsc(b.dataset.o); }));
  c.timeScale().subscribeVisibleLogicalRangeChange((rg) => rg && oc.timeScale().setVisibleLogicalRange(rg));
  oc.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - 200), to: o.t.length + 3 });

  // ---- các tab
  const tabs = { ov: tabOverview, ta: tabTech, wv: (x) => `<div class="g g2"><section class="panel">${wavesBlock(x.waves)}</section><section class="panel"><div class="ph"><h2>Mức giá quan trọng</h2></div>${levelsKv(x.waves)}</section></div>`,
    sm: tabSmart, fa: tabFund, vl: tabVal, pe: tabPeers };
  const show = (k) => {
    $$(".subtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === k));
    $("#tab").innerHTML = tabs[k](d);
    if (k === "vl") bindVal(d);
    if (k === "sm") { L.smc = true; $$('[data-l="smc"]').forEach((b) => b.classList.add("on")); redraw(); }
  };
  $$(".subtabs button").forEach((b) => (b.onclick = () => { history.replaceState(null, "", `#/s/${sym}/${b.dataset.t}`); show(b.dataset.t); }));
  show(tabs[tabArg] ? tabArg : "ov");
}

function recentSignals(d) {
  const w = d.waves || {}, o = d.ohlc, cut = o.t[Math.max(0, o.t.length - 30)];
  const L = [];
  (w.smc?.events || []).forEach((e) => L.push([e.date, e.dir, `SMC ${e.type} ${e.dir > 0 ? "tăng" : "giảm"}`, `qua ${nf(e.level)}`, "SMC – " + e.type]));
  (w.smc?.sweeps || []).forEach((e) => L.push([e.date, e.dir, "SMC quét thanh khoản", e.text, "SMC – quét thanh khoản"]));
  (w.vsa?.signals || []).forEach((x) => L.push([x.date, x.bias, `VSA ${x.signal}`, x.why, "VSA – " + x.signal]));
  (w.wyckoff2?.events || []).forEach((x) => L.push([x.date, ["SC", "ST", "Spring", "LPS", "SOS", "AR"].includes(x.event) ? 1 : -1, `Wyckoff ${x.event}`, x.desc, "Wyckoff – sự kiện (SC/Spring/SOS/UTAD…)"]));
  const R = L.filter((x) => x[0] >= cut).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 10);
  return `<section class="panel sec"><div class="ph"><h2>Tín hiệu 30 phiên gần đây</h2><span class="meta">mới nhất trước · độ tin cậy đo trên dữ liệu VN</span></div>
    ${R.length ? R.map(([dt, b, n, why, rel]) => `<div class="ev"><time>${esc(dt)}</time><span><b class="${b > 0 ? "up" : b < 0 ? "down" : ""}">${b > 0 ? "▲" : b < 0 ? "▼" : "•"} ${esc(n)}</b> <small class="muted">${esc(why || "")}</small> ${relTag(rel, true)}</span></div>`).join("")
      : `<p class="muted">Không có tín hiệu tạo lập nào trong 30 phiên.</p>`}</section>`;
}
function tabOverview(d) {
  const r = d.row, fa = d.fa || {}, sc = d.scores || {};
  return `<div class="g g2">
    <section class="panel"><div class="ph"><h2>Điểm theo từng phương pháp</h2><span class="meta">0–100, so với toàn thị trường</span></div>
      <div class="tw"><table><tbody>${Object.entries(METHOD_NAMES).map(([k, n]) => `<tr><td class="l" style="font-weight:500">${n}</td><td style="width:50%">${minibar(sc[k] ?? r[k])}</td><td>${scoreCell(sc[k] ?? r[k])}</td>
        <td class="l">${METHOD_REL[k] ? relTag(METHOD_REL[k], true) : ""}</td></tr>`).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.74rem;margin-top:4px">CANSLIM đạt: ${esc(sc.canslim_flags || r.canslim_flags || "—")}</p></section>
    <section class="panel"><div class="ph"><h2>Chỉ số chính</h2><span class="meta">${esc(fa.period || "")}</span></div>
      ${fa.shares_note ? `<p class="note">${esc(fa.shares_note)}</p>` : ""}
      ${kpis([["Vốn hoá", mcapFmt(fa.mcap_bn)], ["P/E", nf(fa.pe, 1)], ["P/B", nf(fa.pb)], ["P/S", nf(r.ps)], ["EV/EBITDA", nf(r.ev_ebitda, 1)], ["EPS (đ)", nf(fa.eps, 0)], ["BVPS (đ)", nf(r.bvps, 0)],
        ["ROE", pct(fa.roe, 1, false)], ["ROA", pct(fa.roa, 1, false)], ["ROIC", pct(r.roic, 1, false)], ["Biên gộp", pct(fa.gross_margin, 1, false)], ["Biên ròng", pct(fa.net_margin, 1, false)],
        ["DT 12T", pct(fa.rev_yoy), cls(fa.rev_yoy)], ["LN 12T", pct(fa.ni_yoy), cls(fa.ni_yoy)], ["LN quý", pct(fa.ni_q_yoy), cls(fa.ni_q_yoy)], ["DT CAGR 3N", pct(r.rev_cagr3)], ["LN CAGR 3N", pct(r.ni_cagr3)],
        ["Vay/Vốn", nf(fa.de)], ["CFO/LN", nf(r.cfo_ni)], ["LS FCF", pct(r.fcf_yield, 1, false)], ["Cổ tức", pct(fa.dividend?.yield, 1, false)], ["Beta", nf(d.beta)], ["Biến động 1N", pct(isNum(r.vol_1y) ? r.vol_1y * 100 : null, 0, false)], ["GTGD", bn(r.avg_value_bn)]])}
    </section></div>`;
}
function tabTech(d) {
  const ta = d.ta;
  return `<div class="g g4">${Object.entries(ta.groups || {}).map(([g, s]) => `<section class="panel"><small class="muted">${esc(g)}</small><h3 class="${s.signal === "Mua" ? "up" : s.signal === "Bán" ? "down" : ""}">${esc(s.signal)} <small class="muted">${s.score}/100</small></h3>
      <p class="muted" style="font-size:.76rem">${s.buy} mua · ${s.neutral} trung tính · ${s.sell} bán</p></section>`).join("")}</div>
    <div class="g g-main sec">
    <section class="panel flush"><div class="tw"><table><thead><tr><th class="l">Nhóm</th><th class="l">Chỉ báo</th><th>Giá trị</th><th class="l">Tín hiệu</th><th class="l">Diễn giải</th></tr></thead><tbody>
    ${ta.table.map((x) => `<tr><td class="l">${esc(x.group)}</td><td class="l">${esc(x.name)}</td><td>${esc(typeof x.value === "number" ? nf(x.value) : x.value ?? "—")}</td>
      <td class="l"><span class="pill ${x.signal === "Mua" ? "buy" : x.signal === "Bán" ? "sell" : ""}">${esc(x.signal)}</span></td><td class="wrap">${esc(x.note)}</td></tr>`).join("")}</tbody></table></div></section>
    <div class="stack"><section class="panel"><div class="ph"><h2>Pivot phiên tới</h2></div>${kpis(Object.entries(ta.pivots || {}).map(([k, v]) => [k, nf(v)]))}</section>
      <section class="panel"><div class="ph"><h2>Khác</h2></div>${kpis([["ATR", `${nf(ta.atr)} <small>${nf(ta.atr_pct, 1)}%</small>`], ["Đỉnh 52T", nf(ta.hi52)], ["Đáy 52T", nf(ta.lo52)], ["Cách đỉnh", pct(ta.from_hi52_pct)],
        ["Phân kỳ RSI", ta.divergence?.rsi === "bullish" ? "Tăng" : ta.divergence?.rsi === "bearish" ? "Giảm" : "Không"], ["Phân kỳ MACD", ta.divergence?.macd === "bullish" ? "Tăng" : ta.divergence?.macd === "bearish" ? "Giảm" : "Không"]])}</section></div></div>`;
}

// ---- Tạo lập & dòng tiền: SMC, VSA, Wyckoff sự kiện, Order Flow
function tabSmart(d) {
  const w = d.waves || {}, sm = w.smc || {}, vs = w.vsa || {}, wy = w.wyckoff2 || {}, of = w.orderflow || {};
  const price = d.ohlc.c[d.ohlc.c.length - 1];
  const smcBlock = !sm.ok ? `<p class="muted">${esc(sm.reason || "Chưa đủ dữ liệu để xác định cấu trúc.")}</p>` : (() => {
    const rg = sm.range;
    let bar = "";
    if (rg) {
      const lo = Math.min(rg.low, price), hi = Math.max(rg.high, price), X = (x) => ((x - lo) / ((hi - lo) || 1)) * 100;
      bar = `<div class="vrange" aria-hidden="true"><div class="track"></div>
        <div class="zone" style="left:${X(rg.low)}%;width:${X(rg.eq) - X(rg.low)}%;background:color-mix(in srgb,var(--up) 35%,transparent)"></div>
        <div class="zone" style="left:${X(rg.eq)}%;width:${X(rg.high) - X(rg.eq)}%;background:color-mix(in srgb,var(--down) 30%,transparent)"></div>
        <div class="mk" style="left:${X(price)}%;color:var(--ink)">Giá ${nf(price)}</div></div>
        <div class="leg"><span><i style="background:color-mix(in srgb,var(--up) 35%,transparent)"></i>Discount ${nf(rg.low)}–${nf(rg.eq)}</span><span><i style="background:color-mix(in srgb,var(--down) 30%,transparent)"></i>Premium ${nf(rg.eq)}–${nf(rg.high)}</span></div>`;
    }
    return `${kpis([["Cấu trúc", esc(sm.trend_vi)], ["Thiên hướng", biasPill(sm.bias)], ["Vùng", rg ? esc(rg.zone.split(" (")[0]) : "—"], ["Vị trí", rg ? nf(rg.pos_pct, 0) + "%" : "—"]], false, "c2")}
      ${bar}
      ${(sm.summary || []).length ? `<ul class="checks">${sm.summary.map((x) => `<li class="ok">${esc(x)}</li>`).join("")}</ul>` : ""}
      ${rg ? `<p class="faint" style="font-size:.74rem">${esc(rg.zone)}</p>` : ""}
      <h3 class="sec">Sự kiện cấu trúc</h3>${(sm.events || []).slice(-8).reverse().map((e) => `<div class="ev"><time>${esc(e.date)}</time><span><b class="${e.dir > 0 ? "up" : "down"}">${esc(e.type)} ${e.dir > 0 ? "tăng" : "giảm"}</b> – đóng cửa ${e.dir > 0 ? "vượt" : "thủng"} ${nf(e.level)} ${relTag("SMC – " + e.type, true)}</span></div>`).join("") || `<p class="muted">Không có.</p>`}
      ${(sm.sweeps || []).length ? `<h3 class="sec">Quét thanh khoản</h3>${sm.sweeps.slice(-4).reverse().map((e) => `<div class="ev"><time>${esc(e.date)}</time><span>${esc(e.text)} (KL ${nf(e.vol_ratio, 2)}× TB) ${relTag("SMC – quét thanh khoản", true)}</span></div>`).join("")}` : ""}
      <div class="g g2 sec"><div><h3>Order Block</h3><div class="tw"><table><thead><tr><th class="l">Ngày</th><th class="l">Loại</th><th>Vùng</th><th class="l">Đã test</th></tr></thead><tbody>
        ${(sm.order_blocks || []).slice(0, 6).map((b) => `<tr><td class="l">${esc(b.date)}</td><td class="l ${b.dir > 0 ? "up" : "down"}">${b.dir > 0 ? "Mua" : "Bán"} <small>${esc(b.origin || "")}</small></td><td>${nf(b.bottom)}–${nf(b.top)}</td><td class="l">${b.tested ? "rồi" : "chưa"}</td></tr>`).join("") || `<tr><td colspan="4" class="l">Không có</td></tr>`}</tbody></table></div></div>
        <div><h3>FVG (khoảng trống giá trị)</h3><div class="tw"><table><thead><tr><th class="l">Ngày</th><th class="l">Hướng</th><th>Vùng</th><th>Đã lấp</th></tr></thead><tbody>
        ${(sm.fvg || []).slice(-6).reverse().map((f) => `<tr><td class="l">${esc(f.date)}</td><td class="l ${f.dir > 0 ? "up" : "down"}">${f.dir > 0 ? "Tăng" : "Giảm"}</td><td>${nf(f.bottom)}–${nf(f.top)}</td><td>${nf((f.filled || 0) * 100, 0)}%</td></tr>`).join("") || `<tr><td colspan="4" class="l">Không có</td></tr>`}</tbody></table></div></div></div>
      ${sm.liquidity ? `<p style="margin-top:6px;font-size:.8rem">Thanh khoản (đỉnh/đáy bằng nhau – nơi đặt lệnh dừng): trên ${(sm.liquidity.buy_side || []).map((x) => `<b>${nf(x.price)}</b><small>×${x.n}</small>`).join(", ") || "—"} · dưới ${(sm.liquidity.sell_side || []).map((x) => `<b>${nf(x.price)}</b><small>×${x.n}</small>`).join(", ") || "—"}</p>` : ""}
      <p style="margin-top:4px">${relTag("SMC – tổng hợp")}</p>`;
  })();
  const vsaBlock = !vs.ok ? `<p class="muted">Chưa đủ dữ liệu.</p>` : `${kpis([["Thiên hướng", biasPill(vs.bias)], ["KL tăng / giảm", nf(vs.up_down_vol, 2) + "×", vs.up_down_vol >= 1 ? "up" : "down", "Tổng khối lượng phiên tăng chia phiên giảm (20 phiên)"]])}
    <p style="font-size:.8rem;margin-top:4px">${esc(vs.text || "")}</p>
    ${(vs.signals || []).slice(-10).reverse().map((x) => `<div class="ev"><time>${esc(x.date)}</time><span><span class="pill ${x.bias > 0 ? "buy" : x.bias < 0 ? "sell" : ""}">${esc(x.signal)}</span> ${esc(x.why || "")}
      <small class="faint">KL ${nf(x.vol_ratio, 2)}× · biên ${nf(x.spread_ratio, 2)}× · đóng cửa ${nf((x.close_pos ?? 0) * 100, 0)}% thân</small><br>${relTag("VSA – " + x.signal, true)}</span></div>`).join("") || `<p class="muted">Không có tín hiệu gần đây.</p>`}
    <p style="margin-top:4px">${relTag("VSA – tổng hợp")}</p>`;
  const wyBlock = !wy.ok ? `<p class="muted">${esc(wy.reason || "Không có cấu trúc Wyckoff rõ ràng.")}</p>` : `${kpis([["Pha", esc(wy.phase)], ["Thiên hướng", biasPill(wy.bias)]], false, "c2")}
    ${(wy.events || []).slice().reverse().map((e) => `<div class="ev"><time>${esc(e.date)}</time><span><b>${esc(e.event)}</b> ${isNum(e.price) ? `@ ${nf(e.price)}` : ""} – ${esc(e.desc || "")}</span></div>`).join("")}
    <p style="margin-top:4px">${relTag("Wyckoff – sự kiện (SC/Spring/SOS/UTAD…)")}</p>`;
  const ofBlock = !of.ok ? `<p class="muted">Chưa có dữ liệu khớp lệnh theo bước giá cho mã này.</p>
      <p class="faint" style="font-size:.76rem">Nguồn miễn phí không cho tải lịch sử khớp lệnh cũ. Hệ thống lưu mỗi phiên (sau 14h50) cho ${"250"} mã thanh khoản nhất, nên Order Flow sẽ dày dần theo từng ngày – sau khoảng 10 phiên mới đủ để đọc CVD và phân kỳ.</p>`
    : (() => {
      const lt = of.latest || {};
      const fp = [...(of.footprint || [])].sort((a, b) => b.price - a.price);
      const mx = Math.max(1, ...fp.map((x) => Math.max(x.buy || 0, x.sell || 0)));
      const ib = new Set((lt.imb_buy || []).map(Number)), is = new Set((lt.imb_sell || []).map(Number));
      return `${kpis([["Mua chủ động", big(lt.buy), "up"], ["Bán chủ động", big(lt.sell), "down"], ["Delta", big(lt.delta), cls(lt.delta)], ["Delta %", pct((lt.delta_pct || 0) * 100, 1), cls(lt.delta_pct)],
        ["POC", nf(lt.poc)], ["Vùng giá trị", `${nf(lt.val)}–${nf(lt.vah)}`], ["VWAP", nf(lt.vwap)], ["Delta 5 phiên", isNum(of.delta5_pct) ? pct(of.delta5_pct * 100, 1) : "—", cls(of.delta5_pct)], ["Thiên hướng", biasPill(of.bias)]])}
      ${of.divergence ? `<p class="note" style="margin-top:6px">${esc(of.divergence)}</p>` : ""}
      <div class="g g2 sec"><div><h3>Footprint phiên gần nhất</h3><div class="fp" style="margin-top:4px"><small class="faint" style="text-align:right">Giá</small><small class="faint" style="text-align:right">Bán CĐ</small><small class="faint">Mua CĐ</small>
        ${fp.map((x) => { const inVA = x.price >= lt.val && x.price <= lt.vah; return `<div class="p ${x.price === lt.poc ? "poc" : ""}" style="${inVA ? "background:var(--sunk-2);border-radius:3px;padding-right:3px" : ""}" title="Mua ${nf(x.buy, 0)} · Bán ${nf(x.sell, 0)}">${is.has(x.price) ? "◂ " : ""}${nf(x.price)}${ib.has(x.price) ? " ▸" : ""}</div>
          <div class="s" style="width:${((x.sell || 0) / mx) * 100}%"></div><div class="b" style="width:${((x.buy || 0) / mx) * 100}%"></div>`; }).join("")}</div>
        <p class="faint" style="font-size:.72rem;margin-top:4px">Đậm = POC (khớp nhiều nhất) · nền xám = vùng giá trị 70% · ▸ ◂ = mất cân bằng mua/bán ≥ 3 lần.</p></div>
        <div>${of.history?.length ? `<h3>Delta % theo phiên</h3>${lineSvg([{ bars: true, pts: of.history.map((x) => ({ x: x.d.slice(5), y: (x.dp || 0) * 100 })) }], { h: 150, zero: true, label: "Delta theo phiên" })}
          <h3 class="sec">CVD (delta cộng dồn)</h3>${lineSvg([{ color: css("--brand"), pts: of.history.map((x) => ({ x: x.d.slice(5), y: x.cvd })) }], { h: 140, dec: 0, label: "CVD" })}` : ""}</div></div>`;
    })();
  return `<div class="g g2">
    ${panel("Smart Money Concepts", smcBlock, `<a href="#/guide">SMC là gì?</a>`)}
    <div class="stack">${panel("VSA – phân tích giá & khối lượng", vsaBlock)}${panel("Wyckoff – sự kiện", wyBlock)}</div>
  </div>
  ${panel("Order Flow – dòng lệnh chủ động", ofBlock, of.ok ? `${of.days} phiên đã lưu` : "", "sec")}`;
}

function tabFund(d) {
  const fa = d.fa || {};
  if (!fa.ok) return `<div class="empty">${esc(fa.reason || "Chưa có báo cáo tài chính.")}</div>`;
  const h = d.history || {};
  const isBank = fa.ctype !== "CT";
  const dv = fa.dividend || {};
  const k1 = isBank ? ["toi", "ni_parent"] : ["revenue", "ni_parent"], n1 = isBank ? ["Tổng thu nhập HĐ", "LN cổ đông mẹ"] : ["Doanh thu", "LN cổ đông mẹ"];
  return `<div class="g g2">
    ${panel("Kết quả kinh doanh theo quý", barsSvg(h.quarterly || [], k1, [css("--brand"), css("--up")], n1), "tỷ đồng")}
    ${panel("Theo năm", barsSvg(h.annual || [], k1, [css("--brand"), css("--up")], n1), "tỷ đồng")}
    ${panel("Dòng tiền theo năm", barsSvg(h.annual || [], ["cfo", "capex", "fcf"], [css("--floor"), css("--down"), css("--up")], ["Dòng tiền KD", "Đầu tư TSCĐ", "Dòng tiền tự do"]), "tỷ đồng")}
    ${panel(`Piotroski F-Score: ${fa.fscore ?? "—"}/9`, `<ul class="checks">${(fa.fscore_tests || []).map((t) => `<li class="${t.ok ? "ok" : ""}">${esc(t.name)}</li>`).join("")}</ul>`)}
  </div>
  ${panel("Sức khoẻ & hiệu quả", kpis([["ROE TB 5 năm", pct(fa.roe_avg5, 1, false)], ["Độ lệch ROE 5N", nf(fa.roe_std5, 1)], ["Số năm lỗ", fa.loss_years], ["ROIC", pct(fa.roic, 1, false)],
    ["CFO / Lợi nhuận", nf(fa.cfo_ni)], ["FCF 12T", bn(fa.fcf_ttm)], ["Thanh toán HH", nf(fa.current_ratio)], ["Trả lãi", fa.interest_cover ? nf(fa.interest_cover, 1) + "x" : "—"],
    ["Nợ ròng/EBITDA", nf(fa.net_debt_ebitda)], ["DT CAGR 3N", pct(fa.rev_cagr3)], ["LN CAGR 3N", pct(fa.ni_cagr3)], ["Quý LN tăng liên tiếp", fa.ni_growth_streak],
    ...(isBank ? [["NIM", pct(fa.nim, 2, false)], ["Nợ xấu", pct(fa.npl, 2, false)], ["Cho vay KH", bn(fa.loans_bn)], ["Tiền gửi KH", bn(fa.deposits_bn)]] : [])]), "", "sec")}
  ${panel("Cổ tức", dv.has_data ? `${kpis([["Tiền mặt 12T", vnd(dv.dps_ttm)], ["Tỷ suất", pct(dv.yield, 2, false)], ["TB 3 năm", pct(dv.yield_avg3, 2, false)], ["Năm trả liên tiếp", dv.cash_years],
      ["Tỷ lệ chi trả", pct(dv.payout, 0, false)], ["Cổ phiếu 3 năm", pct(dv.stock_dividend_3y, 0, false)], ["Chốt quyền gần nhất", esc(dv.last_ex_date || "—")]])}
      <div class="tw sec"><table><thead><tr><th class="l">Năm</th>${dv.history.map((x) => `<th>${x.year}</th>`).join("")}</tr></thead><tbody>
        <tr><td class="l">Tiền mặt (đ/cp)</td>${dv.history.map((x) => `<td>${nf(x.cash_dps, 0)}</td>`).join("")}</tr><tr><td class="l">Cổ phiếu (%)</td>${dv.history.map((x) => `<td>${nf(x.stock_pct, 0)}</td>`).join("")}</tr></tbody></table></div>
      ${dv.note ? `<p class="note" style="margin-top:6px">${esc(dv.note)}</p>` : ""}
      <p class="faint" style="font-size:.74rem;margin-top:4px">Cổ tức tiền mặt chịu thuế TNCN 5%. Cổ tức bằng cổ phiếu không phải tiền về tài khoản.</p>` : `<p class="muted">Chưa có lịch sử cổ tức.</p>`, "", "sec")}`;
}

// ---- dự phóng & định giá (sửa giả định -> tính lại ngay)
const A_FIELDS = [
  ["g1", "Tăng trưởng năm 1", "%"], ["gterm", "Tăng trưởng dài hạn", "%"], ["gm", "Biên LN gộp", "%"], ["sga", "Chi phí BH & QL / DT", "%"],
  ["tax", "Thuế suất", "%"], ["payout", "Tỷ lệ chi trả cổ tức", "%"], ["conv", "Tỷ lệ LN thành tiền tự do", "%"], ["roe_cap", "ROE trần (ngân hàng)", "%"],
];
function tabVal(d) {
  const v = d.valuation || {};
  if (!v.ok || !v.model) return `<div class="empty">${esc(v.reason || "Không đủ số liệu để dự phóng (doanh nghiệp lỗ, vốn chủ âm hoặc thiếu BCTC).")}</div>`;
  const a = v.model.assumptions;
  return `<div class="g g-main"><div class="stack">
    ${panel("Giá trị hợp lý", `<div id="vOut"></div>`)}
    ${panel("Bảng dự phóng (kịch bản cơ sở)", `<div id="pOut"></div><p class="faint" style="margin-top:6px;font-size:.74rem">Doanh thu tăng theo giả định, giảm dần về mức dài hạn; biên lợi nhuận và chi phí theo tỷ lệ doanh thu; lợi nhuận khác giảm 20%/năm.
      Ngân hàng/CTCK/bảo hiểm dự phóng thẳng lợi nhuận. Kịch bản Xấu/Tốt điều chỉnh tăng trưởng và biên lợi nhuận.</p>`, "tỷ đồng")}</div>
    ${panel("Giả định dự phóng", `${v.model.overridden?.length ? `<p class="note">Đang dùng giả định anh đã sửa: ${esc(v.model.overridden.join(", "))}</p>` : ""}
      <div class="assump" style="margin-top:6px">${A_FIELDS.filter(([k]) => a[k] !== undefined && a[k] !== null).map(([k, n]) => `
        <div class="field"><label for="as_${k}">${n} (%)</label><input id="as_${k}" data-a="${k}" inputmode="decimal" value="${(a[k] * 100).toFixed(1)}"></div>`).join("")}
        <div class="field"><label for="as_ke">Chi phí vốn chủ ke (%)</label><input id="as_ke" inputmode="decimal" value="${nf(v.ke, 2).replace(",", ".")}"></div></div>
      <p style="margin-top:8px"><button class="btn primary" id="aSave">Lưu giả định cho ${d.symbol}</button> <button class="btn" id="aReset">Về mặc định</button></p>
      <p class="faint" style="font-size:.74rem">Sửa số – kết quả tính lại ngay. Lưu rồi thì lần chạy kế tiếp hệ thống dùng giả định của anh khi ra tín hiệu.</p>`)}
  </div>`;
}
function bindVal(d) {
  const v = d.valuation, base = v.model.base, a0 = { ...v.model.assumptions };
  const calc = () => {
    const a = { ...a0 };
    $$("[data-a]").forEach((el) => { const x = Number(String(el.value).replace(",", ".")); if (!Number.isNaN(x)) a[el.dataset.a] = x / 100; });
    const ke = Number(String($("#as_ke").value).replace(",", ".")) / 100 || v.ke / 100;
    const sc = { bear: { g: a.g1 - Math.max(0.05, 0.5 * Math.abs(a.g1)), gm: -0.015 }, base: { g: a.g1, gm: 0 }, bull: { g: a.g1 + Math.max(0.04, 0.3 * Math.abs(a.g1)), gm: 0.01 } };
    const res = {};
    for (const [k, s] of Object.entries(sc)) {
      const aa = { ...a, g1: s.g }; if (base.model === "CT") aa.gm = a.gm + s.gm;
      const rows = FC.project(base, aa);
      res[k] = { rows, dcf: FC.dcf(base, aa, rows, ke), ddm: FC.ddm(base, aa, rows, ke) };
    }
    const fwd = res.base.rows[0].eps;
    const ms = v.methods.map((m) => {
      let val = m.value, lo = m.range?.[0], hi = m.range?.[1];
      if (m.key === "dcf") { val = res.base.dcf; lo = res.bear.dcf; hi = res.bull.dcf; }
      if (m.key === "ddm") { val = res.base.ddm; lo = res.bear.ddm; hi = res.bull.ddm; }
      if (m.key === "pe" && m.mult) { val = m.mult * fwd / 1000; }
      return { ...m, value: val, lo, hi };
    }).filter((m) => isNum(m.value) && m.value > 0);
    const med = ms.map((m) => m.value).sort((x, y) => x - y)[Math.floor(ms.length / 2)];
    ms.forEach((m) => (m.used = m.value >= med / 2.5 && m.value <= med * 2.5));
    const used = ms.filter((m) => m.used);
    const ws = used.reduce((s, m) => s + m.w, 0);
    const fair = used.reduce((s, m) => s + m.value * m.w, 0) / (ws || 1);
    const buy = fair * (1 - d.mos / 100), price = d.row.price, up = (fair / price - 1) * 100;
    const lo = Math.min(fair, ...used.map((m) => m.lo).filter(isNum).concat([fair * 0.8])), hi = Math.max(fair, ...used.map((m) => m.hi).filter(isNum).concat([fair * 1.2]));
    const L = Math.min(lo, price) * 0.9, R = Math.max(hi, price) * 1.08, X = (x) => ((x - L) / (R - L)) * 100;
    $("#vOut").innerHTML = `
      ${kpis([["Giá trị hợp lý", nf(fair)], ["Mua an toàn dưới", nf(buy)], ["Giá hiện tại", nf(price)], ["Tiềm năng", pct(up), cls(up)], ["Biên an toàn", d.mos + "%"], ["ke", nf(ke * 100, 1) + "%"]], true)}
      <div class="vrange" aria-hidden="true"><div class="track"></div>
        <div class="zone" style="left:${X(lo)}%;width:${X(hi) - X(lo)}%;background:color-mix(in srgb,var(--up) 35%,transparent)"></div>
        <div class="zone" style="left:${X(L)}%;width:${Math.max(0, X(buy) - X(L))}%;background:color-mix(in srgb,var(--brand) 25%,transparent)"></div>
        <div class="mk" style="left:${X(price)}%;color:var(--ink)">Giá ${nf(price)}</div>
        <div class="mk" style="left:${X(fair)}%;color:var(--up);top:30px">Hợp lý ${nf(fair)}</div></div>
      <div class="leg" style="margin-top:14px"><span><i style="background:color-mix(in srgb,var(--brand) 25%,transparent)"></i>Vùng mua an toàn</span><span><i style="background:color-mix(in srgb,var(--up) 35%,transparent)"></i>Vùng hợp lý (Xấu → Tốt)</span></div>
      <div class="tw sec"><table><thead><tr><th class="l">Phương pháp</th><th>Giá trị</th><th>Xấu</th><th>Tốt</th><th>Trọng số</th></tr></thead><tbody>
      ${ms.map((m) => `<tr style="${m.used ? "" : "opacity:.5"}"><td class="wrap">${esc(m.name)}${m.used ? "" : " <small>(lệch xa, bỏ qua)</small>"}</td><td><b>${nf(m.value)}</b></td><td>${nf(m.lo)}</td><td>${nf(m.hi)}</td><td>${nf(m.w * 100, 0)}%</td></tr>`).join("")}
      </tbody></table></div>
      <p class="faint" style="margin-top:4px;font-size:.74rem">ke = lãi suất phi rủi ro + beta ${nf(v.beta)} × phần bù rủi ro. Giá trị theo nghìn đồng/cổ phiếu.</p>`;
    const rows = res.base.rows;
    const yr0 = new Date().getFullYear();
    const lines = base.model === "CT" ? [["Doanh thu", "revenue", 0], ["LN gộp", "gross_profit", 0], ["LN trước thuế", "pbt", 0], ["LN cổ đông mẹ", "ni", 0], ["EPS (đ)", "eps", 0], ["Cổ tức (đ)", "dps", 0], ["Dòng tiền tự do", "fcfe", 0], ["Tăng trưởng", "g", "p"], ["ROE", "roe", "p"]]
      : [["LN cổ đông mẹ", "ni", 0], ["EPS (đ)", "eps", 0], ["Cổ tức (đ)", "dps", 0], ["BVPS (đ)", "bvps", 0], ["Tăng trưởng LN", "g", "p"], ["ROE", "roe", "p"]];
    $("#pOut").innerHTML = `<div class="tw"><table><thead><tr><th class="l">Tỷ đồng</th>${rows.map((r) => `<th>${yr0 + r.year_offset - 1}F</th>`).join("")}</tr></thead><tbody>
      ${lines.map(([n, k, f]) => `<tr><td class="l">${n}</td>${rows.map((r) => `<td>${f === "p" ? pct((r[k] ?? 0) * 100, 1, false) : nf(r[k], 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    return a;
  };
  $$("[data-a], #as_ke").forEach((el) => (el.oninput = calc));
  calc();
  $("#aSave").onclick = async () => {
    const a = calc();
    const { data } = await Store.get("assumptions");
    const all = data || {};
    all[d.symbol] = Object.fromEntries(A_FIELDS.map(([k]) => [k, a[k]]).filter(([, x]) => isNum(x)));
    const ok = await Store.put("assumptions", all);
    toast(ok ? "Đã lưu – áp dụng từ lần chạy kế tiếp" : "Đã lưu trên trình duyệt này");
  };
  $("#aReset").onclick = async () => {
    const { data } = await Store.get("assumptions");
    const all = data || {}; delete all[d.symbol]; await Store.put("assumptions", all);
    $$("[data-a]").forEach((el) => (el.value = (a0[el.dataset.a] * 100).toFixed(1)));
    $("#as_ke").value = String(v.ke); calc(); toast("Đã về giả định mặc định");
  };
}
function tabPeers(d) {
  const p = d.peers || { cols: [], rows: [] };
  const name = { symbol: "Mã", price: "Giá", mcap_bn: "Vốn hoá", pe: "P/E", pb: "P/B", roe: "ROE", ni_yoy: "LN 12T", rev_yoy: "DT 12T", de: "Vay/Vốn", fscore: "F-Score", div_yield: "Cổ tức", upside: "Tiềm năng", composite: "Điểm" };
  const f = (k, x) => k === "symbol" ? `<a href="#/s/${x}">${x}</a>` : k === "mcap_bn" ? mcapFmt(x) : ["roe", "div_yield"].includes(k) ? (isNum(x) ? nf(x, 1) + "%" : "—") : ["ni_yoy", "rev_yoy", "upside"].includes(k) ? `<span class="${cls(x)}">${pct(x)}</span>` : k === "composite" ? scoreCell(x) : k === "fscore" ? (x ?? "—") : nf(x);
  const pctl = p.pctl || {};
  const lbl = { pe: "P/E (thấp là tốt)", pb: "P/B (thấp là tốt)", roe: "ROE", roa: "ROA", net_margin: "Biên LN ròng", gross_margin: "Biên LN gộp", rev_yoy: "Tăng trưởng DT", ni_yoy: "Tăng trưởng LN", de: "Vay/Vốn (thấp là tốt)", fscore: "F-Score", div_yield: "Cổ tức", mcap_bn: "Quy mô" };
  return `<div class="g g-main">
    <section class="panel flush"><div class="ph"><h2>So với các mã cùng ngành</h2><a class="meta" href="#/sector/${enc(d.industry || d.sector || "")}${d.industry && d.industry !== d.sector ? "/l3" : ""}">chạy phương án lọc cả ngành →</a></div>
      <div class="tw"><table><thead><tr>${p.cols.map((c) => `<th class="${c === "symbol" ? "sym" : ""}">${name[c] || c}</th>`).join("")}</tr></thead><tbody>
      ${p.rows.map((r) => `<tr class="${r[0] === d.symbol ? "hl" : ""}">${r.map((x, i) => `<td class="${p.cols[i] === "symbol" ? "sym" : ""}">${f(p.cols[i], x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><div class="ph"><h2>${esc(d.symbol)} đứng ở đâu trong ${p.n ?? "—"} mã</h2><span class="meta">100 = tốt nhất ngành</span></div>
      <div class="tw"><table><tbody>${Object.entries(lbl).map(([k, n]) => `<tr><td class="l" style="font-weight:500">${n}</td><td style="width:45%">${minibar(pctl[k])}</td><td>${isNum(pctl[k]) ? Math.round(pctl[k]) : "—"}</td><td class="muted">TV ${nf(p.median?.[k], 1)}</td></tr>`).join("")}</tbody></table></div></section>
  </div>`;
}

// ================================================================ HƯỚNG DẪN
async function viewGuide() {
  const [m, t] = await Promise.all([load("data/methods.json"), load("data/today.json")]);
  app().innerHTML = `<div class="ph"><h1>Hệ thống chọn mã thế nào?</h1></div>
  <div class="g g2">
  ${panel("Quy trình mỗi ngày", `<ol style="margin:0;padding-left:18px">
    <li>15h35 các ngày giao dịch: tải giá toàn bộ HOSE, HNX, UPCOM và khớp lệnh theo bước giá (Order Flow). Thứ Bảy tải lại báo cáo tài chính, cổ tức và chạy kiểm chứng.</li>
    <li>Đèn thị trường quyết định được nắm tối đa bao nhiêu % cổ phiếu (Xanh 100%, Vàng 60%, Đỏ 30%).</li>
    <li>Mỗi mã được phân tích cơ bản, dự phóng 5 năm, định giá đa phương pháp và chấm điểm ${Object.keys(m.methods).length} phương pháp.</li>
    <li>Mã đạt điều kiện từng rổ được xếp hạng; rổ nào được bao nhiêu vốn theo config.yaml.</li>
    <li>Hàng rào kỹ thuật: chỉ mua mã đang có xu hướng tăng và giá nằm trong vùng an toàn.</li>
    <li>Mỗi lệnh có cắt lỗ, mục tiêu và tỷ trọng sao cho nếu sai chỉ mất khoảng ${esc(String(t.risk?.risk_per_trade ?? 1.5))}% tổng vốn.</li>
    <li>Danh mục đang nắm được kiểm tra: chạm cắt lỗ, định giá đã đắt, hay luận điểm cơ bản gãy thì báo bán qua Telegram.</li></ol>`)}
  ${panel("Tab Ngành – lọc mã xịn nhất trong 1 nhóm ngành", `<p>Chọn ngành (cấp 2) hoặc nhóm ngành (cấp 3) bên trái, rồi chọn <b>phương án</b>. Mỗi yếu tố được xếp hạng phần trăm <i>so với chính các mã cùng ngành</i> (ngân hàng so với ngân hàng, thép so với thép) rồi cộng theo trọng số.</p>
    <p><b>Tốt nhất ngành</b> là công thức đã được backtest: kết quả từng ngành nằm ngay dưới bảng xếp hạng và ở tab Kiểm chứng. Các phương án khác dùng để nhìn từ nhiều góc; <b>Tuỳ chỉnh</b> cho phép tự chọn yếu tố.</p>
    <p>RRG (xoay vòng ngành): ngành <span class="up">Dẫn dắt</span> mạnh hơn thị trường và đang tăng tốc; <span class="floor">Cải thiện</span> yếu nhưng đang mạnh lên; <span class="ref">Suy yếu</span> mạnh nhưng chậm lại; <span class="down">Tụt hậu</span> yếu và yếu đi.</p>`)}
  ${panel("Tạo lập & dòng tiền", `<dl class="kv" style="grid-template-columns:110px 1fr"><dt>SMC</dt><dd style="text-align:left;font-weight:400">BOS = phá vỡ cấu trúc theo xu hướng; CHoCH = đổi tính chất (đảo chiều sớm). Order Block = nến ngược chiều cuối cùng trước cú bứt phá – nơi tổ chức đặt lệnh. FVG = khoảng trống giá chưa khớp đủ, giá hay quay lại lấp. Quét thanh khoản = thủng đỉnh/đáy cũ rồi quay đầu. Premium/Discount = nửa trên/dưới biên độ.</dd>
    <dt>VSA</dt><dd style="text-align:left;font-weight:400">Đọc biên độ nến + khối lượng: No Supply/No Demand (cạn cung/cầu), Stopping Volume, Climax, Upthrust, Test…</dd>
    <dt>Wyckoff</dt><dd style="text-align:left;font-weight:400">Tích luỹ: SC → AR → ST → Spring → SOS → LPS. Phân phối: BC → AR → UTAD → SOW → LPSY.</dd>
    <dt>Order Flow</dt><dd style="text-align:left;font-weight:400">Mua/bán chủ động theo từng bước giá trong phiên: Delta, POC, vùng giá trị, CVD và phân kỳ. Dữ liệu tích luỹ dần từ ngày hệ thống bắt đầu lưu.</dd></dl>
    <p class="faint" style="font-size:.76rem">Mọi tín hiệu đều được đo tỷ lệ đúng trên dữ liệu VN (tab Kiểm chứng). Chỉ tín hiệu có lợi thế thật mới được cộng/trừ điểm.</p>`)}
  ${panel("Các rổ", Object.entries(m.baskets).map(([k, b]) => `<div class="ev"><time><a href="#/screener/${k}">${esc(b.name)}</a></time><span>${esc(b.rule)} <small class="faint">· rủi ro ${esc(b.risk)}</small></span></div>`).join(""))}
  </div>
  <section class="sec">${panel(`${Object.keys(m.methods).length} phương pháp chấm điểm`, `<div class="weights">${Object.entries(m.methods).map(([k, x]) => `<div class="w-item"><header><b>${esc(x.name)}</b><small>trọng số ${m.weights[k] ?? 0}</small></header><p>${esc(x.desc)}</p></div>`).join("")}</div>`)}</section>`;
}

// ================================================================ khởi động
function initTheme() {
  const saved = lsGet("theme", null);
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    lsSet("theme", document.documentElement.dataset.theme);
    route();
  };
}
function initSearch() {
  const q = $("#q"), box = $("#sugg");
  let sel = 0, list = [];
  const pick = (s) => { box.hidden = true; q.value = ""; location.hash = `#/s/${s}`; };
  q.addEventListener("input", async () => {
    const t = q.value.trim().toUpperCase();
    if (!t) { box.hidden = true; return; }
    const rows = await screenerRows();
    list = rows.filter((r) => r.symbol.startsWith(t) || String(r.name || "").toUpperCase().includes(t)).sort((a, b) => (b.symbol.startsWith(t) - a.symbol.startsWith(t)) || (b.avg_value_bn || 0) - (a.avg_value_bn || 0)).slice(0, 8);
    sel = 0;
    box.innerHTML = list.map((r, i) => `<a href="#/s/${r.symbol}" class="${i === 0 ? "on" : ""}"><b>${r.symbol}</b><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.76rem">${esc(r.name || "")}</span><span style="margin-left:auto">${nf(r.price)}</span><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)}</small></a>`).join("") || `<div class="muted" style="padding:10px">Không thấy mã</div>`;
    box.hidden = false;
  });
  q.addEventListener("keydown", (e) => {
    if (box.hidden || !list.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { sel = (sel + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length; $$("a", box).forEach((a, i) => a.classList.toggle("on", i === sel)); e.preventDefault(); }
    if (e.key === "Enter") { pick(list[sel].symbol); e.preventDefault(); }
    if (e.key === "Escape") box.hidden = true;
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search")) box.hidden = true; });
  box.addEventListener("click", () => { box.hidden = true; q.value = ""; });
}
(async function main() {
  initTheme(); initSearch();
  try {
    const meta = await load("data/meta.json");
    window.__ver = meta.generated;
    if (meta.demo) $("#demo").innerHTML = `<div class="demo-banner">DỮ LIỆU GIẢ LẬP để xem thử giao diện – không dùng để đầu tư</div>`;
    const [t, m, meth] = await Promise.all([load("data/today.json"), tryLoad("data/market.json"), tryLoad("data/methods.json")]);
    PSTATS = meth?.pattern_stats?.stats || {};
    const col = { green: "#2FD08F", yellow: "#F4C32F", red: "#F0444B" }[t.regime.light];
    $("#brandDot").style.background = col;
    if (m) {
      const br = m.regime.breadth_now || {};
      $("#ticker").innerHTML = Object.entries(m.indices).map(([k, v]) => `<span><b>${esc(k)}</b>${nf(v.close)} <span class="${cls(v.chg)}">${pct(v.chg, 2)}</span></span>`).join("") +
        `<span><b>Tăng/giảm</b><span class="up">${br.adv ?? "—"}</span>/<span class="down">${br.dec ?? "—"}</span></span><span><b>Đèn</b>${LIGHT_VI[t.regime.light]} ${t.regime.exposure}%</span><span class="faint">${esc(meta.data_date)}</span>`;
    }
  } catch (e) { /* chưa có dữ liệu */ }
  window.addEventListener("hashchange", route);
  route();
})();
