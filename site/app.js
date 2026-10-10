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
const BASKET_SHORT = { garp: "GARP", dividend: "Cổ tức", value: "Giá trị", defensive: "Phòng thủ", growth: "Tăng trưởng", swing: "Lướt sóng", long: "Dài hạn", income: "Cổ tức" };
const STYLE_ORDER = ["swing", "position", "long", "income"];
const STYLE_SHORT = { swing: "Lướt sóng", position: "Trung hạn", long: "Dài hạn", income: "Cổ tức" };
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
const kpis = (items, lg = false, extra = "") => `<dl class="kpis ${lg ? "lg" : ""} ${extra}">${items.filter(Boolean).map(([k, v, c, t, x]) => `<div${t ? ` title="${esc(t)}"` : ""}${x ? ` class="${x}"` : ""}><dt>${k}</dt><dd class="${c || ""}">${v ?? "—"}</dd></div>`).join("")}</dl>`;
const panel = (title, body, meta = "", extra = "") => `<section class="panel ${extra}"><div class="ph"><h2>${title}</h2>${meta ? `<span class="meta">${meta}</span>` : ""}</div>${body}</section>`;

// ================================================================ danh mục (lưu trên Cloudflare KV, dự phòng localStorage)
const Store = {
  async get(key) {
    try {
      const r = await fetch(`api/${key}`, { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) return { data: await r.json(), remote: true };
    } catch (e) { /* chạy trên máy: không có API */ }
    if (typeof ME !== "undefined" && ME && !ME.legacy) return { data: null, remote: false };   // nhiều người dùng: không dùng bản lưu trên máy (có thể của người khác)
    return { data: lsGet(key, null), remote: false };
  },
  async put(key, data) {
    const multi = typeof ME !== "undefined" && ME && !ME.legacy;
    if (!multi) lsSet(key, data);
    try {
      const r = await fetch(`api/${key}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
      if (r.ok) return true;
      if (multi) { let m = `Chưa lưu được (HTTP ${r.status})`; try { m = (await r.json()).error || m; } catch (e) { /* rỗng */ } setTimeout(() => toast("⚠️ " + m), 60); }
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
  path(a, n) {
    const g1 = a.g1, gt = a.gterm, gm_ = isNum(a.gmid) ? a.gmid : (g1 + gt) / 2, m = Math.min(3, n), out = [];
    for (let t = 1; t <= n; t++) {
      const g = t <= m ? g1 + (gm_ - g1) * (t - 1) / Math.max(1, m - 1) : gm_ + (gt - gm_) * (t - m) / Math.max(1, n - m);
      const f = (t - 1) / Math.max(1, n - 1);
      const gm = isNum(a.gm) ? a.gm + ((isNum(a.gm_lt) ? a.gm_lt : a.gm) - a.gm) * f : null;
      const sga = isNum(a.sga) ? a.sga + ((isNum(a.sga_lt) ? a.sga_lt : a.sga) - a.sga) * f : null;
      out.push([g, gm, sga]);
    }
    return out;
  },
  project(base, a) {
    const n = base.years, rows = [], shares = base.shares;
    let equity = base.equity, rev = base.revenue, niPrev = base.ni;
    const rev0 = base.revenue, P = FC.path(a, n);
    for (let t = 1; t <= n; t++) {
      const [g, gmT, sgaT] = P[t - 1];
      let ni, fcfe, row;
      if (base.model === "CT") {
        rev = rev * (1 + g);
        const gp = rev * gmT, sga = rev * sgaT, interest = base.interest * Math.pow(rev / rev0, 0.5);
        const other = base.other * Math.pow(0.8, t);
        const pbt = gp - sga - interest + other;
        const tax = Math.max(0, pbt * a.tax);
        ni = (pbt - tax) * (1 - base.minority);
        const ct = isNum(a.conv_term) ? a.conv_term : a.conv;
        fcfe = ni * (a.conv + (ct - a.conv) * t / n);
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
    const fT = base.model === "CT" && last.ni ? last.fcfe * (1 + g) : last.ni * (1 + g) * (1 - g / roeT);
    const tv = fT / (ke - g);
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
  const S = await secsData(), M = S.market || {};
  const i3 = Object.fromEntries((S.industry || []).map((x) => [x.name, x])), s2 = Object.fromEntries((S.sector || []).map((x) => [x.name, x]));
  SCREENER.forEach((r) => { const b = i3[r.industry] || s2[r.sector]; r.pe_ind = b?.pe_med ?? null; r.pb_ind = b?.pb_med ?? null;
    r.pe_vs_ind = vsPct(r.pe, r.pe_ind); r.pe_vs_mkt = vsPct(r.pe, M.pe_med); r.pb_vs_ind = vsPct(r.pb, r.pb_ind); });
  SCREENER.forEach((r) => { if (isNum(r.ret_6m)) r.ret_6m_pct = r.ret_6m * 100; if (isNum(r.ret_12_1)) r.ret_12_1_pct = r.ret_12_1 * 100; if (isNum(r.vol_1y)) r.vol_1y_pct = r.vol_1y * 100; if (isNum(r.payout)) r.payout_pct = r.payout; });
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
    const gate = ROUTE_FEATURE[r] && ROUTE_FEATURE[r](arg[0]);
    if (gate && !can(gate)) { setTab(r); await lockView(gate); }
    else if (!r) { setTab("today"); if (can("today")) await viewToday(); else await viewDigest(null, true); }
    else if (r === "digest") { setTab(""); await viewDigest(arg[0]); }
    else if (r === "account") { setTab(""); await viewAccount(); }
    else if (r === "admin") { setTab(""); await viewAdmin(arg[0]); }
    else if (r === "notifications") { setTab(""); await viewNotifications(); }
    else if (r === "market") { setTab("market"); await viewMarket(); }
    else if (r === "swing") { setTab("swing"); await viewSwing(arg[0]); }
    else if (r === "sector") { setTab("sector"); if (arg[0]) await viewSector(arg[0], arg[1]); else await viewSectors(); }
    else if (r === "portfolio") { setTab("portfolio"); if (arg[0] === "journal") await viewJournal(); else if (arg[0] === "profile") await viewProfile(); else await viewPortfolio(); }
    else if (r === "screener") { setTab("screener"); await viewScreener(arg[0]); }
    else if (r === "backtest") { setTab("backtest"); await viewBacktest(); }
    else if (r === "watch") { setTab("watch"); await viewWatch(arg[0]); }
    else if (r === "compare") { setTab(""); await viewCompare(arg[0]); }
    else if (r === "s" && arg[0]) { setTab(""); await viewStock(arg[0].toUpperCase(), arg[1]); }
    else if (r === "guide") { setTab(""); await viewGuide(); }
    else if (r === "help" || r === "faq") { setTab(""); await viewHelp(); }
    else { app().innerHTML = `<div class="empty">Không có trang này. <a href="#/">Về trang Hôm nay</a></div>`; }
  } catch (e) {
    console.error(e);
    app().innerHTML = `<div class="panel"><h2>Chưa có dữ liệu để hiển thị</h2><p>${esc(e.message)}</p>
      <p class="muted">Hệ thống cập nhật mỗi chiều sau 15h35. Nếu đây là lần đầu, chờ lượt chạy đầu tiên hoàn tất (khoảng 30–60 phút).</p></div>`;
  }
  if (multiUser()) deTelegram(app());
  app().focus({ preventScroll: true });
}
// chế độ nhiều người dùng: Telegram chỉ dành cho chủ sở hữu – trên web gọi chung là "thông báo"
function deTelegram(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const rp = [[/nhắn Telegram/g, "gửi thông báo"], [/tin Telegram/g, "thông báo"], [/cảnh báo Telegram/g, "thông báo"], [/qua Telegram/g, "qua thông báo"], [/Telegram sẽ nhắn/g, "Hệ thống sẽ báo"], [/Telegram/g, "thông báo"]];
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeValue.includes("Telegram")) rp.forEach(([a, b]) => (n.nodeValue = n.nodeValue.replace(a, b))); }
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

// ---- thành phần hiển thị gọn (không cuộn ngang)
function mini(arr, o = {}) {
  const v = (arr || []).filter(isNum).map(Number);
  if (v.length < 2) return `<span class="mini"></span>`;
  const W = o.w || 74, H = o.h || 24, mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
  const X = (i) => (i / (v.length - 1)) * (W - 3) + 1, Y = (y) => H - 2 - ((y - mn) / rg) * (H - 4);
  const up = v[v.length - 1] >= v[0], col = up ? "var(--up)" : "var(--down)";
  const pts = v.map((y, i) => `${X(i).toFixed(1)},${Y(y).toFixed(1)}`).join(" ");
  return `<svg class="mini" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="1,${H} ${pts} ${W - 2},${H}" fill="${col}" opacity=".08" stroke="none"/>
    <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round"/><circle cx="${X(v.length - 1)}" cy="${Y(v[v.length - 1])}" r="2" fill="${col}"/></svg>`;
}
const ring = (v, size = 30) => `<span class="ring" style="--v:${Math.max(0, Math.min(100, v || 0))};--c:${!isNum(v) ? "var(--ink-3)" : v >= 60 ? "var(--up)" : v >= 40 ? "var(--ref)" : "var(--down)"};width:${size}px;height:${size}px" title="Điểm ${isNum(v) ? Math.round(v) : "—"}/100"><span>${isNum(v) ? Math.round(v) : "—"}</span></span>`;
const row = (href, main, sub, mid, val, valSub) => `<a class="row" href="${href}"><div class="r-main"><b>${main}</b>${sub ? `<small>${sub}</small>` : ""}</div>${mid ?? ""}<div class="r-val">${val ?? ""}${valSub ? `<small>${valSub}</small>` : ""}</div></a>`;
// thước giá: cắt lỗ – vùng mua – giá – mục tiêu
function ladder(p) {
  const z0 = p.zone?.[0], z1 = p.zone?.[1], px = p.price, pts = [p.stop, z0, z1, px, p.t1, p.t2].filter(isNum);
  if (pts.length < 4) return "";
  const L = Math.min(...pts) * 0.985, R = Math.max(...pts) * 1.015, X = (x) => ((x - L) / (R - L)) * 100;
  return `<div class="ladder" aria-label="Giá ${nf(px)}, vùng mua ${nf(z0)}–${nf(z1)}, cắt lỗ ${nf(p.stop)}, mục tiêu ${nf(p.t1)}">
    <div class="lt"></div>
    ${isNum(p.stop) && isNum(z0) ? `<i class="lz risk" style="left:${X(p.stop)}%;width:${X(z0) - X(p.stop)}%"></i>` : ""}
    ${isNum(z0) && isNum(z1) ? `<i class="lz buy" style="left:${X(z0)}%;width:${Math.max(1, X(z1) - X(z0))}%"></i>` : ""}
    ${isNum(z1) && isNum(p.t2 ?? p.t1) ? `<i class="lz gain" style="left:${X(z1)}%;width:${X(p.t2 ?? p.t1) - X(z1)}%"></i>` : ""}
    ${isNum(p.t1) ? `<i class="lk" style="left:${X(p.t1)}%"></i>` : ""}${isNum(p.t2) ? `<i class="lk" style="left:${X(p.t2)}%"></i>` : ""}${isNum(p.stop) ? `<i class="lk stop" style="left:${X(p.stop)}%"></i>` : ""}
    <i class="lp" style="left:${X(px)}%"><em>${nf(px)}</em></i>
    ${(() => { // nhãn: tránh chồng nhau bằng cách xuống dòng thứ 2
      const L = [[X(p.stop), `${p.stop_label || "cắt lỗ"} ${nf(p.stop)}`, ""], [(X(z0) + X(z1)) / 2, `mua ${nf(z0)}–${nf(z1)}`, "c"]];
      if (isNum(p.t1)) L.push([X(p.t1), `MT1 ${nf(p.t1)}`, "c"]);
      if (isNum(p.t2)) L.push([X(p.t2), `MT2 ${nf(p.t2)}`, "r"]);
      const last = [-99, -99];
      return L.sort((a, b) => a[0] - b[0]).map(([x, txt, al]) => { const w = txt.length * 0.9; let rw = x - last[0] > w ? 0 : x - last[1] > w ? 1 : 0; last[rw] = x; return `<span class="ll ${al}" style="left:${x}%;top:${29 + rw * 12}px">${txt}</span>`; }).join("");
    })()}
  </div><div class="lleg"><span class="down">${p.stop_label || "cắt lỗ"} ${nf(p.stop)}</span><span class="up">mua ${nf(z0)}–${nf(z1)}</span>${isNum(p.t1) ? `<span>MT1 ${nf(p.t1)}</span>` : ""}${isNum(p.t2) ? `<span>MT2 ${nf(p.t2)}</span>` : ""}</div>`;
}

// ================================================================ QUYẾT ĐỊNH HÔM NAY: đứng ngoài hay vào, vào bao nhiêu, lệnh cụ thể
function decisionPlan(t, pf) {
  const reg = t.regime || {}, style = t.style || "position", SP = (t.styles || {})[style] || {};
  const pos = (t.portfolio?.positions) || [];
  const stockMV = pos.reduce((s, p) => s + (p.mv_vnd || 0), 0);
  const capital = capitalOf(pf);
  const total = t.portfolio?.total_vnd || capital || (pf.cash ? Number(pf.cash) + stockMV : null);
  const known = !!(capital || Number(pf.cash) > 0);
  const target = Math.min(reg.exposure ?? 100, isNum(SP.exposure_cap) ? SP.exposure_cap : 100);
  const riskPct = Number(t.risk?.risk_per_trade ?? 1.5);
  const orders = [];
  // 1) bán theo khuyến nghị (mức thoát đã chạm, cắt lỗ, luận điểm gãy)
  let sold = 0;
  pos.filter((p) => p.severity >= 2).forEach((p) => {
    const hits = (p.exit?.levels || []).filter((x) => x.status === "hit" && (x.sell || 0) > 0);
    const frac = /BÁN HẾT|CẮT LỖ|GÃY/i.test(p.action || "") ? 1 : Math.max(0, ...hits.map((x) => x.sell)) || 1;
    const q = frac >= 0.999 ? p.qty : lotPart(p.qty, frac);
    if (!q) return;
    const v = q * p.price * 1000; sold += v;
    orders.push({ side: "sell", s: p.symbol, qty: q, px: p.price, v, why: `${p.action}${frac < 0.999 ? ` (${Math.round(frac * 100)}%)` : ""}`, sev: p.severity });
  });
  // 2) giảm tỷ trọng nếu vẫn cao hơn mức đèn cho phép
  let stock2 = stockMV - sold;
  if (total && known && stock2 / total * 100 > target + 5) {
    let need = stock2 - target / 100 * total;
    const soldSet = new Set(orders.map((o) => o.s));
    pos.filter((p) => !soldSet.has(p.symbol)).sort((a, b) => (b.severity - a.severity) || ((a.pnl_pct ?? 0) - (b.pnl_pct ?? 0))).forEach((p) => {
      if (need <= 0) return;
      const q = Math.min(p.qty, Math.ceil(need / (p.price * 1000) / 100) * 100);
      if (q < 100) return;
      const v = q * p.price * 1000; need -= v; stock2 -= v;
      orders.push({ side: "trim", s: p.symbol, qty: q, px: p.price, v, why: `giảm tỷ trọng về ${target}% theo đèn ${LIGHT_VI[reg.light] || ""}${p.severity ? " · " + p.action : ""}`, sev: 1 });
    });
  }
  const trimmingNow = () => orders.some((o) => o.side === "trim");
  // 3) mua theo danh sách MUA của phong cách đang chọn, trong phần vốn còn được phép
  const held = new Set(pos.map((p) => p.symbol));
  let gap = total && known ? target / 100 * total - stock2 : null;
  const picks = (SP.picks || []).filter((p) => !held.has(p.symbol));
  const inZone = picks.filter((p) => p.state === "now" || (isNum(p.price) && p.zone && p.price <= p.zone[1] * 1.005));
  const waiting = picks.filter((p) => !inZone.includes(p));
  inZone.forEach((p) => {
    const entry = Math.min(p.zone[1], p.price || p.zone[1]);
    if (trimmingNow()) { orders.push({ side: "skip", s: p.symbol, why: "đang phải giảm tỷ trọng – chưa mua mới", px: entry }); return; }
    let amt = total ? (p.weight || 0) / 100 * total : null;
    if (gap !== null) amt = Math.min(amt ?? gap, gap);
    if (!amt || amt <= 0) { orders.push({ side: "skip", s: p.symbol, why: "đã dùng hết phần vốn được phép theo đèn", px: entry }); return; }
    const riskCap = total ? riskPct / 100 * total : null;
    let q = amt / (entry * 1000);
    if (riskCap && isNum(p.stop) && entry > p.stop) q = Math.min(q, riskCap / ((entry - p.stop) * 1000));
    q = lot(q);
    if (q < 100) { orders.push({ side: "skip", s: p.symbol, why: "số tiền còn lại không đủ 100 cp", px: entry }); return; }
    const half = p.ext && p.split;
    const v = q * entry * 1000; if (gap !== null) gap -= v;
    orders.push({ side: "buy", s: p.symbol, qty: q, px: entry, zone: p.zone, stop: p.stop, t1: p.t1, v, risk: isNum(p.stop) ? q * (entry - p.stop) * 1000 : null,
      why: `${BASKET_SHORT[p.basket] || p.basket || ""}${half ? " · kéo giãn: 1/2 ngay, 1/2 đặt LO " + nf(p.split.lo) : ""}`, half });
  });
  // 4) cơ hội sau sự kiện (DN có lãi, nợ thấp) – tỷ trọng nhỏ, tuỳ chọn
  const trimming = orders.some((o) => o.side === "trim");
  const ev = trimming ? [] : (t.post_event || []).filter((x) => x.quality && !held.has(x.symbol)).slice(0, 3);
  ev.forEach((x) => {
    const w = Math.min(5, (t.risk?.max_weight_per_stock ?? 20) / 2);
    const amt = total ? Math.min(w / 100 * total, gap !== null ? Math.max(0, gap) : Infinity) : null;
    const q = amt ? lot(amt / (x.zone[1] * 1000)) : 0;
    orders.push({ side: q >= 100 ? "event" : "skip", s: x.symbol, qty: q, px: x.zone[1], zone: x.zone, stop: x.stop, t1: x.t1, v: q * x.zone[1] * 1000,
      risk: q >= 100 && isNum(x.stop) ? q * (x.zone[1] - x.stop) * 1000 : null,
      why: q >= 100 ? "sau sự kiện – tuỳ chọn, tỷ trọng nhỏ" : "sau sự kiện – không còn phần vốn được phép", opt: true });
    if (q >= 100 && gap !== null) gap -= q * x.zone[1] * 1000;
  });
  const curPct = total && known ? stockMV / total * 100 : null;
  const sells = orders.filter((o) => o.side === "sell"), trims = orders.filter((o) => o.side === "trim"), buys = orders.filter((o) => o.side === "buy");
  let head, tone;
  if (sells.length) { head = `XỬ LÝ DANH MỤC TRƯỚC: bán ${sells.length} mã`; tone = "down"; }
  else if (trims.length) { head = `GIẢM TỶ TRỌNG: bán bớt ≈ ${big(trims.reduce((s, o) => s + o.v, 0))} đ`; tone = "down"; }
  else if (buys.length) { head = `GIẢI NGÂN TỪNG PHẦN: mua ${buys.length} mã ≈ ${big(buys.reduce((s, o) => s + o.v, 0))} đ`; tone = "up"; }
  else if (curPct !== null && curPct < target - 5) { head = waiting.length ? `GIỮ TIỀN – chờ ${waiting.length} mã về vùng mua` : "GIỮ TIỀN – chưa có mã đạt điều kiện"; tone = "ref"; }
  else { head = "GIỮ NGUYÊN – không cần làm gì"; tone = ""; }
  return { head, tone, target, curPct, total, known, stockMV, cash: total && known ? total - stockMV : null, orders, waiting, style, styleName: SP.name || STYLE_SHORT[style] };
}
function decisionCard(t, pf, opts = {}) {
  const D = decisionPlan(t, pf), reg = t.regime || {}, S = t.stance || {}, L = (S.lights || {})[reg.light] || {}, G = (S.lights || {}).green || {}, A = S.all || {};
  const sideTxt = { sell: ["BÁN", "down"], trim: ["BÁN BỚT", "down"], buy: ["MUA", "up"], event: ["MUA (tuỳ chọn)", "up"], skip: ["BỎ QUA", "muted"] };
  const ords = D.orders.filter((o) => opts.noBuy ? ["sell", "trim"].includes(o.side) : true);
  const bar = (v, c) => `<i style="width:${Math.max(0, Math.min(100, v || 0))}%;background:${c}"></i>`;
  const after = D.total && D.known ? (D.stockMV - ords.filter((o) => o.side === "sell" || o.side === "trim").reduce((s, o) => s + o.v, 0) + ords.filter((o) => o.side === "buy" || o.side === "event").reduce((s, o) => s + o.v, 0)) / D.total * 100 : null;
  const txt = ords.filter((o) => o.qty >= 100 && o.side !== "skip").map((o) => `${sideTxt[o.side][0]} ${o.s} ${nf(o.qty, 0)} cp giá LO ${nf(o.px)}${o.stop ? ` · cắt lỗ ${nf(o.stop)}` : ""}${o.t1 ? ` · mục tiêu ${nf(o.t1)}` : ""}`).join("\n");
  return `<section class="panel sec decide t-${D.tone}"><div class="ph"><h2>🧭 Hôm nay nên làm gì</h2><span class="meta">phong cách ${esc(D.styleName || "")} · tính từ giá đóng cửa ${esc(t.date)}</span></div>
    <div class="dhead"><b class="${D.tone}">${esc(D.head)}</b></div>
    <div class="dgrid">
      <div class="dexp"><div class="dlab"><span>Đang nắm cổ phiếu</span><b>${isNum(D.curPct) ? nf(D.curPct, 0) + "%" : "—"}</b></div><div class="dbar">${bar(D.curPct, "var(--brand)")}<em style="left:${D.target}%"></em></div>
        <div class="dlab"><span>Mức nên nắm theo đèn ${esc(LIGHT_VI[reg.light] || "")}</span><b>${D.target}%</b></div>
        ${isNum(after) ? `<div class="dlab"><span>Sau khi làm theo các lệnh dưới</span><b>${nf(after, 0)}%</b></div>` : ""}
        ${D.total && D.known ? `<small class="faint">Tổng tài sản ${big(D.total)} đ · cổ phiếu ${big(D.stockMV)} đ · tiền mặt ${big(D.cash)} đ</small>` : `<p class="note">Nhập <b>tổng vốn</b> hoặc tiền mặt ở <a href="#/portfolio">Danh mục</a> để hệ thống tính số tiền và số cổ phiếu cụ thể.</p>`}</div>
      <div class="dwhy">${L.n ? `<p><b>Đèn ${esc(LIGHT_VI[reg.light])}</b>${S.now?.days ? ` ${S.now.days} phiên liền` : ""} (${reg.score}/${reg.max_score} điều kiện). Lịch sử ${esc((S.from || "").slice(0, 4))}–nay sau đèn này: VN-Index 60 phiên TB <b class="${cls(L.vn60)}">${pct(L.vn60, 1)}</b> (mọi lúc ${pct(A.vn60, 1)}), đúng hướng tăng ${nf(L.hit60, 0)}%;
          xác suất sụt ≥ 20% trong 60 phiên <b class="down">${nf(L.p_dd20, 0)}%</b> (đèn Xanh ${nf(G.p_dd20, 0)}%).</p>
          <p class="faint" style="font-size:.74rem">→ Đèn <b>không đoán được</b> thị trường lên hay xuống; nó đo <b>rủi ro sụt sâu</b>. Vì vậy hệ thống không bảo “đứng ngoài hẳn” mà giữ tỷ trọng theo đèn – kiểm chứng 2020–2026: lợi nhuận/năm giảm từ 16,9% xuống 14,0% nhưng mức sụt lớn nhất của danh mục giảm từ −34,6% xuống −18,4%.</p>` : `<p>${esc(reg.text || "")}</p>`}</div>
    </div>
    ${ords.length ? `<div class="tw"><table class="dord"><thead><tr><th class="l">Lệnh</th><th class="l">Mã</th><th>Khối lượng</th><th>Giá LO</th><th>Giá trị</th><th>Cắt lỗ</th><th>Mục tiêu</th><th>Nếu chạm cắt lỗ</th><th class="l">Lý do</th></tr></thead><tbody>
      ${ords.map((o) => `<tr class="${o.side === "skip" ? "faint" : ""}"><td class="l"><b class="${sideTxt[o.side][1]}">${sideTxt[o.side][0]}</b></td><td class="l"><a href="#/s/${o.s}"><b>${o.s}</b></a></td>
        <td>${o.qty ? nf(o.qty, 0) + " cp" : "—"}</td><td>${nf(o.px)}${o.zone ? `<small class="faint"> vùng ${nf(o.zone[0])}–${nf(o.zone[1])}</small>` : ""}</td><td>${o.v ? big(o.v) : "—"}</td>
        <td class="down">${o.stop ? nf(o.stop) : ""}</td><td class="up">${o.t1 ? nf(o.t1) : ""}</td><td class="down">${o.risk ? "−" + big(o.risk) : ""}</td><td class="l wrap"><small>${esc(o.why || "")}</small></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="muted">Không có lệnh nào cần đặt cho phiên tới.</p>`}
    <p class="dfoot">${D.waiting.length && !opts.noBuy ? `<span>⏳ Chờ về vùng mua: ${D.waiting.slice(0, 6).map((p) => `<a href="#/s/${p.symbol}">${p.symbol}</a> ${nf(p.zone[0])}–${nf(p.zone[1])}`).join(" · ")} – đặt cảnh báo giá thay vì mua đuổi.</span>` : ""}
      ${opts.noBuy ? `<span>🔒 Lệnh MUA cụ thể (danh sách MUA, khối lượng theo rủi ro) dành cho gói Pro – <a href="#/account">xem quyền lợi</a>.</span>` : ""}
      ${txt ? `<button class="btn" id="dCopy">📋 Sao chép lệnh</button>` : ""}</p>
    <p class="faint" style="font-size:.72rem">Khối lượng làm tròn lô 100 cp; mỗi lệnh mua giới hạn để nếu chạm cắt lỗ chỉ mất ≈ ${nf(t.risk?.risk_per_trade ?? 1.5, 1)}% tổng tài sản và không vượt ${nf(t.risk?.max_weight_per_stock ?? 20, 0)}%/mã. Đặt cắt lỗ trên app CTCK ngay sau khi khớp. Thông tin tham khảo, không phải khuyến nghị đầu tư cá nhân.</p>
    <template id="dTxt">${esc(txt)}</template></section>`;
}
function bindDecision() {
  const b = $("#dCopy"); if (!b) return;
  b.onclick = async () => { const s = $("#dTxt").innerHTML.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"); try { await navigator.clipboard.writeText(s); toast("Đã sao chép danh sách lệnh"); } catch (e) { toast("Không sao chép được – chọn và copy thủ công"); } };
}

async function viewToday() {
  const [t, meta, pfr, rows, secs, m, LV, FJ] = await Promise.all([loadToday(), load("data/meta.json"), Store.get("portfolio"), screenerRows(), secsData(), tryLoad("data/market.json"), liveData(), tryLoad("data/flow.json")]);
  const pf = pfr.data || {};
  const MV = secs?.market || {};
  const R = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const reg = t.regime, plan = t.plan, ix = reg.index || {}, br = reg.breadth_now || {};
  const capital = capitalOf(pf) ?? t.capital;
  const stale = (Date.now() - new Date(meta.data_date).getTime()) / 864e5 > 4;
  const held = new Set((pf.holdings || []).map((h) => String(h.symbol).toUpperCase()));
  const pos = (t.portfolio && t.portfolio.positions) || [];
  const sells = pos.filter((p) => p.severity >= 1), holds = pos.filter((p) => p.severity < 1);
  const vi = m?.indices?.VNINDEX?.ohlc;
  const liq = rows.filter((r) => r.liquid_ok);
  const topComp = liq.filter((r) => r.trend === "up" && isNum(r.composite)).sort((a, b) => b.composite - a.composite).slice(0, 8);
  const smartTop = liq.filter((r) => isNum(r.smc) && isNum(r.vsa)).map((r) => ({ ...r, _sm: (r.smc + r.vsa + (r.wyckoff_ev ?? 50)) / 3 })).sort((a, b) => b._sm - a._sm).slice(0, 6);
  const lead = (secs?.sector || []).filter((s) => s.quadrant === "Dẫn dắt" || s.quadrant === "Cải thiện").sort((a, b) => (b.rs_ratio + b.rs_mom) - (a.rs_ratio + a.rs_mom)).slice(0, 6);
  const outBuy = (secs?.sector || []).filter((s) => s.outlook?.m3?.verdict === "buy").sort((a, b) => b.outlook.m3.score - a.outlook.m3.score).slice(0, 6);
  const outAvoid = (secs?.sector || []).filter((s) => s.outlook?.m3?.verdict === "avoid").sort((a, b) => a.outlook.m3.score - b.outlook.m3.score).slice(0, 4);
  const weak = (secs?.sector || []).filter((s) => s.quadrant === "Tụt hậu").sort((a, b) => (a.rs_ratio + a.rs_mom) - (b.rs_ratio + b.rs_mom)).slice(0, 3);
  const adv = br.adv || 0, dec = br.dec || 0, tot = adv + dec || 1;
  const lightCol = { green: "var(--up)", yellow: "var(--ref)", red: "var(--down)" }[reg.light];

  const pickSteps = (p) => {
    const z = p.zone, q = capital ? sharesFor(capital, p.weight, z[1]) : null, q1 = q ? lot(q / 2) : null, today = t.date;
    const risk = q && isNum(p.stop) ? q * (z[1] - p.stop) * 1000 : null;
    const L = [
      p.ext && p.split
        ? `<b>Đang kéo giãn</b> (giá cách EMA20 ${nf(p.ext_atr, 1)} ATR, 1 tháng ${pct(p.ret1m)}) – <b>chia 2 lệnh</b>: ${q ? `${nf(q1, 0)} cp mua ngay trong vùng ${nf(z[0])}–${nf(z[1])}, ${nf(q - q1, 0)} cp đặt LO ở ${nf(p.split.lo)} (−1 ATR), giữ lệnh 10 phiên` : `1/2 mua ngay, 1/2 đặt LO ở ${nf(p.split.lo)} trong 10 phiên`}. Kiểm chứng 2016–2026: mua lúc kéo giãn không làm lợi nhuận 20 phiên kém đi, nhưng ~2/3 số lần giá lùi về được mức −1 ATR và sụt sau khi mua sâu hơn – chia lệnh để giá vốn tốt hơn.`
        : `<b>Đặt lệnh mua LO</b> trong vùng ${nf(z[0])}–${nf(z[1])}${q ? `: tổng ${nf(q, 0)} cp (${nf(p.weight, 1)}% vốn) – lệnh 1 ${nf(q1, 0)} cp ở ${nf(z[1])}, lệnh 2 ${nf(q - q1, 0)} cp ở ${nf(z[0])}` : ` – <a href="#/portfolio">nhập vốn</a> để biết số cổ phiếu`}. Không mua đuổi trên ${nf(z[1] * 1.02)}.`,
      `<b>Dừng lỗ ${nf(p.stop)}</b>${isNum(p.stop_pct) ? ` (${pct(p.stop_pct, 1)})` : ""}${risk ? ` – nếu chạm mất ≈ ${big(risk)} đ` : ""}. Đặt lệnh dừng trên app CTCK ngay khi khớp.`,
      `<b>Chốt lời</b> ${nf(p.t1)}${isNum(p.t2) ? ` (1/2) rồi ${nf(p.t2)}` : ""}.`,
      `<b>Hàng về</b> ${addTradingDays(today, 2)} (T+2) – trước ngày này chưa bán được.`,
      `<b>Xem lại</b> ngày ${addTradingDays(today, 20)} hoặc khi có BCTC quý mới; bỏ kế hoạch nếu đóng cửa dưới ${nf(p.stop)} hoặc mã rời danh sách MUA.`,
      `<b>Ghi lại</b>: sau khi khớp bấm "Mua" bên dưới để danh mục và nhật ký tự cập nhật.`,
    ];
    return `<details class="psteps"><summary>Từng bước cho ${p.symbol}</summary><ol>${L.map((x) => `<li>${x}</li>`).join("")}</ol></details>`;
  };
  const pickCard = (p) => `<div class="pickw">${pickCard0(p)}${actBar(p.symbol, { held: held.has(p.symbol) })}${pickSteps(p)}</div>`;
  const pickCard0 = (p) => {
    const sh = sharesFor(capital, p.weight, p.zone[1]);
    const r = R[p.symbol] || {};
    const inZone = p.price <= p.zone[1] * 1.005;
    return `<a class="pick" href="#/s/${p.symbol}">
      <div class="pk-head"><div><span class="sym">${p.symbol}</span> <span class="pill buy">MUA</span> <span class="pill">${esc(BASKET_SHORT[p.basket] || p.basket)}</span>${held.has(p.symbol) ? ' <span class="pill brand">đang nắm</span>' : ""}
        <small class="pk-name">${esc(p.name || "")}</small></div>
        <div class="pk-px">${mini(r.spk, { w: 90, h: 30 })}<div><b>${nf(p.price)}</b><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)}</small></div>${ring(p.score, 36)}</div></div>
      ${ladder(p)}
      <div class="pk-facts">
        <div><small>Tỷ trọng</small><b>${nf(p.weight, 1)}% vốn</b>${sh ? `<small>≈ ${nf(sh, 0)} cp</small>` : ""}</div>
        <div><small>Lời / lỗ kỳ vọng</small><b>${isNum(p.rr) ? nf(p.rr, 1) + " lần" : "—"}</b><small>${pct(p.t1_pct, 0)} / ${pct(p.stop_pct, 0)}</small></div>
        <div class="hlf"><small>P/E</small><b>${nf(p.pe, 1)}</b><small>ngành ${nf(r.pe_ind, 1)} · TT ${nf(MV.pe_med, 1)}</small></div>
        <div><small>ROE · F-Score</small><b>${nf(p.roe, 0)}% · ${nf(p.fscore, 0)}/9</b><small>cổ tức ${nf(p.div_yield, 1)}%</small></div>
      </div>
      ${p.setup || p.tranches || p.exit_note ? `<div class="tags">${p.setup ? `<span class="pill brand">${esc(p.setup)}</span>` : ""}${p.tranches ? `<span class="pill">Mua dần: ${p.tranches.map((x) => nf(x)).join(" → ")}</span>` : ""}${isNum(p.yield) ? `<span class="pill buy">Cổ tức ${nf(p.yield, 1)}% · ${nf(p.dps, 0)} đ/cp</span>` : ""}${p.exit_note ? `<span class="pill">${esc(p.exit_note)}</span>` : ""}</div>` : ""}
      <p class="why">${inZone ? '<b class="up">Giá đang trong vùng mua.</b> ' : '<b class="ref">Chờ giá về vùng mua.</b> '}${esc(p.why || "")}</p></a>`;
  };
  const sellCard = (p) => `<div class="pickw">${sellCard0(p)}<div class="qa"><button class="chip" data-qt="sell:${p.symbol}">Ghi lệnh bán</button><button class="chip" data-alert="${p.symbol}">🔔</button></div></div>`;
  const sellCard0 = (p) => `<a class="pick ${p.severity >= 2 ? "sell" : "wait"}" href="#/s/${p.symbol}">
      <div class="pk-head"><div><span class="sym">${p.symbol}</span> <span class="pill ${p.severity >= 2 ? "sell" : "wait"}">${esc(p.action)}</span></div>
        <div class="pk-px">${mini(R[p.symbol]?.spk, { w: 90, h: 30 })}<div><b>${nf(p.price)}</b><small class="${cls(p.pnl_pct)}">lãi/lỗ ${pct(p.pnl_pct)}</small></div></div></div>
      <div class="pk-facts"><div><small>Giá vốn</small><b>${nf(p.cost)}</b></div><div><small>Điểm dừng</small><b class="down">${nf(p.stop)}</b></div><div><small>Giá trị hợp lý</small><b>${nf(p.fair)}</b></div><div><small>Kỹ thuật</small><b>${esc(R[p.symbol]?.ta_label || "—")}</b></div></div>
      <p class="why">${esc((p.reasons || []).join("; "))}</p></a>`;
  const go = (id) => `onclick="document.getElementById('${id}')?.scrollIntoView({behavior:'smooth',block:'start'})"`;

  app().innerHTML = `
  ${stale ? `<div class="note" style="margin-bottom:10px">Dữ liệu ngày ${esc(meta.data_date)} đã cũ hơn 4 ngày – lượt chạy tự động có thể đang lỗi; xem tab Actions trên GitHub.</div>` : ""}
  <section class="deck" style="--lc:${lightCol}">
    <div class="dk light"><div class="signal">${lamps(reg.light)}<div><div class="exposure">${reg.exposure}%</div><small>được nắm cổ phiếu</small></div></div>
      <p>${esc(reg.text)}</p><small class="faint">Đèn ${LIGHT_VI[reg.light]} · đạt ${reg.score}/${reg.max_score} điều kiện · phiên ${esc(t.date)}</small></div>
    <div class="dk"><small>VN-Index</small><div class="dk-big"><b>${nf(ix.close)}</b><span class="${cls(ix.chg1d)}">${pct(ix.chg1d, 2)}</span></div>
      ${vi ? mini(vi.c.slice(-60), { w: 220, h: 44 }).replace('class="mini"', 'class="mini wide"') : ""}
      <small>1 tháng <b class="${cls(ix.chg1m)}">${pct(ix.chg1m)}</b> · từ đầu năm <b class="${cls(ix.chgytd)}">${pct(ix.chgytd)}</b> · cách đỉnh ${pct(ix.from_hi52)}</small></div>
    <div class="dk"><small>Độ rộng thị trường</small><div class="dk-big"><b class="up">${adv}</b><span>tăng</span><b class="down">${dec}</b><span>giảm</span></div>
      <div class="adbar"><i style="width:${(adv / tot) * 100}%"></i></div>
      <small>${nf(br.above50, 0)}% mã trên MA50 · ${nf(br.above200, 0)}% trên MA200 · đỉnh/đáy mới ${br.new_hi ?? "—"}/${br.new_lo ?? "—"} · ${reg.distribution_days} ngày phân phối</small></div>
    <div class="dk hlb"><small>P/E toàn thị trường</small><div class="dk-big"><b>${nf(MV.pe_w_pos ?? MV.pe_w, 1)}</b><span>gia quyền</span><b>${nf(MV.pe_med, 1)}</b><span>trung vị</span></div>
      <small>Trung vị so với lịch sử ${vsCell(MV.pe_vs_hist)} · P/B ${nf(MV.pb_w)} · phần bù so với TPCP <b>${nf(MV.erp, 1)}%</b></small> <a href="#/sector" class="dk-link">So sánh các ngành</a></div>
    <div class="dk todo"><small>Việc hôm nay</small>
      <button class="tdo buy" ${go("secBuy")}><b>${plan.picks.length}</b> mã nên mua <span>${nf(plan.invested, 0)}% vốn</span></button>
      <button class="tdo sell" ${go("secSell")} ${sells.length ? "" : "disabled"}><b>${sells.length}</b> mã cần xử lý</button>
      <button class="tdo" ${go("secWatch")}><b>${plan.watch.length}</b> mã chờ điểm mua</button>
      <small>Tiền mặt nên giữ <b>${nf(plan.cash, 0)}%</b></small></div>
  </section>
  ${decisionCard(t, pf)}
  ${liveBanner(LV)}
  ${moodStrip(FJ)}
  ${eventsPanel(t)}
  ${seasonBanner(secs?.season)}

  <div class="g g-main sec">
    <div class="stack">
      ${sells.length ? `<section class="panel" id="secSell"><div class="ph"><h2>Danh mục – cần xử lý</h2><span class="meta">${sells.length} mã</span></div><div class="picks">${sells.map(sellCard).join("")}</div></section>` : ""}
      <div id="planBox"></div>
      ${holds.length ? `<section class="panel"><div class="ph"><h2>Đang nắm – giữ nguyên</h2><span class="meta">${holds.length} mã</span></div><div class="rows">${holds.map((p) => row(`#/s/${p.symbol}`, p.symbol, esc((p.reasons || []).join("; ")), mini(R[p.symbol]?.spk), `<b class="${cls(p.pnl_pct)}">${pct(p.pnl_pct)}</b>`, "lãi/lỗ")).join("")}</div></section>` : ""}
    </div>

    <div class="stack">
      ${outBuy.length ? `<section class="panel"><div class="ph"><h2>Ngành đáng đầu tư 3–6 tháng</h2><a class="meta" href="#/sector">triển vọng mọi ngành</a></div><div class="rows">
        ${outBuy.map((s) => row(`#/sector/${enc(s.name)}`, esc(s.name), esc((s.outlook.pos || []).slice(0, 2).join(" · ")), `<div class="r-mid">${ring(s.outlook.m3.score, 28)}</div>`, `<b class="${s.outlook.m12?.verdict === "avoid" ? "ref" : "up"}">${s.outlook.m12 ? OUT_VI[s.outlook.m12.verdict] : ""}</b>`, "12 tháng")).join("")}
        ${outAvoid.length ? `<p class="faint" style="font-size:.72rem;margin-top:6px">Nên tránh: ${outAvoid.map((s) => `<a href="#/sector/${enc(s.name)}">${esc(s.name)}</a>`).join(", ")}</p>` : ""}</div></section>` : ""}
      ${!outBuy.length && lead.length ? `<section class="panel"><div class="ph"><h2>Ngành đang mạnh lên</h2><a class="meta" href="#/sector">mọi ngành</a></div><div class="rows">
        ${lead.map((s) => row(`#/sector/${enc(s.name)}`, `<span class="quad" style="background:${qcol(s.quadrant)}"></span>${esc(s.name)}`, `${esc(s.quadrant)} · đầu ngành ${(s.leaders || []).slice(0, 3).map((x) => x.symbol).join(", ")}`,
          `<div class="r-mid"><span class="bar1"><i style="width:${Math.min(100, Math.max(4, 50 + (s.r1m || 0) * 2))}%;background:${(s.r1m || 0) >= 0 ? "var(--up)" : "var(--down)"}"></i></span></div>`, `<b class="${cls(s.r1m)}">${pct(s.r1m, 0)}</b>`, `P/E ${nf(s.pe_med, 1)}`)).join("")}
        ${weak.length ? `<p class="faint" style="font-size:.72rem;margin-top:6px">Đang yếu đi: ${weak.map((s) => `<a href="#/sector/${enc(s.name)}">${esc(s.name)}</a>`).join(", ")}</p>` : ""}</div></section>` : ""}
      <section class="panel"><div class="ph"><h2>Điểm cao nhất, xu hướng tăng</h2><a class="meta" href="#/screener">bộ lọc</a></div><div class="rows">
        ${topComp.map((r) => row(`#/s/${r.symbol}`, r.symbol, `${esc(r.sector || "")} · P/E ${nf(r.pe, 1)} vs ngành ${nf(r.pe_ind, 1)}`, `<div class="r-mid">${mini(r.spk)}${ring(r.composite, 28)}</div>`,
          `<b>${nf(r.price)}</b>`, isNum(r.upside) ? `tiềm năng <b class="${cls(r.upside)}">${pct(r.upside, 0)}</b>` : `<span class="${cls(r.chg1m)}">${pct(r.chg1m, 0)} 1 tháng</span>`)).join("") || `<p class="muted">Không có.</p>`}</div></section>
      <section class="panel"><div class="ph"><h2>Dấu chân tổ chức mạnh</h2><span class="meta">SMC, VSA, Wyckoff – chỉ để tham khảo</span></div><div class="rows">
        ${smartTop.map((r) => row(`#/s/${r.symbol}`, r.symbol, esc(wyShort(r.wy_phase)), `<div class="r-mid">${mini(r.spk)}${ring(r._sm, 28)}</div>`, `<b>${nf(r.price)}</b>`, `SMC ${nf(r.smc, 0)} · VSA ${nf(r.vsa, 0)}`)).join("")}</div></section>
      <section class="panel"><div class="ph"><h2>Khẩu vị đang dùng</h2><a class="meta" href="#/portfolio/profile">chỉnh</a></div>
        <div class="alloc">${Object.entries(t.allocation || {}).filter(([, v]) => Number(v) > 0).map(([k, v], i, arr) => { const s = arr.reduce((a, [, x]) => a + Number(x), 0); return `<i style="flex:${v};background:var(--a${i})" title="${esc(BASKET_SHORT[k] || k)} ${nf(v / s * 100, 0)}%"><span>${esc(BASKET_SHORT[k] || k)} ${nf(v / s * 100, 0)}%</span></i>`; }).join("")}</div>
        ${kpis([["Đèn X/V/Đ", `${t.exposure_map?.green ?? 100}/${t.exposure_map?.yellow ?? 60}/${t.exposure_map?.red ?? 30}%`], ["Cắt lỗ", (t.risk?.max_stop_loss_pct ?? "—") + "%"], ["Tối đa mã", t.risk?.max_positions], ["Biên an toàn", (t.risk?.margin_of_safety ?? "—") + "%"]], false, "sec")}
        ${t.profile?.applied?.length ? `<p class="faint" style="font-size:.72rem;margin-top:4px">Theo khẩu vị anh lưu trên web${t.profile.updated ? " ngày " + esc(t.profile.updated.slice(0, 10)) : ""}.</p>` : ""}</section>
      <details class="panel"><summary>Vì sao đèn ${LIGHT_VI[reg.light]}? (${reg.score}/${reg.max_score} điều kiện)</summary><ul class="checks">${reg.checks.map((c) => `<li class="${c.ok ? "ok" : ""}">${esc(c.name)}</li>`).join("")}</ul></details>
      <section class="panel"><button class="btn" id="runNow">Chạy lại phân tích ngay</button>
        <p class="muted" id="runMsg" style="font-size:.74rem">Tự chạy lúc 15h35 các ngày giao dịch. Bấm khi muốn cập nhật sớm (10–30 phút).</p></section>
    </div>
  </div>
  <p class="faint" style="margin-top:14px;font-size:.72rem">Cập nhật ${esc(meta.generated)} · ${nf(meta.symbols, 0)} mã · ${nf(meta.deep, 0)} mã phân tích sâu · Công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư có giấy phép.</p>`;
  const ST = t.styles || { position: { ...plan, name: "Trung hạn theo xu hướng" } };
  const drawPlan = (sel) => {
    const P = ST[sel] || plan, act = (t.style || "position") === sel;
    $("#planBox").innerHTML = `<section class="panel" id="secBuy"><div class="ph"><h2>Mua theo kế hoạch</h2>
        <span class="seg" id="stySel">${STYLE_ORDER.filter((k) => ST[k]).map((k) => `<button data-sty="${k}" class="${k === sel ? "on" : ""}">${STYLE_SHORT[k]}${(t.style || "position") === k ? " ●" : ""}</button>`).join("")}</span>
        <span class="meta">${P.picks.length} mã · ${nf(P.invested, 0)}% vốn${capital ? ` · vốn ${big(capital)}` : ""}</span></div>
      <p class="faint" style="font-size:.76rem;margin:-2px 0 8px">${esc(P.name || "")}${P.horizon ? ` · nắm ${esc(P.horizon)}` : ""} · ${act ? '<b class="up">đang áp dụng</b> (Telegram và danh mục theo phong cách này)' : `xem thử – <a href="#/portfolio/profile">đổi sang phong cách này</a>`}</p>
      ${P.note ? `<p class="note" style="margin-bottom:8px">${esc(P.note)}</p>` : ""}
      ${P.picks.length ? `<div class="picks">${P.picks.map(pickCard).join("")}</div>` : `<div class="empty">Hôm nay không mã nào đạt đủ điều kiện cho phong cách này – giữ tiền mặt.</div>`}
      ${!capital ? `<p class="faint" style="font-size:.76rem;margin-top:6px"><a href="#/portfolio">Nhập vốn</a> để thấy số cổ phiếu cần mua cho từng mã.</p>` : ""}
      ${P.rules ? `<details class="sec"><summary>Quy tắc vào/ra của phong cách ${esc(STYLE_SHORT[sel])}</summary><ul class="checks">${P.rules.map((x) => `<li class="ok">${esc(x)}</li>`).join("")}</ul></details>` : ""}</section>
      ${P.watch.length ? `<section class="panel sec" id="secWatch"><div class="ph"><h2>Chờ điểm mua</h2><span class="meta">${esc(STYLE_SHORT[sel])} · tốt nhưng giá hoặc điều kiện chưa đạt</span></div><div class="rows">
        ${P.watch.map((w) => { const r = R[w.symbol] || {}; const dist = isNum(w.price) && isNum(w.zone?.[1]) ? (w.price / w.zone[1] - 1) * 100 : null;
          return row(`#/s/${w.symbol}`, `${w.symbol} <span class="pill">${esc(BASKET_SHORT[w.basket] || w.basket)}</span>`, esc(w.reason), `<div class="r-mid">${mini(r.spk)}${ring(w.score, 28)}</div>`,
            `<b>${nf(w.price)}</b>`, isNum(dist) ? (dist <= 1 ? `<b class="up">đang trong vùng mua</b>` : `cao hơn vùng mua <b class="ref">${nf(dist, 0)}%</b>`) : ""); }).join("")}</div></section>` : ""}`;
    $$("#stySel button").forEach((b) => (b.onclick = () => { lsSet("todayStyle", b.dataset.sty); drawPlan(b.dataset.sty); }));
  };
  const s0 = lsGet("todayStyle", null);
  drawPlan(ST[s0] ? s0 : t.style || "position");
  bindDecision();
  runNow(meta);
}

async function runNow(meta) {
  const b = $("#runNow"); if (!b) return;
  if (!isAdmin()) { b.closest("section, .panel, p")?.remove?.(); b.remove(); return; }
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
  ${kpis([...idxKpis, ...(secs?.market?.pe_med ? [["P/E TT gia quyền", `<b>${nf(secs.market.pe_w_pos ?? secs.market.pe_w, 1)}</b><br><small>TB LS ${nf(secs.market.pew_hist_med, 1)}</small>`, "", "", "hl"], ["P/E TT trung vị", `<b>${nf(secs.market.pe_med, 1)}</b><br><small>TB LS ${nf(secs.market.pe_hist_med, 1)}</small>`, "", "", "hl"], ["P/B TT", `${nf(secs.market.pb_w)}<br><small>TV ${nf(secs.market.pb_med)}</small>`, "", "", "hl"]] : []), ["Đèn", `${LIGHT_VI[reg.light]} · ${reg.exposure}%`, reg.light === "green" ? "up" : reg.light === "red" ? "down" : "ref"], ["Điều kiện đạt", `${reg.score}/${reg.max_score}`],
    ["Tăng / giảm", `<span class="up">${br.adv ?? "—"}</span> / <span class="down">${br.dec ?? "—"}</span>`], ["Đỉnh / đáy 52T", `${br.new_hi ?? "—"} / ${br.new_lo ?? "—"}`],
    ["% trên MA50", nf(br.above50, 0) + "%"], ["% trên MA200", nf(br.above200, 0) + "%"], ["Ngày phân phối", reg.distribution_days, reg.distribution_days >= 6 ? "down" : ""],
    ["RSI VN-Index", nf(ix.rsi, 0)], ["Cách đỉnh 52T", pct(ix.from_hi52), "down"], ["KT chỉ số", `${esc(m.index_ta.label)} ${m.index_ta.score}`]])}
  <div class="g g-main sec">
    <section class="panel"><div class="ph"><h2>Chỉ số</h2><span class="seg" id="ixSel">${Object.keys(m.indices).map((k) => `<button data-i="${k}" class="${k === st.idx ? "on" : ""}">${k}</button>`).join("")}</span>
      <span id="ixTf">${tfSeg("ixTfSel", lsGet("tfIx", "D"))}</span>
      <span class="meta leg"><span><i style="background:${css("--brand")}"></i>MA50</span><span><i style="background:${css("--ref")}"></i>MA200</span></span></div>
      <div class="chart md" id="ixChart"></div><div id="ixMtf" class="sec"></div></section>
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
    const tf = lsGet("tfIx", "D"), TO = tfSeries(m.indices[st.idx]), o = TO[tf] || TO.D;
    const { c } = candleChart($("#ixChart"), o);
    const [f1, f2] = { D: [50, 200], W: [10, 40], M: [10, 24], Q: [4, 12], Y: [3, 5] }[tf];
    c.addLineSeries({ color: css("--brand"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ser(o.t, IND.sma(o.c, f1)));
    c.addLineSeries({ color: css("--ref"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(ser(o.t, IND.sma(o.c, f2)));
    c.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - (tf === "D" ? 260 : TF_VIEW[tf])), to: o.t.length + 2 });
    $("#ixMtf").innerHTML = mtfPanel(m.indices[st.idx].mtf, `${st.idx} – đa khung thời gian`, returnsTable(TO.M)).replace('<section class="panel">', '<div>').replace(/<\/section>$/, "</div>")
      + seasonPanel(m.indices[st.idx].season, null, { index: st.idx === "VNINDEX" }).replace('<section class="panel">', '<div class="sec">').replace(/<\/section>$/, "</div>");
    $(".leg", $("#ixChart").closest(".panel")).innerHTML = `<span><i style="background:${css("--brand")}"></i>MA${f1}</span><span><i style="background:${css("--ref")}"></i>MA${f2}</span>`;
    $$("#ixTfSel button").forEach((b) => (b.onclick = () => { lsSet("tfIx", b.dataset.tf); $$("#ixTfSel button").forEach((x) => x.classList.toggle("on", x === b)); drawIdx(); }));
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
    ["roe_med", "ROE", "x1"], ["ni_yoy_med", "LN 12T", "p"], ["upside_med", "Tiềm năng", "p"], ["composite_med", "Điểm", "s"]];
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
  const V = {};
  const F = M.filter((r) => isNum(r.mcap_bn));
  const E = F.filter((r) => isNum(r.ni_ttm)), Ep = E.filter((r) => r.ni_ttm > 0), B = F.filter((r) => isNum(r.pb) && r.pb > 0);
  const sm = (a, f) => a.reduce((x, r) => x + f(r), 0);
  if (E.length >= 2 && sm(E, (r) => r.ni_ttm) > 0) V.pe_w = sm(E, (r) => r.mcap_bn) / sm(E, (r) => r.ni_ttm);
  if (Ep.length >= 2) V.pe_w_pos = sm(Ep, (r) => r.mcap_bn) / sm(Ep, (r) => r.ni_ttm);
  if (B.length >= 2) { const bk = sm(B, (r) => r.mcap_bn / r.pb); V.pb_w = sm(B, (r) => r.mcap_bn) / bk; const BE = B.filter((r) => isNum(r.ni_ttm)); if (BE.length >= 2) V.roe_w = 100 * sm(BE, (r) => r.ni_ttm) / sm(BE, (r) => r.mcap_bn / r.pb); }
  if (V.pe_w) V.ey_w = 100 / V.pe_w;
  V.loss_share = E.length ? 100 * E.filter((r) => r.ni_ttm <= 0).length / E.length : null;
  { const pg = M.filter((r) => r.pe > 0 && r.ni_yoy > 0).map((r) => r.pe / r.ni_yoy).sort((a, b) => a - b); V.peg_med = pg.length >= 2 ? pg[Math.floor(pg.length / 2)] : null; }
  return { ...V, n: M.length, n_sec: new Set(M.map((r) => r.sector)).size, mcap_bn: sum("mcap_bn"), value_bn: sum("avg_value_bn"), r1w: wr("chg1w"), r1m: wr("chg1m"), r3m: wr("chg3m"), r1y: wr("chg1y"),
    pe_med: med("pe", true), pb_med: med("pb", true), roe_med: med("roe"), ni_yoy_med: med("ni_yoy"), rev_yoy_med: med("rev_yoy"), div_med: med("div_yield"), fscore_med: med("fscore"), de_med: med("de"),
    upside_med: med("upside"), composite_med: med("composite"), above50: null, up_pct: M.length ? 100 * M.filter((r) => r.trend === "up").length / M.length : null };
}
function secValStrip(rec, M, isGroup) {
  const pew = rec.pe_w_pos ?? rec.pe_w, mpew = M.pe_w_pos ?? M.pe_w;
  return `<section class="panel hero"><div class="ph"><h2>Định giá ${isGroup ? "nhóm" : "ngành"} so với thị trường</h2><span class="meta">TT = toàn thị trường · LS = lịch sử của chính ${isGroup ? "nhóm" : "ngành"}</span></div>
    <div class="bigs">
      <div class="big hlb"><small>P/E gia quyền</small><b>${nf(pew, 1)}</b><span>TT ${nf(mpew, 1)} · ${vsCell(vsPct(pew, mpew))}${isNum(rec.pew_vs_hist) ? ` · LS ${vsCell(rec.pew_vs_hist)}` : ""}</span></div>
      <div class="big hlb"><small>P/E trung vị</small><b>${nf(rec.pe_med, 1)}</b><span>TT ${nf(M.pe_med, 1)} · ${vsCell(vsPct(rec.pe_med, M.pe_med))}${isNum(rec.pe_vs_hist) ? ` · LS ${vsCell(rec.pe_vs_hist)}` : ""}</span></div>
      <div class="big"><small>P/E so với lịch sử</small><b>${isNum(rec.pe_pctl_hist) ? pctlChip(rec.pe_pctl_hist) : "—"}</b><span>TB ${nf(rec.pe_hist_med, 1)} · vùng ${nf(rec.pe_hist_lo, 1)}–${nf(rec.pe_hist_hi, 1)}</span></div>
      <div class="big"><small>P/B gia quyền / TV</small><b>${nf(rec.pb_w)} <small>/ ${nf(rec.pb_med)}</small></b><span>TT ${nf(M.pb_w)} / ${nf(M.pb_med)}${isNum(rec.pb_vs_hist) ? ` · LS ${vsCell(rec.pb_vs_hist)}` : ""}</span></div>
      <div class="big"><small>ROE gia quyền</small><b>${pct(rec.roe_w, 1, false)}</b><span>TT ${pct(M.roe_w, 1, false)} · TV ${pct(rec.roe_med, 1, false)}</span></div>
      <div class="big"><small>PEG · Lợi suất LN</small><b>${nf(rec.peg_med)} <small>· ${pct(rec.ey_w, 1, false)}</small></b><span>TT ${nf(M.peg_med)} · ${pct(M.ey_w, 1, false)} · DN lỗ ${pct(rec.loss_share, 0, false)}</span></div>
    </div></section>`;
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
  if ($("#gDel")) $("#gDel").onclick = async () => { await persist(GROUPS.filter((x) => x.id !== g.id)); location.hash = "#/sector"; };
  if ($("#gClose")) $("#gClose").onclick = () => (box.hidden = true);
  if ($("#gEditBtn")) $("#gEditBtn").onclick = () => { box.hidden = !box.hidden; if (!box.hidden) box.scrollIntoView({ behavior: "smooth", block: "start" }); };
}
async function viewSector(name, lvArg) {
  const [secs, rows, m, t, gr] = await Promise.all([load("data/sectors.json"), screenerRows(), load("data/market.json"), loadToday(), Store.get("groups")]);
  const L2 = secs.sector || [], L3 = secs.industry || [];
  const byName2 = Object.fromEntries(L2.map((s) => [s.name, s])), byName3 = Object.fromEntries(L3.map((s) => [s.name, s]));
  let GROUPS = gr.data && Array.isArray(gr.data.list) ? gr.data.list : [];
  const isGroup = lvArg === "g";
  const group = isGroup ? (name === "new" ? { id: "new", name: "", sectors: [], industries: [], symbols: [] } : GROUPS.find((g) => g.id === name)) : null;
  if (isGroup && !group) { location.hash = "#/sector"; return; }
  if (!name) return viewSectors();
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
  const gside = `<button data-go="#/sector" class="ovb"><span>◧ Toàn cảnh tất cả ngành</span><small></small><small></small></button><div class="faint" style="font-size:.68rem;padding:6px 8px 2px;letter-spacing:.04em">NHÓM CỦA TÔI</div>` + GROUPS.map((g) => `<button data-go="#/sector/${enc(g.id)}/g" class="${isGroup && group.id === g.id ? "on" : ""}"><span>★ ${esc(g.name)}</span><small></small><small class="faint">${gCount(g)}</small></button>`).join("")
    + `<button data-go="#/sector/new/g" class="${isGroup && group.id === "new" ? "on" : ""}"><span class="up">＋ Tự nhóm ngành / mã</span><small></small><small></small></button><div class="faint" style="font-size:.68rem;padding:8px 8px 2px;letter-spacing:.04em">NGÀNH CÓ SẴN</div>`;
  const gopts = `<option value="#/sector">◧ Toàn cảnh tất cả ngành</option><optgroup label="Nhóm của tôi">${GROUPS.map((g) => `<option value="#/sector/${enc(g.id)}/g" ${isGroup && group.id === g.id ? "selected" : ""}>★ ${esc(g.name)} (${gCount(g)})</option>`).join("")}<option value="#/sector/new/g" ${isGroup && group.id === "new" ? "selected" : ""}>＋ Tự nhóm ngành / mã</option></optgroup><optgroup label="Ngành có sẵn">`;
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
        ${outChip(rec?.outlook, "m3")}${outChip(rec?.outlook, "m12")}
        ${rec?.quadrant ? `<span class="pill" style="color:${qcol(rec.quadrant)}"><span class="quad" style="background:${qcol(rec.quadrant)}"></span>${esc(rec.quadrant)}</span>` : ""}
        <span class="pill">${isGroup ? `Nhóm tự tạo · ${group.sectors.length} ngành, ${group.industries.length} nhóm ngành, ${group.symbols.length} mã lẻ` : level === "sector" ? "Ngành cấp 2" : "Nhóm ngành cấp 3"}${level === "industry" && parent ? " · thuộc " + esc(parent) : ""}</span>
        ${isGroup && group.id !== "new" ? `<button class="chip" id="gEditBtn">Sửa nhóm</button>` : ""}
        <span class="meta">${members.length} mã · ${members.filter((r) => r.liquid_ok).length} mã thanh khoản</span></div>
      ${isGroup ? groupEditor(group, rows) : ""}
      ${!isGroup ? outlookBox(rec) : ""}
      ${!isGroup && rec?.mtf ? mtfPanel(rec.mtf, "Chỉ số ngành – đa khung thời gian") : ""}
      ${!isGroup && rec?.season ? seasonPanel(rec.season, rec.season_support, { oos: secs.season?.oos?.[level] }) : ""}
      <section class="panel hero"><div class="ph"><h2>Mã đáng đầu tư nhất ${isGroup ? "trong nhóm" : "trong ngành"}</h2><span class="meta">chọn phương án – xếp hạng so với chính các mã cùng ngành</span></div>
        <div class="views" id="presets">${Object.entries(PRESETS).map(([k, p]) => `<button data-p="${k}" class="${k === st.preset ? "on" : ""}">${esc(p.name)}${p.tag ? ` <small>✓</small>` : ""}</button>`).join("")}</div>
        <p id="pDesc" class="muted" style="font-size:.8rem"></p>
        <div class="filters" style="margin-top:6px">
          <div class="field w60"><label>GTGD ≥ (tỷ)</label><input id="sV" inputmode="decimal" value="${st.minVal}"></div>
          <div class="field w90"><label>Sàn</label><select id="sE"><option value="">Cả 3 sàn</option>${["HOSE", "HNX", "UPCOM"].map((e) => `<option ${st.exch === e ? "selected" : ""}>${e}</option>`).join("")}</select></div>
          <label style="display:flex;gap:5px;align-items:center;font-size:.8rem"><input type="checkbox" id="sP"> Chỉ mã có lãi</label>
          <label style="display:flex;gap:5px;align-items:center;font-size:.8rem"><input type="checkbox" id="sU" ${st.uptrend ? "checked" : ""}> Chỉ xu hướng tăng (như hệ thống mua)</label>
          ${isGroup ? `<label style="display:flex;gap:5px;align-items:center;font-size:.8rem" title="Bật: ngân hàng so với ngân hàng, thép so với thép rồi mới gộp lại. Tắt: so tất cả mã trong nhóm với nhau."><input type="checkbox" id="sR" ${st.relative !== false ? "checked" : ""}> So với ngành gốc của từng mã</label>` : ""}
        </div>
        <div id="custom" class="sec" hidden></div>
      <div class="podium sec" id="podium"></div></section>
      ${rec && members.length ? secValStrip(rec, secs.market || {}, isGroup) : ""}
      <section class="panel flush"><div class="ph"><h2>Bảng xếp hạng</h2><span class="pill brand">P/E ngành TV ${nf(rec?.pe_med, 1)} · TT ${nf((secs.market || {}).pe_med, 1)}</span><span class="meta" id="rkMeta"></span></div><div class="tw tall"><table id="rk"></table></div>
        <p class="faint" style="font-size:.72rem;padding:6px 12px">Màu nền mỗi ô = thứ hạng trong ngành (xanh đậm = tốt nhất ngành, đỏ = kém nhất). Thiếu số liệu bị tính như hạng 30/100.</p></section>
      ${isGroup ? (members.length ? kpis([["Số ngành", rec.n_sec], ["Vốn hoá", mcapFmt(rec.mcap_bn)], ["GTGD/ngày", bn(rec.value_bn)], ["1 tuần", pct(rec.r1w), cls(rec.r1w)], ["1 tháng", pct(rec.r1m), cls(rec.r1m)],
          ["3 tháng", pct(rec.r3m), cls(rec.r3m)], ["1 năm", pct(rec.r1y), cls(rec.r1y)], ["% xu hướng tăng", nf(rec.up_pct, 0) + "%"], ["ROE", pct(rec.roe_med, 1, false)],
          ["LN 12T", pct(rec.ni_yoy_med), cls(rec.ni_yoy_med)], ["DT 12T", pct(rec.rev_yoy_med), cls(rec.rev_yoy_med)], ["Cổ tức", pct(rec.div_med, 1, false)], ["F-Score", nf(rec.fscore_med, 1)], ["Vay/Vốn", nf(rec.de_med)],
          ["Tiềm năng TV", pct(rec.upside_med), cls(rec.upside_med)], ["Điểm TV", scoreCell(rec.composite_med)]]) : `<div class="empty">Nhóm chưa có mã nào – chọn ngành hoặc nhập mã ở khung trên.</div>`)
      : rec ? kpis([["Vốn hoá", mcapFmt(rec.mcap_bn)], ["GTGD/ngày", bn(rec.value_bn)], ["1 tuần", pct(rec.r1w), cls(rec.r1w)], ["1 tháng", pct(rec.r1m), cls(rec.r1m)], ["3 tháng", pct(rec.r3m), cls(rec.r3m)],
        ["6 tháng", pct(rec.r6m), cls(rec.r6m)], ["1 năm", pct(rec.r1y), cls(rec.r1y)], ["% trên MA50", nf(rec.above50, 0) + "%"], ["% trên MA200", nf(rec.above200, 0) + "%"],
        ["RS-Ratio / Mom", `${nf(rec.rs_ratio, 1)} / ${nf(rec.rs_mom, 1)}`], ["ROE", nf(rec.roe_med, 1) + "%"], ["LN 12T", pct(rec.ni_yoy_med), cls(rec.ni_yoy_med)], ["DT 12T", pct(rec.rev_yoy_med), cls(rec.rev_yoy_med)],
        ["Cổ tức", nf(rec.div_med, 1) + "%"], ["F-Score", nf(rec.fscore_med, 1)], ["Vay/Vốn", nf(rec.de_med)], ["Tiềm năng TV", pct(rec.upside_med), cls(rec.upside_med)],
        ["Điểm TV", scoreCell(rec.composite_med)], ["SMC TB", isNum(rec.smc_bias) ? `<span class="${rec.smc_bias >= 0.25 ? "up" : rec.smc_bias <= -0.25 ? "down" : ""}">${nf(rec.smc_bias, 2)}</span>` : "—"]])
        : `<p class="note">Nhóm ngành nhỏ (dưới 3 mã thanh khoản) nên chưa có chỉ số ngành – vẫn xếp hạng được các mã bên dưới.</p>`}
      ${isGroup && members.length ? `<section class="panel flush"><div class="ph"><h2>Thành phần nhóm</h2><span class="meta">theo ngành gốc · alpha = kết quả backtest chọn mã trong ngành đó</span></div><div class="tw"><table id="gComp"></table></div></section>` : ""}
      ${rec && !isGroup ? `<div class="g g2">
        <section class="panel"><div class="ph"><h2>Chỉ số ngành so với VN-Index</h2>${rec.index_w ? tfSeg("secTf", lsGet("tfSec", "D"), ["D", "W", "M", "Q", "Y"]) : ""}<span class="meta">cùng gốc 100</span></div><div class="chart sm" id="secIdx"></div>
          <div class="leg"><span><i style="background:${css("--brand")}"></i>${esc(name)}</span><span><i style="background:${css("--ink-3")}"></i>VN-Index</span></div></section>
        <section class="panel hlp"><div class="ph"><h2>P/E ngành theo quý – so với thị trường</h2><span class="meta">cuối mỗi quý</span></div>
          ${rec.val_hist ? (() => { const mm = Object.fromEntries(((secs.market || {}).val_hist || []).map((x) => [x.p, x.pe])); return lineSvg([
              { name: "Ngành – trung vị", color: css("--brand"), width: 2.2, pts: rec.val_hist.map((x) => ({ x: x.p, y: x.pe })) },
              { name: "Ngành – gia quyền", color: css("--floor"), pts: rec.val_hist.map((x) => ({ x: x.p, y: x.pe_w })) },
              { name: "Thị trường – trung vị", color: css("--ink-3"), dash: "4 3", pts: rec.val_hist.map((x) => ({ x: x.p, y: mm[x.p] })) }],
            { h: 200, hlines: [{ y: rec.pe_hist_med, label: "TB ngành " + nf(rec.pe_hist_med, 1), color: css("--ref") }], label: "P/E ngành" }); })()
            + `<p class="faint" style="font-size:.74rem">P/E trung vị hiện tại cao hơn ${nf(rec.pe_pctl_hist, 0)}% số quý trong lịch sử (dưới 25 = ngành đang rẻ so với chính nó, trên 75 = đắt). <a href="#/sector">So với các ngành khác →</a></p>` : `<p class="muted">Chưa đủ lịch sử P/E.</p>`}</section></div>` : ""}
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
        <div style="display:flex;gap:6px;align-items:baseline;flex-wrap:wrap"><a class="sym" style="font-size:1.15rem" href="#/s/${r.symbol}">${r.symbol}</a><b>${nf(r.price)}</b><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)}</small>${mini(r.spk, { w: 64, h: 20 })}
          ${picks.has(r.symbol) ? '<span class="pill buy">MUA hôm nay</span>' : ""}${r.trend === "down" ? '<span class="pill sell">xu hướng giảm</span>' : r.trend === "up" ? '<span class="pill buy">xu hướng tăng</span>' : '<span class="pill">đi ngang</span>'}</div>
        <small class="faint" style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(r.name || "")}</small>
        <ul class="checks">${good.map(([k, p]) => `<li class="ok">${esc(FACT[k][0])} ${fmtFact(k, r[k])} <small class="faint">– hơn ${nf(p, 0)}% ngành</small></li>`).join("")}
          ${bad ? `<li>${esc(FACT[bad[0]][0])} ${fmtFact(bad[0], r[bad[0]])} <small class="faint">– điểm yếu</small></li>` : ""}</ul>
        <p style="font-size:.78rem">Hợp lý <b>${nf(r.fair)}</b> · tiềm năng <b class="${cls(r.upside)}">${pct(r.upside, 0)}</b> · KT <b>${esc(r.ta_label || "—")}</b> · điểm TH <b>${nf(r.composite, 0)}</b></p></section>`;
    }).join("") || `<div class="empty">Không mã nào đạt điều kiện. Thử hạ GTGD tối thiểu hoặc bỏ lọc xu hướng.</div>`;
    // bảng
    const cols = [["_i", "#"], ["symbol", "Mã"], ["score", "Điểm PA"], ...keys.map((k) => [k, FACT[k][0], "f"]), ["price", "Giá"], ["chg1m", "1 tháng"], ["upside", "Tiềm năng"], ["ta_label", "Kỹ thuật", "l"],
      ["trend", "Xu hướng", "l"], ["composite", "Điểm TH"], ["mcap_bn", "Vốn hoá"], ["_tag", "", "l"]];
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
  const drawSecIdx = () => {
    const tf = lsGet("tfSec", "D");
    const old = charts.find((x) => x.__sec); if (old) { old.remove(); charts.splice(charts.indexOf(old), 1); }
    if (tf !== "D" && rec.index_w) {
      const vi = m.indices.VNINDEX;
      const src = tf === "W" ? rec.index_w : rec.index_m || rec.index_w;
      const vsrc = tf === "W" ? vi?.ohlc_w : vi?.ohlc_m || vi?.ohlc_w;
      const c = lineTfChart($("#secIdx"), [{ name, color: css("--brand"), width: 2, t: src.t, c: src.c }, ...(vsrc ? [{ name: "VN-Index", color: css("--ink-3"), t: vsrc.t, c: vsrc.c }] : [])], tf === "W" ? "W" : tf);
      c.__sec = true; return;
    }
    const c = mkChart($("#secIdx"), { rightPriceScale: { borderColor: css("--line") } }); c.__sec = true;
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
  };
  if (rec && rec.index?.length) {
    drawSecIdx();
    $$("#secTf button").forEach((b) => (b.onclick = () => { lsSet("tfSec", b.dataset.tf); $$("#secTf button").forEach((x) => x.classList.toggle("on", x === b)); drawSecIdx(); }));
  }
  if (bt && bt.curve?.length) {
    const c = mkChart($("#secBt"), { rightPriceScale: { mode: 1, borderColor: css("--line") } });
    c.addLineSeries({ color: css("--up"), lineWidth: 2, priceLineVisible: false }).setData(bt.curve.map((p) => ({ time: p.d, value: p.top })));
    c.addLineSeries({ color: css("--ink-3"), lineWidth: 1, priceLineVisible: false }).setData(bt.curve.map((p) => ({ time: p.d, value: p.all })));
    c.timeScale().fitContent();
  }
}

// ================================================================ DANH MỤC (quản lý vị thế, mua thêm / bán từng phần, cơ cấu, lãi đã chốt)
const FEE_BUY = 0.15, FEE_SELL = 0.25; // % (bán gồm 0,1% thuế TNCN)
const lot = (q) => Math.max(0, Math.floor(q / 100) * 100);
// ---- kế hoạch thoát hàng theo phong cách (cùng công thức với app/analysis/exits.py)
const STYLE_OF_BASKET = { swing: "swing", long: "long", income: "income" };
const styleOf = (h) => (["swing", "position", "long", "income"].includes(h.style) ? h.style : STYLE_OF_BASKET[h.basket] || "position");
const lotPart = (rem, f) => { if (rem <= 0 || f <= 0) return 0; if (f >= 0.999) return rem; const q = Math.floor((rem * f) / 100 + 1e-6) * 100; return q > 0 ? q : rem >= 100 ? Math.min(100, rem) : rem; };
function exitPlan(h, price, peak, held, info, maxSlPct = 20) {
  const style = styleOf(h), cost = Number(h.cost) || price, pos = (x) => (isNum(x) && x > 0 ? x : null);
  const atr = pos(info.atr) || price * 0.025, fair = pos(info.fair), fairHi = pos(info.fair_hi), y = pos(info.div_yield);
  const be = cost / (1 - FEE_SELL / 100), L = [];
  const add = (key, kind, label, px, sell, trig, why, hit) => { if (px != null || trig === "time" || trig === "cond") L.push({ key, kind, label, price: px != null ? Math.round(px * 100) / 100 : null, sell, trig, why, hit }); };
  if (style === "swing") {
    const r0 = Math.min(Math.max(cost - 2.5 * atr, cost * 0.9), cost * 0.95), risk = cost - r0;
    let stop = Math.max(r0, peak - 2.5 * atr); if (peak >= cost + 1.5 * risk) stop = Math.max(stop, be);
    add("stop", "stop", stop < be ? "Dừng lỗ" : "Dừng – khoá lãi", stop, 1, "below", "2,5×ATR dưới giá vốn (5–10%), dời lên theo đỉnh; về hoà vốn khi đã lãi 1,5R");
    add("tp1", "tp", "Mục tiêu 1 (3R)", cost + 3 * risk, 2 / 3, "above", "Lãi gấp 3 lần rủi ro – chốt 2/3");
    add("tp2", "tp", "Mục tiêu 2 (4R)", cost + 4 * risk, 1, "above", "Chốt nốt phần còn lại");
    add("time", "time", "Hết 20 phiên", null, 1, "time", "Lướt sóng quá 20 phiên mà chưa tới mục tiêu 1 – bán hết, giải phóng vốn", held != null && held >= 20);
    if (pos(info.e20)) add("ema", "cond", "Đóng cửa dưới EMA20 2 phiên", info.e20, 1, "cond", "Nhịp tăng đã gãy", info.e20_below2 === true);
  } else if (style === "long") {
    add("review", "review", "Xem lại luận điểm (−25%)", cost * 0.75, 0, "below", "Dài hạn không tự cắt lỗ theo giá – đọc lại BCTC, nếu luận điểm còn nguyên có thể mua thêm");
    if (fair) { add("tp1", "tp", "Vượt giá trị hợp lý 20%", fair * 1.2, 1 / 3, "above", "Đã đắt – chốt 1/3"); add("tp2", "tp", "Vượt giá trị hợp lý 40%", fair * 1.4, 1 / 2, "above", "Rất đắt – chốt thêm một nửa phần còn lại, giữ 1/3 tích sản"); }
  } else if (style === "income") {
    add("review", "review", "Xem lại (−20%)", cost * 0.8, 0, "below", "Kiểm tra cổ tức có bị cắt không – nếu vẫn trả đều thì không bán");
    if (y) { const dps = (price * y) / 100; add("tp1", "tp", "Lợi suất còn 3,5%", dps / 0.035, 1 / 2, "above", `Cổ tức ${nf(dps * 1000, 0)} đ/cp – giá đã cao, bán một nửa`); add("tp2", "tp", "Lợi suất còn 3%", dps / 0.03, 1, "above", "Bán hết, chuyển sang mã lợi suất cao hơn"); }
  } else {
    const hard = cost * (1 - maxSlPct / 100), trail = peak - 3 * atr, stop = Math.max(hard, trail);
    add("stop", "stop", stop < be ? "Dừng lỗ" : "Dừng – khoá lãi", stop, 1, "below", stop === hard ? `Lỗ tối đa ${nf(maxSlPct, 0)}% so với giá vốn` : "Đỉnh sau mua − 3×ATR (dời lên theo giá)");
    if (fair) { const t1 = fair * 1.1; add("tp1", "tp", "Vượt giá trị hợp lý 10%", t1, 1 / 2, "above", "Định giá đã đắt – chốt một nửa"); add("tp2", "tp", "Vùng giá trị cao", Math.max(fairHi || fair * 1.25, t1 * 1.08), 1, "above", "Chốt nốt phần còn lại"); }
    add("time", "review", "Xem lại sau 60 phiên", null, 0, "time", "Nắm 60 phiên mà lãi < 5% – vốn đang đứng yên", held != null && held >= 60 && price < cost * 1.05);
  }
  const cu = h.exit_custom || {};
  if (pos(cu.stop)) { const i = L.findIndex((x) => x.key === "stop"); if (i >= 0) L.splice(i, 1); L.unshift({ key: "stop", kind: "stop", label: "Dừng lỗ của anh", price: Number(cu.stop), sell: 1, trig: "below", why: "Mức anh tự đặt" }); }
  if (pos(cu.tp)) L.push({ key: "tpc", kind: "tp", label: "Chốt lời của anh", price: Number(cu.tp), sell: Math.min(100, Math.max(1, Number(cu.tp_pct) || 50)) / 100, trig: "above", why: "Mức anh tự đặt" });
  const done = new Set(h.exits_done || []);
  L.forEach((x) => {
    x.dist = x.price ? (x.price / price - 1) * 100 : null;
    if (done.has(x.key)) x.status = "done";
    else if (x.trig === "below") x.status = price <= x.price ? "hit" : x.dist >= -3 ? "near" : "far";
    else if (x.trig === "above") x.status = price >= x.price ? "hit" : x.dist <= 3 ? "near" : "far";
    else x.status = x.hit ? "hit" : "far";
  });
  let out = L;
  if (style === "swing" && L.some((x) => x.key === "tp1" && (x.status === "hit" || x.status === "done"))) out = L.filter((x) => x.key !== "time");
  const qty = Number(h.qty) || 0; let rem = qty;
  out.filter((x) => x.trig === "above" && x.status !== "done").sort((a, b) => a.price - b.price).forEach((x) => { x.qty = lotPart(rem, x.sell); rem -= x.qty; });
  out.forEach((x) => { if (x.qty == null) x.qty = x.status === "done" ? 0 : lotPart(qty, x.sell); if (x.price && x.qty) { x.proceeds = x.qty * x.price * (1 - FEE_SELL / 100) * 1000; x.pnl = (x.price * (1 - FEE_SELL / 100) - cost) * x.qty * 1000; } });
  const st = out.find((x) => x.key === "stop") || out.find((x) => x.kind === "review" && x.price);
  return { style, levels: out, stop: st ? st.price : null, breakeven: be };
}
const fracVi = (f) => (f >= 0.999 ? "Bán hết" : f <= 0 ? "Không bán" : Math.abs(f - 1 / 2) < 0.01 ? "Bán 1/2" : Math.abs(f - 1 / 3) < 0.01 ? "Bán 1/3" : Math.abs(f - 2 / 3) < 0.01 ? "Bán 2/3" : `Bán ${nf(f * 100, 0)}%`);
function exitBox(x, today) {
  const { h, ep } = x, s = h.symbol;
  const stTxt = (l) => l.status === "done" ? '<b class="faint">đã làm</b>' : l.status === "hit" ? `<b class="${l.kind === "tp" ? "up" : "down"}">ĐÃ CHẠM</b>` : l.trig === "time" ? (l.key === "time" && h.date ? `phiên ${x.held ?? "—"}/${ep.style === "swing" ? 20 : 60}` : "") : l.trig === "cond" ? "chưa xảy ra" : `${l.status === "near" ? '<b class="ref">sắp chạm</b> ' : "còn "}${pct(l.dist, 1)}`;
  const rows = ep.levels.map((l) => `<div class="exr st-${l.status} k-${l.kind}"><div class="ex-l"><i></i><b>${esc(l.label)}</b><small>${esc(l.why)}</small></div>
      <div class="ex-p"><b>${l.price ? nf(l.price) : "—"}</b><small>${stTxt(l)}</small></div>
      <div class="ex-q"><b>${l.sell > 0 && l.sell < 0.999 ? fracVi(l.sell) + (l.trig === "above" ? " <small>số còn lại</small>" : "") : fracVi(l.sell)}</b><small>${l.qty ? nf(l.qty, 0) + " cp" : ""}</small></div>
      <div class="ex-m">${isNum(l.proceeds) ? `<b>${big(l.proceeds)} đ</b><small class="${cls(l.pnl)}">${l.pnl >= 0 ? "lãi" : "lỗ"} ${big(Math.abs(l.pnl))} đ</small>` : ""}</div>
      <div class="ex-b">${l.status === "done" ? `<button class="chip" data-exu="${s}|${l.key}" title="Bỏ đánh dấu đã làm">↺</button>` : l.sell > 0 && l.qty ? `<button class="chip ${l.status === "hit" ? "hot" : ""}" data-exb="${s}|${l.key}">Bán</button>` : ""}</div></div>`).join("");
  const cu = h.exit_custom || {};
  return `<div class="exit"><div class="ex-h"><b>Kế hoạch thoát</b><label class="ex-sty">theo phong cách <select data-exs="${s}">${STYLE_ORDER.map((k) => `<option value="${k}" ${k === ep.style ? "selected" : ""}>${STYLE_SHORT[k]}</option>`).join("")}</select></label>
      <button class="chip" data-exc="${s}">${cu.stop || cu.tp ? "Mức riêng ✓" : "＋ Mức riêng"}</button><small class="faint">hoà vốn sau phí ${nf(ep.breakeven)}</small></div>
    <div class="exl">${rows || '<p class="muted">Chưa có dữ liệu để tính mức thoát.</p>'}</div>
    <div class="exc" id="exc-${s}" hidden><div class="filters"><div class="field w90"><label>Dừng lỗ riêng</label><input data-cus="stop" inputmode="decimal" value="${cu.stop ?? ""}" placeholder="${nf(ep.stop)}"></div>
      <div class="field w90"><label>Chốt lời riêng</label><input data-cus="tp" inputmode="decimal" value="${cu.tp ?? ""}"></div><div class="field w60"><label>Bán %</label><input data-cus="tp_pct" inputmode="numeric" value="${cu.tp_pct ?? 50}"></div>
      <button class="btn primary" data-exsave="${s}">Lưu</button><button class="btn" data-exclr="${s}">Xoá mức riêng</button></div></div></div>`;
}
function addTradingDays(d, n) { const x = new Date(d + "T00:00:00"); let k = 0; while (k < n) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) k++; } return x.toISOString().slice(0, 10); }
function tradingDaysBetween(a, b) { if (!a || !b) return null; let x = new Date(a + "T00:00:00"), y = new Date(b + "T00:00:00"), n = 0; while (x < y) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) n++; } return n; }
// Ghi 1 lệnh: cập nhật danh mục (giá vốn bình quân như CTCK), tiền mặt, nhật ký; lệnh bán lưu luôn lãi/lỗ đã chốt
async function applyTrade(tr, pf, J) {
  pf.holdings = pf.holdings || [];
  const i = pf.holdings.findIndex((h) => h.symbol === tr.symbol);
  const h = i >= 0 ? pf.holdings[i] : null;
  if (tr.side === "buy") {
    const unit = tr.price * (1 + tr.fee / 100);
    if (h) { const nq = h.qty + tr.qty; h.cost = Math.round(((h.qty * h.cost + tr.qty * unit) / nq) * 1000) / 1000; h.qty = nq; h.last_buy = tr.date; }
    else pf.holdings.push({ symbol: tr.symbol, qty: tr.qty, cost: Math.round(unit * 1000) / 1000, date: tr.date, last_buy: tr.date, basket: tr.basket || null, style: tr.style || STYLE_OF_BASKET[tr.basket] || null });
    if (isNum(pf.cash) && pf.cash > 0) pf.cash = Math.max(0, pf.cash - tr.qty * unit * 1000);
  } else {
    const avg = h ? h.cost : null, q = h ? Math.min(tr.qty, h.qty) : tr.qty;
    tr.avg_cost = avg;
    tr.realized = isNum(avg) ? Math.round((tr.price * (1 - tr.fee / 100) - avg) * q * 1000) : null;
    tr.realized_pct = isNum(avg) && avg ? (tr.price * (1 - tr.fee / 100) / avg - 1) * 100 : null;
    tr.held_days = h ? tradingDaysBetween(h.date, tr.date) : null;
    if (h) { h.qty -= q; if (h.qty <= 0) pf.holdings.splice(i, 1); else if (tr.exit_key) h.exits_done = [...new Set([...(h.exits_done || []), tr.exit_key])]; }
    if (isNum(pf.cash)) pf.cash = (pf.cash || 0) + tr.qty * tr.price * (1 - tr.fee / 100) * 1000;
  }
  J.trades.push(tr);
  pf.updated = new Date().toISOString();
  const [a, b] = await Promise.all([Store.put("portfolio", pf), Store.put("journal", J)]);
  return a && b;
}
function tradeBox(o, onDone) {
  // hộp ghi lệnh nổi (mua thêm / bán một phần / bán hết)
  const old = $("#tbox"); if (old) old.remove();
  const el = document.createElement("div");
  el.id = "tbox"; el.className = "tbox";
  const today = new Date().toISOString().slice(0, 10);
  el.innerHTML = `<div class="tb-in" role="dialog" aria-label="Ghi lệnh">
    <div class="ph"><h2>${o.side === "buy" ? "Mua" : "Bán"} ${esc(o.symbol)}</h2><button class="chip" id="tbX" aria-label="Đóng">Đóng</button></div>
    ${o.note ? `<p class="note" style="font-size:.78rem">${esc(o.note)}</p>` : ""}
    <div class="filters" style="margin-top:6px">
      <div class="field w140"><label for="tbD">Ngày</label><input id="tbD" type="date" value="${today}"></div>
      <div class="field w90"><label for="tbQ">Khối lượng</label><input id="tbQ" inputmode="numeric" value="${o.qty || ""}"></div>
      <div class="field w90"><label for="tbP">Giá khớp (nghìn)</label><input id="tbP" inputmode="decimal" value="${o.price ?? ""}"></div>
      <div class="field w60"><label for="tbF">Phí %</label><input id="tbF" inputmode="decimal" value="${o.side === "buy" ? FEE_BUY : FEE_SELL}"></div></div>
    ${o.side === "sell" && o.held ? `<div class="views" style="margin:6px 0 0">${[25, 50, 75, 100].map((p) => `<button data-q="${p}">${p === 100 ? "Bán hết" : p + "%"}</button>`).join("")}</div>` : ""}
    <div class="field sec"><label for="tbDec">Quyết định này là</label><select id="tbDec">${Object.entries(DECISION).map(([k, n]) => `<option value="${k}" ${k === o.decision ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="field sec"><label for="tbR">Lý do</label><input id="tbR" value="${esc(o.reason || "")}" placeholder="ví dụ: chốt lời một phần vì định giá đã đắt"></div>
    <p id="tbPrev" class="muted" style="font-size:.78rem;margin-top:8px"></p>
    <p style="margin-top:8px"><button class="btn primary" id="tbOk">${o.side === "buy" ? "Ghi lệnh mua" : "Ghi lệnh bán"}</button></p></div>`;
  document.body.appendChild(el);
  const prev = () => {
    const q = Number(String($("#tbQ").value).replace(/\D/g, "")), p = Number(String($("#tbP").value).replace(",", ".")), f = Number(String($("#tbF").value).replace(",", ".")) || 0;
    if (!q || !p) { $("#tbPrev").textContent = ""; return; }
    if (o.side === "buy") { const nq = (o.held || 0) + q, nc = o.held ? (o.held * o.cost + q * p * (1 + f / 100)) / nq : p * (1 + f / 100);
      $("#tbPrev").innerHTML = `Tiền cần: <b>${vnd(q * p * (1 + f / 100) * 1000)}</b> · sau lệnh nắm <b>${nf(nq, 0)}</b> cp, giá vốn bình quân <b>${nf(nc)}</b>${o.held ? ` (từ ${nf(o.cost)})` : ""} · bán được từ ${addTradingDays($("#tbD").value || today, 2)} (T+2)`; }
    else { const qq = Math.min(q, o.held || q), r = isNum(o.cost) ? (p * (1 - f / 100) - o.cost) * qq * 1000 : null;
      $("#tbPrev").innerHTML = `Tiền về: <b>${vnd(q * p * (1 - f / 100) * 1000)}</b>${isNum(r) ? ` · lãi/lỗ chốt <b class="${cls(r)}">${vnd(r)}</b> (${pct((p * (1 - f / 100) / o.cost - 1) * 100, 1)})` : ""} · còn lại <b>${nf(Math.max(0, (o.held || 0) - q), 0)}</b> cp`; }
  };
  $$("#tbox input").forEach((x) => (x.oninput = prev));
  $$("#tbox [data-q]").forEach((b) => (b.onclick = () => { $("#tbQ").value = b.dataset.q === "100" ? o.held : lot(o.held * Number(b.dataset.q) / 100) || o.held; prev(); }));
  $("#tbX").onclick = () => el.remove();
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  $("#tbOk").onclick = async () => {
    const q = Number(String($("#tbQ").value).replace(/\D/g, "")), p = Number(String($("#tbP").value).replace(",", "."));
    if (!q || !p) { toast("Nhập khối lượng và giá khớp"); return; }
    if (o.side === "sell" && o.held && q > o.held) { toast(`Chỉ đang nắm ${nf(o.held, 0)} cp`); return; }
    const tr = { id: "t" + Date.now().toString(36), ts: Date.now(), date: $("#tbD").value || today, symbol: o.symbol, side: o.side, qty: q, price: p,
      fee: Number(String($("#tbF").value).replace(",", ".")) || 0, decision: $("#tbDec").value, reason: $("#tbR").value.trim(), snap: o.snap || "", basket: o.basket || null, style: o.style || null, exit_key: o.exit_key || null };
    el.remove();
    await onDone(tr);
  };
  prev();
}

async function viewPortfolio() {
  const [pfr, jr, t, rows, m] = await Promise.all([Store.get("portfolio"), Store.get("journal"), loadToday(), screenerRows(), tryLoad("data/market.json")]);
  const pf = pfr.data || { holdings: [], cash: 0, capital: null }; pf.holdings = pf.holdings || [];
  const J = { trades: (jr.data && jr.data.trades) || [] };
  const R = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const adv = Object.fromEntries(((t.portfolio && t.portfolio.positions) || []).map((p) => [p.symbol, p]));
  const risk = t.risk || {}, picks = t.plan?.picks || [];
  const maxSL = (risk.max_stop_loss_pct ?? 20) / 100;
  // giá lịch sử cho từng mã đang nắm (đỉnh kể từ khi mua)
  const det = {};
  await Promise.all(pf.holdings.map(async (h) => { det[h.symbol] = await tryLoad(`data/stocks/${h.symbol}.json`); }));
  const today = t.date || new Date().toISOString().slice(0, 10);
  const snapOf = (s) => { const r = R[s]; if (!r) return ""; const a = adv[s]; return [picks.some((p) => p.symbol === s) ? "trong danh sách MUA" : "không trong danh sách MUA", `điểm ${nf(r.composite, 0)}`, `KT ${r.ta_label || "—"}`, `P/E ${nf(r.pe, 1)} vs ngành ${nf(r.pe_ind, 1)}`, `đèn ${LIGHT_VI[t.regime.light]}`, a ? `tư vấn: ${a.action}` : ""].filter(Boolean).join(" · "); };
  const done = async (tr) => {
    const ok = await applyTrade(tr, pf, J);
    toast((tr.side === "sell" && isNum(tr.realized) ? `Đã ghi – lãi/lỗ chốt ${vnd(tr.realized)}` : "Đã ghi lệnh") + (ok ? "" : " (lưu trên trình duyệt này)"));
    render();
  };

  const render = () => {
    const P = pf.holdings.map((h) => {
      const r = R[h.symbol] || {}, a = adv[h.symbol], d = det[h.symbol];
      const px = r.price ?? h.cost, mv = h.qty * px * 1000, cost = h.qty * h.cost * 1000;
      let peak = px;
      if (d?.ohlc && h.date) { const o = d.ohlc; for (let i = 0; i < o.t.length; i++) if (o.t[i] >= h.date) peak = Math.max(peak, o.c[i]); }
      const held = h.date ? tradingDaysBetween(h.date, today) : null;
      const ep = exitPlan(h, px, peak, held, { atr: r.atr, e20: r.e20, e20_below2: r.e20_below2, fair: r.fair, fair_hi: r.fair_hi, div_yield: r.div_yield }, maxSL * 100);
      const stop = ep.stop ?? h.cost * (1 - maxSL);
      const th = (a?.actions || []).map((k, i) => [k, a.reasons?.[i]]).filter(([k]) => k === "BÁN – LUẬN ĐIỂM GÃY" || (k === "CÂN NHẮC GIẢM TỶ TRỌNG" && ep.style === "position"));
      const hits = ep.levels.filter((l) => l.status === "hit"), fullH = hits.find((l) => l.sell >= 0.999), partH = hits.filter((l) => l.sell > 0 && l.sell < 0.999).sort((p, q) => q.price - p.price)[0];
      const act = th.some(([k]) => k.startsWith("BÁN")) ? { action: "BÁN – LUẬN ĐIỂM GÃY", sev: 3 } : fullH ? { action: fullH.kind === "stop" && fullH.price < h.cost ? "CẮT LỖ / BÁN" : "BÁN HẾT", sev: fullH.kind === "stop" || fullH.kind === "cond" ? 3 : 2 }
        : partH ? { action: `CHỐT LỜI ${fracVi(partH.sell).replace("Bán ", "")}`, sev: 2 } : hits.some((l) => l.sell === 0) ? { action: "XEM LẠI LUẬN ĐIỂM", sev: 1 } : th.length ? { action: th[0][0], sev: 1 } : { action: "GIỮ", sev: 0 };
      act.notes = th.map(([k, r]) => `${k === "BÁN – LUẬN ĐIỂM GÃY" ? "Luận điểm gãy" : "Xu hướng giảm"}: ${r}`);
      const be = ep.breakeven;
      const lastBuy = h.last_buy || h.date;
      const sellable = lastBuy ? addTradingDays(lastBuy, 2) : null;
      return { h, r, a, px, mv, cost, pnl: mv * (1 - FEE_SELL / 100) - cost, pnlPct: h.cost ? (px * (1 - FEE_SELL / 100) / h.cost - 1) * 100 : null, peak, fromPeak: peak ? (px / peak - 1) * 100 : null,
        stop, be, sellable, held, ep, act, lvl: { stop, cost: h.cost, px, fair: a?.fair ?? r.fair, tps: ep.levels.filter((l) => l.kind === "tp" && l.price && l.status !== "done").map((l) => l.price).sort((p, q) => p - q) } };
    });
    const mv = P.reduce((s, x) => s + x.mv, 0), costT = P.reduce((s, x) => s + x.cost, 0), cash = Number(pf.cash || 0);
    const total = mv + cash, denom = capitalOf(pf) || total;
    const day = P.reduce((s, x) => s + (isNum(x.r.chg1d) ? x.mv - x.mv / (1 + x.r.chg1d / 100) : 0), 0);
    const sells = J.trades.filter((x) => x.side === "sell" && isNum(x.realized)).sort((a, b) => (a.date < b.date ? -1 : 1));
    const realized = sells.reduce((s, x) => s + x.realized, 0);
    const ym = today.slice(0, 7), yy = today.slice(0, 4);
    const rMonth = sells.filter((x) => x.date.startsWith(ym)).reduce((s, x) => s + x.realized, 0), rYear = sells.filter((x) => x.date.startsWith(yy)).reduce((s, x) => s + x.realized, 0);
    const wins = sells.filter((x) => x.realized > 0), losses = sells.filter((x) => x.realized <= 0);
    const gW = wins.reduce((s, x) => s + x.realized, 0), gL = -losses.reduce((s, x) => s + x.realized, 0);
    const expCap = t.regime.exposure;
    const plan = rebalance(P, cash, denom);
    const bySec = {};
    P.forEach((x) => { const s = x.r.sector || "Khác"; bySec[s] = (bySec[s] || 0) + x.mv; });

    const card = (x) => {
      const { h, r, a } = x, w = denom ? (x.mv / denom) * 100 : null;
      const sev = x.act.sev;
      const tps = x.lvl.tps, L = [x.stop, h.cost, x.px, ...tps].filter(isNum), lo = Math.min(...L) * 0.97, hi = Math.max(...L) * 1.03, X = (v) => ((v - lo) / (hi - lo)) * 100;
      const hitL = x.ep.levels.filter((l) => l.status === "hit"), nearL = x.ep.levels.filter((l) => l.status === "near");
      const canSell = !x.sellable || x.sellable <= today;
      return `<div class="pos ${sev >= 2 ? "sell" : sev === 1 ? "wait" : ""}">
        <div class="pk-head"><div><a class="sym" href="#/s/${h.symbol}">${h.symbol}</a> <span class="pill ${sev >= 2 ? "sell" : sev === 1 ? "wait" : "buy"}">${esc(x.act.action)}</span> <span class="pill">${esc(STYLE_SHORT[x.ep.style])}</span>${h.basket ? ` <span class="pill">${esc(BASKET_SHORT[h.basket] || h.basket)}</span>` : ""}
          <small class="pk-name">${esc(r.name || "")} · ${esc(r.sector || "")}</small></div>
          <div class="pk-px">${mini(r.spk, { w: 90, h: 30 })}<div><b>${nf(x.px)}</b><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)} hôm nay</small></div>
            <div><b class="${cls(x.pnl)}">${pct(x.pnlPct, 1)}</b><small class="${cls(x.pnl)}">${big(x.pnl)} đ</small></div></div></div>
        <div class="ladder sm" aria-hidden="true"><div class="lt"></div>
          <i class="lz risk" style="left:${X(x.stop)}%;width:${Math.max(0, X(h.cost) - X(x.stop))}%"></i>
          ${tps.length && tps[0] > h.cost ? `<i class="lz gain" style="left:${X(h.cost)}%;width:${X(Math.max(...tps)) - X(h.cost)}%"></i>` : ""}
          <i class="lk stop" style="left:${X(x.stop)}%"></i><i class="lk cost" style="left:${X(h.cost)}%"></i>${tps.map((v) => `<i class="lk" style="left:${X(v)}%"></i>`).join("")}
          <i class="lp" style="left:${X(x.px)}%"><em>${nf(x.px)}</em></i></div>
        <div class="lleg" style="display:block"><span class="down">${x.ep.style === "long" || x.ep.style === "income" ? (h.exit_custom?.stop ? "dừng" : "xem lại") : "dừng"} ${nf(x.stop)}</span><span>giá vốn ${nf(h.cost)}</span>${tps.map((v, i) => `<span class="up">chốt ${i + 1}: ${nf(v)}</span>`).join("")}</div>
        <div class="pk-facts f6">
          <div><small>Khối lượng</small><b>${nf(h.qty, 0)}</b><small>${big(x.mv)} đ</small></div>
          <div><small>Tỷ trọng</small><b class="${w > (risk.max_weight_per_stock ?? 20) ? "down" : ""}">${pct(w, 1, false)}</b><small>tối đa ${risk.max_weight_per_stock ?? 20}%</small></div>
          <div><small>Sụt từ đỉnh sau mua</small><b class="${x.fromPeak <= -10 ? "down" : ""}">${pct(x.fromPeak, 1)}</b><small>đỉnh ${nf(x.peak)}</small></div>
          <div><small>Đã nắm</small><b>${x.held ?? "—"} phiên</b><small>mua ${esc(h.date || "—")}</small></div>
          <div><small>Được bán từ</small><b class="${canSell ? "up" : "ref"}">${canSell ? "đã bán được" : esc(x.sellable)}</b><small>hàng về T+2</small></div>
          <div class="hlf"><small>P/E</small><b>${nf(r.pe, 1)}</b><small>ngành ${nf(r.pe_ind, 1)}</small></div></div>
        ${exitBox(x, today)}
        <p class="why">${hitL.length ? `<b class="${hitL.some((l) => l.kind !== "tp") ? "down" : "up"}">Đã chạm: ${hitL.map((l) => esc(l.label) + (l.sell > 0 ? " → " + fracVi(l.sell).toLowerCase() + (l.qty ? " " + nf(l.qty, 0) + " cp" : "") : " → xem lại")).join("; ")}.</b> ` : nearL.length ? `<b class="ref">Sắp chạm: ${nearL.map((l) => `${esc(l.label)} ${nf(l.price)}`).join("; ")}.</b> ` : ""}${esc(x.act.notes.join("; ") || (hitL.length || nearL.length ? "" : "Chưa chạm mức thoát nào – cứ giữ, hệ thống nhắn Telegram khi giá cách một mức ≤ 3% và khi chạm."))}${x.fromPeak <= -15 && x.peak > h.cost * 1.1 ? ` · Đã trả lại ${nf(-x.fromPeak, 0)}% từ đỉnh – cân nhắc khoá lãi.` : ""}</p>
        <div class="pos-act"><button class="btn" data-act="buy" data-s="${h.symbol}">Mua thêm</button><button class="btn" data-act="part" data-s="${h.symbol}">Bán một phần</button><button class="btn" data-act="all" data-s="${h.symbol}">Bán hết</button>
          <button class="chip" data-edit="${h.symbol}" title="Sửa khối lượng / giá vốn mà không ghi nhật ký">Sửa</button></div></div>`;
    };
    const cum = []; let c0 = 0; sells.forEach((x) => { c0 += x.realized; cum.push({ x: x.date.slice(5), y: c0 / 1e6 }); });
    app().innerHTML = `${pfTabs("hold")}
    <div class="ph"><h1>Danh mục của tôi</h1><span class="meta">${pfr.remote ? "đã đồng bộ mọi thiết bị" : "đang lưu trong trình duyệt này"}</span></div>
    <section class="panel hero"><div class="bigs">
      <div class="big hlb"><small>Tổng tài sản</small><b>${big(total)}</b><span>cổ phiếu ${big(mv)} · tiền ${big(cash)}</span></div>
      <div class="big"><small>Lãi/lỗ chưa chốt</small><b class="${cls(mv * (1 - FEE_SELL / 100) - costT)}">${big(mv * (1 - FEE_SELL / 100) - costT)}</b><span>${pct(costT ? ((mv * (1 - FEE_SELL / 100)) / costT - 1) * 100 : null, 1)} · đã trừ phí bán</span></div>
      <div class="big"><small>Lãi/lỗ đã chốt</small><b class="${cls(realized)}">${big(realized)}</b><span>tháng này <b class="${cls(rMonth)}">${big(rMonth)}</b> · năm nay <b class="${cls(rYear)}">${big(rYear)}</b></span></div>
      <div class="big"><small>Hôm nay</small><b class="${cls(day)}">${big(day)}</b><span>${P.length} mã đang nắm</span></div>
      <div class="big ${denom && (mv / denom) * 100 > expCap + 5 ? "warnb" : ""}"><small>Tỷ trọng cổ phiếu</small><b>${pct(denom ? (mv / denom) * 100 : null, 0, false)}</b><span>đèn ${LIGHT_VI[t.regime.light]} cho phép tối đa ${expCap}%</span></div>
    </div>${(t.portfolio?.warnings || []).map((w) => `<p class="note" style="margin-top:6px">${esc(w)}</p>`).join("")}</section>
    <div class="g g-main sec">
      <div class="stack">
        <section class="panel"><div class="ph"><h2>Mã đang nắm</h2><span class="meta">bấm "Bán một phần" để chốt từng phần – lãi/lỗ được ghi lại</span></div>
          ${P.length ? `<div class="picks">${P.sort((a, b) => b.act.sev - a.act.sev || b.mv - a.mv).map(card).join("")}</div>` : `<div class="empty">Chưa có mã nào. Ghi lệnh mua ở khung "Mua mã mới" hoặc thêm mã đang nắm.</div>`}</section>
        <section class="panel hero" id="rebal"><div class="ph"><h2>Kế hoạch cơ cấu danh mục</h2>
          <label style="display:flex;gap:5px;align-items:center;font-size:.78rem"><input type="checkbox" id="rbCap" ${lsGet("rbCap", true) ? "checked" : ""}> Giảm tỷ trọng theo đèn (${LIGHT_VI[t.regime.light]}: tối đa ${t.regime.exposure}%)</label>
          <span class="meta">theo tư vấn từng mã, trần tỷ trọng mã/ngành và danh sách MUA</span></div>
          ${plan.lines.length ? `<div class="rows">${plan.lines.map((l, i) => `<div class="row rb"><div class="r-main"><b><span class="pill ${l.side === "buy" ? "buy" : "sell"}">${l.label}</span> ${l.symbol}</b><small>${esc(l.why)}</small></div>
              <div class="r-val"><b>${nf(l.qty, 0)} cp</b><small>≈ ${big(l.value)} đ · ${nf(l.price)}</small></div><button class="btn" data-rb="${i}">Ghi lệnh</button></div>`).join("")}</div>
            ${kpis([["Tiền mặt sau cơ cấu", big(plan.cashAfter) + " đ"], ["Tỷ trọng CP sau", pct(plan.expAfter, 0, false) + ` <small>/ tối đa ${expCap}%</small>`], ["Số mã sau", plan.nAfter + ` <small>/ tối đa ${risk.max_positions ?? 8}</small>`]], false, "sec")}`
            : `<div class="empty">Danh mục đang khớp kế hoạch – không cần mua bán thêm.</div>`}
          <p class="faint" style="font-size:.72rem;margin-top:6px">Gợi ý tính ở giá đóng cửa gần nhất, làm tròn lô 100 cp. Bấm "Ghi lệnh" sau khi khớp thật để cập nhật giá khớp chính xác.</p></section>
        <section class="panel"><div class="ph"><h2>Lãi/lỗ đã chốt</h2><span class="meta">${sells.length} lần bán · giá vốn bình quân như CTCK, đã trừ phí + thuế</span></div>
          ${sells.length ? `${kpis([["Tổng đã chốt", big(realized) + " đ", cls(realized)], ["Số lần lãi / lỗ", `${wins.length} / ${losses.length}`], ["Lãi TB mỗi lần thắng", big(wins.length ? gW / wins.length : null) + " đ", "up"], ["Lỗ TB mỗi lần thua", big(losses.length ? -gL / losses.length : null) + " đ", "down"],
              ["Hệ số lãi/lỗ", gL ? nf(gW / gL, 2) : "—", "", "Tổng lãi ÷ tổng lỗ – trên 1,5 là tốt"], ["Nắm TB", nf(sells.filter((x) => isNum(x.held_days)).reduce((s, x, _, a) => s + x.held_days / a.length, 0), 0) + " phiên"]])}
            ${cum.length > 1 ? `<div class="sec">${lineSvg([{ name: "Lãi đã chốt cộng dồn (triệu đ)", color: css("--brand"), width: 2, pts: cum }], { h: 150, zero: true, dec: 1, label: "Lãi đã chốt cộng dồn" })}</div>` : ""}
            <div class="rows sec">${sells.slice().reverse().slice(0, 30).map((x) => `<div class="row"><div class="r-main"><b><a href="#/s/${x.symbol}">${x.symbol}</a> <small style="display:inline">bán ${nf(x.qty, 0)} @ ${nf(x.price)}</small></b><small>${esc(x.date)} · giá vốn ${nf(x.avg_cost)} · nắm ${x.held_days ?? "—"} phiên · ${esc(DECISION[x.decision] || "")}${x.reason ? " · " + esc(x.reason) : ""}</small></div>
              <div></div><div class="r-val"><b class="${cls(x.realized)}">${big(x.realized)} đ</b><small class="${cls(x.realized_pct)}">${pct(x.realized_pct, 1)}</small></div></div>`).join("")}</div>`
            : `<p class="muted">Chưa có lần bán nào được ghi. Bấm "Bán một phần" hoặc "Bán hết" ở thẻ mã khi anh bán – lãi/lỗ sẽ được ghi lại ở đây.</p>`}</section>
      </div>
      <div class="stack sticky">
        <section class="panel"><div class="ph"><h2>Mua mã mới</h2></div>
          <div class="filters"><div class="field w90"><label for="nbS">Mã</label><input id="nbS" placeholder="FPT" autocapitalize="characters"></div><button class="btn primary" id="nbGo">Ghi lệnh mua</button></div>
          ${picks.length ? `<p class="faint" style="font-size:.74rem;margin-top:6px">Danh sách MUA hôm nay: ${picks.map((p) => `<a href="#" data-nb="${p.symbol}">${p.symbol}</a>`).join(", ")}</p>` : ""}</section>
        ${panel("Vốn", `<div class="filters"><div class="field"><label for="cap">Tổng vốn cho chứng khoán (đồng)</label><input id="cap" inputmode="numeric" value="${pf.capital ?? ""}" placeholder="500000000"></div>
          <div class="field"><label for="cash">Tiền mặt hiện có (đồng)</label><input id="cash" inputmode="numeric" value="${pf.cash ?? ""}"></div><button class="btn primary" id="saveCap">Lưu</button></div>
          <p class="faint" style="font-size:.72rem">Tiền mặt tự trừ/cộng khi anh ghi lệnh mua/bán.</p>`)}
        ${Object.keys(bySec).length ? panel("Cơ cấu theo ngành", `<div class="rows">${Object.entries(bySec).sort((a, b) => b[1] - a[1]).map(([s, v]) => { const w = denom ? v / denom * 100 : 0, lim = risk.max_weight_per_sector ?? 30;
          return `<div class="row"><div class="r-main"><b>${esc(s)}</b></div><div class="r-mid"><span class="bar1" style="width:90px"><i style="width:${Math.min(100, w / lim * 100)}%;background:${w > lim ? "var(--down)" : "var(--brand)"}"></i></span></div><div class="r-val"><b class="${w > lim ? "down" : ""}">${pct(w, 1, false)}</b><small>trần ${lim}%</small></div></div>`; }).join("")}</div>`) : ""}
        <details class="panel"><summary>Thêm / sửa mã đang nắm (không ghi nhật ký)</summary>
          <div class="filters" style="margin-top:8px">
            <div class="field w60"><label for="hs">Mã</label><input id="hs" placeholder="FPT" autocapitalize="characters"></div>
            <div class="field w90"><label for="hq">KL (cp)</label><input id="hq" inputmode="numeric"></div>
            <div class="field w90"><label for="hc">Giá vốn</label><input id="hc" inputmode="decimal"></div>
            <div class="field w140"><label for="hd">Ngày mua</label><input id="hd" type="date"></div>
            <div class="field w140"><label for="hb">Rổ</label><select id="hb"><option value="">Không rõ</option>${Object.entries(BASKET_SHORT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
            <div class="field w140"><label for="hst">Phong cách (luật thoát)</label><select id="hst"><option value="">Tự theo rổ</option>${STYLE_ORDER.map((k) => `<option value="${k}">${STYLE_SHORT[k]}</option>`).join("")}</select></div>
            <button class="btn" id="add">Lưu mã</button><button class="btn" id="del">Xoá mã</button></div>
          <p class="faint" style="font-size:.72rem;margin-top:6px">Dùng khi nhập danh mục có sẵn từ trước, hoặc sửa cho khớp với tài khoản CTCK. Mua/bán thật thì nên dùng nút trên thẻ mã để lãi/lỗ được ghi lại.</p></details>
      </div>
    </div>`;
    // ---- sự kiện
    const posOf = (s) => P.find((x) => x.h.symbol === s);
    $$("[data-act]").forEach((b) => (b.onclick = () => {
      const x = posOf(b.dataset.s), act = b.dataset.act;
      const sev = x.act.sev;
      const o = { symbol: x.h.symbol, side: act === "buy" ? "buy" : "sell", price: x.px, held: x.h.qty, cost: x.h.cost, snap: snapOf(x.h.symbol), basket: x.h.basket,
        qty: act === "all" ? x.h.qty : act === "part" ? lot(x.h.qty / 2) || x.h.qty : null,
        decision: act === "buy" ? (picks.some((p) => p.symbol === x.h.symbol) ? "sys" : "self") : sev >= 2 ? "sys" : sev === 0 ? "against" : "self",
        note: act !== "buy" && x.sellable > today ? `Cổ phiếu mua ngày ${x.h.last_buy || x.h.date} chỉ bán được từ ${x.sellable} (T+2).` : act === "buy" && x.pnlPct < -7 ? "Đang lỗ – mua thêm để bình quân giá chỉ nên làm khi luận điểm cơ bản vẫn đúng và hệ thống vẫn đánh giá tốt." : "" };
      tradeBox(o, done);
    }));
    $$("[data-exs]").forEach((sel) => (sel.onchange = async () => { const h = pf.holdings.find((y) => y.symbol === sel.dataset.exs); h.style = sel.value; h.exits_done = []; await save(); }));
    $$("[data-exc]").forEach((b) => (b.onclick = () => { const el = $(`#exc-${b.dataset.exc}`); el.hidden = !el.hidden; }));
    $$("[data-exsave]").forEach((b) => (b.onclick = async () => { const s = b.dataset.exsave, h = pf.holdings.find((y) => y.symbol === s), box = $(`#exc-${s}`), v = (k) => { const n = Number(String($(`[data-cus="${k}"]`, box).value).replace(",", ".")); return n > 0 ? n : null; };
      h.exit_custom = { stop: v("stop"), tp: v("tp"), tp_pct: v("tp_pct") || 50 }; if (!h.exit_custom.stop && !h.exit_custom.tp) delete h.exit_custom; await save(); }));
    $$("[data-exclr]").forEach((b) => (b.onclick = async () => { const h = pf.holdings.find((y) => y.symbol === b.dataset.exclr); delete h.exit_custom; await save(); }));
    $$("[data-exu]").forEach((b) => (b.onclick = async () => { const [s, k] = b.dataset.exu.split("|"), h = pf.holdings.find((y) => y.symbol === s); h.exits_done = (h.exits_done || []).filter((z) => z !== k); await save(); }));
    $$("[data-exb]").forEach((b) => (b.onclick = () => { const [s, k] = b.dataset.exb.split("|"), x = posOf(s), l = x.ep.levels.find((z) => z.key === k);
      tradeBox({ symbol: s, side: "sell", qty: l.qty, price: l.status === "hit" || !l.price ? x.px : l.price, held: x.h.qty, cost: x.h.cost, snap: snapOf(s), basket: x.h.basket, style: x.ep.style, decision: "sys", exit_key: k,
        reason: `${l.label}${l.price ? " " + nf(l.price) : ""} – ${l.why}`, note: l.status === "hit" ? "" : `Chưa chạm mức này (giá hiện ${nf(x.px)}). Có thể đặt lệnh bán chờ ở ${nf(l.price)} trên app CTCK, khớp xong thì ghi lại ở đây.` + (x.sellable > today ? ` Hàng mua ${x.h.last_buy || x.h.date} bán được từ ${x.sellable} (T+2).` : "") }, done); }));
    $$("[data-rb]").forEach((b) => (b.onclick = () => { const l = plan.lines[Number(b.dataset.rb)], x = posOf(l.symbol);
      tradeBox({ symbol: l.symbol, side: l.side, qty: l.qty, price: l.price, held: x?.h.qty || 0, cost: x?.h.cost, snap: snapOf(l.symbol), basket: l.basket || x?.h.basket, decision: "sys", reason: l.why }, done); }));
    const newBuy = (s) => { s = String(s || "").trim().toUpperCase(); if (!/^[A-Z0-9]{3}$/.test(s)) { toast("Nhập mã 3 ký tự"); return; } const x = posOf(s), pk = picks.find((p) => p.symbol === s);
      tradeBox({ symbol: s, side: "buy", price: R[s]?.price, qty: pk && capitalOf(pf) ? sharesFor(capitalOf(pf), pk.weight, pk.zone[1]) : null, held: x?.h.qty || 0, cost: x?.h.cost, snap: snapOf(s), basket: pk?.basket, style: pk ? t.style || "position" : null, decision: pk ? "sys" : "self",
        note: pk ? `Trong danh sách MUA: vùng mua ${nf(pk.zone[0])}–${nf(pk.zone[1])}, cắt lỗ ${nf(pk.stop)}, tỷ trọng ${nf(pk.weight, 1)}%` : "Mã không có trong danh sách MUA hôm nay." }, done); };
    $("#nbGo").onclick = () => newBuy($("#nbS").value);
    $("#rbCap").onchange = (e) => { lsSet("rbCap", e.target.checked); render(); };
    $$("[data-nb]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); newBuy(a.dataset.nb); }));
    $$("[data-edit]").forEach((b) => (b.onclick = () => { const h = pf.holdings.find((x) => x.symbol === b.dataset.edit); $("details.panel").open = true; $("#hs").value = h.symbol; $("#hq").value = h.qty; $("#hc").value = h.cost; $("#hd").value = h.date || ""; $("#hb").value = h.basket || ""; $("#hst").value = h.style || ""; $("#hs").scrollIntoView({ behavior: "smooth", block: "center" }); }));
    $("#saveCap").onclick = async () => { pf.capital = Number(String($("#cap").value).replace(/\D/g, "")) || null; pf.cash = Number(String($("#cash").value).replace(/\D/g, "")) || 0; await save(); };
    $("#add").onclick = async () => {
      const s = $("#hs").value.trim().toUpperCase(), q = Number(String($("#hq").value).replace(/\D/g, "")), c = Number(String($("#hc").value).replace(",", "."));
      if (!/^[A-Z0-9]{3}$/.test(s) || !q || !c) { toast("Nhập đủ mã, khối lượng và giá vốn"); return; }
      const h = { symbol: s, qty: q, cost: c, date: $("#hd").value || today, basket: $("#hb").value || null, style: $("#hst").value || null };
      const i = pf.holdings.findIndex((x) => x.symbol === s);
      if (i >= 0) pf.holdings[i] = { ...pf.holdings[i], ...h }; else pf.holdings.push(h);
      await save();
    };
    $("#del").onclick = async () => { const s = $("#hs").value.trim().toUpperCase(); const i = pf.holdings.findIndex((x) => x.symbol === s); if (i < 0) { toast("Không có mã này trong danh mục"); return; } pf.holdings.splice(i, 1); await save(); };
  };
  function rebalance(P, cash, denom) {
    const lines = [], cap = (t.regime.exposure / 100) * denom, maxW = ((risk.max_weight_per_stock ?? 20) / 100) * denom, maxS = ((risk.max_weight_per_sector ?? 30) / 100) * denom;
    const tgt = Object.fromEntries(P.map((x) => [x.h.symbol, x.mv]));
    const why = {};
    P.forEach((x) => {
      const s = x.h.symbol, sev = x.a?.severity ?? (x.px <= x.stop ? 3 : 0), act = x.a?.action || "";
      const hit = x.ep.levels.filter((l) => l.status === "hit" && l.sell > 0), full = hit.find((l) => l.sell >= 0.999), part = hit.filter((l) => l.sell < 0.999).sort((p, q) => q.price - p.price)[0];
      if (x.act.action.startsWith("BÁN – LUẬN")) { tgt[s] = 0; why[s] = `${act} – ${(x.a?.reasons || []).join("; ")}`; }
      else if (full) { tgt[s] = 0; why[s] = `${full.label}${full.price ? " " + nf(full.price) : ""} – ${full.why}`; }
      else if (part) { tgt[s] = x.mv - part.qty * x.px * 1000; why[s] = `${part.label} ${nf(part.price)} – ${fracVi(part.sell).toLowerCase()} (${part.why})`; }
      else if (x.ep.style === "position" && x.act.action.startsWith("CÂN NHẮC")) { tgt[s] = (x.mv * 2) / 3; why[s] = `Giảm 1/3 – ${(x.a?.reasons || []).join("; ")}`; }
      if (tgt[s] > maxW) { tgt[s] = maxW; why[s] = (why[s] ? why[s] + "; " : "") + `vượt trần ${risk.max_weight_per_stock ?? 20}% vốn/mã`; }
    });
    const secOf = (s) => R[s]?.sector || "Khác";
    const secSum = {}; Object.entries(tgt).forEach(([s, v]) => (secSum[secOf(s)] = (secSum[secOf(s)] || 0) + v));
    Object.entries(secSum).forEach(([sec, v]) => { if (v <= maxS) return; let ex = v - maxS;
      P.filter((x) => secOf(x.h.symbol) === sec).sort((a, b) => (a.r.composite ?? 0) - (b.r.composite ?? 0)).forEach((x) => { if (ex <= 0) return; const s = x.h.symbol, cut = Math.min(ex, tgt[s]); tgt[s] -= cut; ex -= cut; why[s] = (why[s] ? why[s] + "; " : "") + `ngành ${sec} vượt trần ${risk.max_weight_per_sector ?? 30}%`; }); });
    let stock = Object.values(tgt).reduce((a, b) => a + b, 0);
    if (lsGet("rbCap", true) && stock > cap * 1.03) { let ex = stock - cap;
      P.slice().sort((a, b) => (a.r.composite ?? 0) - (b.r.composite ?? 0)).forEach((x) => { if (ex <= 0) return; const s = x.h.symbol, cut = Math.min(ex, tgt[s]); if (cut <= 0) return; tgt[s] -= cut; ex -= cut; why[s] = (why[s] ? why[s] + "; " : "") + `đèn ${LIGHT_VI[t.regime.light]} chỉ cho nắm ${t.regime.exposure}% cổ phiếu (bán mã điểm thấp trước)`; }); }
    let cashAfter = cash;
    P.forEach((x) => { const s = x.h.symbol; const diff = x.mv - tgt[s]; if (diff <= 0) return; let q = tgt[s] <= 1 ? x.h.qty : lot(diff / (x.px * 1000)); if (q <= 0) return; q = Math.min(q, x.h.qty);
      lines.push({ side: "sell", label: q >= x.h.qty ? "BÁN HẾT" : "BÁN BỚT", symbol: s, qty: q, price: x.px, value: q * x.px * 1000, why: why[s] || "" }); cashAfter += q * x.px * 1000 * (1 - FEE_SELL / 100); });
    stock = P.reduce((a, x) => a + x.mv, 0) - lines.reduce((a, l) => a + l.value, 0);
    let n = P.length - lines.filter((l) => l.label === "BÁN HẾT").length;
    picks.slice().sort((a, b) => b.score - a.score).forEach((p) => {
      const x = P.find((y) => y.h.symbol === p.symbol), cur = x ? x.mv : 0, want = (p.weight / 100) * denom;
      if (want - cur < 0.02 * denom) return;
      if (!x && n >= (risk.max_positions ?? 8)) return;
      const room = Math.min(want - cur, (lsGet("rbCap", true) ? cap : denom) - stock, cashAfter);
      const px = Math.min(p.price, p.zone[1]), q = lot(room / (px * 1000));
      if (q < 100) return;
      lines.push({ side: "buy", label: x ? "MUA THÊM" : "MUA MỚI", symbol: p.symbol, qty: q, price: px, value: q * px * 1000, basket: p.basket,
        why: `Trong danh sách MUA (${BASKET_SHORT[p.basket] || p.basket}) – mục tiêu ${nf(p.weight, 1)}% vốn; vùng mua ${nf(p.zone[0])}–${nf(p.zone[1])}${p.price > p.zone[1] ? ", đặt lệnh chờ ở giá trên vùng" : ""}; cắt lỗ ${nf(p.stop)}` });
      stock += q * px * 1000; cashAfter -= q * px * 1000 * (1 + FEE_BUY / 100); if (!x) n++;
    });
    return { lines, cashAfter, expAfter: denom ? (stock / denom) * 100 : null, nAfter: n };
  }
  async function save() { pf.updated = new Date().toISOString(); const ok = await Store.put("portfolio", pf); toast(ok ? "Đã lưu và đồng bộ" : "Đã lưu trên trình duyệt này"); render(); }
  render();
}

// ================================================================ BỘ LỌC
const COLDEF = {
  symbol: ["Mã", "sym"], name: ["Tên", "name"], exchange: ["Sàn", "l"], sector: ["Ngành", "l"], industry: ["Nhóm ngành", "l"], subindustry: ["Ngành cấp 4", "l"],
  price: ["Giá", "x2"], spk: ["30 phiên", "spk"], chg1d: ["Hôm nay", "pct"], chg1w: ["1 tuần", "pct"], chg1m: ["1 tháng", "pct"], chg3m: ["3 tháng", "pct"], chg1y: ["1 năm", "pct"],
  ret_12_1_pct: ["12–1 tháng", "pct"], avg_value_bn: ["GTGD/ngày", "x1"], mcap_bn: ["Vốn hoá", "bn"],
  composite: ["Điểm", "score"], upside: ["Tiềm năng", "pct"], fair: ["Hợp lý", "x2"], buy_below: ["Mua dưới", "x2"], verdict: ["Định giá", "l"],
  pe: ["P/E", "pe"], pe_ind: ["P/E ngành", "x1"], pe_vs_ind: ["P/E vs ngành", "vs"], pe_vs_mkt: ["P/E vs TT", "vs"], pb: ["P/B", "x2"], pb_ind: ["P/B ngành", "x2"], pb_vs_ind: ["P/B vs ngành", "vs"], ps: ["P/S", "x2"], ev_ebitda: ["EV/EBITDA", "x1"], earnings_yield: ["LS lợi nhuận", "p1"], fcf_yield: ["LS FCF", "p1"],
  roe: ["ROE", "p1"], roe_avg5: ["ROE TB5", "p1"], roa: ["ROA", "p1"], roic: ["ROIC", "p1"], gross_margin: ["Biên gộp", "p1"], net_margin: ["Biên ròng", "p1"], cfo_ni: ["CFO/LN", "x2"], de: ["Vay/Vốn", "x2"],
  fscore: ["F-Score", "i"], rev_yoy: ["DT 12T", "pct"], ni_yoy: ["LN 12T", "pct"], rev_q_yoy: ["DT quý", "pct"], ni_q_yoy: ["LN quý", "pct"], rev_cagr3: ["DT CAGR3", "pct"], ni_cagr3: ["LN CAGR3", "pct"],
  ni_growth_streak: ["Quý LN tăng", "i"], eps: ["EPS (đ)", "i"], bvps: ["BVPS (đ)", "i"], div_yield: ["Cổ tức", "p1"], payout_pct: ["Tỷ lệ chi trả", "p0"], cash_years: ["Năm trả TM", "i"],
  ta_score: ["Điểm KT", "i"], ta_label: ["Kỹ thuật", "l"], trend: ["Xu hướng", "trend"], rsi: ["RSI", "i"], from_hi52: ["Cách đỉnh 52T", "pct"], beta: ["Beta", "x2"], vol_1y_pct: ["Biến động", "p0"],
  rs_rating: ["RS", "i"], tf_d: ["Khung ngày", "tf"], tf_w: ["Khung tuần", "tf"], tf_m: ["Khung tháng", "tf"], tf_q: ["Khung quý", "tf"], mtf_align: ["Đồng thuận", "bias"], fb_total: ["Điểm tổng (TL+QK)", "score"], fb_fwd: ["Điểm tương lai", "score"], fb_back: ["Điểm quá khứ", "score"], fb_w: ["Trọng số tương lai", "w"], ss1_mean: ["Ngày này +1 tháng", "pct"], ss1_rel: ["So VN-Index +1 tháng", "pct"], ss1_hit: ["% năm hơn VNI", "p0"], ss_n: ["Số năm", "i"], canslim_flags: ["CANSLIM đạt", "l"], ind_rank: ["Hạng ngành", "rank"],
  smc: ["SMC", "score"], smc_bias: ["SMC hướng", "bias"], smc_zone: ["Vị trí P/D", "zone"], vsa: ["VSA", "score"], vsa_bias: ["VSA hướng", "bias"], wyckoff_ev: ["Wyckoff", "score"], wy_phase: ["Pha Wyckoff", "wy"],
  orderflow: ["Order Flow", "score"], of_bias: ["OF hướng", "bias"], of_delta5: ["Delta 5 phiên", "dp"],
  piotroski: ["Piotroski", "score"], magic_formula: ["Magic F.", "score"], value: ["Giá trị", "score"], quality: ["Chất lượng", "score"], growth: ["Tăng trưởng", "score"], dividend: ["Cổ tức", "score"],
  momentum: ["Động lượng", "score"], canslim: ["CANSLIM", "score"], low_vol: ["Ít biến động", "score"],
};
const VIEWS = {
  overview: ["Tổng quan", ["symbol", "exchange", "sector", "price", "spk", "chg1d", "chg1m", "composite", "upside", "verdict", "pe", "pe_ind", "pe_vs_ind", "pb", "roe", "ni_yoy", "fscore", "div_yield", "ta_label", "trend", "avg_value_bn", "ind_rank"]],
  valuation: ["Định giá", ["symbol", "sector", "price", "pe", "pe_ind", "pe_vs_ind", "pe_vs_mkt", "pb", "pb_ind", "pb_vs_ind", "fair", "buy_below", "upside", "verdict", "ps", "ev_ebitda", "earnings_yield", "fcf_yield", "mcap_bn", "value", "magic_formula"]],
  quality: ["Chất lượng", ["symbol", "sector", "roe", "roe_avg5", "roa", "roic", "gross_margin", "net_margin", "cfo_ni", "de", "fscore", "quality", "piotroski", "composite"]],
  growth: ["Tăng trưởng", ["symbol", "sector", "rev_yoy", "ni_yoy", "rev_q_yoy", "ni_q_yoy", "rev_cagr3", "ni_cagr3", "ni_growth_streak", "eps", "pe", "growth", "canslim", "canslim_flags"]],
  dividend: ["Cổ tức", ["symbol", "sector", "price", "div_yield", "payout_pct", "cash_years", "fcf_yield", "de", "fscore", "roe", "dividend", "upside"]],
  tech: ["Kỹ thuật", ["symbol", "price", "spk", "chg1d", "chg1w", "chg1m", "chg3m", "chg1y", "ret_12_1_pct", "rsi", "from_hi52", "beta", "vol_1y_pct", "ta_score", "ta_label", "trend", "rs_rating", "momentum", "avg_value_bn"]],
  smart: ["Tạo lập & dòng tiền", ["symbol", "sector", "price", "chg1m", "smc", "smc_bias", "smc_zone", "vsa", "vsa_bias", "wyckoff_ev", "wy_phase", "orderflow", "of_bias", "of_delta5", "ta_label", "trend"]],
  season: ["Mùa vụ", ["symbol", "sector", "price", "spk", "chg1m", "ss1_mean", "ss1_rel", "ss1_hit", "ss_n", "tf_w", "tf_m", "composite", "ni_yoy", "trend"]],
  fb: ["Tương lai / quá khứ", ["symbol", "sector", "price", "spk", "chg1m", "fb_total", "fb_fwd", "fb_back", "fb_w", "pe", "pe_ind", "roe", "ni_yoy", "composite", "trend"]],
  mtf: ["Đa khung", ["symbol", "sector", "price", "spk", "chg1d", "chg1m", "chg1y", "tf_d", "tf_w", "tf_m", "tf_q", "mtf_align", "ta_label", "rsi", "from_hi52", "composite"]],
  methods: ["Điểm phương pháp", ["symbol", "sector", "composite", "piotroski", "magic_formula", "value", "quality", "growth", "dividend", "momentum", "canslim", "low_vol", "smc", "vsa", "wyckoff_ev", "orderflow"]],
};
const HLC = new Set(["pe", "pe_ind", "pe_vs_ind", "pe_vs_mkt"]);
const METHOD_REL = { smc: "SMC – tổng hợp", vsa: "VSA – tổng hợp", wyckoff_ev: "Wyckoff – sự kiện (SC/Spring/SOS/UTAD…)" };
function fmtCol(r, k) {
  const f = (COLDEF[k] || ["", "l"])[1], v = k === "composite" && r._score != null ? r._score : r[k];
  if (f === "sym") return `<a href="#/s/${v}" title="${esc(r.name || "")}">${v}</a>${WL.has(v) ? ' <span class="wstar" title="đang theo dõi">★</span>' : ""}`;
  if (f === "score") return scoreCell(v);
  if (f === "vs") return vsCell(v);
  if (f === "spk") return mini(v, { w: 64, h: 18 });
  if (f === "pe") return isNum(v) ? `<b>${nf(v, 1)}</b>` : "—";
  if (f === "pct") return `<span class="${cls(v)}">${pct(v)}</span>`;
  if (f === "p1") return isNum(v) ? nf(v, 1) + "%" : "—";
  if (f === "p0") return isNum(v) ? nf(v, 0) + "%" : "—";
  if (f === "i") return isNum(v) ? nf(v, 0) : "—";
  if (f === "x1") return nf(v, 1);
  if (f === "bn") return mcapFmt(v);
  if (f === "tf") return tfPill(v);
  if (f === "w") return isNum(v) ? nf(v * 100, 0) + "%" : "—";
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
  const [rows, meth, td, vr] = await Promise.all([screenerRows(), load("data/methods.json"), loadToday(), Store.get("views")]);
  await WL.load();
  const W = { ...meth.weights, ...lsGet("weights", {}) };
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  const DEF = { exch: "", sec: "", ind: "", basket: "", minVal: 3, maxPE: "", minROE: "", minF: "", minDiv: "", minUp: "", minScore: "", trend: "", text: "", sort: "composite", asc: false, view: "overview", plan: "", maxHi: "", watch: false, minSS: "" };
  const st = { ...DEF, basket: arg || "", view: lsGet("scrView", "overview") };
  const planSet = (k) => new Set(k === "any" ? STYLE_ORDER.flatMap((x) => (td.styles?.[x]?.picks || []).map((p) => p.symbol)) : (td.styles?.[k]?.picks || td.plan?.picks || []).map((p) => p.symbol));
  const SPRE = [
    ["Đang trong danh sách MUA", { plan: "any", view: "overview" }], ["Rẻ + chất lượng", { maxPE: 12, minROE: 15, minF: 6, view: "valuation", sort: "upside" }],
    ["Cổ tức cao, bền", { minDiv: 6, minF: 5, view: "dividend", sort: "div_yield" }], ["Tăng trưởng mạnh", { minROE: 12, view: "growth", sort: "ni_yoy", trend: "notdown" }],
    ["Giảm sâu, cơ bản tốt", { maxHi: -30, minF: 6, view: "valuation", sort: "upside" }], ["Tăng đồng thuận mọi khung", { trend: "mtfup", view: "mtf", sort: "mtf_align" }], ["Vào mùa từ hôm nay (≥ 75% số năm)", { view: "season", sort: "ss1_rel", minSS: 75 }], ["Điểm tổng tương lai + quá khứ cao", { view: "fb", sort: "fb_total" }], ["Xu hướng tháng tăng, ngày điều chỉnh", { trend: "mtfdip", view: "mtf", sort: "tf_m" }], ["Xu hướng tăng, điểm cao", { trend: "up", minScore: 60, view: "tech", sort: "composite" }],
    ["Dòng tiền thông minh", { view: "smart", sort: "smc", minVal: 5 }], ["Mã tôi theo dõi", { watch: true, minVal: 0 }]];
  const saved = (vr.data && Array.isArray(vr.data.screener)) ? vr.data.screener : [];
  const sel = new Set();
  const ps = meth.pattern_stats || {};
  app().innerHTML = `
  <div class="ph"><h1>Bộ lọc & phương pháp chọn mã</h1>${mktPill(SECS?.market)}<span class="meta"><a href="#/guide">giải thích các phương pháp</a></span></div>
  <div class="views" id="sv"></div>
  <section class="panel"><div class="filters">
    <div class="field w140"><label>Kế hoạch</label><select id="fPl"><option value="">Mọi mã</option><option value="any">Trong danh sách MUA</option>${STYLE_ORDER.map((k) => `<option value="${k}">MUA · ${STYLE_SHORT[k]}</option>`).join("")}</select></div>
    <div class="field w140"><label>Rổ</label><select id="fB"><option value="">Tất cả mã</option>${Object.entries(meth.baskets).map(([k, b]) => `<option value="${k}" ${st.basket === k ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
    <div class="field w90"><label>Sàn</label><select id="fE"><option value="">Cả 3 sàn</option><option>HOSE</option><option>HNX</option><option>UPCOM</option></select></div>
    <div class="field w200"><label>Ngành</label><select id="fS"><option value="">Tất cả ngành</option>${sectors.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
    <div class="field w200"><label>Nhóm ngành</label><select id="fI"><option value="">Tất cả</option></select></div>
    <div class="field w90"><label>Xu hướng</label><select id="fTr"><option value="">Mọi</option><option value="up">Tăng</option><option value="side">Đi ngang</option><option value="down">Giảm</option><option value="notdown">Không giảm</option><option value="mtfup">Tăng mọi khung (ngày/tuần/tháng)</option><option value="mtfdip">Tháng tăng, ngày điều chỉnh</option><option value="mtfconf">Các khung mâu thuẫn</option></select></div>
    <div class="field w140"><label>Tìm mã / tên</label><input id="fT" placeholder="ví dụ thép"></div>
    <div class="field w60"><label>GTGD ≥ tỷ</label><input id="fV" inputmode="decimal" value="3"></div>
    <div class="field w60"><label>P/E ≤</label><input id="fPE" inputmode="decimal"></div>
    <div class="field w60"><label>ROE ≥ %</label><input id="fR" inputmode="decimal"></div>
    <div class="field w60"><label>F-Score ≥</label><input id="fF" inputmode="numeric"></div>
    <div class="field w60"><label>Cổ tức ≥ %</label><input id="fD" inputmode="decimal"></div>
    <div class="field w60"><label>Tiềm năng ≥ %</label><input id="fU" inputmode="decimal"></div>
    <div class="field w60"><label>Điểm ≥</label><input id="fSc" inputmode="decimal"></div>
    <div class="field w60"><label title="Giá cách đỉnh 52 tuần">Cách đỉnh ≤ %</label><input id="fH" inputmode="decimal" placeholder="-30"></div>
    <label style="display:flex;gap:5px;align-items:center;font-size:.8rem"><input type="checkbox" id="fW"> Chỉ mã theo dõi ★</label>
    <button class="btn" id="fClear">Xoá lọc</button>
  </div><p class="muted" id="bRule" style="margin-top:6px;font-size:.78rem"></p></section>
  <div class="views" id="views">${Object.entries(VIEWS).map(([k, [n]]) => `<button data-v="${k}" class="${k === st.view ? "on" : ""}">${esc(n)}</button>`).join("")}
    <span style="margin-left:auto;display:flex;gap:6px;align-items:center"><small id="cnt" class="muted"></small><button class="btn" id="toGroup" title="Lưu các mã đang lọc thành một nhóm để chạy phương án ở tab Ngành">Lưu thành nhóm</button><button class="btn" id="csv">Tải CSV</button></span></div>
  <section class="panel flush"><div class="tw tall"><table id="scr"></table></div></section>
  <div class="selbar" id="selbar" hidden><b id="selN"></b><button class="btn primary" id="selCmp">So sánh</button><button class="btn" id="selWl">★ Theo dõi tất cả</button><button class="btn" id="selClr">Bỏ chọn</button></div>
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
    const PL = st.plan ? planSet(st.plan) : null, maxH = num(st.maxHi);
    filtered = rows.filter((r) => (!st.exch || r.exchange === st.exch) && (!st.sec || r.sector === st.sec) && (!st.ind || r.industry === st.ind) && (!st.basket || r["in_" + st.basket] === true)
      && (!st.trend || (st.trend === "notdown" ? r.trend !== "down" : st.trend === "mtfup" ? r.tf_d >= 0.35 && r.tf_w >= 0.35 && r.tf_m >= 0.35
        : st.trend === "mtfdip" ? r.tf_m >= 0.35 && r.tf_d <= -0.2 : st.trend === "mtfconf" ? r.mtf_conflict === true : r.trend === st.trend))
      && (minVal == null || (r.avg_value_bn ?? 0) >= minVal) && (maxPE == null || (isNum(r.pe) && r.pe > 0 && r.pe <= maxPE))
      && (minR == null || (r.roe ?? -1e9) >= minR) && (minF == null || (r.fscore ?? -1) >= minF) && (minD == null || (r.div_yield ?? 0) >= minD)
      && (minU == null || (r.upside ?? -1e9) >= minU) && (minS == null || (r._score ?? -1) >= minS)
      && (!num(st.minSS) || ((r.ss1_hit ?? 0) >= num(st.minSS) && (r.ss_n ?? 0) >= 8 && (r.ss1_rel ?? 0) >= 3))
      && (!PL || PL.has(r.symbol)) && (maxH == null || (isNum(r.from_hi52) && r.from_hi52 <= maxH)) && (!st.watch || WL.has(r.symbol))
      && (!txt || r.symbol.toLowerCase().includes(txt) || String(r.name || "").toLowerCase().includes(txt) || String(r.industry || "").toLowerCase().includes(txt) || String(r.sector || "").toLowerCase().includes(txt)));
    const k = st.sort === "composite" ? "_score" : st.sort;
    filtered.sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (st.asc ? 1 : -1); });
    const cols = VIEWS[st.view][1];
    $("#cnt").textContent = `${filtered.length} mã${filtered.length > 500 ? " (hiện 500)" : ""}`;
    $("#scr").innerHTML = `<thead><tr><th class="cb"><input type="checkbox" id="selAll" aria-label="Chọn tất cả"></th>${cols.map((c) => { const f = COLDEF[c][1]; return `<th data-k="${c}" class="${HLC.has(c) ? "hlc " : ""}${f === "sym" ? "sym" : ["l", "trend", "wy"].includes(f) ? "l" : ""} ${st.sort === c ? "sorted" + (st.asc ? " asc" : "") : ""}">${esc(COLDEF[c][0])}</th>`; }).join("")}</tr></thead>
      <tbody>${filtered.slice(0, 500).map((r) => `<tr class="${sel.has(r.symbol) ? "hl" : ""}"><td class="cb"><input type="checkbox" data-sel="${r.symbol}" ${sel.has(r.symbol) ? "checked" : ""} aria-label="Chọn ${r.symbol}"></td>${cols.map((c) => { const f = COLDEF[c][1]; return `<td class="${HLC.has(c) ? "hlc " : ""}${f === "sym" ? "sym" : ["l", "trend", "wy"].includes(f) ? "l" : ""}">${fmtCol(r, c)}</td>`; }).join("")}</tr>`).join("")}</tbody>`;
    $$("#scr th").forEach((th) => (th.onclick = () => { if (st.sort === th.dataset.k) st.asc = !st.asc; else { st.sort = th.dataset.k; st.asc = ["pe", "pb", "ps", "ev_ebitda", "de", "beta", "vol_1y_pct", "symbol", "ind_rank", "pe_vs_ind", "pe_vs_mkt", "pb_vs_ind", "pe_ind", "pb_ind"].includes(th.dataset.k); } draw(); }));
    const b = meth.baskets[st.basket];
    $("#bRule").innerHTML = b ? `<b>Điều kiện rổ ${esc(b.name)}</b> (rủi ro ${esc(b.risk)}): ${esc(b.rule)}` : (st.sec ? `Muốn xếp hạng sâu trong ngành ${esc(st.sec)} theo từng phương án? <a href="#/sector/${enc(st.ind || st.sec)}${st.ind ? "/l3" : ""}">Mở trang Ngành</a>.` : "");
  };
  const selUI = () => { $("#selbar").hidden = !sel.size; $("#selN").textContent = `Đã chọn ${sel.size} mã`; $("#selCmp").disabled = sel.size < 2 || sel.size > 4; $("#selCmp").textContent = sel.size > 4 ? "So sánh (tối đa 4)" : "So sánh"; };
  $("#scr").addEventListener("change", (e) => {
    const x = e.target;
    if (x.id === "selAll") { filtered.slice(0, 500).forEach((r) => (x.checked ? sel.add(r.symbol) : sel.delete(r.symbol))); draw(); }
    else if (x.dataset.sel) { x.checked ? sel.add(x.dataset.sel) : sel.delete(x.dataset.sel); x.closest("tr").classList.toggle("hl", x.checked); }
    selUI();
  });
  $("#selCmp").onclick = () => { const L = [...sel].slice(0, 4); lsSet("cmp", L); location.hash = `#/compare/${L.join(",")}`; };
  $("#selWl").onclick = async () => { await WL.load(); for (const s of sel) if (!WL.has(s)) WL.data.items.unshift({ symbol: s, added: new Date().toISOString().slice(0, 10), note: "", alerts: [], price0: rows.find((r) => r.symbol === s)?.price }); const ok = await WL.save(); toast(`Đã theo dõi ${sel.size} mã` + (ok ? "" : " (trên trình duyệt này)")); draw(); };
  $("#selClr").onclick = () => { sel.clear(); draw(); selUI(); };
  const IDS = { basket: "#fB", exch: "#fE", sec: "#fS", ind: "#fI", trend: "#fTr", text: "#fT", minVal: "#fV", maxPE: "#fPE", minROE: "#fR", minF: "#fF", minDiv: "#fD", minUp: "#fU", minScore: "#fSc", plan: "#fPl", maxHi: "#fH" };
  const applyState = (o) => {
    Object.assign(st, DEF, o);
    Object.entries(IDS).forEach(([k, id]) => { if (k === "ind") return; $(id).value = st[k] ?? ""; });
    fillInd(); $("#fI").value = st.ind || ""; $("#fW").checked = !!st.watch;
    $$("#views [data-v]").forEach((x) => x.classList.toggle("on", x.dataset.v === st.view)); lsSet("scrView", st.view);
    draw();
  };
  const drawSv = () => {
    $("#sv").innerHTML = `<small class="muted" style="align-self:center">Bộ lọc mẫu:</small>${SPRE.map(([n], i) => `<button data-pre="${i}">${esc(n)}</button>`).join("")}
      ${saved.length ? `<small class="muted" style="align-self:center;margin-left:8px">Đã lưu:</small>${saved.map((v, i) => `<button data-svv="${i}" class="svd">${esc(v.name)} <span data-svx="${i}" title="Xoá">✕</span></button>`).join("")}` : ""}
      <button id="svSave" class="svs">＋ Lưu bộ lọc hiện tại</button>`;
    $$("[data-pre]").forEach((b) => (b.onclick = () => { applyState(SPRE[Number(b.dataset.pre)][1]); $$("#sv button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $$("[data-svv]").forEach((b) => (b.onclick = async (e) => {
      if (e.target.dataset.svx !== undefined) { saved.splice(Number(e.target.dataset.svx), 1); await Store.put("views", { ...(vr.data || {}), screener: saved }); drawSv(); toast("Đã xoá bộ lọc"); return; }
      const v = saved[Number(b.dataset.svv)]; applyState(v.st); if (v.w) { Object.assign(W, v.w); } $$("#sv button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $("#svSave").onclick = () => {
      $("#svSave").outerHTML = `<span class="svform"><input id="svName" placeholder="Tên bộ lọc, vd: Thép rẻ" style="width:170px"><button class="btn primary" id="svOk">Lưu</button></span>`;
      $("#svName").focus();
      const go = async () => { const n = $("#svName").value.trim(); if (!n) { toast("Đặt tên cho bộ lọc"); return; } saved.push({ name: n, st: { ...st }, w: { ...W } }); const ok = await Store.put("views", { ...(vr.data || {}), screener: saved }); toast(ok ? "Đã lưu bộ lọc" : "Đã lưu bộ lọc trên trình duyệt này"); drawSv(); };
      $("#svOk").onclick = go; $("#svName").onkeydown = (e) => { if (e.key === "Enter") go(); };
    };
  };
  drawSv();
  $("#fW").onchange = (e) => { st.watch = e.target.checked; draw(); };
  $$("input[data-w]").forEach((el) => (el.oninput = () => { W[el.dataset.w] = Number(el.value); $("#wo_" + el.dataset.w).textContent = el.value; lsSet("weights", W); draw(); }));
  $("#wReset").onclick = () => { Object.assign(W, meth.weights); try { localStorage.removeItem("vnstock_weights"); } catch (e) { /* bỏ qua */ } viewScreener(st.basket); };
  const bind = (id, key, after) => ($(id).oninput = () => { st[key] = $(id).value; if (after) after(); draw(); });
  bind("#fB", "basket"); bind("#fE", "exch"); bind("#fS", "sec", () => { st.ind = ""; fillInd(); }); bind("#fI", "ind"); bind("#fTr", "trend"); bind("#fT", "text"); bind("#fV", "minVal");
  bind("#fPE", "maxPE"); bind("#fR", "minROE"); bind("#fF", "minF"); bind("#fD", "minDiv"); bind("#fU", "minUp"); bind("#fSc", "minScore"); bind("#fPl", "plan"); bind("#fH", "maxHi");
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
  const [b, meth, t, secs, F, SB] = await Promise.all([load("data/backtest.json"), load("data/methods.json"), loadToday(), tryLoad("data/sectors.json"), tryLoad("data/fwd.json"), tryLoad("data/styles_bt.json")]);
  const SBs = SB;
  if (!b.ok) { app().innerHTML = `<h1>Kiểm chứng</h1><div class="empty">${esc(b.reason || "Backtest chưa chạy – sẽ có sau lượt chạy cuối tuần.")}</div>`; return; }
  const series = [["combo", b.combo, css("--brand")], ["combo_regime", b.combo_regime, css("--up")], ["bench", b.benchmark, css("--ink-3")]];
  const bas = Object.entries(b.baskets);
  const palette = [css("--ref"), css("--ceil"), css("--floor"), css("--down"), "#7C8A99"];
  const statRow = (name, s, c) => `<tr><td class="l"><i class="quad" style="background:${c || "transparent"}"></i>${esc(name)}</td><td class="${cls(s.cagr)}"><b>${pct(s.cagr)}</b></td><td class="down">${pct(s.max_dd)}</td><td>${nf(s.vol, 1)}%</td><td>${nf(s.sharpe)}</td><td>${s.win_years ?? "—"}/${s.n_years ?? "—"}</td><td>${s.avg_count ?? ""}</td></tr>`;
  const years = [...new Set([b.benchmark, b.combo, ...bas.map(([, v]) => v)].flatMap((s) => Object.keys(s.yearly || {})))].sort();
  const ps = meth.pattern_stats || {};
  const SECB = Object.entries(b.sectors || secs?.backtest || {}).sort((x, y) => (y[1].alpha ?? -99) - (x[1].alpha ?? -99));
  const grp = (k) => k.startsWith("SMC") ? "SMC" : k.startsWith("VSA") ? "VSA" : k.startsWith("Wyckoff") ? "Wyckoff" : ["Elliott", "Dow", "Harmonic"].includes(k) ? "Sóng" : "Mô hình giá";
  const pst = Object.entries(ps.stats || {});
  app().innerHTML = `
  ${fwdSection(F)}
  ${fbSection(await fbData())}
  ${SB ? `<section class="panel sec"><div class="ph"><h2>So sánh các phong cách đầu tư</h2><span class="meta">cùng giai đoạn, đã trừ phí · <a href="#/portfolio/profile">chọn phong cách</a></span></div>
    <div class="tw"><table data-hm="c5 c6"><thead><tr><th class="l">Phong cách</th><th>Lãi kép/năm</th><th>Sụt tối đa</th><th>Sharpe</th><th>Biến động</th><th class="l">Ghi chú</th></tr></thead><tbody>
    ${STYLE_ORDER.filter((k) => SB[k]?.ok).map((k) => { const x = SB[k]; return `<tr class="${(t.style || "position") === k ? "hl" : ""}"><td class="l"><b>${esc(STYLE_SHORT[k])}</b>${(t.style || "position") === k ? ' <span class="pill buy">đang dùng</span>' : ""}</td>
      <td class="${cls(x.cagr)}"><b>${pct(x.cagr, 1)}</b></td><td class="down">${pct(x.max_dd, 1)}</td><td>${nf(x.sharpe)}</td><td>${nf(x.vol, 0)}%</td>
      <td class="l"><small>${k === "swing" ? `${nf(x.trades_per_year, 0)} lệnh/năm · thắng ${nf(x.win_rate, 0)}% · lãi TB/lệnh ${pct(x.avg_ret, 2)} · nắm TB ${nf(x.avg_days, 0)} phiên` : k === "position" ? "rổ GARP/Tăng trưởng/Phòng thủ + đèn" : k === "long" ? "GARP/Phòng thủ/Cổ tức, không lọc xu hướng chặt, không cắt lỗ" : "Cổ tức/Phòng thủ, không cắt lỗ"}</small></td></tr>`; }).join("")}
      <tr class="mk"><td class="l">VN-Index</td><td class="${cls(b.benchmark?.cagr)}">${pct(b.benchmark?.cagr, 1)}</td><td class="down">${pct(b.benchmark?.max_dd, 1)}</td><td>${nf(b.benchmark?.sharpe)}</td><td>${nf(b.benchmark?.vol, 0)}%</td><td></td></tr></tbody></table></div>
    <div class="chart sm sec" id="styChart"></div><div class="leg">${STYLE_ORDER.filter((k) => SB[k]?.curve).map((k, i) => `<span><i style="background:var(--a${i})"></i>${STYLE_SHORT[k]}</span>`).join("")}<span><i style="background:var(--ink-3)"></i>VN-Index</span></div>
    <p class="faint" style="font-size:.72rem;margin-top:4px">Lướt sóng mô phỏng theo ngày (mua giá mở cửa phiên sau tín hiệu, tôn trọng T+2, cắt lỗ/chốt lời/thoát theo thời gian); chưa dùng bộ lọc cơ bản tại thời điểm quá khứ.</p></section>` : ""}
  <div class="ph sec"><h1>Kiểm chứng bằng dữ liệu quá khứ</h1><span class="meta">${esc(b.start)} → ${esc(b.end)} · ${b.months} tháng · tái cơ cấu hằng tháng, chỉ dùng thông tin đã có tại thời điểm đó</span></div>
  ${kpis([["Hệ thống + đèn / năm", pct(b.combo_regime.cagr), cls(b.combo_regime.cagr)], ["Sụt tối đa", pct(b.combo_regime.max_dd), "down"], ["VN-Index / năm", pct(b.benchmark.cagr), cls(b.benchmark.cagr)],
    ["VN-Index sụt", pct(b.benchmark.max_dd), "down"], ["Sharpe", nf(b.combo_regime.sharpe)], ["Mục tiêu / năm", "30%"], ["Chấp nhận sụt", (t.risk?.max_drawdown_target ?? 25) + "%"]], true)}
  <div class="g sec">
    <section class="panel"><div class="ph"><h2>Tăng trưởng tài sản (thang log)</h2></div><div class="chart md" id="btChart"></div>
      <div class="leg" style="margin-top:6px">${series.map(([, s, c]) => `<span><i style="background:${c}"></i>${esc(s.name)}</span>`).join("")}
        ${bas.map(([, s], i) => `<span><i style="background:${palette[i % palette.length]}"></i>${esc(s.name)}</span>`).join("")}</div></section>
    <section class="panel flush"><div class="ph"><h2>Kết quả</h2></div><div class="tw"><table data-hm="c4 c5 c7"><thead><tr><th class="l">Chiến lược</th><th>Lãi kép/năm</th><th>Sụt tối đa</th><th>Biến động</th><th>Sharpe</th><th>Năm lãi</th><th>Số mã</th></tr></thead><tbody>
      ${statRow(b.combo.name, b.combo, css("--brand"))}${statRow(b.combo_regime.name, b.combo_regime, css("--up"))}${statRow("VN-Index", b.benchmark, css("--ink-3"))}
      ${bas.map(([, s], i) => statRow("Rổ " + s.name, s, palette[i % palette.length])).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.74rem;padding:6px 12px">So hai dòng đầu với mục tiêu 30%/năm để biết kỳ vọng thực tế.</p></section>
  </div>
  <section class="panel flush sec"><div class="ph"><h2>Từng năm</h2></div><div class="tw"><table><thead><tr><th class="l">Chiến lược</th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
    ${[[b.combo.name, b.combo], [b.combo_regime.name, b.combo_regime], ["VN-Index", b.benchmark], ...bas.map(([, s]) => [s.name, s])].map(([n, s]) =>
      `<tr><td class="l">${esc(n)}</td>${years.map((y) => `<td class="${cls(s.yearly?.[y])}">${pct(s.yearly?.[y], 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>
  <div class="g g2 sec">
    <section class="panel flush"><div class="ph"><h2>Chọn mã trong từng ngành</h2><span class="meta">top 3 "Tốt nhất ngành" vs mua đều cả ngành</span></div>
      ${SECB.length ? `<div class="tw"><table><thead><tr><th class="l">Ngành</th><th>Top 3/năm</th><th>Cả ngành/năm</th><th>Alpha</th><th>Sụt top 3</th><th>Số mã</th><th class="l">Chọn gần nhất</th></tr></thead><tbody>
        ${SECB.map(([n, s]) => `<tr><td class="l"><a href="#/sector/${enc(n)}">${esc(n)}</a></td><td class="${cls(s.top?.cagr)}">${pct(s.top?.cagr)}</td><td class="${cls(s.all?.cagr)}">${pct(s.all?.cagr)}</td>
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
  drawFwd(F);
  if (SB && $("#styChart")) {
    const c2 = mkChart($("#styChart"), { rightPriceScale: { mode: 1, borderColor: css("--line") } });
    STYLE_ORDER.filter((k) => SB[k]?.curve).forEach((k, i) => c2.addLineSeries({ color: css("--a" + i) || css("--brand"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false }).setData(SB[k].curve.map((p) => ({ time: p.d, value: p.v }))));
    c2.addLineSeries({ color: css("--ink-3"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false }).setData(b.benchmark.curve.map((p) => ({ time: p.d, value: p.v })));
    c2.timeScale().fitContent();
  }
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
  const [rows, secs] = await Promise.all([screenerRows(), secsData()]);
  try { d = await load(`data/stocks/${sym}.json`); }
  catch (e) {
    const r = rows.find((x) => x.symbol === sym);
    app().innerHTML = r ? `<div class="ph"><h1>${sym}</h1><span class="meta">${esc(r.exchange)} · ${esc(r.sector || "")}</span></div><div class="panel"><p>${esc(r.name)} – thanh khoản quá thấp (${nf(r.avg_value_bn, 2)} tỷ/ngày) nên hệ thống không phân tích sâu.</p>
      ${kpis([["Giá", nf(r.price)], ["P/E", nf(r.pe, 1)], ["P/B", nf(r.pb)], ["ROE", pct(r.roe, 1, false)], ["Cổ tức", pct(r.div_yield, 1, false)], ["Vốn hoá", mcapFmt(r.mcap_bn)]])}</div>`
      : `<div class="empty">Không tìm thấy mã ${esc(sym)}.</div>`;
    return;
  }
  recentAdd(sym); await WL.load();
  if (d._locked) {   // gói Miễn phí: các phần chuyên sâu đã được lược khỏi dữ liệu
    d.style_levels = {}; d.waves = {}; d.levels = null; d.timing = null; d.in_plan = false; d.mtf = null; d.season = null; d.season_support = null; d.fb = null; d.swing = null; d.rel = null;
  }
  const [pfS, tS, evS, FJ, LV, FLJ] = await Promise.all([Store.get("portfolio"), loadToday(), tryLoad("data/events.json"), fbData(), liveData(), tryLoad("data/flow.json")]);
  const held = (pfS.data?.holdings || []).some((h) => h.symbol === sym);
  window.__pf = pfS.data || {}; window.__risk = tS.risk || {};
  const stepsBlock = d._locked ? lockBox("stock_full", "Kết luận & việc nên làm từng bước").replace("panel lockp", "panel sec steps lockp") : (() => { try { return stepsHtml(stepsFor(d, { t: tS, pf: pfS.data || {}, ev: evS })); } catch (e) { console.warn(e); return ""; } })();
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
    <div class="px ${boardCls(chg, d.exchange)}">${nf(last)}</div><div class="${boardCls(chg, d.exchange)} pxc">${arrow(boardCls(chg, d.exchange))} ${pct(chg, 2)}</div>
    <div class="tags" style="margin-left:auto">${d.in_plan ? '<span class="pill buy">Trong danh sách MUA</span>' : ""}${(d.baskets || []).map((b) => `<span class="pill brand">${esc(BASKET_SHORT[b] || b)}</span>`).join("")}
      <span class="pill ${r.trend === "up" ? "buy" : r.trend === "down" ? "sell" : ""}">Xu hướng ${TREND_VI[r.trend] || "—"}</span>
      ${secRec ? `<span class="pill" title="Vị trí ngành trên biểu đồ xoay vòng"><span class="quad" style="background:${qcol(secRec.quadrant)}"></span>Ngành ${esc(secRec.quadrant)}</span>` : ""}
      ${isNum(r.ind_rank) ? `<span class="pill">Hạng ${nf(r.ind_rank, 0)}/${r.ind_n} trong ngành</span>` : ""}</div>
    <div style="flex-basis:100%">${actBar(sym, { label: true, held })}</div>
  </div>
  ${(() => { const C = ctxRecs(secs || {}, d.sector, d.industry), b = C.ind || C.sec || {}, M = C.mkt || {}, pe0 = fa.pe ?? r.pe, pb0 = fa.pb ?? r.pb;
    const g = (t, meta, items) => `<section class="panel sg"><div class="ph"><h3>${t}</h3><span class="meta">${meta}</span></div>${kpis(items, false, "c3")}</section>`;
    return `<div class="snap">${g("Định giá", "so với ngành · thị trường", [
      ["P/E", `${nf(pe0, 1)} <small>ngành ${nf(b.pe_med, 1)} · TT ${nf(M.pe_med, 1)}</small>`, "", "So với P/E trung vị nhóm ngành và toàn thị trường", "hl"],
      ["P/E vs ngành / TT", `${vsCell(vsPct(pe0, b.pe_med))} <small>${vsCell(vsPct(pe0, M.pe_med))} vs TT</small>`, "", "", "hl"],
      ["P/B", `${nf(pb0)} <small>ngành ${nf(b.pb_med)} · TT ${nf(M.pb_med)}</small>`, "", "", "hl"],
      ["EPS (đ)", nf(fa.eps ?? r.eps, 0)], ["Cổ tức", pct(fa.dividend?.yield ?? r.div_yield, 1, false)],
      ["Tiềm năng", v.ok ? `${pct(v.upside)} <small>hợp lý ${nf(v.fair)}</small>` : "—", cls(v.upside)]])}
    ${g("Kinh doanh & sức khoẻ", "12 tháng gần nhất", [["ROE", pct(fa.roe ?? r.roe, 1, false)], ["LN 12T", pct(fa.ni_yoy ?? r.ni_yoy), cls(fa.ni_yoy ?? r.ni_yoy)],
      ["DT 12T", pct(fa.rev_yoy ?? r.rev_yoy), cls(fa.rev_yoy ?? r.rev_yoy)], ["F-Score", `${r.fscore ?? "—"}/9`], ["Vay/Vốn", nf(fa.de ?? r.de)], ["Vốn hoá", mcapFmt(fa.mcap_bn ?? r.mcap_bn)]])}
    ${g("Giá & thanh khoản", "đà giá, sức mạnh, rủi ro", [["1 tháng", pct(r.chg1m), cls(r.chg1m)], ["1 năm", pct(r.chg1y), cls(r.chg1y)], ["Cách đỉnh 52T", pct(ta.from_hi52_pct), "down"],
      ["RS", `${sc.rs_rating ?? r.rs_rating ?? "—"}/100`], ["GTGD/ngày", bn(r.avg_value_bn)], ["Beta", nf(d.beta)]])}</div>`; })()}
  ${eventBox(v, sym)}
  <div class="g g-dec sec fbrow">
    <div class="stack">${fbPanel(d, FJ).replace('panel sec fbp', 'panel fbp')}${stepsBlock.replace('panel sec steps', 'panel steps')}</div>
    <div class="stack">
      ${styleLevels(d)}
      <section class="panel" id="planPos" hidden><div class="ph"><h2>Kế hoạch giao dịch</h2><span class="meta">${d.timing?.ok ? '<b class="up">đủ điều kiện kỹ thuật</b>' : '<b class="ref">chưa đến lúc</b>'}</span></div>
        ${lv ? kpis([["Vùng mua", `${nf(lv.zone[0])}–${nf(lv.zone[1])}`], ["Cắt lỗ", `${nf(lv.stop)} <small>${pct(lv.stop_pct, 0)}</small>`, "down"], ["Mục tiêu 1", `${nf(lv.t1)} <small>${pct(lv.t1_pct, 0)}</small>`, "up"], ["Mục tiêu 2", nf(lv.t2), "up"], ["Lời / lỗ", nf(lv.rr, 1) + "x"], ["Trạng thái", entryState(d, lv).t]], false, "c2")
          : `<p class="muted">Chưa có kế hoạch (thiếu định giá hoặc kỹ thuật).</p>`}
        ${d.timing && !d.timing.ok ? `<p class="note" style="margin-top:6px">${esc(d.timing.reason)}</p>` : ""}</section>
      <section class="panel"><div class="ph"><h2>Định giá: ${esc(v.verdict || "chưa định giá được")}</h2><span class="meta">điểm ${scoreCell(r.composite)}</span></div>
        ${v.ok ? kpis([["Hợp lý", nf(v.fair)], ["Khoảng", `${nf(v.fair_lo)}–${nf(v.fair_hi)}`], ["Mua dưới", nf(v.buy_below)], ["Tiềm năng", pct(v.upside), cls(v.upside)]], false, "c2") : `<p class="muted">${esc(v.reason || "")}</p>`}
        ${normNote(v)}
        ${v.warning ? `<p class="note" style="margin-top:6px">${esc(v.warning)}</p>` : ""}</section>
      ${valCtx(d, secs || {})}
    </div>
    <div class="stack">${(() => { const C = ctxRecs(secs || {}, d.sector, d.industry), x = C.ind?.outlook ? C.ind : C.sec; return x ? outlookBox(x, `Triển vọng ngành ${esc(x.name)}`) : ""; })()}
      ${seasonPanel(d.season, d.season_support, { oos: secs?.season?.oos?.stock })}</div>
  </div>
  <div class="g g-main sec">
    <div>
      <div class="toolbar" id="tools"></div>
      <div class="chart" id="pChart"></div>
      <div class="chart xs" id="oChart" style="margin-top:4px"></div>
    </div>
    <div class="stack">
      <section class="panel"><div class="ph"><h2>Kỹ thuật: ${esc(ta.label)}</h2><span class="meta">${ta.score}/100</span></div><div class="gauge"><i style="left:${ta.score}%"></i></div>
        ${kpis(Object.entries(ta.groups || {}).map(([g, s]) => [esc(g), `${esc(s.signal)} <small>${s.score}</small>`, s.signal === "Mua" ? "up" : s.signal === "Bán" ? "down" : ""]))}
        <p class="muted" style="font-size:.78rem;margin-top:4px">${esc(ta.trend_vi)}</p></section>
      ${mtfPanel(d.mtf, "Đa khung thời gian", returnsTable(TFO_M(d)))}
    </div>
  </div>
  <div class="g g-main sec sigrow"><div class="stack">${recentSignals(d).replace('panel sec', 'panel')}</div>
    <div class="stack">
      ${swingPanel(d.swing, LV, sym, FLJ)}
      <section class="panel"><div class="ph"><h2>Dấu chân tổ chức</h2><a class="meta" href="#/s/${sym}/sm">chi tiết</a></div>
        <dl class="kv"><dt>SMC</dt><dd>${sm.ok ? `${esc(sm.trend_vi)} ${biasPill(sm.bias, " ")}` : "—"}</dd>
          <dt>Premium/Discount</dt><dd>${sm.range ? esc(sm.range.zone.split(" (")[0]) + ` <small>${nf(sm.range.pos_pct, 0)}%</small>` : "—"}</dd>
          <dt>VSA</dt><dd>${vs.ok ? biasPill(vs.bias) : "—"}</dd>
          <dt>Wyckoff</dt><dd style="white-space:normal">${esc(wy2.phase || "—")}</dd>
          <dt>Order Flow</dt><dd>${of.ok ? `${biasPill(of.bias)} <small>${of.days} phiên</small>` : '<small class="faint">đang tích luỹ dữ liệu</small>'}</dd></dl></section>
    </div>
  </div>
  ${d._locked ? lockBox("stock_full", "Phân tích đầy đủ mã " + sym + ": vùng mua, kế hoạch theo phong cách, sóng & SMC, hành vi giá, mã liên quan", true) : relPanel(d.rel, sym, new Set((pfS.data?.holdings || []).map((h) => h.symbol)))}
  <div class="subtabs" role="tablist">${[["ov", "Tổng quan"], ["ta", "Kỹ thuật"], ["wv", "Sóng & mô hình"], ["sm", "Tạo lập & dòng tiền"], ["fa", "Cơ bản"], ["vl", "Dự phóng & định giá"], ["pe", "Cùng ngành"]]
    .map(([k, n]) => `<button role="tab" data-t="${k}">${n}</button>`).join("")}</div>
  <div id="tab"></div>`;

  // ---- biểu đồ giá (đổi khung: ngày / tuần / tháng / quý / năm – chỉ báo tính lại trên nến của khung)
  const TFO = tfSeries(d);
  let redraw = () => {}, curCharts = [];
  const L = { lv: true, smc: false, el: false, vsa: false, wy: false };
  const drawChart = () => {
  curCharts.forEach((x) => { try { x.remove(); } catch (e) { /* đã huỷ */ } const k = charts.indexOf(x); if (k >= 0) charts.splice(k, 1); });
  curCharts = [];
  const tf = TFO[lsGet("tf", "D")] ? lsGet("tf", "D") : "D", o = TFO[tf], kf = TF_KEY[tf];
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
    const add = (time, pos, color, shape, text) => { const k = kf(time); if (tset.has(k)) M.push({ time: k, position: pos, color, shape, text }); };
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
  redraw = () => { drawLines(); cs.setMarkers(markers()); };
  $("#tools").innerHTML = tfSeg("tfSel", tf) + Object.keys(overlays).map((k) => `<button class="chip ${active.has(k) ? "on" : ""}" data-ov="${k}">${k}</button>`).join("") +
    `<span class="faint">|</span>` + [["lv", "Mức giá"], ["smc", "SMC"], ["vsa", "VSA"], ["wy", "Wyckoff"], ["el", "Elliott"]].map(([k, n]) => `<button class="chip ${L[k] ? "on" : ""}" data-l="${k}">${n}</button>`).join("") +
    `<span style="margin-left:auto" class="seg" id="osc"><button class="on" data-o="rsi">RSI</button><button data-o="macd">MACD</button><button data-o="vol">KL</button><button data-o="obv">OBV</button>${of.history?.length && tf === "D" ? '<button data-o="delta">Delta</button>' : ""}</span>`;
  Object.keys(overlays).forEach(drawOv);
  redraw();
  $$("[data-ov]").forEach((b) => (b.onclick = () => { const k = b.dataset.ov; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); drawOv(k); }));
  $$("[data-l]").forEach((b) => (b.onclick = () => { L[b.dataset.l] = !L[b.dataset.l]; b.classList.toggle("on"); redraw(); }));
  c.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - TF_VIEW[tf]), to: o.t.length + 3 });
  const oc = mkChart($("#oChart"), { timeScale: { visible: false } });
  curCharts.push(c, oc);
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
  oc.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - TF_VIEW[tf]), to: o.t.length + 3 });
  $$("#tfSel button").forEach((b) => (b.onclick = () => { lsSet("tf", b.dataset.tf); drawChart(); }));
  };
  drawChart();

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
  bindStyleLevels();
}

function normNote(v) {
  const z = v?.norm || {};
  if (!z || !isNum(z.ratio)) return "";
  if (!z.kind) return `<p class="faint" style="font-size:.74rem;margin-top:4px"><span data-g="norm_eps">Lợi nhuận 12 tháng</span> ${nf(z.ttm, 0)} tỷ, bằng ${nf(z.ratio, 2)} lần mức bình thường 5 năm (${nf(z.med, 0)} tỷ) – không cần chuẩn hoá.${isNum(z.cash_conv) ? ` Dòng tiền KD 4 quý = ${nf(z.cash_conv * 100, 0)}% lợi nhuận.` : ""}</p>`;
  return `<div class="note" style="margin-top:6px"><b data-g="norm_eps">Lợi nhuận đang ở ${z.kind === "peak" ? "đỉnh" : "đáy"} so với bình thường:</b> 12 tháng ${nf(z.ttm, 0)} tỷ = ${nf(z.ratio, 2)} lần trung vị 5 năm (${nf(z.med, 0)} tỷ)${z.spike_q ? `; riêng ${esc(z.spike_q.q)} lãi ${nf(z.spike_q.ni, 0)} tỷ, gấp ${nf(z.spike_q.ni / z.spike_q.avg4, 1)} lần TB 4 quý trước` : ""}. Giá trị hợp lý dùng lợi nhuận <b>chuẩn hoá</b> (½ hiện tại + ½ bình thường).
    <br>Mục tiêu có điều kiện: <b>${nf(z.fair_ttm)}</b> nếu lợi nhuận giữ mức 12 tháng · <b>${nf(v.fair)}</b> (đang dùng) · <b>${nf(z.fair_med)}</b> nếu về mức bình thường.${isNum(z.cash_conv) ? ` Dòng tiền KD 4 quý = <b class="${z.cash_conv < 0.5 ? "down" : ""}">${nf(z.cash_conv * 100, 0)}%</b> lợi nhuận.` : ""} Báo cáo quý tới sẽ cho biết kịch bản nào đúng.</div>`;
}
function entryState(d, lv) {
  if (!lv) return { k: "none", t: "Chưa có kế hoạch", c: "" };
  if (d.timing && !d.timing.ok) return { k: "trend", t: "Chưa đến lúc", c: "ref", why: d.timing.reason };
  if (lv.state === "wait") return { k: "wait", t: "Chờ giá", c: "ref", why: `Giá còn trên vùng mua an toàn – chờ về ${nf(lv.zone[0])}–${nf(lv.zone[1])}` };
  if (lv.no_val && !d.in_plan) return { k: "noval", t: "Chưa định giá được", c: "ref", why: "Không đủ số liệu định giá đáng tin – chỉ mua nếu mã vào danh sách MUA của rổ đã kiểm chứng" };
  if (!d.in_plan) return { k: "notplan", t: "Đạt giá – ngoài danh sách MUA", c: "ref", why: "Giá và xu hướng đạt nhưng mã không được chọn vào danh sách MUA (rổ của mã không được phân bổ vốn, đã đủ số mã, vượt trần ngành hoặc đèn thị trường) – chỉ theo dõi" };
  if (lv.ext) return { k: "split", t: "Mua được – chia 2 lệnh", c: "up", why: `Đang kéo giãn (giá cách EMA20 ${nf(lv.ext_atr, 1)} ATR, 1 tháng ${pct(lv.ret1m)}): mua 1/2 ngay, 1/2 đặt LO ${nf(lv.split?.lo)} trong 10 phiên` };
  return { k: "now", t: "Mua được", c: "up" };
}
// "Vào bao nhiêu?" – cùng công thức với bảng Quyết định hôm nay: giới hạn tỷ trọng / mã và rủi ro mỗi lệnh
function sizeLine(entry, stop) {
  const pf = window.__pf || {}, R = window.__risk || {}, cap = capitalOf(pf);
  if (!cap || !isNum(entry)) return `<p class="faint" style="font-size:.74rem;margin:0 0 6px">Nhập tổng vốn ở <a href="#/portfolio">Danh mục</a> để biết nên mua bao nhiêu cổ phiếu.</p>`;
  const wmax = Number(R.max_weight_per_stock ?? 20), rp = Number(R.risk_per_trade ?? 1.5);
  let q = cap * wmax / 100 / (entry * 1000), by = `tối đa ${wmax}% vốn/mã`;
  if (isNum(stop) && entry > stop) { const qr = cap * rp / 100 / ((entry - stop) * 1000); if (qr < q) { q = qr; by = `rủi ro ${rp}% vốn nếu chạm cắt lỗ`; } }
  q = lot(q);
  if (q < 100) return "";
  return `<p class="szl"><b>Vào bao nhiêu?</b> Tối đa <b>${nf(q, 0)} cp</b> ≈ ${big(q * entry * 1000)} đ (${nf(q * entry * 1000 / cap * 100, 1)}% vốn, giới hạn theo ${by})${isNum(stop) ? ` · chạm cắt lỗ mất ≈ ${big(q * (entry - stop) * 1000)} đ` : ""}. Nên chia 2 lệnh.</p>`;
}
function styleLevels(d) {
  if (d._locked) return lockBox("stock_full", "Kế hoạch giao dịch theo phong cách", true);
  const L = d.style_levels || {}, lv = d.levels, sel0 = lsGet("stockStyle", "position");
  const body = (k) => {
    if (k === "position") { const es = entryState(d, lv); return lv ? `${sizeLine(lv.zone[1], lv.stop)}${kpis([["Vùng mua", `${nf(lv.zone[0])}–${nf(lv.zone[1])}`], ["Cắt lỗ", `${nf(lv.stop)} <small>${pct(lv.stop_pct, 0)}</small>`, "down"], ["Mục tiêu 1", `${nf(lv.t1)} <small>${pct(lv.t1_pct, 0)}</small>`, "up"], ["Mục tiêu 2", nf(lv.t2), "up"], ["Lời / lỗ", nf(lv.rr, 1) + "x"], ["Trạng thái", es.t, es.c]], false, "c2")}
      ${es.why ? `<p class="note" style="margin-top:6px">${esc(es.why)}</p>` : `<p class="faint" style="font-size:.74rem;margin-top:4px">Đủ điều kiện xu hướng, giá và nằm trong danh sách MUA. Nắm 1–6 tháng, cắt lỗ tối đa 20%.</p>`}` : `<p class="muted">Chưa có kế hoạch (thiếu định giá hoặc kỹ thuật).</p>`; }
    const x = L[k] || {};
    if (x.none) return `<p class="muted">${esc(x.reason)}</p>`;
    if (k === "swing") return `${kpis([["Điểm vào", `${nf(x.zone[0])}–${nf(x.zone[1])}`], ["Cắt lỗ", `${nf(x.stop)} <small>${pct(x.stop_pct, 1)}</small>`, "down"], ["Mục tiêu 1", `${nf(x.t1)} <small>${pct(x.t1_pct, 0)}</small>`, "up"], ["Mục tiêu 2", nf(x.t2), "up"]], false, "c2")}
      <p style="font-size:.78rem;margin-top:6px"><span class="pill brand">${esc(x.setup)}</span> ${esc(x.exit_note || "")}. Hàng về T+2.</p>`;
    if (k === "long") return `${kpis([["Vùng tích luỹ", `${nf(x.zone[0])}–${nf(x.zone[1])}`], ["Trạng thái", x.state === "now" ? "Đang rẻ – mua dần" : "Chờ giá", x.state === "now" ? "up" : "ref"], ["Mua dần 3 lần", x.tranches.map((y) => nf(y)).join(" → ")], ["Xem lại luận điểm", nf(x.review), "down"], ["Giá trị hợp lý", nf(x.t1), "up"], ["Bán một phần từ", nf(x.t1 * 1.2), "up"]], false, "c2")}
      <p class="faint" style="font-size:.74rem;margin-top:4px">Không cắt lỗ theo giá – chỉ bán khi luận điểm gãy hoặc giá vượt xa giá trị.</p>`;
    if (k === "income") return `${kpis([["Cổ tức tiền mặt", `${nf(x.yield, 1)}% <small>${nf(x.dps, 0)} đ/cp</small>`, x.yield >= 6 ? "up" : ""], ["Năm trả liên tiếp", nf(x.cash_years, 0)], ["Mua khi giá ≤", `${nf(x.buy_at_6)} <small>lợi suất 6%</small>`, "up"], ["Bán khi giá ≥", `${nf(x.sell_at_35)} <small>lợi suất 3,5%</small>`]], false, "c2")}`;
    return "";
  };
  const sel = L[sel0] || sel0 === "position" ? sel0 : "position";
  return `<section class="panel"><div class="ph"><h2>Kế hoạch theo phong cách</h2><span class="seg" id="slSel">${STYLE_ORDER.map((k) => `<button data-sl="${k}" class="${k === sel ? "on" : ""}">${STYLE_SHORT[k]}</button>`).join("")}</span></div>
    <div id="slBody">${body(sel)}</div><template id="slTpl">${STYLE_ORDER.map((k) => `<div data-k="${k}">${body(k)}</div>`).join("")}</template></section>`;
}
function bindStyleLevels() {
  $$("#slSel button").forEach((b) => (b.onclick = () => { lsSet("stockStyle", b.dataset.sl); $$("#slSel button").forEach((x) => x.classList.toggle("on", x === b));
    const tpl = $("#slTpl").content.querySelector(`[data-k="${b.dataset.sl}"]`); $("#slBody").innerHTML = tpl ? tpl.innerHTML : ""; }));
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
  return `<section class="panel hlp" style="margin-bottom:10px"><div class="ph"><h2>P/E ${esc(d.symbol)} theo quý so với ngành và thị trường</h2><span class="meta">cuối mỗi quý · <a href="#/sector">toàn cảnh các ngành</a></span></div>${peHistChart(d, SECS || {})}</section>
  <div class="g g2">
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
    <section class="panel flush"><div class="tw"><table data-hm="c1"><thead><tr><th class="l">Nhóm</th><th class="l">Chỉ báo</th><th>Giá trị</th><th class="l">Tín hiệu</th><th class="l">Diễn giải</th></tr></thead><tbody>
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
  ["g1", "Tăng trưởng năm 1", "%"], ["gmid", "Tăng trưởng năm 3", "%"], ["gterm", "Tăng trưởng dài hạn", "%"], ["gm", "Biên LN gộp hiện tại", "%"], ["gm_lt", "Biên LN gộp dài hạn", "%"],
  ["sga", "Chi phí BH & QL / DT hiện tại", "%"], ["sga_lt", "Chi phí BH & QL / DT dài hạn", "%"],
  ["tax", "Thuế suất", "%"], ["payout", "Tỷ lệ chi trả cổ tức", "%"], ["conv", "Tỷ lệ LN thành tiền tự do", "%"], ["roe_cap", "ROE bình thường (ngân hàng)", "%"],
];
const base0 = (v) => v.model.base;
function tabVal(d) {
  const v = d.valuation || {};
  if (!v.ok || !v.model) return `<div class="empty">${esc(v.reason || "Không đủ số liệu để dự phóng (doanh nghiệp lỗ, vốn chủ âm hoặc thiếu BCTC).")}</div>`;
  const a = v.model.assumptions;
  return `<div class="g g-main"><div class="stack">
    ${panel("Giá trị hợp lý", `<div id="vOut"></div>`)}
    ${panel("Bảng dự phóng (kịch bản cơ sở)", `<div id="pOut"></div><p class="faint" style="margin-top:6px;font-size:.74rem">Doanh thu tăng theo giả định, giảm dần về mức dài hạn; biên lợi nhuận và chi phí theo tỷ lệ doanh thu; lợi nhuận khác giảm 20%/năm.
      Ngân hàng/CTCK/bảo hiểm dự phóng thẳng lợi nhuận. Kịch bản Xấu/Tốt điều chỉnh tăng trưởng và biên lợi nhuận.</p>`, "tỷ đồng")}</div>
    ${panel("Giả định dự phóng", `${v.model.overridden?.length ? `<p class="note">Đang dùng giả định anh đã sửa: ${esc(v.model.overridden.join(", "))}</p>` : ""}
      <p class="faint" style="font-size:.76rem;margin-top:4px">Mặc định suy ra từ lịch sử của chính ${esc(d.symbol)} (bảng dưới), kéo dần về mức ngành khi lịch sử thất thường. Tăng trưởng đi từ năm 1 → năm 3 → dài hạn; biên lợi nhuận đi dần từ hiện tại về trung vị nhiều năm.</p>
      <div class="assump" style="margin-top:6px">${A_FIELDS.filter(([k]) => a[k] !== undefined && a[k] !== null).map(([k, n]) => `
        <div class="field"><label for="as_${k}">${n} (%)</label><input id="as_${k}" data-a="${k}" inputmode="decimal" value="${(a[k] * 100).toFixed(1)}">${v.model.why?.[k] ? `<small class="awhy">${esc(v.model.why[k])}</small>` : ""}</div>`).join("")}
        <div class="field"><label for="as_ke">Chi phí vốn chủ ke (%)</label><input id="as_ke" inputmode="decimal" value="${nf(v.ke, 2).replace(",", ".")}"></div></div>
      <p style="margin-top:8px"><button class="btn primary" id="aSave">Lưu giả định cho ${d.symbol}</button> <button class="btn" id="aReset">Về mặc định</button></p>
      <p class="faint" style="font-size:.74rem">Sửa số – kết quả tính lại ngay. Lưu rồi thì lần chạy kế tiếp hệ thống dùng giả định của anh khi ra tín hiệu.</p>
      ${(v.model.hist || []).length ? `<div class="tw sec"><table><thead><tr><th class="l">Lịch sử của ${esc(d.symbol)}</th>${v.model.hist.map((h) => `<th>${h.year}</th>`).join("")}</tr></thead><tbody>
        ${(base0(v).model === "CT" ? [["Tăng trưởng DT", "rev_g"], ["Tăng trưởng LN", "ni_g"], ["Biên LN gộp", "gm"], ["BH & QL / DT", "sga"], ["LN thành tiền tự do", "conv"], ["ROE", "roe"]] : [["Tăng trưởng LN", "ni_g"], ["ROE", "roe"]])
          .map(([n, k]) => `<tr><td class="l">${n}</td>${v.model.hist.map((h) => `<td class="${k.endsWith("_g") ? cls(h[k]) : ""}">${isNum(h[k]) ? pct(h[k] * 100, k === "conv" ? 0 : 1, k.endsWith("_g")) : "—"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}`)}
  </div>`;
}
function bindVal(d) {
  const v = d.valuation, base = v.model.base, a0 = { ...v.model.assumptions };
  const calc = () => {
    const a = { ...a0 };
    $$("[data-a]").forEach((el) => { const x = Number(String(el.value).replace(",", ".")); if (!Number.isNaN(x)) a[el.dataset.a] = x / 100; });
    const ke = Number(String($("#as_ke").value).replace(",", ".")) / 100 || v.ke / 100;
    const bear = (g) => g - Math.max(0.05, 0.5 * Math.abs(g)), bull = (g) => g + Math.max(0.04, 0.3 * Math.abs(g)), same = (g) => g;
    const sc = { bear: { f: bear, gm: -0.015 }, base: { f: same, gm: 0 }, bull: { f: bull, gm: 0.01 } };
    const res = {};
    for (const [k, s] of Object.entries(sc)) {
      const aa = { ...a, g1: s.f(a.g1) }; if (isNum(a.gmid)) aa.gmid = s.f(a.gmid);
      if (base.model === "CT") { aa.gm = a.gm + s.gm; if (isNum(a.gm_lt)) aa.gm_lt = a.gm_lt + s.gm; }
      const rows = FC.project(base, aa);
      res[k] = { rows, dcf: FC.dcf(base, aa, rows, ke), ddm: FC.ddm(base, aa, rows, ke) };
    }
    const fwd = res.base.rows[0].eps;
    const ms = v.methods.map((m) => {
      let val = m.value, lo = m.range?.[0], hi = m.range?.[1];
      if (m.key === "dcf") { val = res.base.dcf; lo = res.bear.dcf; hi = res.bull.dcf; }
      if (m.key === "ddm") { val = res.base.ddm; lo = res.bear.ddm; hi = res.bull.ddm; }
      return { ...m, value: val, lo, hi };
    }).filter((m) => isNum(m.value) && m.value > 0);
    const medOf = (a) => { const x = a.slice().sort((p, q) => p - q), k = x.length; return k ? (k % 2 ? x[(k - 1) / 2] : (x[k / 2 - 1] + x[k / 2]) / 2) : null; };
    const act = ms.filter((m) => m.w > 0);
    const med = medOf(act.map((m) => m.value));
    ms.forEach((m) => (m.used = m.w > 0 && m.value >= med / 2.5 && m.value <= med * 2.5));
    const used = ms.filter((m) => m.used);
    used.forEach((m) => (m.we = m.w / (1 + 3 * Math.abs(Math.log(m.value / med)))));
    const ws = used.reduce((s, m) => s + m.we, 0) || 1;
    used.forEach((m) => (m.we /= ws));
    const fair = used.reduce((s, m) => s + m.value * m.we, 0);
    const medU = medOf(used.map((m) => m.value));
    const buy = Math.min(fair * (1 - d.mos / 100), medU * (1 - d.mos / 200)), price = d.row.price, up = (fair / price - 1) * 100;
    const lo = Math.min(fair, ...used.map((m) => m.lo).filter(isNum).concat([fair * 0.8])), hi = Math.max(fair, ...used.map((m) => m.hi).filter(isNum).concat([fair * 1.2]));
    const L = Math.min(lo, price) * 0.9, R = Math.max(hi, price) * 1.08, X = (x) => ((x - L) / (R - L)) * 100;
    $("#vOut").innerHTML = `
      ${kpis([["Giá trị hợp lý", nf(fair)], ["Mua an toàn dưới", nf(buy)], ["Giá hiện tại", nf(price)], ["Tiềm năng", pct(up), cls(up)], ["Biên an toàn", d.mos + "%"], ["ke", nf(ke * 100, 1) + "%"]], true)}
      ${v.flag ? `<p class="note" style="margin:6px 0">${v.flag === "event" ? "⚠️ <b>Có sự kiện – chưa định giá.</b> " : "⚠️ "}${esc(v.warning || "")}</p>` : ""}
      <div class="vrange" aria-hidden="true"><div class="track"></div>
        <div class="zone" style="left:${X(lo)}%;width:${X(hi) - X(lo)}%;background:color-mix(in srgb,var(--up) 35%,transparent)"></div>
        <div class="zone" style="left:${X(L)}%;width:${Math.max(0, X(buy) - X(L))}%;background:color-mix(in srgb,var(--brand) 25%,transparent)"></div>
        <div class="mk" style="left:${X(price)}%;color:var(--ink)">Giá ${nf(price)}</div>
        <div class="mk" style="left:${X(fair)}%;color:var(--up);top:30px">Hợp lý ${nf(fair)}</div></div>
      <div class="leg" style="margin-top:14px"><span><i style="background:color-mix(in srgb,var(--brand) 25%,transparent)"></i>Vùng mua an toàn</span><span><i style="background:color-mix(in srgb,var(--up) 35%,transparent)"></i>Vùng hợp lý (Xấu → Tốt)</span></div>
      <div class="tw sec"><table data-hm="c5"><thead><tr><th class="l">Phương pháp</th><th>Giá trị</th><th>Xấu</th><th>Tốt</th><th>Trọng số</th></tr></thead><tbody>
      ${ms.map((m) => `<tr style="${m.used ? "" : "opacity:.5"}"><td class="wrap">${esc(m.name)}${m.used ? "" : m.w === 0 ? "" : " <small>(lệch xa, bỏ qua)</small>"}</td><td><b>${nf(m.value)}</b></td><td>${nf(m.lo)}</td><td>${nf(m.hi)}</td><td>${m.used ? nf(m.we * 100, 0) + "%" : "0%"}</td></tr>`).join("")}
      </tbody></table></div>
      <p class="faint" style="margin-top:4px;font-size:.74rem">ke = max(lãi suất phi rủi ro ${nf(v.ke_parts?.rf, 1)}% + max(beta ${nf(v.beta)}; 1) × phần bù ${nf(v.ke_parts?.erp, 0)}% + phần bù quy mô ${nf(v.ke_parts?.size, 0)}%; tối thiểu ${nf(v.ke_parts?.floor, 0)}%). Trọng số thực = trọng số gốc giảm dần khi phương pháp lệch xa trung vị; DCF bị tắt khi mô hình mong manh. Mua an toàn = thấp hơn của (hợp lý × (1 − biên an toàn)) và (trung vị các phương pháp × (1 − ½ biên an toàn)). Giá trị theo nghìn đồng/cổ phiếu.</p>`;
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
    <div class="stack">${valCtx(d, SECS || {})}
    <section class="panel"><div class="ph"><h2>${esc(d.symbol)} đứng ở đâu trong ${p.n ?? "—"} mã</h2><span class="meta">100 = tốt nhất ngành</span></div>
      <div class="tw"><table><tbody>${Object.entries(lbl).map(([k, n]) => `<tr><td class="l" style="font-weight:500">${n}</td><td style="width:45%">${minibar(pctl[k])}</td><td>${isNum(pctl[k]) ? Math.round(pctl[k]) : "—"}</td><td class="muted">TV ${nf(p.median?.[k], 1)}</td></tr>`).join("")}</tbody></table></div></section></div>
  </div>`;
}

// ================================================================ HƯỚNG DẪN
// ================================================================ HƯỚNG DẪN SỬ DỤNG & FAQ
const HELP_PAGES = [
  ["Hôm nay", "#/", "Trang mở đầu mỗi ngày: bảng “Hôm nay nên làm gì” (đang nắm bao nhiêu % cổ phiếu, nên nắm bao nhiêu, danh sách lệnh bán / mua với khối lượng, giá LO, cắt lỗ), đèn thị trường (được nắm tối đa bao nhiêu % cổ phiếu), việc cần làm với danh mục, danh sách MUA theo phong cách đang chọn, mã chờ điểm mua, tâm lý thị trường, cơ hội sau sự kiện, mùa vụ, ngành dẫn dắt.",
    ["Xem ô “Việc hôm nay” trước: số mã nên mua, cần xử lý, chờ điểm mua.", "Đổi phong cách (Lướt sóng / Trung hạn / Dài hạn / Cổ tức) bằng nút trên bảng kế hoạch – danh sách MUA đổi theo.", "Gói Miễn phí: trang này là Bản tin thị trường."]],
  ["Bản tin thị trường", "#/digest", "Tóm tắt mỗi phiên: chỉ số, độ rộng (tăng/giảm/trần/sàn), thanh khoản so với trung bình, ngành mạnh/yếu, mã kéo/đè VN-Index, tăng/giảm mạnh, khối lượng đột biến, dòng tiền lớn, phiên bất thường, sự kiện 7 ngày tới, tin tức.",
    ["Chọn ngày ở ô phía trên để xem lại các phiên trước.", "Bấm vào mã bất kỳ để mở trang phân tích mã."]],
  ["Thị trường", "#/market", "VN-Index theo nhiều khung thời gian, các điều kiện của đèn thị trường, độ rộng (% mã trên MA50/MA200), phân phối, định giá toàn thị trường so với lịch sử.",
    ["Đèn Xanh: được nắm tới 100% cổ phiếu · Vàng: 60% · Đỏ: 30% (mặc định, đổi được trong Khẩu vị)."]],
  ["Biến động", "#/swing", "Trong phiên (giá trực tiếp lúc 11:35 và 14:35), phiên gần nhất có gì bất thường, dòng tiền lớn gom/xả/bứt phá, tâm lý thị trường, mã liên quan (đồng pha), bảng hành vi giá từng mã, kiểm chứng.",
    ["Mỗi tín hiệu đều kèm kết quả lịch sử: sau những phiên giống vậy giá thường đi đâu.", "“Điểm bất thường” cao = giá hay bị đẩy/đạp, KHÔNG phải bằng chứng thao túng."]],
  ["Ngành", "#/sector", "Toàn cảnh các ngành: định giá so với lịch sử, xoay vòng ngành (RRG), triển vọng 3–6 và 12 tháng, mùa vụ. Bấm vào ngành để xếp hạng các mã trong ngành.",
    ["“Tốt nhất ngành” là công thức đã kiểm chứng; các phương án khác để nhìn theo góc khác."]],
  ["Bộ lọc", "#/screener", "Lọc toàn bộ HOSE/HNX/UPCOM theo hơn 60 chỉ tiêu: định giá, sinh lời, tăng trưởng, kỹ thuật, dòng tiền, các rổ chiến lược. Lưu được bộ lọc riêng, chọn nhiều mã để so sánh.",
    ["Bấm tiêu đề cột để sắp xếp; rê chuột lên tên chỉ tiêu để xem cách tính."]],
  ["Theo dõi", "#/watch", "Danh sách mã quan tâm và cảnh báo giá: giá ≤ / ≥ một mức, biến động ≥ x% trong phiên, hoặc khi mã vào danh sách MUA. Có lịch sự kiện (chốt quyền cổ tức, hạn BCTC, ĐHCĐ).",
    ["Bấm ☆ ở bất kỳ đâu để thêm mã vào theo dõi.", "Mã đang “có sự kiện” trong danh sách theo dõi sẽ được báo khi đến điểm vào sau sự kiện."]],
  ["Danh mục", "#/portfolio", "Nhập mã đang nắm (khối lượng, giá vốn, ngày mua) và tổng vốn. Hệ thống tính mức dừng lỗ, chốt lời từng phần, tỷ trọng, rủi ro theo ngành; có Nhật ký giao dịch và Khẩu vị đầu tư.",
    ["Ghi lệnh mua/bán ở Nhật ký thì danh mục tự cập nhật và lưu lại hệ thống đang khuyên gì lúc đó.", "Khẩu vị: chỉnh phân bổ rổ, mức cắt lỗ, tỷ trọng theo màu đèn, loại trừ ngành/mã – thấy ngay kết quả nếu đã làm như vậy từ 2020."]],
  ["Kiểm chứng", "#/backtest", "Mọi phương pháp và tín hiệu được đo trên dữ liệu Việt Nam: lợi nhuận/năm, mức sụt lớn nhất, từng năm, so với VN-Index; theo dõi thực tế danh sách MUA hằng ngày (không thể tối ưu ngược).",
    ["Đây là nơi trả lời câu hỏi “cách này có thật sự hiệu quả không?”."]],
  ["Trang từng mã", "#/s/FPT", "Biểu đồ nhiều khung, các bước nên làm, kế hoạch theo phong cách (vùng mua, cắt lỗ, mục tiêu), định giá đa phương pháp, kỹ thuật, sóng & mô hình, SMC/VSA/Wyckoff, dòng tiền, cơ bản, dự phóng 5 năm (sửa giả định được), cùng ngành, mã liên quan.",
    ["Gõ mã vào ô tìm kiếm phía trên hoặc bấm phím / để mở nhanh."]],
];
const HELP_LABELS = [
  ["Mua được", "Đạt đủ: xu hướng, giá trong vùng mua an toàn, và mã nằm trong danh sách MUA của rổ đã kiểm chứng."],
  ["Mua được – chia 2 lệnh", "Đạt điều kiện nhưng giá đang kéo giãn (cách EMA20 > 2,5 ATR hoặc +25%/tháng): mua 1/2 ngay, 1/2 đặt lệnh thấp hơn 1 ATR trong 10 phiên."],
  ["Chờ giá", "Giá còn trên vùng mua an toàn – đặt cảnh báo giá ở vùng mua."],
  ["Chưa đến lúc", "Chưa qua hàng rào kỹ thuật (cần giá > MA50 > MA200), hoặc lợi nhuận quý gần nhất xấu đi, hoặc mã đang có sự kiện."],
  ["Đạt giá – ngoài danh sách MUA", "Giá và xu hướng đạt nhưng rổ của mã không được phân bổ vốn, đã đủ số mã, vượt trần ngành hoặc đèn thị trường không cho – chỉ theo dõi."],
  ["Rẻ / Hơi rẻ / Hợp lý / Đắt", "So giá với giá trị hợp lý (P/E và P/B mục tiêu theo ngành điều chỉnh theo ROE, DCF, DDM khi phù hợp). Rẻ = dưới vùng mua an toàn."],
  ["Chưa đáng tin – cần rà lại", "Các phương pháp lệch nhau quá xa hoặc giá trị lệch quá xa giá thị trường – thường do số liệu bất thường. Không dùng để quyết định."],
  ["Có sự kiện – chưa định giá", "Giá sụt ≥ 45% kèm ≥ 3 phiên giảm sàn: thị trường đang định giá thông tin BCTC chưa có. Chờ ≥ 120 phiên và ≥ 60 phiên liền không giảm sàn rồi mới tính điểm vào."],
  ["Lợi nhuận đang xấu đi", "Quý gần nhất lỗ hoặc dưới ½ cùng kỳ: P/E dùng EPS điều chỉnh theo 2 quý gần nhất, chưa mua mới cho tới khi BCTC quý sau xác nhận."],
  ["Đèn thị trường", "Xanh / Vàng / Đỏ từ 7 điều kiện (xu hướng VN-Index, độ rộng, phân phối…). Quyết định tỷ trọng cổ phiếu tối đa."],
];
const HELP_FAQ = [
  ["Bắt đầu", "Dữ liệu cập nhật lúc nào?", "Các ngày giao dịch: 11:35 và 14:35 (giá trong phiên, cảnh báo nhanh) và 15:35 (phân tích đầy đủ sau đóng cửa). Thứ Bảy tải lại báo cáo tài chính, cổ tức và chạy kiểm chứng. Góc trên bên trái ghi rõ dữ liệu cập nhật lúc nào."],
  ["Bắt đầu", "Tôi nên dùng trang này mỗi ngày thế nào?", "Mở Hôm nay sau 15:35: xem đèn thị trường → việc với danh mục (bán/cắt lỗ/chốt lời) → danh sách MUA mới → mã chờ điểm mua. Trong ngày chỉ cần xem thông báo; không cần nhìn bảng điện."],
  ["Bắt đầu", "Vì sao tìm mã không thấy trang phân tích đầy đủ?", "Mã có giá trị giao dịch bình quân dưới 0,5 tỷ/phiên chỉ có số liệu tóm tắt – quá ít thanh khoản để phân tích sâu và để mua bán an toàn. Khuyến nghị MUA chỉ áp cho mã ≥ 3 tỷ/phiên."],
  ["Bắt đầu", "Giá trên trang có phải giá trực tiếp không?", "Không theo từng giây. Giá được chụp ở các lượt 11:35, 14:35 và 15:35. Khi đặt lệnh, luôn kiểm tra lại giá trên ứng dụng của công ty chứng khoán."],
  ["Bắt đầu", "Bảng “Hôm nay nên làm gì” tính thế nào?", "Lấy tỷ trọng cổ phiếu đang nắm so với mức đèn thị trường cho phép (theo phong cách đang chọn). Thứ tự: (1) bán các mã đã chạm mức thoát / cắt lỗ / luận điểm gãy; (2) nếu vẫn nắm nhiều hơn mức cho phép thì bán bớt mã yếu nhất, khi đó không mua mới; (3) còn phần vốn được phép thì mua các mã trong danh sách MUA đang trong vùng mua – khối lượng bị giới hạn bởi tỷ trọng tối đa/mã và rủi ro ≈ 1,5% tổng tài sản nếu chạm cắt lỗ; (4) cơ hội sau sự kiện với tỷ trọng nhỏ, tuỳ chọn. Bấm “Sao chép lệnh” để dán sang app CTCK."],
  ["Khuyến nghị", "Đèn Đỏ thì có nên đứng ngoài hoàn toàn?", "Không. Kiểm chứng 2015–2026: sau đèn Đỏ, VN-Index 60 phiên vẫn tăng trung bình như mọi lúc (~+2,8%) – đèn không đoán được hướng. Nhưng xác suất sụt ≥ 20% trong 60 phiên cao gấp đôi đèn Xanh. Vì vậy hệ thống giữ tỷ trọng thấp (mặc định 30%) chứ không bán sạch: danh mục kiểm chứng giảm mức sụt lớn nhất từ −34,6% xuống −18,4%, đổi lại lợi nhuận/năm thấp hơn khoảng 3 điểm %."],
  ["Khuyến nghị", "“Mua được” nghĩa là tôi nên mua ngay?", "Nghĩa là mã đạt đủ điều kiện của hệ thống tại giá đóng cửa gần nhất. Mua trong vùng mua, đặt cắt lỗ ngay sau khi mua, tỷ trọng theo gợi ý (mỗi lệnh sai chỉ mất khoảng 1,5% tổng vốn). Đây là thông tin tham khảo, không phải lời khuyên đầu tư cá nhân."],
  ["Khuyến nghị", "Mã định giá “Rẻ” sao lại “Chưa đến lúc”?", "Rẻ chưa đủ: hệ thống chỉ mua khi giá đã vào xu hướng tăng (giá > MA50 > MA200). Kiểm chứng 2020–2026: hàng rào này giảm mức sụt danh mục từ khoảng −50% xuống khoảng −26%. Mã rẻ mà đang giảm thường còn rẻ hơn nữa."],
  ["Khuyến nghị", "RSI gần 70, MACD sắp cắt xuống mà vẫn “Mua được”?", "Đo trên dữ liệu VN, mã quá mua trong xu hướng tăng không tệ hơn trung bình, nhưng dễ có nhịp chỉnh sâu. Vì vậy mã đang kéo giãn được chuyển sang “Mua được – chia 2 lệnh” thay vì cấm mua."],
  ["Khuyến nghị", "Giá đã giảm sàn nhiều phiên, P/E chỉ 4x – có phải cơ hội vàng?", "Kiểm chứng 560 đợt 2016–2026: mua ngay khi sập hoặc bắt nhịp hồi sớm thường thua thị trường và còn sụt thêm ~30%. Cơ hội có thật nhưng đến muộn hơn: khi đủ 120 phiên từ lúc có cờ và 60 phiên liền không giảm sàn, nhất là DN còn lãi, nợ thấp. Trang mã đếm ngược số phiên còn phải chờ; thêm mã vào Theo dõi để được báo đúng lúc."],
  ["Khuyến nghị", "Giá trị hợp lý tính thế nào? Tôi muốn dùng giả định của mình.", "P/E và P/B mục tiêu theo trung vị ngành (điều chỉnh theo ROE của mã), DCF dòng tiền cho cổ đông và DDM khi phù hợp; lợi nhuận đỉnh/đáy chu kỳ được chuẩn hoá. Trong trang mã → tab Dự phóng & định giá, sửa tăng trưởng, biên lợi nhuận… giá trị hợp lý tính lại ngay và có thể lưu."],
  ["Khuyến nghị", "Mã này chạy rồi thì mã cùng ngành có chạy theo không?", "Kiểm chứng trên dữ liệu VN: các mã đồng pha đi CÙNG LÚC, không đi trước nhau vài tuần; mã tụt lại cũng không có xu hướng bắt kịp. Xem phần Mã liên quan trong trang mã để biết nên né cả nhóm khi nào và mã nào trong nhóm đang vào được."],
  ["Danh mục", "Nhập danh mục ở đâu? Có ai khác xem được không?", "Tab Danh mục → nhập mã, khối lượng, giá vốn (nghìn đồng), ngày mua và tổng vốn. Dữ liệu lưu riêng cho tài khoản của anh/chị, đồng bộ mọi thiết bị; người dùng khác không xem được."],
  ["Danh mục", "Mức dừng lỗ, chốt lời được tính thế nào?", "Theo phong cách của từng mã: dừng lỗ theo ATR và đỉnh sau mua (dời lên theo giá, tối đa −20%), chốt một phần khi vượt giá trị hợp lý, bán khi luận điểm cơ bản gãy, xem lại sau 60 phiên nếu vốn đứng yên. Có thể đặt mức riêng cho từng mã."],
  ["Danh mục", "Tôi đã bán mà hệ thống vẫn báo mã đó?", "Ghi lệnh bán ở Danh mục → Nhật ký giao dịch (hoặc bấm “Bán” cạnh mức thoát) để danh mục cập nhật. Thông báo theo danh mục đã lưu ở lượt chạy gần nhất."],
  ["Thông báo", "Làm sao nhận thông báo trên điện thoại?", "Tài khoản → Nhận thông báo → “Bật trên thiết bị này” và cho phép thông báo. Android/máy tính: dùng Chrome, Edge hoặc Firefox. iPhone/iPad (iOS 16.4+): mở trang bằng Safari → nút Chia sẻ → Thêm vào Màn hình chính → mở trang từ biểu tượng mới → bật lại. Thông báo đẩy và email thuộc gói Pro."],
  ["Thông báo", "Khi nào tôi nhận thông báo?", "Sau các lượt 11:35, 14:35 và 15:35, chỉ khi có việc mới: chạm/sắp chạm mức thoát, khuyến nghị bán/cắt lỗ, cảnh báo giá, mã mới vào danh sách MUA, dòng tiền lớn với mã của anh/chị, mã có sự kiện / đến điểm vào sau sự kiện. Mỗi việc chỉ báo một lần."],
  ["Thông báo", "Nhận quá nhiều / quá ít thông báo?", "Tài khoản → chọn mức gửi đẩy và email (Tất cả / Bình thường / Chỉ việc quan trọng / Tắt) và bỏ chọn loại không cần. Chuông trên web luôn giữ đủ để xem lại."],
  ["Thông báo", "Bật rồi mà không nhận được thông báo đẩy?", "Kiểm tra: trình duyệt/điện thoại cho phép thông báo của trang; iPhone phải mở từ biểu tượng ngoài màn hình chính; chế độ Tập trung/Không làm phiền đang tắt. Bấm “Gửi thử” trong trang Tài khoản để kiểm tra thiết bị."],
  ["Tài khoản", "Quên mật khẩu?", "Ở trang đăng nhập bấm “Quên mật khẩu?”, nhập email. Nếu chưa nhận được email, quản trị viên sẽ gửi liên kết đặt lại mật khẩu (hiệu lực 72 giờ)."],
  ["Tài khoản", "Gói Miễn phí và Pro khác gì? Nâng cấp thế nào?", "Xem bảng quyền lợi ở trang Tài khoản. Miễn phí: bản tin, thị trường, ngành, bộ lọc, lịch sự kiện, danh mục với tư vấn mức thoát, theo dõi, chuông thông báo. Pro thêm danh sách MUA, phân tích đầy đủ từng mã, biến động & trong phiên, dòng tiền, mã liên quan, kiểm chứng, PDF, thông báo đẩy và email. Liên hệ quản trị viên để nâng cấp/gia hạn."],
  ["Tài khoản", "Dùng chung tài khoản trên nhiều máy được không?", "Được – đăng nhập cùng email, dữ liệu đồng bộ. “Đăng xuất mọi thiết bị” trong trang Tài khoản khi nghi lộ mật khẩu."],
  ["Khác", "Xuất báo cáo PDF thế nào?", "Nút PDF ở thanh trên: xuất trang đang xem, hoặc chọn nhiều trang để tạo báo cáo tổng hợp có bìa, mục lục, số trang."],
  ["Khác", "Phím tắt?", "/ hoặc Ctrl/⌘ + K: tìm nhanh mã, trang, thuật ngữ. Gõ g rồi một phím để chuyển trang (g h: Hôm nay, g r: Bản tin, g m: Thị trường, g d: Danh mục, g t: Theo dõi, g ?: Hướng dẫn)."],
  ["Khác", "Số liệu lấy từ đâu? Có chính xác không?", "Giá, báo cáo tài chính, cổ tức lấy từ nguồn dữ liệu công khai, kiểm tra và chuẩn hoá tự động (điều chỉnh chia tách, cổ tức). Sai sót nguồn vẫn có thể xảy ra – các giá trị bất thường được gắn nhãn “Chưa đáng tin”."],
  ["Khác", "Đây có phải là lời khuyên đầu tư?", "Không. Đây là hệ thống phân tích tự động cung cấp thông tin tham khảo; quyết định và rủi ro đầu tư thuộc về anh/chị. Hiệu quả quá khứ (kể cả kiểm chứng) không bảo đảm kết quả tương lai."],
];
async function viewHelp() {
  const multi = multiUser();
  const P = HELP_PAGES, cats = [...new Set(HELP_FAQ.map((x) => x[0]))];
  app().innerHTML = `<div class="ph"><h1>Hướng dẫn sử dụng & câu hỏi thường gặp</h1><span class="meta"><a href="#/guide">Phương pháp chọn mã & từ điển chỉ số →</a></span></div>
  <section class="panel hero hstart"><div class="ph"><h2>Bắt đầu trong 5 phút</h2></div>
    <ol class="hsteps">
      ${multi ? `<li><b>Hoàn thiện tài khoản</b><span>Đặt tên, bật thông báo trên điện thoại ở <a href="#/account">Tài khoản</a>.</span></li>` : ""}
      <li><b>Nhập danh mục</b><span>Tab <a href="#/portfolio">Danh mục</a>: mã, khối lượng, giá vốn, ngày mua và tổng vốn.</span></li>
      <li><b>Chọn phong cách</b><span><a href="#/portfolio/profile">Khẩu vị</a>: Lướt sóng, Trung hạn, Dài hạn hoặc Cổ tức – danh sách MUA đổi theo.</span></li>
      <li><b>Thêm mã quan tâm</b><span>Bấm ☆ ở trang mã hoặc vào <a href="#/watch">Theo dõi</a>, đặt cảnh báo giá.</span></li>
      <li><b>Mỗi chiều sau 15:35</b><span>Mở <a href="#/">Hôm nay</a> / <a href="#/digest">Bản tin</a>: đèn thị trường → việc với danh mục → mã mới.</span></li>
    </ol></section>
  <div class="g g2 sec">
    <section class="panel"><div class="ph"><h2>Lịch cập nhật</h2></div>
      <div class="rows hsched">
        <div class="row"><span><b>11:35</b></span><span>Giá giữa phiên: chạm/sắp chạm mức thoát, cảnh báo giá, biến động bất thường, mã vào vùng mua</span></div>
        <div class="row"><span><b>14:35</b></span><span>Giá trước ATC: như trên + kiểu “sáng đẩy chiều xả”</span></div>
        <div class="row"><span><b>15:35</b></span><span>Phân tích đầy đủ: định giá, danh sách MUA, tư vấn danh mục, bản tin thị trường, thông báo</span></div>
        <div class="row"><span><b>Thứ Bảy</b></span><span>Tải lại BCTC, cổ tức; chạy kiểm chứng</span></div>
      </div>
      <p class="faint" style="font-size:.74rem;margin-top:6px">Ngày nghỉ lễ hệ thống tự bỏ qua. Giờ cập nhật gần nhất hiện ở góc trên bên trái.</p></section>
    <section class="panel"><div class="ph"><h2>Đọc các nhãn</h2></div>
      <dl class="hlab">${HELP_LABELS.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></section>
  </div>
  <section class="panel sec"><div class="ph"><h2>Các trang</h2></div>
    <div class="hpages">${P.map(([n, h, d, tips]) => `<article><h3><a href="${h}">${esc(n)}</a></h3><p>${esc(d)}</p><ul>${tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></article>`).join("")}</div></section>
  <section class="panel sec" id="faq"><div class="ph"><h2>Câu hỏi thường gặp</h2><span class="meta"><input id="fq" placeholder="Tìm câu hỏi…" style="width:180px" autocomplete="off"></span></div>
    <div class="views" id="fcat" style="margin:0 0 8px">${["Tất cả", ...cats].map((c, i) => `<button class="btn ${i ? "" : "primary"}" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="faq">${HELP_FAQ.map(([c, q, a]) => `<details data-c="${esc(c)}" data-s="${esc((q + " " + a).toLowerCase())}"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("")}</div>
    <p class="muted" id="fnone" hidden>Không thấy câu hỏi phù hợp – thử từ khoá khác${multi ? ", hoặc liên hệ quản trị viên" : ""}.</p></section>
  <p class="faint" style="font-size:.72rem;margin-top:8px">Thông tin tham khảo từ hệ thống phân tích tự động – không phải khuyến nghị đầu tư cá nhân.</p>`;
  let cat = "Tất cả";
  const filt = () => {
    const q = ($("#fq").value || "").trim().toLowerCase();
    let n = 0;
    $$(".faq details").forEach((d) => { const ok = (cat === "Tất cả" || d.dataset.c === cat) && (!q || d.dataset.s.includes(q)); d.hidden = !ok; if (ok) n++; if (q && ok) d.open = true; });
    $("#fnone").hidden = n > 0;
  };
  $("#fq").oninput = filt;
  $$("#fcat button").forEach((b) => (b.onclick = () => { cat = b.dataset.c; $$("#fcat button").forEach((x) => x.classList.toggle("primary", x === b)); filt(); }));
  if (location.hash.includes("faq")) setTimeout(() => $("#faq")?.scrollIntoView(), 50);
}

async function viewGuide() {
  const [m, t] = await Promise.all([load("data/methods.json"), loadToday()]);
  const glo = Object.entries(GLOSS).sort((a, b) => a[1].t.localeCompare(b[1].t, "vi"));
  const gloHtml = `<section class="panel sec" id="gloss"><div class="ph"><h2>Từ điển chỉ số và ký hiệu</h2><span class="meta">${glo.length} mục · rê chuột hoặc chạm vào chữ gạch chấm ở bất kỳ trang nào để xem nhanh</span></div>
    <div class="filters"><div class="field w200"><label for="gq">Tìm</label><input id="gq" placeholder="P/E, ROE, sụt tối đa, RRG…" autocomplete="off"></div></div>
    <div class="gloss sec">${glo.map(([k, g]) => `<article class="gi" id="g-${k}" data-s="${esc((g.t + " " + g.d + " " + Object.entries(GLOSS_ALIAS).filter(([, v]) => v === k).map(([a]) => a).join(" ")).toLowerCase())}"><h3>${esc(g.t)}</h3><p>${esc(g.d)}</p>
      ${g.f ? `<p class="gr"><i>Công thức</i><span>${esc(g.f)}</span></p>` : ""}${g.hi ? `<p class="gr hi"><i>Cao</i><span>${esc(g.hi)}</span></p>` : ""}${g.lo ? `<p class="gr lo"><i>Thấp</i><span>${esc(g.lo)}</span></p>` : ""}${g.n ? `<p class="gn">${esc(g.n)}</p>` : ""}</article>`).join("")}</div></section>`;
  app().innerHTML = `<div class="ph"><h1>Hệ thống chọn mã thế nào?</h1><a class="meta" href="#/guide" onclick="setTimeout(()=>document.getElementById('gloss')?.scrollIntoView({behavior:'smooth'}),50)">Từ điển chỉ số</a></div>
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
  <section class="sec">${panel(`${Object.keys(m.methods).length} phương pháp chấm điểm`, `<div class="weights">${Object.entries(m.methods).map(([k, x]) => `<div class="w-item"><header><b>${esc(x.name)}</b><small>trọng số ${m.weights[k] ?? 0}</small></header><p>${esc(x.desc)}</p></div>`).join("")}</div>`)}</section>${gloHtml}`;
  $("#gq").oninput = (e) => { const q = e.target.value.trim().toLowerCase(); $$(".gi").forEach((x) => (x.hidden = q && !x.dataset.s.includes(q))); };
  if (location.hash.includes("gloss")) setTimeout(() => $("#gloss")?.scrollIntoView(), 50);
}

// ================================================================ ĐỊNH GIÁ SO SÁNH (dùng chung)
let SECS = null;
const mktPill = (M) => (M && isNum(M.pe_med) ? `<a class="pill brand mktp" href="#/sector" title="Định giá toàn thị trường – bấm để so sánh các ngành">P/E thị trường <b>${nf(M.pe_w_pos ?? M.pe_w, 1)}</b> gia quyền · <b>${nf(M.pe_med, 1)}</b> trung vị · P/B ${nf(M.pb_w)}</a>` : "");
async function secsData() { if (!SECS) SECS = (await tryLoad("data/sectors.json")) || { sector: [], industry: [], market: {} }; return SECS; }
const vsPct = (a, b) => (isNum(a) && isNum(b) && a > 0 && b > 0 ? (a / b - 1) * 100 : null);
// thấp hơn là rẻ hơn → xanh
const vsCell = (v, d = 0) => (isNum(v) ? `<span class="${v <= -10 ? "up" : v >= 10 ? "down" : "muted"}">${v > 0 ? "+" : ""}${nf(v, d)}%</span>` : "—");
const pctlChip = (p) => (isNum(p) ? `<span class="pill ${p <= 25 ? "buy" : p >= 75 ? "sell" : ""}" title="P/E hiện tại cao hơn ${nf(p, 0)}% số quý trong lịch sử">${p <= 25 ? "rẻ" : p >= 75 ? "đắt" : "TB"} · ${nf(p, 0)}</span>` : "—");
function ctxRecs(S, sector, industry) {
  const sec = (S.sector || []).find((x) => x.name === sector) || null;
  const ind = industry && industry !== sector ? (S.industry || []).find((x) => x.name === industry) || null : null;
  return { sec, ind, mkt: S.market || {} };
}
function spark(vals, o = {}) {
  const W = o.w || 220, H = o.h || 56, P = 3;
  const v = vals.map((x) => (isNum(x) ? Number(x) : null));
  const all = v.filter((x) => x != null).concat([o.lo, o.hi, o.med, o.ref].filter(isNum)).concat((o.ref2 || []).filter(isNum));
  if (all.length < 2) return "";
  let mn = Math.min(...all), mx = Math.max(...all); if (mx === mn) { mx += 1; mn -= 1; }
  const X = (i) => P + (i / Math.max(1, v.length - 1)) * (W - 2 * P), Y = (y) => P + (1 - (y - mn) / (mx - mn)) * (H - 2 * P);
  let s = `<svg class="svgchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px">`;
  if (isNum(o.lo) && isNum(o.hi)) s += `<rect x="0" width="${W}" y="${Y(o.hi)}" height="${Math.max(1, Y(o.lo) - Y(o.hi))}" fill="var(--brand)" opacity=".08"/>`;
  if (isNum(o.med)) s += `<line x1="0" x2="${W}" y1="${Y(o.med)}" y2="${Y(o.med)}" stroke="var(--ink-3)" stroke-dasharray="3 3"/>`;
  if (o.ref2) s += `<polyline fill="none" stroke="var(--ink-3)" stroke-width="1" opacity=".7" points="${o.ref2.map((y, i) => (isNum(y) ? `${X(i)},${Y(y)}` : null)).filter(Boolean).join(" ")}"/>`;
  s += `<polyline fill="none" stroke="${o.color || "var(--brand)"}" stroke-width="1.8" points="${v.map((y, i) => (y == null ? null : `${X(i)},${Y(y)}`)).filter(Boolean).join(" ")}"/>`;
  const li = v.map((y, i) => [y, i]).filter(([y]) => y != null).pop();
  if (li) s += `<circle cx="${X(li[1])}" cy="${Y(li[0])}" r="2.6" fill="${o.color || "var(--brand)"}"/>`;
  if (isNum(o.cur)) s += `<circle cx="${W - P}" cy="${Y(o.cur)}" r="3.2" fill="none" stroke="var(--ink)" stroke-width="1.4"><title>hiện tại ${nf(o.cur, 1)}</title></circle>`;
  return s + `</svg>`;
}

// Bảng so sánh định giá của 1 mã: mã / lịch sử mã / nhóm ngành / ngành / thị trường
function valCtx(d, S, opts = {}) {
  const r = d.row || d, fa = d.fa || {};
  const pe = fa.pe ?? r.pe, pb = fa.pb ?? r.pb, roe = fa.roe ?? r.roe, dy = fa.dividend?.yield ?? r.div_yield, g = fa.ni_yoy ?? r.ni_yoy;
  const { sec, ind, mkt } = ctxRecs(S, d.sector || r.sector, d.industry || r.industry);
  const vh = (d.val_hist || []).filter((x) => isNum(x.pe));
  const hmed = (k) => { const a = (d.val_hist || []).map((x) => x[k]).filter(isNum).sort((x, y) => x - y); return a.length >= 6 ? a[Math.floor(a.length / 2)] : null; };
  const pe_h = hmed("pe"), pb_h = hmed("pb");
  const rows = [
    ["<b>" + esc(d.symbol || r.symbol) + "</b>", pe, pb, roe, dy, g, "self"],
    pe_h ? [`Chính mã, TB ${vh.length} quý`, pe_h, pb_h, null, null, null, "hist"] : null,
    ind ? [`Nhóm ngành<small>${esc(ind.name)}</small>`, ind.pe_med, ind.pb_med, ind.roe_med, ind.div_med, ind.ni_yoy_med, "ind"] : null,
    sec ? [`Ngành<small>${esc(sec.name)}</small>`, sec.pe_med, sec.pb_med, sec.roe_med, sec.div_med, sec.ni_yoy_med, "sec"] : null,
    [`Thị trường<small>trung vị</small>`, mkt.pe_med, mkt.pb_med, mkt.roe_med, mkt.div_med, mkt.ni_yoy_med, "mkt"],
    [`Thị trường<small>gia quyền</small>`, mkt.pe_w_pos ?? mkt.pe_w, mkt.pb_w, mkt.roe_w, null, null, "mktw"],
  ].filter(Boolean);
  const base = ind || sec;
  const say = [];
  if (isNum(pe) && pe > 0) {
    const a = vsPct(pe, base?.pe_med), b = vsPct(pe, mkt.pe_med), c = vsPct(pe, pe_h);
    const w = (v, n) => (isNum(v) ? `${v < 0 ? "thấp hơn" : "cao hơn"} ${n} <b class="${v < 0 ? "up" : "down"}">${nf(Math.abs(v), 0)}%</b>` : null);
    say.push([w(a, ind ? "nhóm ngành" : "ngành"), w(b, "thị trường"), w(c, "trung bình lịch sử của chính mã")].filter(Boolean).join(", "));
  } else say.push(`Mã đang lỗ hoặc chưa có EPS dương nên không có P/E – so sánh bằng P/B.`);
  return `<section class="panel ctxp ${opts.extra || ""}"><div class="ph"><h2>P/E so với ngành & thị trường</h2><span class="meta">trung vị = DN điển hình · gia quyền = như chỉ số</span></div>
    <table class="ctx"><colgroup><col><col style="width:30%"><col style="width:17%"><col style="width:17%"></colgroup><thead><tr><th class="l"></th><th class="hlc">P/E <small>mã so với</small></th><th>P/B</th><th>ROE</th></tr></thead><tbody>
    ${rows.map(([n, a, b, c, e, f, k]) => `<tr class="${k === "self" ? "me" : k.startsWith("mkt") ? "mk" : ""}"><td class="l">${n}</td><td class="hlc"><b>${nf(a, 1)}</b>${k !== "self" && isNum(pe) && isNum(a) ? ` <small>${vsCell(vsPct(pe, a))}</small>` : ""}</td>
      <td>${nf(b)}</td><td>${isNum(c) ? nf(c, 0) + "%" : "—"}</td></tr>`).join("")}</tbody></table>
    <p class="faint" style="font-size:.72rem;margin-top:4px">${esc(d.symbol || r.symbol)}: cổ tức ${pct(dy, 1, false)} · LN 12 tháng ${pct(g, 0)}${ind || sec ? ` · ngành: cổ tức ${pct((ind || sec).div_med, 1, false)}, LN ${pct((ind || sec).ni_yoy_med, 0)}` : ""}</p>
    <p style="font-size:.8rem;margin-top:6px">P/E <b>${nf(pe, 1)}</b>${say.length ? " – " + say.join("") : ""}.</p>
    <p class="faint" style="font-size:.7rem">Số nhỏ cạnh P/E: P/E của mã đắt hơn (đỏ) hoặc rẻ hơn (xanh) dòng đó bao nhiêu %. Rẻ chưa chắc tốt – xem cùng ROE.</p></section>`;
}
function peHistChart(d, S) {
  const vh = d.val_hist || [];
  if (vh.filter((x) => isNum(x.pe)).length < 4) return `<p class="muted">Chưa đủ lịch sử P/E của mã.</p>`;
  const { sec, ind, mkt } = ctxRecs(S, d.sector, d.industry);
  const map = (rec) => Object.fromEntries((rec?.val_hist || []).map((x) => [x.p, x.pe]));
  const mi = map(ind), ms = map(sec), mm = map(mkt);
  const series = [{ name: `P/E ${d.symbol}`, color: css("--brand"), width: 2.2, pts: vh.map((x) => ({ x: x.p, y: x.pe })) }];
  if (ind) series.push({ name: "Nhóm ngành (TV)", color: css("--floor"), pts: vh.map((x) => ({ x: x.p, y: mi[x.p] })) });
  if (sec) series.push({ name: "Ngành (TV)", color: css("--ref"), pts: vh.map((x) => ({ x: x.p, y: ms[x.p] })) });
  series.push({ name: "Thị trường (TV)", color: css("--ink-3"), dash: "4 3", pts: vh.map((x) => ({ x: x.p, y: mm[x.p] })) });
  return lineSvg(series, { w: 1000, h: 230, ticks: 10, label: "P/E theo quý so với ngành và thị trường" });
}

// ================================================================ TOÀN CẢNH NGÀNH
const MEAS = {
  pe_w: { n: "P/E gia quyền", cur: (s) => s.pe_w_pos ?? s.pe_w, mk: (m) => m.pe_w_pos ?? m.pe_w, med: "pew_hist_med", lo: "pew_hist_lo", hi: "pew_hist_hi", vs: "pew_vs_hist", pc: "pew_pctl_hist", hk: "pe_w", dec: 1,
    note: "Tổng vốn hoá ÷ tổng lợi nhuận 12 tháng của các DN có lãi trong ngành – giống cách tính P/E của chỉ số; mã vốn hoá lớn chi phối." },
  pe_med: { n: "P/E trung vị", cur: (s) => s.pe_med, mk: (m) => m.pe_med, med: "pe_hist_med", lo: "pe_hist_lo", hi: "pe_hist_hi", vs: "pe_vs_hist", pc: "pe_pctl_hist", hk: "pe", dec: 1,
    note: "P/E của doanh nghiệp đứng giữa ngành – đại diện cho 'DN điển hình', không bị vài mã lớn chi phối." },
  pb_w: { n: "P/B gia quyền", cur: (s) => s.pb_w, mk: (m) => m.pb_w, med: "pbw_hist_med", lo: "pbw_hist_lo", hi: "pbw_hist_hi", vs: "pbw_vs_hist", pc: "pbw_pctl_hist", hk: "pb_w", dec: 2,
    note: "Tổng vốn hoá ÷ tổng vốn chủ sở hữu. Dùng tốt cho ngân hàng, chứng khoán, bất động sản, DN chu kỳ." },
  pb_med: { n: "P/B trung vị", cur: (s) => s.pb_med, mk: (m) => m.pb_med, med: "pb_hist_med", lo: "pb_hist_lo", hi: "pb_hist_hi", vs: "pb_vs_hist", pc: "pb_pctl_hist", hk: "pb", dec: 2,
    note: "P/B của doanh nghiệp đứng giữa ngành." },
};

// ================================================================ ĐA KHUNG THỜI GIAN (ngày / tuần / tháng / quý / năm)
const TF_VI = { D: "Ngày", W: "Tuần", M: "Tháng", Q: "Quý", Y: "Năm" };
const TF_KEY = {
  D: (s) => s,
  W: (s) => { const x = new Date(s + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); },
  M: (s) => s.slice(0, 7) + "-01",
  Q: (s) => `${s.slice(0, 4)}-${String(Math.floor((Number(s.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`,
  Y: (s) => s.slice(0, 4) + "-01-01",
};
function aggOhlc(o, tf) {
  if (!o || !o.t?.length) return null;
  const kf = TF_KEY[tf], out = { t: [], o: [], h: [], l: [], c: [], v: [] };
  o.t.forEach((d, i) => {
    const k = kf(d), n = out.t.length;
    if (!n || out.t[n - 1] !== k) { out.t.push(k); out.o.push(o.o?.[i] ?? o.c[i]); out.h.push(o.h?.[i] ?? o.c[i]); out.l.push(o.l?.[i] ?? o.c[i]); out.c.push(o.c[i]); out.v.push(o.v?.[i] || 0); }
    else { const j = n - 1; out.h[j] = Math.max(out.h[j], o.h?.[i] ?? o.c[i]); out.l[j] = Math.min(out.l[j], o.l?.[i] ?? o.c[i]); out.c[j] = o.c[i]; out.v[j] += o.v?.[i] || 0; }
  });
  return out;
}
const TFO_M = (d) => (d.ohlc_m?.t?.length ? d.ohlc_m : aggOhlc(d.ohlc, "M"));
function tfSeries(src) {
  const D = src.ohlc, W = src.ohlc_w?.t?.length ? src.ohlc_w : aggOhlc(D, "W"), M = src.ohlc_m?.t?.length ? src.ohlc_m : aggOhlc(D, "M");
  return { D, W, M, Q: aggOhlc(M, "Q"), Y: aggOhlc(M, "Y") };
}
const TF_VIEW = { D: 200, W: 156, M: 120, Q: 999, Y: 999 };
const tfSeg = (id, cur, avail = ["D", "W", "M", "Q", "Y"]) => `<span class="seg tfseg" id="${id}">${avail.map((k) => `<button data-tf="${k}" class="${k === cur ? "on" : ""}" title="Mỗi nến = 1 ${TF_VI[k].toLowerCase()}">${TF_VI[k]}</button>`).join("")}</span>`;
const sgnCell = (v, up = "Tăng", dn = "Giảm", mid = "Ngang") => v === 1 ? `<b class="up">${up}</b>` : v === -1 ? `<b class="down">${dn}</b>` : v === 0 ? `<span class="ref">${mid}</span>` : "—";
const tfPill = (sc) => !isNum(sc) ? "—" : sc >= 0.35 ? `<span class="pill buy">Tăng</span>` : sc <= -0.35 ? `<span class="pill sell">Giảm</span>` : `<span class="pill wait">Ngang</span>`;
function mtfPanel(M, title = "Đa khung thời gian", extra = "") {
  if (!M || !M.tf) return "";
  const T = ["D", "W", "M", "Q"].map((k) => M.tf[k]).filter((x) => x && x.ok);
  if (!T.length) return "";
  const S = M.summary || {};
  return `<section class="panel"><div class="ph"><h2>${title}</h2><span class="meta">mỗi khung tự tính trên nến của khung đó</span></div>
    <p class="mtf-sum ${S.tone || ""}" data-g="mtf">${esc(S.text || "")}</p>
    <div class="tw"><table class="mtft"><thead><tr><th class="l">Khung</th><th>Kết luận</th><th>Xu hướng</th><th>Cấu trúc</th><th>RSI</th><th>MACD</th><th>Động lượng</th><th>Vị trí</th></tr></thead><tbody>
      ${T.map((x) => `<tr><td class="l"><b>${x.name}</b> <small class="faint">${x.bars} nến</small></td><td>${tfPill(x.score)} <small class="faint">${nf(x.score, 2)}</small></td>
        <td title="Giá so với MA${x.ma_n[0]} / MA${x.ma_n[1]} của khung ${x.name.toLowerCase()}">${sgnCell(x.trend)}</td><td title="2 đỉnh và 2 đáy gần nhất">${sgnCell(x.struct, "Đỉnh-đáy cao dần", "Thấp dần", "Lẫn lộn")}</td>
        <td class="${x.rsi >= 70 ? "down" : x.rsi <= 30 ? "up" : ""}">${nf(x.rsi, 0)}</td><td>${x.macd == null ? "—" : `${x.macd > 0 ? '<span class="up">dương</span>' : '<span class="down">âm</span>'}${x.macd_up == null ? "" : x.macd_up ? " ↗" : " ↘"}`}</td>
        <td class="${cls(x.roc)}" title="Thay đổi giá ${x.roc_n} nến">${pct(x.roc, 0)}</td><td title="0 = đáy, 100 = đỉnh của biên độ gần đây">${nf(x.pos, 0)}</td></tr>`).join("")}</tbody></table></div>${extra}</section>`;
}
function returnsTable(o) {
  // lợi nhuận theo tháng, quý, năm từ nến tháng
  if (!o || o.t.length < 13) return "";
  const by = {};
  for (let i = 1; i < o.t.length; i++) { const y = o.t[i].slice(0, 4), mth = Number(o.t[i].slice(5, 7)); (by[y] = by[y] || {})[mth] = (o.c[i] / o.c[i - 1] - 1) * 100; }
  const yrs = Object.keys(by).sort().reverse().slice(0, 10);
  const Y = aggOhlc(o, "Y"), yr = {}; for (let i = 1; i < Y.t.length; i++) yr[Y.t[i].slice(0, 4)] = (Y.c[i] / Y.c[i - 1] - 1) * 100;
  const avg = Array.from({ length: 12 }, (_, m) => { const v = Object.values(by).map((x) => x[m + 1]).filter(isNum); return v.length ? [v.reduce((a, b) => a + b, 0) / v.length, v.filter((x) => x > 0).length / v.length * 100] : [null, null]; });
  const cell = (v) => `<td style="background:${isNum(v) ? heatColor(v, 6) : "transparent"};color:${isNum(v) ? "#fff" : "inherit"}">${isNum(v) ? nf(v, 1) : ""}</td>`;
  return `<details class="sec"><summary>Lợi nhuận theo tháng / năm (tính mùa vụ)</summary><div class="tw sec"><table class="rett"><thead><tr><th class="l">Năm</th>${Array.from({ length: 12 }, (_, i) => `<th>Th${i + 1}</th>`).join("")}<th>Cả năm</th></tr></thead><tbody>
    ${yrs.map((y) => `<tr><td class="l">${y}</td>${Array.from({ length: 12 }, (_, i) => cell(by[y][i + 1])).join("")}<td class="${cls(yr[y])}"><b>${pct(yr[y], 0)}</b></td></tr>`).join("")}
    <tr class="gh"><td class="l">Trung bình</td>${avg.map(([v]) => `<td class="${cls(v)}">${isNum(v) ? nf(v, 1) : ""}</td>`).join("")}<td></td></tr>
    <tr><td class="l">% tháng tăng</td>${avg.map(([, p]) => `<td>${isNum(p) ? nf(p, 0) : ""}</td>`).join("")}<td></td></tr></tbody></table></div>
    <p class="faint" style="font-size:.72rem">Trung bình theo tháng chỉ để tham khảo tính mùa vụ – số năm ít nên dễ là ngẫu nhiên.</p></details>`;
}
function lineTfChart(el, series, tf) {
  // series: [{name,color,width,t,c}] – vẽ cùng gốc 100 theo khung tf
  const c = mkChart(el, { rightPriceScale: { borderColor: css("--line") } });
  series.forEach((s) => {
    if (!s.t?.length) return;
    const a = aggOhlc({ t: s.t, c: s.c }, tf === "D" ? "D" : tf);
    const n = Math.min(a.t.length, TF_VIEW[tf] === 999 ? a.t.length : Math.max(TF_VIEW[tf], 60));
    const T = a.t.slice(-n), V = a.c.slice(-n), b0 = V.find(isNum);
    c.addLineSeries({ color: s.color, lineWidth: s.width || 1, priceLineVisible: false, lastValueVisible: true }).setData(T.map((d, i) => (isNum(V[i]) ? { time: d, value: (V[i] / b0) * 100 } : null)).filter(Boolean));
  });
  c.timeScale().fitContent();
  return c;
}

// ================================================================ TƯƠNG LAI vs QUÁ KHỨ + KHUYẾN NGHỊ TỪNG BƯỚC
const FBV = { buy: ["Mua / tích luỹ", "up"], lean_buy: ["Nghiêng mua – chờ điểm vào", "up"], neutral: ["Trung tính – giữ, chưa mua thêm", "ref"], lean_sell: ["Nghiêng bán – không mua thêm", "down"], sell: ["Tránh / giảm tỷ trọng", "down"] };
const fbLabel = (v) => (FBV[v] || ["—", ""])[0];
const fbCls = (v) => (FBV[v] || ["", ""])[1];
let FBJ = null;
async function fbData() { if (!FBJ) FBJ = (await tryLoad("data/fb.json")) || { summary: {}, ind: {} }; return FBJ; }
const fbGroup = (f) => (f >= 0.6 ? "fwd" : f >= 0.3 ? "mix" : "back");
function fbInterp(k, raw, rank) {
  if (!isNum(raw)) return "chưa có số liệu";
  const lvl = !isNum(rank) ? "" : rank >= 80 ? "rất tốt so với thị trường" : rank >= 60 ? "tốt hơn đa số" : rank >= 40 ? "quanh mức giữa" : rank >= 20 ? "kém hơn đa số" : "thuộc nhóm kém nhất";
  const P = (x, nd = 0) => pct(x * 100, nd);
  const m = {
    fpe: `P/E năm tới ≈ ${nf(raw, 1)} – ${lvl}${raw < 8 ? " (rẻ)" : raw > 20 ? " (đắt)" : ""}`,
    pe: `P/E hiện tại ${nf(raw, 1)} – ${lvl}`,
    peg: `PEG ${nf(raw, 2)}${raw < 1 ? " – rẻ so với tốc độ tăng" : raw > 2 ? " – đắt so với tốc độ tăng" : ""}`,
    sector: `ngành được ${nf(raw, 0)}/100 điểm triển vọng 3–6 tháng`,
    season: `các năm trước, tháng tới mã ${raw >= 0 ? "hơn" : "kém"} thị trường TB ${pct(Math.abs(raw), 1, false)}`,
    accel: `tăng trưởng LN quý ${raw >= 0 ? "nhanh lên" : "chậm lại"} ${nf(Math.abs(raw) * 100, 0)} điểm %`,
    cmf: `dòng tiền ${raw > 0.05 ? "đang vào (tích luỹ)" : raw < -0.05 ? "đang ra (phân phối)" : "cân bằng"} – CMF ${nf(raw, 2)}`,
    pepct: `P/E đang ở phân vị ${nf(raw, 0)}% lịch sử của chính mã`,
    mom: `giá 12–1 tháng ${P(raw)} – ${lvl}`,
    ma200: `giá ${raw >= 0 ? "trên" : "dưới"} MA200 ${pct(Math.abs(raw) * 100, 0, false)}`,
    gni: `LN 12 tháng ${P(raw)} so cùng kỳ`, grev: `doanh thu 12 tháng ${P(raw)} so cùng kỳ`,
    roe: `ROE ${pct(raw * 100, 1, false)} – ${lvl}`, margin: `biên LN ròng ${pct(raw * 100, 1, false)}`, de: `nợ vay ${nf(raw, 2)} lần vốn chủ`,
  };
  return m[k] || nf(raw);
}
function fbPanel(d, FJ) {
  const c = d.fb, S = FJ.summary || {}, I = FJ.ind || {};
  if (!c) return "";
  const wf = Math.round((c.w ?? 0.5) * 100);
  const tile = (title, sc, v, sub) => `<div class="fbt ${fbCls(v)}"><small>${title}</small><b>${nf(sc, 0)}</b><span>${fbLabel(v)}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  const rows = Object.entries(I).map(([k, x]) => ({ k, ...x, ...(c.ind?.[k] || {}), w: S.ind_w?.[k], ic: S.ind_ic?.[k] }));
  const grp = (g, t) => { const R = rows.filter((x) => fbGroup(x.f) === g).sort((a, b) => b.f - a.f); return R.length ? `<tr class="gh"><td colspan="7"><b>${t}</b></td></tr>` + R.map((x) => `<tr class="${x.w > 0 ? "" : "fboff"}">
      <td class="l"><b>${esc(x.name)}</b><small>${esc(x.why)}</small></td><td>${isNum(x.rank) ? scoreCell(x.rank) : "—"}</td>
      <td class="wrap">${esc(fbInterp(x.k, x.raw, x.rank))}</td><td>${nf(x.f * 100, 0)}%</td><td>${x.w > 0 ? nf(x.w, 1) + "%" : '<span class="faint">0</span>'}</td>
      <td class="${(x.ic?.ic ?? 0) > 0.02 ? "up" : (x.ic?.ic ?? 0) < -0.02 ? "down" : ""}">${nf(x.ic?.ic, 3)} <small>t ${nf(x.ic?.t, 1)}</small></td>
      <td><small>${nf(x.ic?.ic_a, 3)} → ${nf(x.ic?.ic_b, 3)}</small></td></tr>`).join("") : ""; };
  const H = S.halves || {}, HS = S.halves_sector || {};
  const cal = (S.calib || []).find((x) => x.key === c.v_total);
  const own = isNum(c.w_raw) ? `Riêng lịch sử ${esc(d.symbol)} (${c.n} tháng: tương quan nhóm tương lai ${nf(c.icf, 2)}, nhóm quá khứ ${nf(c.icb, 2)}) gợi ý <b>${nf(c.w_raw * 100, 0)}% tương lai</b>.` : "";
  const test = H.rho != null ? ` Nhưng kiểm định trên ${H.n} mã: mã nào nửa đầu (đến ${esc(H.mid)}) nghiêng tương lai thì nửa sau <b>${H.p < 0.1 ? "vẫn nghiêng" : "không còn nghiêng"}</b> (tương quan ${nf(H.rho, 2)}, p = ${nf(H.p, 2)}); gộp theo ngành cũng ${HS.p != null && HS.p < 0.1 ? "có" : "không"} lặp lại (p = ${nf(HS.p, 2)}). ${H.p < 0.1 ? "Vì vậy dùng trọng số riêng đã kéo về mức chung theo độ tin cậy." : `Vì vậy khác biệt từng mã là nhiễu – áp dụng trọng số chung <b>${wf}% tương lai</b> cho mọi mã.`}` : "";
  return `<section class="panel sec fbp"><div class="ph"><h2>Khuyến nghị: tương lai, quá khứ và tổng hợp</h2><span class="meta">${esc(S.start || "")} → ${esc(S.end || "")} · kiểm chứng lợi nhuận 3 tháng sau</span></div>
    <div class="fbtiles">${tile("Theo chỉ số hướng TƯƠNG LAI", c.fwd, c.v_fwd, "dự phóng, tăng tốc, dòng tiền, ngành, mùa vụ")}${tile("Theo chỉ số hướng QUÁ KHỨ", c.back, c.v_back, "kết quả kinh doanh, định giá hiện tại, đà giá")}
      ${tile(`TỔNG – ${wf}% tương lai · ${100 - wf}% quá khứ`, c.total, c.v_total, cal ? `lịch sử nhóm này: ${pct(cal.ret, 1)} so với thị trường sau 3 tháng, ${nf(cal.win, 0)}% lần hơn` : "")}</div>
    <div class="fbw"><i style="width:${wf}%"></i><span>tương lai ${wf}%</span><span>quá khứ ${100 - wf}%</span></div>
    <p class="faint" style="font-size:.76rem;margin-top:6px">${own}${test}</p>
    <details class="sec"><summary>Từng chỉ số – nhóm, hạng, trọng số, hiệu lực lịch sử</summary>
      <div class="tw sec"><table class="fbtab"><thead><tr><th class="l">Chỉ số</th><th>Hạng</th><th class="l">Nghĩa là gì hôm nay</th><th>% tương lai</th><th>Trọng số</th><th>Tương quan với LN 3 tháng sau</th><th>Nửa đầu → nửa sau</th></tr></thead><tbody>
        ${grp("fwd", "Hướng tương lai (≥ 60% tương lai)")}${grp("mix", "Hỗn hợp (30–60%)")}${grp("back", "Hướng quá khứ (< 30% tương lai)")}</tbody></table></div>
      <p class="faint" style="font-size:.72rem;margin-top:6px">Hạng 0–100 so với mọi mã cùng thời điểm (cao = tốt). Trọng số chỉ số = mức dự báo đúng trung bình trong quá khứ; chỉ số dự báo ngược chiều được để 0 (in mờ) – ví dụ "rẻ so với lịch sử của mã" và "đà giá 12 tháng" ở VN lại thường đi kèm kết quả kém hơn trong 3 tháng sau. Chỉ số hỗn hợp chia vào cả hai điểm theo "% tương lai".</p></details></section>`;
}

// ---- KHUYẾN NGHỊ TỪNG BƯỚC (cầm tay chỉ việc)
function nextEarnings(ev, today) { return (ev?.events || []).filter((e) => e.type === "earnings" && e.date >= today).sort((a, b) => (a.date < b.date ? -1 : 1))[0]; }
function stepsFor(d, ctx) {
  const { t, pf, ev, R } = ctx, sym = d.symbol, r = d.row || {}, fbx = d.fb || {}, lv = d.levels, v = d.valuation || {};
  const today = t.date || new Date().toISOString().slice(0, 10), cap = capitalOf(pf), reg = t.regime || {};
  const h = (pf?.holdings || []).find((x) => x.symbol === sym);
  const px = r.price ?? d.ohlc.c[d.ohlc.c.length - 1];
  const st = [];
  const ern = nextEarnings(ev, today);
  const pick = Object.entries(t.styles || {}).map(([k, p]) => [k, (p.picks || []).find((x) => x.symbol === sym) || (p.watch || []).find((x) => x.symbol === sym)]).find(([, x]) => x);
  const verdict = fbx.v_total, mt = d.mtf?.summary || {}, sup = d.season_support;
  const plus = Object.entries(fbx.ind || {}).filter(([k, x]) => isNum(x.rank) && x.rank >= 70 && (FBJ?.summary?.ind_w?.[k] || 0) > 0).map(([k, x]) => fbInterp(k, x.raw, x.rank)).slice(0, 3);
  const minus = Object.entries(fbx.ind || {}).filter(([k, x]) => isNum(x.rank) && x.rank <= 30 && (FBJ?.summary?.ind_w?.[k] || 0) > 0).map(([k, x]) => fbInterp(k, x.raw, x.rank)).slice(0, 3);
  st.push({ t: `Kết luận: ${fbLabel(verdict)} (điểm tổng ${nf(fbx.total, 0)}/100)`, c: fbCls(verdict),
    d: `${plus.length ? "Điểm mạnh: " + plus.join("; ") + ". " : ""}${minus.length ? "Điểm yếu: " + minus.join("; ") + ". " : ""}Đa khung: ${mt.text || "—"}` });
  const maxW = (t.risk?.max_weight_per_stock ?? 20), expo = reg.exposure ?? 100;
  if (h) {
    let peak = px; if (h.date) d.ohlc.t.forEach((dt, i) => { if (dt >= h.date) peak = Math.max(peak, d.ohlc.c[i]); });
    const ep = exitPlan(h, px, peak, h.date ? tradingDaysBetween(h.date, today) : null, { atr: r.atr, e20: r.e20, e20_below2: r.e20_below2, fair: r.fair, fair_hi: r.fair_hi, div_yield: r.div_yield }, (t.risk?.max_stop_loss_pct ?? 20));
    const pnl = (px * (1 - FEE_SELL / 100) / h.cost - 1) * 100;
    const hit = ep.levels.filter((l) => l.status === "hit"), near = ep.levels.filter((l) => l.status === "near");
    st.push({ t: `Anh đang nắm ${nf(h.qty, 0)} cp, giá vốn ${nf(h.cost)} – lãi/lỗ ${pct(pnl, 1)} sau phí`, d: `Theo luật thoát của phong cách ${STYLE_SHORT[ep.style]}. Hoà vốn sau phí: ${nf(ep.breakeven)}.` });
    const full = hit.find((l) => l.sell >= 0.999);
    if (full) { st[0].t += " – nhưng mã đang nắm đã chạm mức thoát: làm theo kỷ luật trước"; st[0].c = "down"; }
    if (hit.length) hit.forEach((l) => st.push(l.sell > 0 ? { t: `Làm ngay: ${l.label}${l.price ? " (" + nf(l.price) + ")" : ""} → ${fracVi(l.sell).toLowerCase()}${l.qty ? " " + nf(l.qty, 0) + " cp" : ""}`, c: l.kind === "tp" ? "up" : "down",
      d: `${l.why}. Phiên tới đặt lệnh bán LO bằng giá tham chiếu hoặc lệnh ATC nếu muốn chắc khớp${isNum(l.proceeds) ? `; tiền về ≈ ${big(l.proceeds)} đ sau phí, thuế` : ""}. Khớp xong bấm "Bán" ở bảng Kế hoạch thoát trong tab Danh mục để hệ thống ghi lãi/lỗ và đánh dấu đã làm.` }
      : { t: `Xem lại luận điểm: ${l.label}`, c: "ref", d: `${l.why}. Việc cần làm: (1) đọc BCTC quý gần nhất – lợi nhuận còn tăng không; (2) so P/E với ngành; (3) nếu lý do mua ban đầu không còn, bán dần 1/2 trong 1–2 tuần; nếu vẫn còn, ghi lại lý do giữ vào Nhật ký.` }));
    else st.push({ t: "Chưa chạm mức thoát nào – giữ", d: near.length ? `Sắp chạm: ${near.map((l) => `${l.label} ${nf(l.price)}`).join("; ")}. Đặt sẵn lệnh chờ trên app CTCK.` : `Mức gần nhất: ${ep.levels.filter((l) => l.price).map((l) => `${l.label} ${nf(l.price)} (${pct(l.dist, 1)})`).slice(0, 2).join("; ")}.` });
    if ((verdict === "buy" || verdict === "lean_buy") && cap) {
      const wNow = (h.qty * px * 1000) / cap * 100;
      if (wNow < maxW - 2 && lv) st.push({ t: `Có thể mua thêm tới trần ${maxW}% vốn (đang ${nf(wNow, 1)}%)`, d: `Chỉ mua thêm trong vùng ${nf(lv.zone[0])}–${nf(lv.zone[1])}, tối đa ${nf(lot(((maxW - wNow) / 100) * cap / (lv.zone[1] * 1000)), 0)} cp; không bình quân giá khi khung tuần đang giảm.` });
    }
    if (verdict === "lean_sell" || verdict === "sell") st.push({ t: "Không mua thêm; cân nhắc giảm 1/3 nếu đóng cửa dưới MA50", c: "down", d: `Điểm tổng thấp (${nf(fbx.total, 0)}). Nếu muốn giữ, giữ tỷ trọng ≤ ${Math.round(maxW / 2)}% vốn và theo đúng điểm dừng ${nf(ep.stop)}.` });
  } else if ((verdict === "buy" || verdict === "lean_buy") && !Object.values(t.styles || {}).some((p) => (p.picks || []).some((x) => x.symbol === sym)) && entryState(d, lv).k !== "now" && entryState(d, lv).k !== "split") {
    const es = entryState(d, lv);
    st.push({ t: `Điểm tổng nghiêng mua nhưng CHƯA vào lệnh: ${es.t}`, c: "ref", d: `${es.why || ""}. Điểm tổng chỉ nói mã tốt hay xấu tương đối; vào lệnh còn cần đúng xu hướng, đúng giá và nằm trong danh sách MUA.` });
    if (lv?.zone) st.push({ t: `Đặt cảnh báo giá ${nf(lv.zone[1])}`, d: `Bấm 🔔 ở trên, chọn "giá giảm tới ≤ ${nf(lv.zone[1])}" hoặc "khi mã vào danh sách MUA" – Telegram sẽ nhắn khi đến lúc.` });
  } else if (verdict === "buy" || verdict === "lean_buy") {
    const zone = pick?.[1]?.zone || lv?.zone, stop = pick?.[1]?.stop ?? lv?.stop, t1 = pick?.[1]?.t1 ?? lv?.t1, t2 = pick?.[1]?.t2 ?? lv?.t2;
    const inZone = zone && px <= zone[1] * 1.005;
    const wPlan = pick?.[1]?.weight ?? Math.min(maxW, 8);
    const money = cap ? cap * Math.min(wPlan, maxW) / 100 : null;
    st.push({ t: `Thị trường: đèn ${LIGHT_VI[reg.light] || "—"} – tổng cổ phiếu tối đa ${expo}% vốn`, d: `${reg.text || ""} ${cap ? `Với vốn ${big(cap)} đ: phần cho ${sym} tối đa ${nf(Math.min(wPlan, maxW), 1)}% ≈ ${big(money)} đ.` : 'Nhập tổng vốn ở tab Danh mục để em tính số cổ phiếu cụ thể.'}` });
    if (zone) {
      const q = money ? lot(money / (zone[1] * 1000)) : null;
      const q1 = q ? lot(q / 2) : null, q2 = q && q1 ? q - q1 : null;
      st.push({ t: inZone ? `Mua trong vùng ${nf(zone[0])}–${nf(zone[1])} – giá đang trong vùng` : `Chờ giá về vùng ${nf(zone[0])}–${nf(zone[1])} (hiện ${nf(px)}, cao hơn ${pct((px / zone[1] - 1) * 100, 1)})`, c: inZone ? "up" : "ref",
        d: `${q ? `Tổng ≈ ${nf(q, 0)} cp. Chia 2 lệnh LO: lệnh 1 ${nf(q1, 0)} cp ở ${nf(zone[1])}; lệnh 2 ${nf(q2, 0)} cp ở ${nf(zone[0])} hoặc khi giá đóng cửa vượt đỉnh 5 phiên gần nhất (xác nhận). ` : ""}Không mua đuổi trên ${nf(zone[1] * 1.02)}. Hàng về T+2: mua hôm nay bán được từ ${addTradingDays(today, 2)}.` });
    }
    if (isNum(stop)) st.push({ t: `Đặt điểm dừng lỗ ${nf(stop)} (${pct((stop / (zone?.[1] || px) - 1) * 100, 1)})`, c: "down",
      d: `${zone && cap ? `Nếu chạm, mất ≈ ${big(lot((cap * Math.min(wPlan, maxW) / 100) / (zone[1] * 1000)) * ((zone[1] - stop) * 1000))} đ (${nf((Math.min(wPlan, maxW) * (1 - stop / zone[1])), 2)}% tổng vốn). ` : ""}Đặt lệnh dừng (stop order) trên app CTCK ngay sau khi khớp mua; dời lên theo bảng "Kế hoạch thoát" khi giá tăng.` });
    if (isNum(t1)) st.push({ t: `Chốt lời từng phần: ${nf(t1)}${isNum(t2) ? ` rồi ${nf(t2)}` : ""}`, c: "up", d: `Đến mục tiêu 1 bán 1/2, đến mục tiêu 2 bán phần còn lại (hoặc theo phong cách anh chọn trong Danh mục).` });
  } else {
    const bb = v.ok && v.reliable ? v.buy_below : null;
    st.push({ t: "Chưa mua lúc này", c: fbCls(verdict), d: `Điểm tổng ${nf(fbx.total, 0)} – ${fbLabel(verdict).toLowerCase()}.` });
    const conds = [];
    if (isNum(bb) && px > bb) conds.push(`giá về ≤ ${nf(bb)} (giá trị hợp lý trừ biên an toàn, còn ${pct((bb / px - 1) * 100, 1)})`);
    if (mt.signs?.W === -1) conds.push("khung tuần chuyển từ Giảm sang Ngang/Tăng");
    if (isNum(fbx.total)) conds.push("điểm tổng lên ≥ 55");
    st.push({ t: "Khi nào xem lại", d: `Đặt cảnh báo giá (nút 🔔) và chờ một trong các điều kiện: ${conds.join("; ") || "điểm tổng cải thiện"}.` });
  }
  if (sup?.verdict && d.season?.same?.h1) { const s1 = d.season.same.h1; st.push({ t: `Mùa vụ: ngày này các năm trước sau 1 tháng TB ${pct(s1.mean, 1)} (${nf(s1.hit * s1.n / 100, 0)}/${s1.n} năm lãi)`, c: SUP_VI[sup.verdict]?.[1], d: `${(SUP_VI[sup.verdict] || [""])[0]}${sup.pros?.length ? ": " + sup.pros.join(", ") : ""}${sup.cons?.length ? "; ngược lại: " + sup.cons.join(", ") : ""}. Chỉ dùng như yếu tố phụ.` }); }
  const checks = [];
  if (ern) checks.push(`${new Date(ern.date + "T00:00:00").toLocaleDateString("vi-VN")}: ${ern.title.split(" (")[0]} – đọc LN quý mới, nếu giảm > 30% so cùng kỳ thì xem lại`);
  checks.push(`${addTradingDays(today, 20)} (20 phiên nữa): mở lại trang này xem điểm tổng và đa khung còn ủng hộ không`);
  st.push({ t: "Mốc kiểm tra", d: checks.join(" · ") });
  st.push({ t: "Điều kiện đổi ý", d: `Bỏ kế hoạch nếu: đóng cửa dưới điểm dừng; điểm tổng xuống < 45; khung tuần và tháng cùng chuyển Giảm; hoặc đèn thị trường chuyển Đỏ khi anh đang nắm quá ${expo}% vốn cổ phiếu.` });
  return st;
}
const stepsHtml = (st, title = "Việc anh nên làm – từng bước") => `<section class="panel sec steps"><div class="ph"><h2>${title}</h2><span class="meta">tính từ số liệu phiên gần nhất</span></div>
  <ol class="stl">${st.map((s) => `<li class="${s.c || ""}"><b>${esc(s.t)}</b><span>${esc(s.d || "")}</span></li>`).join("")}</ol></section>`;

// ================================================================ MÙA VỤ (ngày này / tháng này các năm trước)
const MON_VI = ["Th1", "Th2", "Th3", "Th4", "Th5", "Th6", "Th7", "Th8", "Th9", "Th10", "Th11", "Th12"];
const SUP_VI = { yes: ["Năm nay ủng hộ", "up"], no: ["Năm nay không ủng hộ", "down"], mixed: ["Năm nay chưa rõ", "ref"] };
function oosLine(o) {
  if (!o || !o.ok) return "";
  const s = o.strong || {}, n = o.none || {};
  return `Kiểm chứng ngoài mẫu (${o.years?.[0]}–${o.years?.[1]}, mỗi năm chỉ dùng các năm trước để đoán): tháng được đánh dấu "mùa mạnh" năm sau trung bình <b class="${cls(s.rel)}">${pct(s.rel, 1)}</b> so với VN-Index, ${nf(s.pos, 0)}% lần hơn (${nf(s.n, 0)} lần); các tháng khác ${pct(n.rel, 1)}, ${nf(n.pos, 0)}%.`;
}
function supBox(sup) {
  if (!sup) return "";
  const [t, c] = SUP_VI[sup.verdict] || SUP_VI.mixed;
  return `<div class="sup ${c}"><b>${t}</b>${sup.pros?.length ? `<span class="up">＋ ${sup.pros.map(esc).join(" · ")}</span>` : ""}${sup.cons?.length ? `<span class="down">− ${sup.cons.map(esc).join(" · ")}</span>` : ""}</div>`;
}
function seasonPanel(sp, sup, opt = {}) {
  if (!sp || !sp.same) return "";
  const S = sp.same, rel = !opt.index, today = new Date((sp.date || "") + "T00:00:00");
  const dd = isNaN(today) ? "" : today.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
  const hcell = (k) => { const h = S[`h${k}`]; if (!h) return `<div><small>Sau ${k} tháng</small><b>—</b></div>`;
    return `<div class="${rel ? (seasonStrong(h) ? "hot" : "") : ""}"><small>Sau ${k} tháng</small><b class="${cls(h.mean)}">${pct(h.mean, 1)}</b><small>${nf(h.hit * h.n / 100, 0)}/${h.n} năm lãi${rel && isNum(h.rel) ? ` · so VN-Index <b class="${cls(h.rel)}">${pct(h.rel, 1)}</b> (${nf(h.relhit, 0)}% năm hơn)` : ""}</small></div>`; };
  const nowM = isNaN(today) ? 0 : today.getMonth() + 1;
  const months = sp.months || [];
  const mcell = (x) => { const v = rel ? x.rel : x.mean, hit = rel ? x.relhit : x.hit;
    return `<td class="${x.m === nowM ? "now" : ""}${seasonStrong(x) && rel ? " strong" : ""}" style="background:${isNum(v) ? heatColor(v, 4) : "transparent"};color:${isNum(v) ? "#fff" : "inherit"}" title="${MON_VI[x.m - 1]}: TB ${pct(x.mean, 1)}${rel ? `, so VN-Index ${pct(x.rel, 1)}` : ""}, ${nf(hit, 0)}% năm ${rel ? "hơn VN-Index" : "tăng"} (${x.n} năm)">${isNum(v) ? nf(v, 1) : ""}<small>${isNum(hit) ? nf(hit, 0) + "%" : ""}</small></td>`; };
  const years = (S.years || []).slice().reverse();
  return `<section class="panel"><div class="ph"><h2>Ngày ${dd} các năm trước</h2><span class="meta">${S.years?.length || 0} năm dữ liệu</span></div>
    <p class="faint" style="font-size:.76rem;margin:-2px 0 6px">Nếu mua đúng ngày ${dd} ở mỗi năm trước rồi giữ 1 / 2 / 3 tháng (21 / 42 / 63 phiên):</p>
    <div class="sgrid">${[1, 2, 3].map(hcell).join("")}</div>
    ${supBox(sup)}
    <div class="tw sec"><table class="seas"><thead><tr><th class="l"></th>${MON_VI.map((m, i) => `<th class="${i + 1 === nowM ? "now" : ""}">${m}</th>`).join("")}</tr></thead>
      <tbody><tr><td class="l">${rel ? "So với VN-Index" : "Trung bình"}<br><small>% năm ${rel ? "hơn" : "tăng"}</small></td>${months.map(mcell).join("")}</tr></tbody></table></div>
    ${years.length ? `<details class="sec"><summary>Từng năm</summary><div class="tw"><table><thead><tr><th class="l">Năm</th><th>Ngày mua</th><th>Sau 1 tháng</th><th>Sau 2 tháng</th><th>Sau 3 tháng</th>${rel ? "<th>1 tháng so VN-Index</th>" : ""}</tr></thead><tbody>
      ${years.map((y) => `<tr><td class="l">${y.year}</td><td>${esc(y.date)}</td>${[1, 2, 3].map((k) => `<td class="${cls(y[`r${k}`])}">${pct(y[`r${k}`], 1)}</td>`).join("")}${rel ? `<td class="${cls(y.rel1)}">${pct(y.rel1, 1)}</td>` : ""}</tr>`).join("")}</tbody></table></div></details>` : ""}
    <p class="faint" style="font-size:.72rem;margin-top:6px">Ô viền vàng = mùa mạnh theo ngưỡng chặt (≥ 8 năm dữ liệu, ≥ 75% số năm hơn VN-Index, trung bình hơn ≥ 3%). ${opt.oos ? oosLine(opt.oos) : ""} Mùa vụ chỉ đáng tin khi số liệu năm nay cũng ủng hộ.</p></section>`;
}
const seasonStrong = (x) => x && (x.n || 0) >= 8 && (x.rel || 0) >= 3 && (x.relhit || 0) >= 75;
// ================================================================ BIẾN ĐỘNG: TRONG PHIÊN & HÀNH VI GIÁ (đẩy/xả, đảo chiều, tay to)
let __live = null, __liveAt = 0;
async function liveData(force) {
  if (!force && __live && Date.now() - __liveAt < 60000) return __live;
  try {
    const r = await fetch("api/intraday", { cache: "no-store" });
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) { __live = await r.json(); __liveAt = Date.now(); return __live; }
  } catch (e) { /* chạy trên máy */ }
  __live = (await tryLoad("data/live_last.json")) || { ok: false };
  __liveAt = Date.now();
  return __live;
}
const todayVN = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const liveFresh = (L) => !!(L && L.ok && L.date === todayVN());
const SLOT_VI = { noon: "giữa phiên (11:35)", atc: "trước ATC (14:35)", after: "sau giờ" };
const LFLAG = {
  leave_c: ["chạm trần rồi rời", "down", "sw_leave_c"], at_ceil: ["đang trần", "ceil", "board_px"], rec_f: ["chạm sàn rồi kéo", "up", "sw_rec_f"], at_floor: ["đang sàn", "floor", "board_px"],
  fade_hi: ["xả từ đỉnh phiên", "down", "sw_fade_hi"], bounce_lo: ["kéo từ đáy phiên", "up", "sw_fade_hi"], pump_am: ["sáng tăng – mã hay bị xả chiều", "down", "sw_fade"],
  dump_am: ["sáng giảm – mã hay được kéo chiều", "up", "sw_bounce"], fade_pm: ["sáng đẩy, chiều xả", "down", "sw_fade"], bounce_pm: ["sáng đạp, chiều kéo", "up", "sw_bounce"],
  vol: ["KL bất thường", "ref", "sw_pace"], f_sell: ["khối ngoại bán ròng mạnh", "down", "sw_fnet"], f_buy: ["khối ngoại mua ròng mạnh", "up", "sw_fnet"],
};
const SSIG = {
  pump_spike: ["Đẩy rồi xả + KL lớn", "down"], pump: ["Đẩy rồi xả", "down"], dump_spike: ["Đạp rồi kéo + KL lớn", "up"], dump: ["Đạp rồi kéo", "up"],
  leave_c: ["Chạm trần rồi rời", "down"], rec_f: ["Chạm sàn rồi kéo", "up"], push: ["Tăng mạnh, KL lớn", "up"], flush: ["Bán tháo, KL lớn", "down"],
  fade_today: ["Sáng đẩy – chiều xả", "down"], bounce_today: ["Sáng đạp – chiều kéo", "up"], atc_up: ["Kéo ATC", "ref"], atc_dn: ["Đạp ATC", "ref"],
  wide: ["Biên độ bất thường", "ref"], spike: ["KL đột biến, giá đứng", "ref"],
};
const SIG_G = { pump_spike: "sw_pump_spike", pump: "sw_pump_spike", dump_spike: "sw_dump_spike", dump: "sw_dump_spike", leave_c: "sw_leave_c", rec_f: "sw_rec_f",
  push: "sw_push", flush: "sw_push", fade_today: "sw_fade", bounce_today: "sw_bounce", atc_up: "sw_atc", atc_dn: "sw_atc", wide: "sw_rng", spike: "sw_pace" };
const flagPill = (f) => { const x = LFLAG[f]; return x ? `<span class="pill fl ${x[1]}" data-g="${x[2]}">${x[0]}</span>` : ""; };
const sigPill = (k) => { const x = SSIG[k]; return x ? `<span class="pill fl ${x[1]}" data-g="${SIG_G[k] || "sw_score"}">${x[0]}</span>` : ""; };
const tagPill = (t) => `<span class="pill tag" data-g="sw_tags">${esc(t)}</span>`;
const B_LABELS = ["9:30", "10:00", "10:30", "11:00", "11:30", "13:30", "14:00", "14:30", "ATC"];

function swSorter(tableId, rows, cols, render, init) {
  // cols: [{k, t, g, num}] · render(row) -> <tr> ; click tiêu đề để sắp xếp
  const st = { k: init?.k || cols[0].k, asc: !!init?.asc };
  const el = document.getElementById(tableId);
  if (!el) return;
  const draw = () => {
    const R = rows.slice().sort((a, b) => {
      const x = a[st.k], y = b[st.k];
      if (!isNum(x) && !isNum(y)) return String(x ?? "").localeCompare(String(y ?? ""));
      if (!isNum(x)) return 1; if (!isNum(y)) return -1;
      return st.asc ? x - y : y - x;
    });
    el.innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c.k}" class="${c.num ? "" : "l"} srt ${st.k === c.k ? "on" : ""}"${c.g ? ` data-g="${c.g}"` : ""}>${c.t}${st.k === c.k ? (st.asc ? " ▴" : " ▾") : ""}</th>`).join("")}</tr></thead>
      <tbody>${R.slice(0, init?.limit || 400).map(render).join("") || `<tr><td colspan="${cols.length}" class="muted l">Không có mã nào.</td></tr>`}</tbody>`;
    el.querySelectorAll("th[data-k]").forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (st.k === k) st.asc = !st.asc; else { st.k = k; st.asc = false; } draw(); }));
  };
  draw();
}

function pathSvg(own, mkt, live, opt = {}) {
  const S = [];
  if (Array.isArray(own) && own.some(isNum)) S.push({ name: opt.ownName || "Trung bình của mã", color: css("--brand"), pts: own.map((y, i) => ({ x: B_LABELS[i], y })) });
  if (Array.isArray(mkt) && mkt.some(isNum)) S.push({ name: "Trung bình thị trường", color: css("--ink-3"), dash: "4 3", pts: mkt.map((y, i) => ({ x: B_LABELS[i], y })) });
  if (Array.isArray(live) && live.some(isNum)) S.push({ name: "Hôm nay", color: css("--ceil"), width: 2.2, pts: B_LABELS.map((x, i) => ({ x, y: live[i] })) });
  if (!S.length) return `<p class="muted">Chưa đủ dữ liệu nến phút (hệ thống đang tải dần ~6 tháng).</p>`;
  return lineSvg(S, { h: opt.h || 150, zero: true, dec: 1, ticks: 9, hlines: [{ y: 0, color: "var(--ink-3)" }], label: "đường đi trung bình trong phiên" });
}

function personalLine(p, rows) {
  const r = rows[p.symbol] || {};
  const a = `<a href="#/s/${p.symbol}"><b>${p.symbol}</b></a>`;
  if (p.kind === "exit") {
    const act = (p.sell || 0) >= 0.999 ? "bán hết" : !p.sell ? "xem lại luận điểm" : `bán ${Math.round(p.sell * 100)}% (≈ ${nf(p.qty, 0)} cp)`;
    return p.hit ? `<li class="pl down">${a} <b>ĐÃ CHẠM</b> ${esc(p.label || "")} ${nf(p.price)} – giá ${nf(p.px)} → <b>${act}</b>. Đặt lệnh ngay trên app CTCK${p.sell >= 0.999 ? " (LO tại giá hiện tại hoặc ATC)" : ""}.</li>`
      : `<li class="pl ref">${a} còn ${nf(p.dist, 1)}% tới ${esc(p.label || "")} ${nf(p.price)} – giá ${nf(p.px)} · ${act}. Đặt sẵn lệnh chờ trên app nếu CTCK hỗ trợ lệnh điều kiện.</li>`;
  }
  if (p.kind === "flag") return `<li class="pl">${a}${p.held ? "" : " <span class='muted'>(theo dõi)</span>"} ${nf(r.px)} <b class="${cls(r.chg)}">${pct(r.chg)}</b>: ${(p.flags || []).map(flagPill).join(" ")} <small class="blk">${esc(liveAdvice(p.flags, p.held))}</small></li>`;
  if (p.kind === "alert") return `<li class="pl">${a} 🔔 ${esc(p.text)}${p.note ? ` <small class="muted">${esc(p.note)}</small>` : ""}</li>`;
  if (p.kind === "pick_in") return `<li class="pl up">${a} đang trong vùng mua ${nf(p.zone[0])}–${nf(p.zone[1])} (giá ${nf(p.px)}) → đặt LO trong vùng, dừng lỗ ${nf(p.stop)}. Xem số lượng ở <a href="#/">Hôm nay</a>.</li>`;
  if (p.kind === "pick_chase") return `<li class="pl ref">${a} ${nf(p.px)} đã vượt ${nf(p.chase)} – <b>không mua đuổi</b>, chờ về vùng ${nf(p.zone[0])}–${nf(p.zone[1])}.</li>`;
  return "";
}
function persList(pers, rows, max = 60) {
  const ins = pers.filter((p) => p.kind === "pick_in"), rest = pers.filter((p) => p.kind !== "pick_in");
  let h = rest.slice(0, max).map((p) => personalLine(p, rows)).join("");
  if (ins.length > 4) h += `<li class="pl up"><b>${ins.length} mã trong danh sách mua đang ở vùng mua:</b> ${ins.map((p) => `<a href="#/s/${p.symbol}"><b>${p.symbol}</b></a> ${nf(p.px)} <small class="faint">(${nf(p.zone[0])}–${nf(p.zone[1])})</small>`).join(" · ")}. Đặt LO trong vùng theo số lượng ở <a href="#/">Hôm nay</a>, dừng lỗ như kế hoạch.</li>`;
  else h += ins.map((p) => personalLine(p, rows)).join("");
  return h;
}
function liveAdvice(flags, held) {
  const F = new Set(flags || []);
  if (F.has("leave_c") || F.has("fade_pm") || F.has("fade_hi")) return held ? "Đang nắm: giữ kỷ luật điểm dừng, lãi nhiều có thể chốt bớt; không mua thêm hôm nay." : "Không mua đuổi – người đẩy giá có thể đang thoát hàng.";
  if (F.has("pump_am")) return held ? "Đang lãi: cân nhắc chốt bớt ở giá cao buổi chiều." : "Đừng mua đuổi buổi chiều – lịch sử mã này hay bị xả lại.";
  if (F.has("dump_am") || F.has("rec_f") || F.has("bounce_lo")) return "Đừng bán tháo theo đám đông – mã này hay được kéo lại; vẫn tôn trọng điểm dừng.";
  if (F.has("vol")) return "KL bất thường – có thể có thông tin: đọc tin trước khi đặt lệnh.";
  if (F.has("f_sell")) return "Khối ngoại bán ròng mạnh – theo dõi, đừng bắt đáy vội.";
  return "";
}

function liveSection(L, mine) {
  if (!L || !L.ok) return `<section class="panel"><div class="ph"><h2>Trong phiên</h2></div><p class="muted">Chưa có lượt chạy trong phiên nào. Hệ thống chạy lúc 11:35 và 14:35 các ngày giao dịch (và 15:35 sau đóng cửa).</p></section>`;
  const rows = Object.fromEntries((L.rows || []).map((r) => [r.s, r]));
  const fresh = liveFresh(L), ix = L.index?.VNINDEX || {};
  const pers = L.personal || [];
  const order = { exit: 0, alert: 1, flag: 2, pick_in: 3, pick_chase: 4 };
  pers.sort((a, b) => (order[a.kind] - order[b.kind]) || ((b.hit ? 1 : 0) - (a.hit ? 1 : 0)));
  return `<section class="panel hero live ${fresh ? "" : "stale"}">
    <div class="ph"><h2>Trong phiên ${esc((L.at || "").slice(11, 16))} · ${esc(SLOT_VI[L.slot] || L.slot || "")}</h2>
      <span class="meta">${fresh ? "" : `<b class="down">dữ liệu ngày ${esc(L.date)}</b> · `}VN-Index ${nf(ix.close)} <b class="${cls(ix.chg)}">${pct(ix.chg, 2)}</b> · ${nf(L.n, 0)} mã · cập nhật 11:35 / 14:35 / 15:35</span></div>
    ${pers.length ? `<h3 class="sub">Việc của anh ngay bây giờ</h3><ul class="plist">${persList(pers, rows)}</ul>` : `<p class="muted">Không có việc gấp với danh mục, danh sách theo dõi và danh sách mua.</p>`}
    <div class="ph" style="margin-top:10px"><h3>Bảng giá trong phiên</h3><span class="seg" id="lvF"><button data-v="mine" class="on">Mã của anh</button><button data-v="abn">Bất thường</button><button data-v="all">Tất cả</button></span></div>
    <div class="tw"><table id="lvT" class="lvt"></table></div>
    <p class="faint" style="font-size:.72rem;margin-top:4px">KL so cùng giờ = khối lượng đã khớp ÷ khối lượng thường có tới giờ này (theo nhịp khớp lệnh 60 phiên gần nhất của mã). Sáng = giá 11:30 so với tham chiếu; chiều = giá hiện tại/14:30 so với 11:30. Không phải dữ liệu thời gian thực – mỗi ngày 3 lượt.</p></section>`;
}
function bindLive(L, mine) {
  if (!L || !L.ok || !$("#lvT")) return;
  const R = (L.rows || []).map((r) => ({ ...r, nf: (r.flags || []).length, abn: (r.flags || []).filter((f) => !["at_ceil", "at_floor"].includes(f)).length }));
  const cols = [{ k: "s", t: "Mã" }, { k: "px", t: "Giá", num: 1 }, { k: "chg", t: "%", num: 1, g: "chg" }, { k: "hi", t: "Cao", num: 1, g: "sw_fade_hi" }, { k: "lo", t: "Thấp", num: 1, g: "sw_fade_hi" },
    { k: "fh", t: "Từ đỉnh", num: 1, g: "sw_fade_hi" }, { k: "m_ret", t: "Sáng", num: 1, g: "sw_fade" }, { k: "a_ret", t: "Chiều", num: 1, g: "sw_fade" }, { k: "pace", t: "KL so cùng giờ", num: 1, g: "sw_pace" },
    { k: "val", t: "GTGD", num: 1, g: "gtgd" }, { k: "fn", t: "NN ròng", num: 1, g: "sw_fnet" }, { k: "abn", t: "Dấu hiệu", num: 1 }];
  const render = (r) => `<tr><td class="l"><a href="#/s/${r.s}"><b>${r.s}</b></a></td><td class="${boardCls(r.chg, "")}">${nf(r.px)}</td><td class="${cls(r.chg)}">${pct(r.chg)}</td>
    <td class="${cls(r.hi)}">${pct(r.hi)}</td><td class="${cls(r.lo)}">${pct(r.lo)}</td><td class="${(r.fh || 0) <= -2 ? "down" : ""}">${pct(r.fh)}</td>
    <td class="${cls(r.m_ret)}">${pct(r.m_ret)}</td><td class="${cls(r.a_ret)}">${pct(r.a_ret)}</td><td class="${(r.pace || 0) >= 2.5 ? "ceil" : ""}">${isNum(r.pace) ? nf(r.pace, 1) + "×" : "—"}</td>
    <td>${nf(r.val, 0)}</td><td class="${cls(r.fn)}">${nf(r.fn, 1)}</td><td class="l wrap">${(r.flags || []).map(flagPill).join(" ")}</td></tr>`;
  const go = (v) => {
    const rows = v === "mine" ? R.filter((r) => mine.has(r.s)) : v === "abn" ? R.filter((r) => r.abn > 0 && (r.val || 0) >= 3) : R.filter((r) => (r.val || 0) >= 1);
    swSorter("lvT", rows, cols, render, { k: v === "mine" ? "chg" : "abn", limit: v === "all" ? 300 : 200 });
  };
  $$("#lvF button").forEach((b) => (b.onclick = () => { $$("#lvF button").forEach((x) => x.classList.toggle("on", x === b)); go(b.dataset.v); }));
  const first = R.some((r) => mine.has(r.s)) ? "mine" : "abn";
  $$("#lvF button").forEach((x) => x.classList.toggle("on", x.dataset.v === first));
  go(first);
}

function sigCard(x, mine) {
  const ret = x.ret, hist = (x.hist || []).map((h) => `<li>${esc(SSIG[h.k]?.[0] || h.k)}: sau 5 phiên TB <b class="${cls(h.r5)}">${pct(h.r5, 2)}</b> so với VN-Index, ${nf(h.hit5, 0)}% số lần hơn (n = ${nf(h.n, 0)})${h.useful ? ' · <b class="up">ổn định qua 2 giai đoạn</b>' : ' · <span class="muted">không ổn định / không có ý nghĩa thống kê</span>'}${isNum(h.own_n) && h.own_n > 0 ? ` · riêng mã này ${nf(h.own_n, 0)} lần, TB ${pct(h.own_r5, 1)}` : ""}</li>`).join("");
  return `<div class="sgc ${x.dir < 0 ? "neg" : x.dir > 0 ? "pos" : ""} ${mine.has(x.symbol) ? "mine" : ""}">
    <div class="sgh"><a href="#/s/${x.symbol}"><b>${x.symbol}</b></a> <b class="${cls(ret)}">${pct(ret)}</b> ${(x.sig || []).map(sigPill).join(" ")}
      <span class="meta">điểm bất thường ${scoreCell(x.score)}</span></div>
    <div class="sgn"><span>Biên độ <b>${nf(x.rng, 1)}%</b> <small>(bình thường ${nf(x.typ, 1)}%)</small></span><span>KL <b>${nf(x.vol_x, 1)}×</b></span>
      ${isNum(x.m_ret) ? `<span>Sáng <b class="${cls(x.m_ret)}">${pct(x.m_ret)}</b> · chiều <b class="${cls(x.a_ret)}">${pct(x.a_ret)}</b>${isNum(x.atc_ret) ? ` · ATC <b class="${cls(x.atc_ret)}">${pct(x.atc_ret)}</b>` : ""}</span>` : ""}
      <span>Cao ${nf(x.hi)} · thấp ${nf(x.lo)} · đóng ${nf(x.close)}</span></div>
    <p>${esc(x.meaning || "")}</p>
    ${hist ? `<ul class="sgl">${hist}</ul>` : ""}
    <p class="adv"><b>Nên làm:</b> ${esc(x.advice || "")}</p>
    ${(x.news || []).length ? `<div class="nws">${x.news.map((n) => `<a href="${esc(n.link)}" target="_blank" rel="noopener">📰 ${esc(n.title)}</a> <small class="faint">${esc(n.t)} · ${esc(n.src)}</small>`).join("<br>")}</div>` : `<small class="faint">Không thấy tin nào nhắc mã này trong 3 ngày (CafeF, VnExpress) – có thể là dòng tiền chứ không phải thông tin.</small>`}
  </div>`;
}

// ---- dòng tiền lớn (gom / xả / bứt phá) + tâm lý thị trường
const FLOW_ST = { acc: ["Gom âm thầm", "up", "fl_acc"], dist: ["Xả âm thầm", "down", "fl_dist"], brk: ["Bứt phá có KL", "up", "fl_brk"], acc_brk: ["Gom rồi bứt phá", "up", "fl_brk"] };
const flowPill = (k) => { const x = FLOW_ST[k]; return x ? `<span class="pill fl ${x[1]}" data-g="${x[2]}">${x[0]}</span>` : ""; };
function flowAdvice(k, E) {
  const e = (E || {})[k] || {}, b = (E || {})._base || {};
  const hist = isNum(e.r20) ? `Lịch sử (${nf(e.n, 0)} lần từ 2016): 20 phiên sau TB ${pct(e.r20, 2)} so với VN-Index (mốc ${pct(b.r20, 2)}), ${nf(e.game, 0)}% số lần có nhịp +20% trong 60 phiên (mốc ${nf(b.game, 0)}%)${e.useful ? "" : " – chưa có ý nghĩa thống kê"}.` : "";
  const act = { dist: "Đang nắm: siết dừng, hồi lên thì bán bớt; chưa nắm: đứng ngoài.",
    acc: "Chỉ là dấu hiệu theo dõi – gom đơn thuần không dự báo được \"game\". Đặt cảnh báo giá ở đỉnh 20 phiên; chỉ mua khi BỨT PHÁ có KL.",
    brk: "Có thể vào 1 phần khi giá giữ trên đỉnh cũ; dừng lỗ dưới đỉnh cũ / đáy phiên bứt phá.",
    acc_brk: "Gom trước rồi bứt phá: vào 1 phần, dừng dưới vùng gom; lịch sử không tốt hơn bứt phá thường – đừng kỳ vọng quá." }[k] || "";
  return `${hist} ${act}`.trim();
}
function flowLine(x, E) {
  if (!x) return "";
  const st = x.st || [];
  const facts = `KL ${nf(x.vr, 1)}× bình thường · giá ${pct(x.pchg)} trong ${FLOW_N} phiên · KL phiên tăng/giảm ${nf(x.ud, 2)} · nến đóng ${isNum(x.clv) ? (x.clv > 0 ? "nửa trên" : "nửa dưới") : "—"}${isNum(x.delta10) ? ` · mua − bán chủ động 10 phiên ${pct(x.delta10, 1)} (${x.delta_pos}/${x.delta_n} phiên dương)` : ""}${isNum(x.shark5) ? ` · cá mập 5 phiên ${nf(x.shark5, 1)} tỷ` : ""}`;
  if (!st.length) return `<p class="faint" style="font-size:.76rem">Dòng tiền lớn: không có dấu hiệu gom/xả rõ (${facts}).</p>`;
  return `<div class="flw">${st.map(flowPill).join(" ")}${x.acc_days ? ` <small>${x.acc_days} phiên liên tiếp</small>` : ""}${x.dist_days ? ` <small>${x.dist_days} phiên liên tiếp</small>` : ""}<br><small>${facts}</small><br><small class="muted">${esc(flowAdvice(st[0], E))}</small></div>`;
}
let FLOW_N = 10;
function moodGauge(S, big = true) {
  if (!S || !isNum(S.now)) return "";
  const c = S.now >= 60 ? "up" : S.now < 40 ? "down" : "ref";
  return `<div class="mood ${big ? "big" : ""}"><b class="${c}">${nf(S.now, 0)}</b><span>/100 · <b>${esc(S.label)}</b>${isNum(S.chg5) ? ` · ${S.chg5 > 0 ? "+" : ""}${nf(S.chg5, 0)} so với tuần trước` : ""}</span>
    <div class="mbar"><i style="left:${Math.max(0, Math.min(100, S.now))}%"></i></div><small class="mlab"><span>Sợ hãi</span><span>Thận trọng</span><span>Trung tính</span><span>Lạc quan</span><span>Hưng phấn</span></small></div>`;
}
// ---- mã có sự kiện & điểm vào sau sự kiện (app/analysis/events.py)
const EV_NOTE = "Kiểm chứng 560 đợt 2016–2026: mua ngay khi giá sập hoặc mua nhịp hồi sớm thường thua thị trường và còn sụt thêm ~30%. Vào khi sự kiện đã nguội (≥ 120 phiên từ lúc có cờ và ≥ 60 phiên liền không giảm sàn) thì thắng thị trường, rõ nhất ở DN có lãi, nợ thấp.";
function eventsPanel(t) {
  const P = t.post_event || [], A = t.event_active || [];
  if (!P.length && !A.length) return "";
  const row = (x) => `<tr><td class="l"><a href="#/s/${x.symbol}"><b>${x.symbol}</b></a> <small class="faint">${esc((x.sector || "").slice(0, 18))}</small>${x.quality ? "" : ' <span class="pill">lỗ / nợ cao</span>'}</td>
    <td>${nf(x.price)}</td><td class="down">${pct(x.dd_now, 0)}</td><td class="up">${pct(x.from_low, 0)}</td><td>${nf(x.since, 0)} / ${nf(x.quiet, 0)}</td>
    <td>${nf(x.zone?.[0])}–${nf(x.zone?.[1])}</td><td class="down">${nf(x.stop)}</td><td class="up">${nf(x.t1)} <small>${pct(x.t1_pct, 0)}</small></td></tr>`;
  return `<section class="panel sec evp"><div class="ph"><h2 data-g="ev_post">🎯 Cơ hội sau sự kiện</h2><span class="meta">${P.filter((x) => x.quality).length} mã đủ điều kiện · ${A.length} mã đang có sự kiện (chờ nguội)</span></div>
    ${P.length ? `<div class="tw"><table><thead><tr><th class="l">Mã</th><th>Giá</th><th>So với đỉnh trước sự kiện</th><th>Từ đáy</th><th>Phiên từ cờ / không giảm sàn</th><th>Vùng vào</th><th>Cắt lỗ</th><th>Mục tiêu</th></tr></thead><tbody>${P.map(row).join("")}</tbody></table></div>`
      : `<p class="muted">Chưa có mã nào qua giai đoạn nguội.</p>`}
    ${A.length ? `<details style="margin-top:6px"><summary>⚡ Đang có sự kiện – chưa vào (${A.length} mã)</summary><div class="tw"><table><thead><tr><th class="l">Mã</th><th>Từ</th><th>So với đỉnh trước</th><th>Phiên giảm sàn</th><th>Còn chờ</th></tr></thead><tbody>
      ${A.map((x) => `<tr><td class="l"><a href="#/s/${x.symbol}"><b>${x.symbol}</b></a></td><td>${esc(x.start)}</td><td class="down">${pct(x.dd_now, 0)}</td><td>${x.n_down}</td><td><small>${x.wait_since ? `${x.wait_since} phiên nữa đủ 120` : ""}${x.wait_since && x.wait_quiet ? " · " : ""}${x.wait_quiet ? `${x.wait_quiet} phiên không giảm sàn` : ""}</small></td></tr>`).join("")}</tbody></table></div></details>` : ""}
    <p class="faint" style="font-size:.72rem;margin-top:6px">${EV_NOTE} Mua 1/2 ngay, 1/2 khi chỉnh về vùng dưới; cắt lỗ −15%; nắm 6–12 tháng. Chỉ 23% số đợt quay lại được ≥ 90% đỉnh cũ trong 1 năm – mục tiêu lấy thận trọng.</p></section>`;
}
function eventBox(v, sym) {
  const P = v?.post_event, E = v?.event;
  if (P) { const p = P.plan || {};
    return `<section class="panel sec evp"><div class="ph"><h2 data-g="ev_post">🎯 ${esc(sym)}: điểm vào sau sự kiện</h2><span class="pill ${p.quality ? "buy" : ""}">${p.quality ? "đủ điều kiện" : "chỉ theo dõi"}</span></div>
      ${kpis([["Sự kiện từ", esc(P.start)], ["Phiên từ cờ / không giảm sàn", `${P.since} / ${P.quiet}`], ["So với đỉnh trước", pct(P.dd_now, 0), "down"], ["Từ đáy " + esc(P.low_date || ""), pct(P.from_low, 0), "up"],
        ["Vùng vào", `${nf(p.zone?.[0])}–${nf(p.zone?.[1])}`], ["Cắt lỗ", nf(p.stop), "down"], ["Mục tiêu", `${nf(p.t1)} <small>${pct(p.t1_pct, 0)}</small>`, "up"]], false, "c4")}
      <p class="note" style="margin-top:6px">${esc(p.split || "")}. ${esc(p.edge || "")}</p></section>`; }
  if (E) return `<section class="panel sec evp"><div class="ph"><h2 data-g="ev_post">⚡ ${esc(sym)}: có sự kiện – chưa vào</h2><span class="meta">từ ${esc(E.start)}</span></div>
      ${kpis([["So với đỉnh trước", pct(E.dd_now, 0), "down"], ["Phiên giảm sàn", nf(E.n_down, 0)], ["Phiên từ lúc có cờ", `${E.since} <small>cần 120</small>`], ["Phiên không giảm sàn", `${E.quiet} <small>cần 60</small>`]], false, "c4")}
      <p class="note" style="margin-top:6px">${EV_NOTE} ${E.wait_since || E.wait_quiet ? `Còn chờ: ${[E.wait_since ? E.wait_since + " phiên nữa đủ 120" : "", E.wait_quiet ? E.wait_quiet + " phiên liền không giảm sàn" : ""].filter(Boolean).join(" · ")}. Hệ thống tự báo khi đến điểm vào nếu mã có trong danh sách theo dõi.` : ""}</p></section>`;
  return "";
}
function moodStrip(FJ) {
  if (!FJ?.sentiment) return "";
  const S = FJ.sentiment, k = FJ.count || {};
  return `<section class="panel sec moodstrip"><div class="ph"><h2 data-g="mood">Tâm lý thị trường</h2><span class="meta"><a href="#/digest">📰 Bản tin phiên</a> · <a href="#/swing/mood">chi tiết & kiểm chứng</a></span></div>
    <div class="ms-row">${moodGauge(S, false)}<div class="ms-k"><a href="#/swing/flow"><b class="down">${nf(k.dist, 0)}</b> mã xả âm thầm</a><a href="#/swing/flow"><b class="up">${nf(k.acc, 0)}</b> mã gom âm thầm</a><a href="#/swing/flow"><b class="up">${nf(k.brk, 0)}</b> mã bứt phá có KL</a></div></div></section>`;
}
function flowView(FJ, mine) {
  FLOW_N = FJ.window || 10;
  const E = FJ.events || {}, R = FJ.rows || [];
  const evRows = ["dist", "acc", "brk", "acc_brk", "_base"].filter((k) => E[k]).map((k) => { const e = E[k]; return `<tr${k === "_base" ? ' class="muted"' : ""}><td class="l"><b>${esc(e.name)}</b></td><td>${nf(e.n, 0)}</td><td class="${cls(e.r20)}">${pct(e.r20, 2)}</td><td>${nf(e.t20, 1)}</td><td class="${cls(e.r60)}">${pct(e.r60, 2)}</td><td>${isNum(e.game) ? nf(e.game, 0) + "%" : "—"}${isNum(e.game_x) && k !== "_base" ? ` <small class="${cls(e.game_x)}">(${e.game_x > 0 ? "+" : ""}${nf(e.game_x, 0)})</small>` : ""}</td><td>${isNum(e.r20_a) ? `${pct(e.r20_a, 2)} / ${pct(e.r20_b, 2)}` : "—"}</td><td>${k === "_base" ? "" : e.useful ? '<b class="up">có</b>' : '<span class="muted">không</span>'}</td></tr>`; }).join("");
  const tbl = (key, title, rows) => `<section class="panel"><div class="ph"><h2>${title}</h2><span class="meta">${rows.length} mã</span></div>
    <p class="faint" style="font-size:.74rem;margin:0 0 4px">${esc(flowAdvice(key, E))}</p>
    <div class="tw"><table class="flt"><thead><tr><th class="l">Mã</th><th data-g="fl_streak">Liên tiếp</th><th data-g="fl_streak">Trong 20p</th><th data-g="fl_vr">KL ×</th><th data-g="chg">Giá ${FLOW_N}p</th><th data-g="fl_ud">KL tăng/giảm</th><th data-g="fl_clv">Đóng cửa</th><th data-g="orderflow">Mua−bán chủ động 10p</th><th data-g="sw_shark">Cá mập 5p</th><th data-g="chg">1 tháng</th><th data-g="gtgd">GTGD</th></tr></thead>
    <tbody>${rows.map((x) => `<tr class="${mine.has(x.s) ? "mine" : ""}"><td class="l"><a href="#/s/${x.s}"><b>${x.s}</b></a> <small class="faint">${esc((x.sector || "").slice(0, 16))}</small></td>
      <td>${key === "dist" ? nf(x.dist_days, 0) : key === "acc" ? nf(x.acc_days, 0) : "—"}</td><td>${key === "dist" ? nf(x.dist_20, 0) : nf(x.acc_20, 0)}</td><td>${nf(x.vr, 1)}×</td><td class="${cls(x.pchg)}">${pct(x.pchg)}</td>
      <td class="${(x.ud || 1) >= 1.2 ? "up" : (x.ud || 1) <= 0.8 ? "down" : ""}">${nf(x.ud, 2)}</td><td class="${cls(x.clv)}">${isNum(x.clv) ? (x.clv > 0 ? "nửa trên" : "nửa dưới") : "—"}</td>
      <td class="${cls(x.delta10)}">${isNum(x.delta10) ? `${pct(x.delta10, 1)} <small>${x.delta_pos}/${x.delta_n}</small>` : '<small class="faint">chưa có</small>'}</td><td class="${cls(x.shark5)}">${isNum(x.shark5) ? nf(x.shark5, 1) : "—"}</td>
      <td class="${cls(x.chg1m)}">${pct(x.chg1m)}</td><td>${nf(x.val, 0)}</td></tr>`).join("") || `<tr><td colspan="11" class="l muted">Không có mã nào.</td></tr>`}</tbody></table></div></section>`;
  const sortMine = (a, b) => (mine.has(b.s) - mine.has(a.s)) || ((b.vr || 0) - (a.vr || 0));
  const dist = R.filter((x) => (x.st || []).includes("dist")).sort(sortMine), acc = R.filter((x) => (x.st || []).includes("acc")).sort(sortMine);
  const brk = R.filter((x) => (x.st || []).some((k) => k === "brk" || k === "acc_brk")).sort(sortMine);
  return `<p class="note">"Tay to" để lại dấu vết ở <b>khối lượng</b> và <b>cách giá đóng cửa</b>: gom thì KL lớn nhiều phiên nhưng giá bị giữ đi ngang, nến đóng cửa cao, KL phiên tăng lớn hơn phiên giảm; xả thì ngược lại. Hệ thống quét mọi mã thanh khoản mỗi ngày và <b>kiểm chứng trên dữ liệu VN từ 2016</b> xem sau đó có "game" (+20% trong 60 phiên) thật không. Kết quả thẳng thắn: <b>xả âm thầm</b> báo trước giá kém đi; <b>gom âm thầm đơn thuần không dự báo được game</b> – chỉ khi giá <b>bứt phá có KL</b> thì xác suất có nhịp +20% mới tăng rõ.</p>
    <section class="panel sec"><div class="ph"><h2>Kiểm chứng: sau mỗi dấu hiệu, giá đi đâu?</h2><span class="meta">mã GTGD ≥ 2 tỷ, từ 2016 · so với VN-Index</span></div>
      <div class="tw"><table class="evt"><thead><tr><th class="l">Dấu hiệu</th><th>Số lần</th><th>20 phiên sau</th><th data-g="tstat">t</th><th>60 phiên sau</th><th data-g="fl_game">Có "game" (+20%/60p)</th><th>2016–6/2021 / 7/2021–nay</th><th>Có ý nghĩa?</th></tr></thead><tbody>${evRows}</tbody></table></div></section>
    <div class="g g-dec sec">${tbl("dist", "Đang xả âm thầm", dist)}${tbl("acc", "Đang gom âm thầm", acc)}${tbl("brk", "Bứt phá có KL (3 phiên gần nhất)", brk)}</div>
    <p class="faint" style="font-size:.72rem">"Mua − bán chủ động" lấy từ dữ liệu khớp lệnh theo bước giá (250 mã thanh khoản nhất, lưu từ khi hệ thống chạy); "Cá mập" chỉ có cho mã anh nắm/theo dõi. Không biết được ai đứng sau – chỉ thấy dấu vết trên giá và khối lượng.</p>`;
}
function moodView(FJ) {
  const S = FJ.sentiment || {};
  const comp = Object.values(S.comp || {});
  const T = S.test || {};
  const tt = (k) => T[k] ? `<table><thead><tr><th class="l">Nhóm điểm</th><th>VN-Index ${k} phiên sau</th><th>% lần tăng</th></tr></thead><tbody>${(T[k].q || []).map((q) => `<tr><td class="l">${["Sợ hãi nhất", "Thấp", "Giữa", "Cao", "Hưng phấn nhất"][q.q - 1]}</td><td class="${cls(q.r)}">${pct(q.r, 2)}</td><td>${nf(q.hit, 0)}%</td></tr>`).join("")}</tbody></table><small class="faint">tương quan ${nf(T[k].ic, 3)} · ${nf(T[k].n, 0)} mẫu (mỗi 5 phiên) · trung bình mọi lúc ${pct(T[k].all, 2)}</small>` : "";
  const H = S.hist || { t: [], v: [] };
  return `<div class="g g-main sec"><section class="panel"><div class="ph"><h2 data-g="mood">Tâm lý thị trường hôm nay</h2><span class="meta">${esc(S.date || "")}</span></div>${moodGauge(S)}
      ${lineSvg([{ name: "Tâm lý (0–100)", color: css("--brand"), pts: H.t.map((t, i) => ({ x: t.slice(2, 7), y: H.v[i] })) }], { h: 200, dec: 0, ticks: 8, hlines: [{ y: 80, color: "var(--down)", label: "hưng phấn" }, { y: 20, color: "var(--up)", label: "sợ hãi" }] })}</section>
    <section class="panel"><div class="ph"><h2>Thành phần</h2><span class="meta">xếp hạng so với 2 năm gần nhất</span></div>
      <div class="tw"><table><thead><tr><th class="l">Chỉ báo</th><th>Hiện tại</th><th>Xếp hạng</th></tr></thead><tbody>${comp.map((c) => `<tr><td class="l">${esc(c.name)}</td><td>${nf(c.raw, c.name.includes("Thanh khoản") ? 2 : 1)}${c.name.includes("Thanh khoản") ? "×" : "%"}</td><td>${minibar(c.rank)} ${nf(c.rank, 0)}</td></tr>`).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.74rem">Chưa có lịch sử khối ngoại và dư nợ margin nên chưa đưa vào.</p></section></div>
    <div class="g g2 sec"><section class="panel"><div class="ph"><h2>Kiểm chứng: 20 phiên sau</h2></div>${tt("20")}</section><section class="panel"><div class="ph"><h2>Kiểm chứng: 60 phiên sau</h2></div>${tt("60")}</section></div>
    ${(() => { const q = T["20"]?.q || []; if (q.length < 5) return ""; const nm = ["sợ hãi nhất", "thấp", "giữa", "cao", "hưng phấn nhất"], best = q.reduce((a, b) => (b.r > a.r ? b : a)), worst = q.reduce((a, b) => (b.r < a.r ? b : a));
      return `<p class="note">Trên dữ liệu VN từ 2016: 20 phiên sau, nhóm tâm lý <b>${nm[best.q - 1]}</b> cho VN-Index tốt nhất (${pct(best.r, 2)}), nhóm <b>${nm[worst.q - 1]}</b> kém nhất (${pct(worst.r, 2)}). Mức độ dự báo yếu (tương quan ${nf(T["20"].ic, 3)}) – dùng để điều chỉnh tỷ trọng cổ phiếu, không dùng một mình để mua/bán.</p>`; })()}`;
}

async function viewSwing(sub) {
  const [SW, L, pfr, t, FJ] = await Promise.all([tryLoad("data/swing.json"), liveData(true), Store.get("portfolio"), tryLoadToday(), tryLoad("data/flow.json"), WL.load()]);
  const mine = new Set([...(pfr.data?.holdings || []).map((h) => h.symbol), ...(WL.data?.items || []).map((x) => x.symbol),
    ...Object.values(t?.styles || {}).flatMap((s) => (s.picks || []).map((p) => p.symbol))]);
  const fresh = liveFresh(L);
  sub = sub || (fresh ? "live" : "today");
  const tabs = [["live", "Trong phiên"], ["today", "Phiên gần nhất"], ["flow", "Dòng tiền lớn (gom / xả)"], ["mood", "Tâm lý thị trường"], ["pairs", "Mã liên quan"], ["table", "Bảng hành vi giá"], ["test", "Kiểm chứng"]];
  const nav = `<div class="views" style="margin-top:0">${tabs.map(([k, n]) => `<a class="btn ${k === sub ? "primary" : ""}" href="#/swing/${k}">${n}${k === "live" && fresh ? ' <span class="dot-live"></span>' : ""}</a>`).join("")}</div>`;
  const head = `<div class="ph"><h1>Biến động & đảo chiều</h1><span class="meta">${SW ? `${nf(SW.rows?.length, 0)} mã · cửa sổ ${SW.window} phiên · dữ liệu ${esc(SW.date)}` : "chưa có dữ liệu"}</span></div>`;
  if (sub === "live") {
    app().innerHTML = nav + head + liveSection(L, mine);
    bindLive(L, mine);
    return;
  }
  if (sub === "pairs") {
    const [PJ, TT] = await Promise.all([tryLoad("data/pairs.json"), tryLoadToday()]);
    if (PJ) { PJ.conc = TT?.rel?.conc || PJ.conc || []; PJ.mine = TT?.rel?.mine || PJ.mine || {}; }
    app().innerHTML = nav + head + pairsView(PJ, mine);
    bindPairs(PJ);
    return;
  }
  if (sub === "flow" || sub === "mood") {
    app().innerHTML = nav + head + (FJ ? (sub === "flow" ? flowView(FJ, mine) : moodView(FJ)) : `<div class="empty">Chưa có dữ liệu – chờ lượt chạy sau đóng cửa.</div>`);
    return;
  }
  if (!SW) { app().innerHTML = nav + head + `<div class="empty">Chưa có phân tích hành vi giá – chờ lượt chạy sau đóng cửa.</div>`; return; }
  const C = SW.cols, rows = SW.rows.map((r) => Object.fromEntries(C.map((c, i) => [c, r[i]])));
  if (sub === "today") {
    const T = (SW.today || []).slice().sort((a, b) => (mine.has(b.symbol) - mine.has(a.symbol)) || (b.sev - a.sev));
    const neg = T.filter((x) => x.dir < 0), pos = T.filter((x) => x.dir > 0), mid = T.filter((x) => !x.dir);
    app().innerHTML = nav + head + `
      <p class="note">Mỗi tín hiệu kèm <b>kết quả lịch sử</b>: từ 2016, sau những phiên giống hệt kiểu này trên toàn thị trường, 5 phiên sau giá đi đâu so với VN-Index. "Nên làm" được suy ra từ chính kết quả đó – kiểu nào lịch sử không cho thấy xu hướng rõ thì chỉ là cảnh báo biến động. Mã của anh (nắm, theo dõi, danh sách mua) xếp lên đầu.</p>
      <div class="g g3 sec">
        <section class="panel"><div class="ph"><h2>Lịch sử hay kém tiếp – tránh mua, siết dừng</h2><span class="meta">${neg.length} mã</span></div><div class="sgs">${neg.map((x) => sigCard(x, mine)).join("") || '<p class="muted">Không có.</p>'}</div></section>
        <section class="panel"><div class="ph"><h2>Lịch sử hay mạnh tiếp – có lực mua thật</h2><span class="meta">${pos.length} mã</span></div><div class="sgs">${pos.map((x) => sigCard(x, mine)).join("") || '<p class="muted">Không có.</p>'}</div></section>
        <section class="panel"><div class="ph"><h2>Bất thường, lịch sử chưa rõ hướng</h2><span class="meta">${mid.length} mã</span></div><div class="sgs">${mid.map((x) => sigCard(x, mine)).join("") || '<p class="muted">Không có.</p>'}</div></section>
      </div>`;
    return;
  }
  if (sub === "table") {
    const tags = [...new Set(rows.flatMap((r) => r.tags || []))].sort();
    app().innerHTML = nav + head + `
      <section class="panel"><div class="ph"><h2>Hành vi giá ${SW.window} phiên gần nhất</h2>
        <span class="meta"><input id="swQ" placeholder="Tìm mã" style="width:90px"> <select id="swTag"><option value="">Mọi kiểu chơi</option>${tags.map((x) => `<option>${esc(x)}</option>`).join("")}</select>
        <label><input type="checkbox" id="swMine"> Mã của anh</label> GTGD ≥ <input id="swV" type="number" value="3" style="width:50px"> tỷ</span></div>
        <div class="tw"><table id="swT"></table></div>
        <p class="faint" style="font-size:.72rem;margin-top:4px">Rê chuột lên tiêu đề cột để xem cách tính. Điểm bất thường cao = giá hay bị đẩy/đạp, đảo chiều, chạm trần/sàn rồi rời, KL thất thường – <b>không phải bằng chứng thao túng</b>; kiểm chứng cho thấy nó dự báo tốt <b>độ biến động</b> 20 phiên tới, không dự báo được lãi/lỗ.</p></section>`;
    const cols = [{ k: "symbol", t: "Mã" }, { k: "score", t: "Điểm bất thường", num: 1, g: "sw_score" }, { k: "tagsT", t: "Kiểu chơi", g: "sw_tags" }, { k: "rng_med", t: "Biên độ TB", num: 1, g: "sw_rng" },
      { k: "rng_rel", t: "× thị trường", num: 1, g: "sw_rel" }, { k: "rev_rate", t: "Phiên đảo chiều", num: 1, g: "sw_rev" }, { k: "pump_spike", t: "Phân phối", num: 1, g: "sw_pump_spike" },
      { k: "dump_spike", t: "Rũ bỏ", num: 1, g: "sw_dump_spike" }, { k: "leave_c", t: "Trần→rời", num: 1, g: "sw_leave_c" }, { k: "rec_f", t: "Sàn→kéo", num: 1, g: "sw_rec_f" },
      { k: "s_p_fade", t: "Sáng tăng→chiều xả", num: 1, g: "sw_fade" }, { k: "s_p_bounce", t: "Sáng giảm→chiều kéo", num: 1, g: "sw_bounce" }, { k: "s_atc_mean", t: "ATC TB", num: 1, g: "sw_atc" },
      { k: "s_atc_up", t: "Kéo ATC", num: 1, g: "sw_atc" }, { k: "s_hi_early", t: "Đỉnh đầu phiên", num: 1, g: "sw_hi_early" }, { k: "ac1", t: "Tự tương quan", num: 1, g: "sw_ac1" },
      { k: "today_m", t: "Hôm nay sáng", num: 1, g: "sw_fade" }, { k: "today_a", t: "chiều", num: 1, g: "sw_fade" }, { k: "today_atc", t: "ATC", num: 1, g: "sw_atc" }, { k: "avg_value_bn", t: "GTGD", num: 1, g: "gtgd" }];
    const render = (r) => `<tr><td class="l"><a href="#/s/${r.symbol}"><b>${r.symbol}</b></a> <small class="faint">${esc((r.sector || "").slice(0, 18))}</small></td><td>${scoreCell(r.score)}</td>
      <td class="l wrap">${(r.tags || []).map(tagPill).join(" ")}${(r.sig || []).map(sigPill).join(" ")}</td><td>${nf(r.rng_med, 1)}%</td><td class="${(r.rng_rel || 0) >= 1.5 ? "down" : ""}">${nf(r.rng_rel, 2)}×</td>
      <td>${nf(r.rev_rate, 1)}</td><td>${nf(r.pump_spike, 0)}</td><td>${nf(r.dump_spike, 0)}</td><td>${nf(r.leave_c, 0)}</td><td>${nf(r.rec_f, 0)}</td>
      <td class="${(r.s_p_fade || 0) >= 60 ? "down" : ""}">${isNum(r.s_p_fade) ? nf(r.s_p_fade, 0) + "%" : "—"}<small class="faint"> ${isNum(r.s_n_up) ? "/" + nf(r.s_n_up, 0) : ""}</small></td>
      <td class="${(r.s_p_bounce || 0) >= 60 ? "up" : ""}">${isNum(r.s_p_bounce) ? nf(r.s_p_bounce, 0) + "%" : "—"}<small class="faint"> ${isNum(r.s_n_dn) ? "/" + nf(r.s_n_dn, 0) : ""}</small></td>
      <td class="${cls(r.s_atc_mean)}">${pct(r.s_atc_mean, 2)}</td><td>${isNum(r.s_atc_up) ? nf(r.s_atc_up, 0) + "%" : "—"}</td><td>${isNum(r.s_hi_early) ? nf(r.s_hi_early, 0) + "%" : "—"}</td>
      <td class="${(r.ac1 || 0) <= -0.1 ? "down" : ""}">${nf(r.ac1, 2)}</td><td class="${cls(r.today_m)}">${pct(r.today_m)}</td><td class="${cls(r.today_a)}">${pct(r.today_a)}</td><td class="${cls(r.today_atc)}">${pct(r.today_atc)}</td><td>${nf(r.avg_value_bn, 0)}</td></tr>`;
    rows.forEach((r) => { r.tagsT = (r.tags || []).join(", "); });
    const draw = () => {
      const q = ($("#swQ").value || "").toUpperCase(), tg = $("#swTag").value, mv = Number($("#swV").value || 0), mo = $("#swMine").checked;
      swSorter("swT", rows.filter((r) => (!q || r.symbol.includes(q)) && (!tg || (r.tags || []).includes(tg)) && (r.avg_value_bn || 0) >= mv && (!mo || mine.has(r.symbol))), cols, render, { k: "score" });
    };
    ["swQ", "swTag", "swV", "swMine"].forEach((id) => { $("#" + id).oninput = draw; $("#" + id).onchange = draw; });
    draw();
    return;
  }
  // kiểm chứng
  const E = SW.events || {}, V = SW.validation || {}, M = SW.market || {}, cov = SW.coverage || {};
  const evRow = (k, e) => `<tr><td class="l"><b>${esc(e.name)}</b><br><small class="muted">${esc(e.desc || "")}</small></td><td>${nf(e.n, 0)}</td>
    <td class="${cls(e.r1)}">${pct(e.r1, 2)}</td><td class="${cls(e.r5)}">${pct(e.r5, 2)}</td><td>${isNum(e.hit5) ? nf(e.hit5, 0) + "%" : "—"}</td><td>${nf(e.t5, 1)}</td>
    <td class="${cls(e.r20)}">${pct(e.r20, 2)}</td><td>${isNum(e.r5_a) ? `${pct(e.r5_a, 2)} / ${pct(e.r5_b, 2)}` : "—"}</td><td>${e.useful ? '<b class="up">có</b>' : '<span class="muted">không</span>'}</td></tr>`;
  const keys = ["pump_spike", "pump", "leave_c", "flush", "dump_spike", "dump", "rec_f", "push", "fade_today", "bounce_today", "atc_up", "atc_dn"];
  app().innerHTML = nav + head + `
    <section class="panel"><div class="ph"><h2>Sau mỗi kiểu phiên, giá đi đâu?</h2><span class="meta">toàn thị trường, mã GTGD ≥ 2 tỷ, từ 2016 · so với VN-Index</span></div>
      <div class="tw"><table class="evt"><thead><tr><th class="l">Kiểu phiên</th><th>Số lần</th><th>1 phiên sau</th><th>5 phiên sau</th><th>% lần hơn VNI</th><th data-g="tstat">t</th><th>20 phiên sau</th><th>2016–6/2021 / 7/2021–nay</th><th>Có ý nghĩa?</th></tr></thead>
      <tbody>${keys.filter((k) => E[k]).map((k) => evRow(k, E[k])).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.74rem;margin-top:4px">Mốc so sánh: một phiên bất kỳ, 5 phiên sau trung bình ${pct(E._base?.r5, 2)} so với VN-Index, ${nf(E._base?.hit5, 0)}% số lần hơn (phần lớn mã nhỏ kém chỉ số nên tỷ lệ này dưới 50%). "Có ý nghĩa" = |t| ≥ 2 và cùng dấu ở cả hai giai đoạn. Kiểu sáng/chiều/ATC chỉ có từ khi có nến phút/giờ (${esc(cov.ses_from || "—")}).</p></section>
    <div class="g g2 sec">
      <section class="panel"><div class="ph"><h2>Điểm bất thường có dự báo được gì?</h2><span class="meta">${nf(V.n_months, 0)} tháng từ 2017</span></div>
        ${V.ok ? `${kpis([["Tương quan với biến động 20 phiên sau", nf(V.ic_vol, 3), V.t_vol >= 2 ? "up" : "", "", ""], ["t", nf(V.t_vol, 1)], ["Tương quan với lợi nhuận 20 phiên sau", nf(V.ic_ret, 3), cls(V.ic_ret)], ["t", nf(V.t_ret, 1)]], false, "c2")}
          <div class="tw"><table><thead><tr><th class="l">Nhóm điểm</th><th>Biến động/năm</th><th>Lợi nhuận 20 phiên so VNI</th></tr></thead><tbody>${(V.quint || []).map((q) => `<tr><td class="l">${["Thấp nhất", "Thấp", "Giữa", "Cao", "Cao nhất"][q.q - 1]}</td><td>${nf(q.vol, 1)}%</td><td class="${cls(q.ret)}">${pct(q.ret, 2)}</td></tr>`).join("")}</tbody></table></div>
          <p class="note" style="margin-top:6px">${V.t_vol >= 2 ? "Điểm cao → giá biến động mạnh hơn rõ rệt trong 20 phiên sau (đúng như mục đích: nhận diện mã hay bị đẩy/đạp)." : "Điểm chưa dự báo rõ biến động."} ${Math.abs(V.t_ret || 0) >= 2 ? `Và có liên hệ với lợi nhuận (${V.ic_ret < 0 ? "điểm cao thường kém hơn" : "điểm cao thường tốt hơn"}).` : "Không dự báo được lãi hay lỗ – dùng để chọn cách vào lệnh (đặt dừng rộng hơn, không mua đuổi), không dùng để chọn mã."}</p>` : '<p class="muted">Chưa đủ dữ liệu.</p>'}</section>
      <section class="panel"><div class="ph"><h2>Nhịp trong phiên của thị trường</h2><span class="meta">mã thanh khoản, ${nf(M.n, 0)} phiên-mã</span></div>
        ${pathSvg(null, M.path, null)}
        ${kpis([["Sáng tăng ≥ 1,5% → chiều giảm lại", isNum(M.p_fade) ? nf(M.p_fade, 0) + "%" : "—", "", "", ""], ["TB buổi chiều sau đó", pct(M.a_after_up, 2), cls(M.a_after_up)],
          ["Sáng giảm ≥ 1,5% → chiều hồi", isNum(M.p_bounce) ? nf(M.p_bounce, 0) + "%" : "—"], ["TB buổi chiều sau đó", pct(M.a_after_dn, 2), cls(M.a_after_dn)],
          ["ATC trung bình", pct(M.atc_mean, 2), cls(M.atc_mean)], ["Kéo ATC ≥ 0,5% / đạp ≥ 0,5%", `${nf(M.atc_up, 0)}% / ${nf(M.atc_dn, 0)}%`], ["Đỉnh trong 45 phút đầu", isNum(M.hi_early) ? nf(M.hi_early, 0) + "%" : "—"], ["Đáy trong 45 phút đầu", isNum(M.lo_early) ? nf(M.lo_early, 0) + "%" : "—"]], false, "c2")}
        ${M.vshare ? `<small class="faint">Nhịp khối lượng theo khung 30 phút: ${M.vshare.map((v, i) => `${B_LABELS[i]} ${nf(v, 0)}%`).join(" · ")}</small>` : ""}
        <p class="faint" style="font-size:.72rem;margin-top:4px">Dữ liệu: nến giờ của ${nf(cov.hourly_syms, 0)} mã (~3 năm), nến phút của ${nf(cov.minute_syms, 0)} mã (~6 tháng), từ ${esc(cov.ses_from || "—")}. Hệ thống tải dần mỗi lượt sau đóng cửa.</p></section>
    </div>`;
}

// ---------------------------------------------------------------- Mã liên quan: đồng pha & dẫn dắt
function ccfSvg(ccf, lags, band, x, y) {
  if (!ccf || !lags) return "";
  const W = 210, H = 54, n = lags.length, bw = W / n, mid = H / 2, sc = (H / 2 - 3) / Math.max(0.5, ...ccf.map((v) => Math.abs(v || 0)));
  const bars = ccf.map((v, i) => { const h = Math.abs(v || 0) * sc, L = lags[i], sig = Math.abs(v || 0) >= band;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(v >= 0 ? mid - h : mid).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${Math.max(h, 0.6).toFixed(1)}" fill="${L === 0 ? "var(--brand)" : sig ? "var(--ref)" : "var(--ink-3)"}" opacity="${L === 0 || sig ? 1 : 0.45}"><title>${L === 0 ? "Cùng tuần" : L > 0 ? `${x} đi trước ${L} tuần` : `${y} đi trước ${-L} tuần`}: r = ${nf(v, 2)}</title></rect>`; }).join("");
  const by = band * sc;
  return `<svg class="ccf" viewBox="0 0 ${W} ${H + 12}" width="100%" role="img" aria-label="Tương quan trễ">
    <rect x="0" y="${(mid - by).toFixed(1)}" width="${W}" height="${(2 * by).toFixed(1)}" fill="var(--line-2)"/>
    <line x1="0" x2="${W}" y1="${mid}" y2="${mid}" stroke="var(--line)"/>${bars}
    <text x="0" y="${H + 10}" font-size="8" fill="var(--ink-3)">← ${esc(y)} đi trước</text><text x="${W / 2}" y="${H + 10}" font-size="8" text-anchor="middle" fill="var(--ink-3)">cùng tuần</text>
    <text x="${W}" y="${H + 10}" font-size="8" text-anchor="end" fill="var(--ink-3)">${esc(x)} đi trước →</text></svg>`;
}
function relCard(x, c, R, H) {
  const lv = c.lv || {}, z = lv.zone;
  c = { ...c, held: H ? H.has(c.s) : !!c.held };
  return `<div class="relc ${c.held ? "mine" : ""}">
    <div class="relh"><a href="#/s/${c.s}"><b>${c.s}</b></a> <small class="muted">${esc((c.name || "").slice(0, 34))}</small>
      <span class="tags">${c.same ? '<span class="pill">cùng ngành</span>' : `<span class="pill" title="${esc(c.industry || "")}">khác ngành</span>`}${c.held ? '<span class="pill brand">đang nắm</span>' : ""}<span class="pill ${c.es_c === "up" ? "buy" : ""}">${esc(c.es_t || "—")}</span></span></div>
    <div class="reln">
      <span data-g="rel_rc">Tương quan <b>${nf(c.rc, 2)}</b> <small>dài hạn ${nf(c.rc_l, 2)}</small></span>
      <span data-g="rel_beta">Beta <b>${nf(c.beta, 2)}</b></span>
      <span data-g="rel_dd">Cùng sụt <b class="${(c.p_dd || 0) >= 50 ? "down" : ""}">${isNum(c.p_dd) ? nf(c.p_dd, 0) + "%" : "—"}</b> <small>thường ${isNum(c.p_base) ? nf(c.p_base, 0) + "%" : "—"}</small></span>
      <span>3 tháng ${esc(x)} <b class="${cls(c.r13_x)}">${pct(c.r13_x, 0)}</b> · ${esc(c.s)} <b class="${cls(c.r13_y)}">${pct(c.r13_y, 0)}</b></span>
      <span>Giá <b>${nf(c.price)}</b>${z ? ` · vùng mua ${nf(z[0])}–${nf(z[1])} · cắt lỗ ${nf(lv.stop)}` : ""}</span>
      <span>${esc(c.ta_label || "")}${c.verdict ? ` · ${esc(c.verdict)}` : ""}${(c.flow_st || []).length ? " · " + c.flow_st.map(flowPill).join(" ") : ""}</span></div>
    ${ccfSvg(c.ccf, R.ccf_lags, R.ccf_band, x, c.s)}
    <ul class="rels">${(c.strat || []).map((s) => `<li class="t-${s.tone || "n"}"><b>${esc(s.title)}</b> ${esc(s.text)}</li>`).join("")}</ul>
  </div>`;
}
function relPanel(R, sym, H) {
  if (!R) return `<section class="panel sec"><div class="ph"><h2>Mã liên quan</h2></div><p class="muted">Chưa đủ thanh khoản (≥ 3 tỷ/phiên) hoặc lịch sử để đo đồng pha – hoặc không có mã nào đi cùng nhịp đủ mạnh.</p></section>`;
  const T = R.tests || {}, lp = (T.lead_pool || {})["13_4"] || {}, cu = T.catchup || {}, dl = T.daily_lead || {};
  const ll = [...(R.leads || []).map((p) => ["lead", p]), ...(R.follows || []).map((p) => ["follow", p])];
  const llHtml = ll.length ? ll.map(([k, p]) => { const o = k === "lead" ? p.follow : p.lead, f = p.fc || [];
    return `<div class="note" style="margin-bottom:6px"><b>${k === "lead" ? `${sym} đi trước <a href="#/s/${o}">${o}</a>` : `<a href="#/s/${o}">${o}</a> đi trước ${sym}`}</b> ${p.lags.map((g) => `${g.L} tuần (r ${nf(g.r_tr, 2)} → ngoài mẫu ${nf(g.r_te, 2)})`).join(", ")}.
      Dự báo ${k === "lead" ? o : sym} so với VN-Index: 4 tuần ${pct(f[3])}, 8 tuần ${pct(f[7])} (đã co 50%). ${(p.fdr || 0) > 0.2 ? `<span class="ref">Độ tin cậy thấp: ≈ ${nf(100 * p.fdr, 0)}% khả năng là ngẫu nhiên.</span>` : ""}</div>`; }).join("")
    : `<p class="muted" style="font-size:.8rem">Không có mã nào <b>đi trước / đi sau</b> ${sym} vài tuần mà qua được kiểm chứng ngoài mẫu. Cả thị trường: ${nf(R.n_found, 0)} cặp qua trên ${nf(R.n_tests, 0)} phép thử (may rủi đã cho ≈ ${nf(R.exp_false, 1)} cặp) → các mã liên quan dưới đây <b>đi CÙNG lúc</b>, không đi trước nhau.</p>`;
  return `<section class="panel sec rel"><div class="ph"><h2>Mã liên quan & chiến thuật</h2><span class="meta">đồng pha = lợi nhuận vượt VN-Index theo tuần cùng chiều · <a href="#/swing/pairs">kiểm chứng toàn thị trường</a></span></div>
    ${llHtml}
    ${(R.group || []).length ? `<ul class="rels grp">${R.group.map((s) => `<li class="t-${s.tone || "n"}"><b>${esc(s.title)}</b> ${esc(s.text)}</li>`).join("")}</ul>` : ""}
    <div class="relg">${(R.co || []).map((c) => relCard(sym, c, R, H)).join("")}</div>
    <details class="sec"><summary>Cách đọc và vì sao không khuyên “mã kia chạy trước thì mã này chạy sau”</summary>
      <ul class="sgl">
        <li><b>Tương quan</b>: lợi nhuận <i>vượt VN-Index</i> theo tuần, 2 năm gần nhất (và từ 2016). Đã bỏ phần cả thị trường cùng lên xuống, nên đây là mức “cùng câu chuyện” thật. Biểu đồ cột: tương quan khi lệch −8…+8 tuần; dải xám = mức ngẫu nhiên (±${nf(R.ccf_band, 2)}). Cột giữa cao, hai bên trong dải xám = hai mã đi cùng lúc.</li>
        <li><b>Cùng sụt</b>: trong các cửa sổ 4 tuần mà ${sym} giảm ≥ 10%, mã kia cũng giảm ≥ 10% bao nhiêu % số lần (so với tỷ lệ bình thường của mã đó).</li>
        <li><b>Dẫn dắt gộp</b> (${nf(lp.pairs, 0)} cặp đồng pha): mã dẫn chạy 13 tuần → mã theo 4 tuần sau: hệ số ${nf(lp.b_tr, 3)} (t ${nf(lp.t_tr, 1)}) giai đoạn 2016–2022, nhưng ${nf(lp.b_te, 3)} (t ${nf(lp.t_te, 1)}) từ 2023 → <b>${Math.abs(lp.t_te || 0) >= 2 ? "vẫn còn" : "không còn"}</b>.</li>
        <li><b>Bắt kịp</b> (${nf(cu.pairs, 0)} cặp): mã tụt lại ≥ 2 độ lệch chuẩn so với mã đồng pha, 20 phiên sau thu hẹp ${pct(cu.r_tr)} (2016–2022, đúng ${nf(cu.hit_tr, 0)}%) và ${pct(cu.r_te)} (2023–nay, đúng ${nf(cu.hit_te, 0)}%).</li>
        <li><b>Mã lớn dẫn mã nhỏ cùng ngành 1 phiên</b> (${nf(dl.pairs, 0)} cặp): t ${nf(dl.t_tr, 1)} trước 2023 → t ${nf(dl.t_te, 1)} từ 2023 (yếu dần, không đủ để giao dịch sau phí).</li>
      </ul></details></section>`;
}
function pairsView(P, mine) {
  if (!P) return `<div class="empty">Chưa có dữ liệu – chờ lượt chạy sau đóng cửa.</div>`;
  const T = P.tests || {}, LP = T.lead_pool || {}, cu = T.catchup || {}, dl = T.daily_lead || {}, fd = T.follow_dd || [], stb = T.stability || {};
  const vd = (t, t0) => (Math.abs(t0 || 0) < 2 ? '<span class="muted">không có</span>' : Math.abs(t || 0) >= 2 ? '<b class="up">còn</b>' : '<span class="down">không còn</span>');
  const hyp = [
    ...Object.values(LP).map((x) => [`Mã đồng pha chạy ${x.K} tuần → mã kia ${x.H} tuần sau`, `${x.pairs} cặp`, `${nf(x.b_tr, 3)} <small>t ${nf(x.t_tr, 1)}</small>`, `${nf(x.b_te, 3)} <small>t ${nf(x.t_te, 1)}</small>`, vd(x.t_te, x.t_tr)]),
    ["Mã tụt lại ≥ 2σ so với mã đồng pha → bắt kịp trong 20 phiên", `${cu.pairs} cặp`, `${pct(cu.r_tr)} <small>đúng ${nf(cu.hit_tr, 0)}%</small>`, `${pct(cu.r_te)} <small>đúng ${nf(cu.hit_te, 0)}%</small>`, (cu.r_te || 0) > 0.5 ? '<b class="up">còn</b>' : '<span class="down">không còn</span>'],
    ["Mã lớn tăng/giảm → mã nhỏ cùng ngành phiên sau", `${dl.pairs} cặp`, `${nf(dl.b_tr, 3)} <small>t ${nf(dl.t_tr, 1)}</small>`, `${nf(dl.b_te, 3)} <small>t ${nf(dl.t_te, 1)}</small>`, vd(dl.t_te, dl.t_tr)],
  ];
  const mineRows = Object.entries(P.mine || {});
  return `<p class="note">Câu hỏi: <b>mã nào đi cùng mã nào</b> (né mã này thì né mã kia) và <b>mã nào chạy trước mã nào vài tuần</b> (để căn điểm mua mã đi sau). Mọi giả thuyết được chọn trên 2016–2022 rồi <b>kiểm chứng lại trên 2023–nay</b> – chỉ điều gì còn đúng ở giai đoạn sau mới được dùng để khuyên.</p>
    <div class="g g2 sec">
      <section class="panel"><div class="ph"><h2>Dẫn dắt từng cặp</h2><span class="meta">${nf(P.n_syms, 0)} mã GTGD ≥ ${nf(P.min_val, 0)} tỷ · ${nf(P.weeks, 0)} tuần</span></div>
        ${kpis([["Phép thử (cặp × độ trễ)", nf(P.n_tests, 0)], ["Qua cả 2 giai đoạn", nf(P.n_found, 0), P.n_found > 3 * (P.exp_false || 0) ? "up" : "ref"], ["Kỳ vọng do may rủi", nf(P.exp_false, 1)], ["Khả năng là ngẫu nhiên", isNum(P.fdr) ? nf(100 * P.fdr, 0) + "%" : "—"]], false, "c2")}
        <p class="note" style="margin-top:6px">${P.n_found <= 3 * (P.exp_false || 0) ? `Số cặp “dẫn dắt” tìm được gần bằng số do may rủi → <b>thị trường VN hiện không có quan hệ “mã A chạy trước mã B vài tuần” đủ tin cậy</b>. Các mã liên quan chủ yếu đi <b>cùng lúc</b>. Ai nói “mã này chạy rồi mã kia sẽ chạy sau x tuần” thường là nhìn lại quá khứ (chọn trên cùng dữ liệu).` : "Có một số cặp dẫn dắt qua kiểm chứng – xem bảng dưới, vẫn nên kết hợp tín hiệu riêng của mã đi sau."}</p>
        ${(P.pairs || []).length ? `<div class="tw"><table><thead><tr><th class="l">Mã dẫn → mã theo</th><th>Độ trễ</th><th>r huấn luyện / ngoài mẫu</th><th>Đúng hướng</th><th>Dự báo 8 tuần</th><th class="l">Mã theo</th></tr></thead><tbody>
          ${P.pairs.map((p) => `<tr><td class="l"><a href="#/s/${p.lead}">${p.lead}</a> → <a href="#/s/${p.follow}"><b>${p.follow}</b></a> <small class="faint">${esc(p.ind_l || "")} / ${esc(p.ind_f || "")}</small></td>
            <td>${p.lags.map((g) => g.L + "t").join(", ")}</td><td>${p.lags.map((g) => `${nf(g.r_tr, 2)} / ${nf(g.r_te, 2)}`).join(", ")}</td><td>${nf(p.oos_hit, 0)}%</td><td class="${cls(p.fc?.[7])}">${pct(p.fc?.[7])}</td><td class="l">${esc(p.es_f || "")}</td></tr>`).join("")}</tbody></table></div>` : ""}
        <div class="tw"><table><thead><tr><th>Độ trễ (tuần)</th>${(P.stats || []).map((s) => `<th>${s.L}</th>`).join("")}</tr></thead><tbody>
          <tr><td class="l">Qua giai đoạn đầu (|t| ≥ 3)</td>${(P.stats || []).map((s) => `<td>${s.pass_train}</td>`).join("")}</tr>
          <tr><td class="l">… và còn đúng 2023–nay</td>${(P.stats || []).map((s) => `<td><b>${s.pass_both}</b></td>`).join("")}</tr></tbody></table></div>
        <p class="faint" style="font-size:.72rem;margin-top:4px">Phần lớn cặp “có vẻ dẫn dắt” ở giai đoạn đầu không còn đúng ở giai đoạn sau – đúng như kỳ vọng nếu đó là ngẫu nhiên.</p></section>
      <section class="panel"><div class="ph"><h2>Các giả thuyết hay gặp</h2><span class="meta">gộp nhiều cặp · huấn luyện 2016–2022 / kiểm tra 2023–nay</span></div>
        <div class="tw"><table><thead><tr><th class="l">Giả thuyết</th><th>Mẫu</th><th>2016–2022</th><th>2023–nay</th><th>Còn đúng?</th></tr></thead>
          <tbody>${hyp.map((h) => `<tr><td class="l wrap">${h[0]}</td><td>${h[1]}</td><td>${h[2]}</td><td>${h[3]}</td><td>${h[4]}</td></tr>`).join("")}</tbody></table></div>
        <h3 style="margin-top:10px">Đồng pha có bền? (chọn theo 2021–2022, đo lại 2023–nay)</h3>
        <div class="tw"><table><thead><tr><th class="l">Tương quan 2021–2022</th><th>Số cặp</th><th>Tương quan về sau</th><th>Cùng sụt ≥ 10%/4 tuần</th><th>Bình thường</th></tr></thead><tbody>
          ${(stb.buckets || []).map((b) => `<tr><td class="l">${b.lo < 0 ? "< " + nf(b.hi, 2) : b.hi > 1 ? "≥ " + nf(b.lo, 2) : nf(b.lo, 2) + "–" + nf(b.hi, 2)}</td><td>${nf(b.pairs, 0)}</td><td>${nf(b.later, 2)}</td><td><b>${nf(b.p_dd, 0)}%</b></td><td>${nf(b.p_base, 0)}%</td></tr>`).join("")}</tbody></table></div>
        <h3 style="margin-top:10px">Mã đồng pha đã sụt, mã này chưa → 4 tuần sau (2023–nay)</h3>
        <div class="tw"><table><thead><tr><th class="l">Mức đồng pha</th><th>Số lần</th><th>Mã này sụt ≥ 10%</th><th>Lợi nhuận TB</th><th>Mọi lúc: sụt / TB</th></tr></thead><tbody>
          ${fd.map((b) => `<tr><td class="l">${b.lo < 0 ? "< " + nf(b.hi, 2) : b.hi > 1 ? "≥ " + nf(b.lo, 2) : nf(b.lo, 2) + "–" + nf(b.hi, 2)}</td><td>${nf(b.n, 0)}</td><td><b>${nf(b.p, 0)}%</b></td><td class="${cls(b.r)}">${pct(b.r, 2)}</td><td>${nf(b.p_base, 0)}% / ${pct(b.r_base, 2)}</td></tr>`).join("")}</tbody></table></div>
        <p class="note" style="margin-top:6px"><b>Kết luận dùng được:</b> (1) đồng pha <b>bền</b> và rủi ro đến <b>cùng lúc</b> → né mã này vì lý do ngành thì né cả nhóm, và đừng coi nắm 2 mã đồng pha là đa dạng hoá; (2) mã đồng pha <b>mạnh</b> đã gãy thì mã còn lại dễ sụt theo hơn một chút → siết cắt lỗ; (3) không mua mã tụt lại chỉ vì “mã kia đã chạy”; (4) không có quan hệ “chạy trước vài tuần” đủ tin cậy để căn điểm mua.</p></section>
    </div>
    <div class="g g2 sec">
      <section class="panel"><div class="ph"><h2>Danh mục & theo dõi của anh</h2><span class="meta">mã đồng pha mạnh nhất</span></div>
        ${(P.conc || []).length ? `<p class="note"><b>Rủi ro tập trung:</b> ${P.conc.map((c) => `<a href="#/s/${c.a}">${c.a}</a> + <a href="#/s/${c.b}">${c.b}</a> (tương quan ${nf(c.rc, 2)}, cùng sụt ${nf(c.p_dd, 0)}%)`).join(" · ")} – coi mỗi cặp như một vị thế.</p>` : `<p class="faint" style="font-size:.78rem">Không có hai mã đang nắm nào đồng pha mạnh (≥ 0,4).</p>`}
        ${mineRows.length ? `<div class="tw"><table><thead><tr><th class="l">Mã</th><th class="l">Đi cùng (tương quan · cùng sụt · trạng thái)</th></tr></thead><tbody>
          ${mineRows.map(([s, L]) => `<tr><td class="l"><a href="#/s/${s}"><b>${s}</b></a></td><td class="l wrap">${L.map((c) => `<a href="#/s/${c.s}">${c.s}</a> <small>${nf(c.rc, 2)} · ${isNum(c.p_dd) ? nf(c.p_dd, 0) + "%" : "—"} · <span class="${c.es_c === "up" ? "up" : "muted"}">${esc(c.es_t || "")}</span></small>`).join(" &nbsp; ")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">Chưa có mã nắm/theo dõi đủ thanh khoản.</p>'}</section>
      <section class="panel"><div class="ph"><h2>Cặp đồng pha mạnh nhất thị trường</h2><span class="meta"><input id="prQ" placeholder="Tìm mã" style="width:90px"></span></div>
        <div class="tw" style="max-height:420px"><table id="prT"></table></div></section>
    </div>`;
}
function bindPairs(P) {
  if (!P || !$("#prT")) return;
  const rows = (P.top || []).map((r) => ({ ...r, pair: r.a + "–" + r.b }));
  const cols = [{ k: "pair", t: "Cặp" }, { k: "rc", t: "Tương quan 2 năm", num: 1, g: "rel_rc" }, { k: "rc_l", t: "Dài hạn", num: 1 }, { k: "p_dd", t: "Cùng sụt", num: 1, g: "rel_dd" }, { k: "p_base", t: "Bình thường", num: 1 }, { k: "same", t: "Cùng ngành" }];
  const render = (r) => `<tr><td class="l"><a href="#/s/${r.a}"><b>${r.a}</b></a> – <a href="#/s/${r.b}"><b>${r.b}</b></a> <small class="faint">${esc((r.ind_a || "").slice(0, 16))}${r.ind_b !== r.ind_a ? " / " + esc((r.ind_b || "").slice(0, 16)) : ""}</small></td>
    <td>${nf(r.rc, 2)}</td><td>${nf(r.rc_l, 2)}</td><td>${isNum(r.p_dd) ? nf(r.p_dd, 0) + "%" : "—"}</td><td>${isNum(r.p_base) ? nf(r.p_base, 0) + "%" : "—"}</td><td>${r.same ? "✓" : ""}</td></tr>`;
  const draw = () => { const q = ($("#prQ").value || "").toUpperCase(); swSorter("prT", rows.filter((r) => !q || r.pair.includes(q)), cols, render, { k: "rc" }); };
  $("#prQ").oninput = draw;
  draw();
}

function swingPanel(SWd, live, sym, FLJ) {
  if (!SWd || !SWd.profile) return "";
  const p = SWd.profile, M = SWd.market || {}, lr = liveFresh(live) ? (live.rows || []).find((r) => r.s === sym) : null;
  const tg = (p.tags || []).map(tagPill).join(" ");
  const recent = (SWd.recent || []).slice(-10).reverse();
  const t = SWd.today;
  const sh = (SWd.shark || []).slice(-5).reverse();
  return `<section class="panel"><div class="ph"><h2>Hành vi giá & tay chơi lớn</h2><a class="meta" href="#/swing/table">so với các mã khác</a></div>
    ${lr ? `<div class="note live-note"><b>Trong phiên ${esc((live.at || "").slice(11, 16))}:</b> ${nf(lr.px)} <b class="${cls(lr.chg)}">${pct(lr.chg)}</b> · cao ${pct(lr.hi)} · thấp ${pct(lr.lo)}${isNum(lr.m_ret) ? ` · sáng ${pct(lr.m_ret)}` : ""}${isNum(lr.a_ret) ? ` · chiều ${pct(lr.a_ret)}` : ""} · KL ${isNum(lr.pace) ? nf(lr.pace, 1) + "× cùng giờ" : "—"} · NN ${nf(lr.fn, 1)} tỷ ${(lr.flags || []).map(flagPill).join(" ")}</div>` : ""}
    <div class="sgh"><span data-g="sw_score">Điểm bất thường</span> ${scoreCell(p.score)} ${tg || '<span class="muted">không có kiểu chơi nổi bật</span>'}</div>
    ${SWd.flow ? flowLine(SWd.flow, FLJ?.events) : ""}
    ${kpis([["Biên độ TB", `${nf(p.rng_med, 1)}% <small>${nf(p.rng_rel, 2)}× TT</small>`], ["Phiên đảo chiều", `${nf(p.rev_rate, 1)}/100`], ["Phân phối / rũ bỏ", `${nf(p.pump_spike, 0)} / ${nf(p.dump_spike, 0)}`],
      ["Trần→rời / sàn→kéo", `${nf(p.leave_c, 0)} / ${nf(p.rec_f, 0)}`],
      ["Sáng tăng→chiều xả", isNum(p.s_p_fade) ? `${nf(p.s_p_fade, 0)}% <small>TT ${nf(M.p_fade, 0)}% · ${nf(p.s_n_up, 0)} lần</small>` : "—", (p.s_p_fade || 0) >= 60 ? "down" : ""],
      ["Sáng giảm→chiều kéo", isNum(p.s_p_bounce) ? `${nf(p.s_p_bounce, 0)}% <small>TT ${nf(M.p_bounce, 0)}% · ${nf(p.s_n_dn, 0)} lần</small>` : "—", (p.s_p_bounce || 0) >= 60 ? "up" : ""],
      ["ATC TB", isNum(p.s_atc_mean) ? `${pct(p.s_atc_mean, 2)} <small>kéo ${nf(p.s_atc_up, 0)}% · đạp ${nf(p.s_atc_dn, 0)}%</small>` : "—", cls(p.s_atc_mean)],
      ["Đỉnh / đáy đầu phiên", isNum(p.s_hi_early) ? `${nf(p.s_hi_early, 0)}% / ${nf(p.s_lo_early, 0)}%` : "—"]], false, "c2")}
    <div style="margin-top:6px"><small class="muted" data-g="sw_path">Đường đi trung bình trong phiên (% so với tham chiếu, ${nf(p.path_n, 0)} phiên gần nhất)</small>${pathSvg(p.path, M.path, lr?.path, { h: 130 })}</div>
    ${t ? `<div class="sgc ${t.dir < 0 ? "neg" : t.dir > 0 ? "pos" : ""}" style="margin-top:6px"><div class="sgh"><b>Phiên ${esc(SWd.recent?.slice(-1)[0]?.d || "")}:</b> ${(t.sig || []).map(sigPill).join(" ")}</div><p>${esc(t.meaning || "")}</p><p class="adv"><b>Nên làm:</b> ${esc(t.advice || "")}</p></div>` : ""}
    ${recent.length ? `<details style="margin-top:6px"><summary>10 phiên gần nhất: sáng / chiều / ATC</summary><div class="tw"><table><thead><tr><th class="l">Ngày</th><th>Sáng</th><th>Chiều</th><th>ATC</th><th>Cả ngày</th><th>Biên độ</th><th>Đỉnh lúc</th><th>Đáy lúc</th></tr></thead><tbody>
      ${recent.map((x) => `<tr><td class="l">${esc(x.d.slice(5))}</td><td class="${cls(x.m)}">${pct(x.m)}</td><td class="${cls(x.a)}">${pct(x.a)}</td><td class="${cls(x.atc)}">${pct(x.atc)}</td><td class="${cls(x.day)}">${pct(x.day)}</td><td>${nf(x.rng, 1)}%</td><td>${hm(x.hi_t)}</td><td>${hm(x.lo_t)}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    ${sh.length ? `<details style="margin-top:6px" open><summary data-g="sw_shark">Lệnh Cá mập / Sói / Cừu (mua − bán chủ động, tỷ đồng)</summary><div class="tw"><table><thead><tr><th class="l">Ngày</th><th>Cá mập</th><th>Sói</th><th>Cừu</th><th>Cá mập sáng</th><th>Cá mập chiều</th><th>% GTGD cá mập</th></tr></thead><tbody>
      ${sh.map((x) => `<tr><td class="l">${esc(x.d.slice(5))}</td><td class="${cls(x.shark?.net)}">${nf(x.shark?.net, 1)}</td><td class="${cls(x.wolf?.net)}">${nf(x.wolf?.net, 1)}</td><td class="${cls(x.sheep?.net)}">${nf(x.sheep?.net, 1)}</td><td class="${cls(x.m?.shark_net)}">${nf(x.m?.shark_net, 1)}</td><td class="${cls(x.a?.shark_net)}">${nf(x.a?.shark_net, 1)}</td><td>${nf(x.shark_share, 0)}%</td></tr>`).join("")}</tbody></table></div></details>` : ""}
    ${(SWd.news || []).length ? `<details style="margin-top:6px"><summary>Tin gần đây nhắc ${esc(sym)}</summary><div class="nws">${SWd.news.slice(0, 6).map((n) => `<a href="${esc(n.link)}" target="_blank" rel="noopener">📰 ${esc(n.title)}</a> <small class="faint">${esc(n.t)} · ${esc(n.src)}</small>`).join("<br>")}</div></details>` : ""}
  </section>`;
}
const hm = (m) => (isNum(m) ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}` : "—");

function liveBanner(L, pf, wl) {
  if (!liveFresh(L)) return "";
  const pers = L.personal || [];
  const hits = pers.filter((p) => p.kind === "exit" && p.hit), others = pers.filter((p) => !(p.kind === "exit" && p.hit));
  const rows = Object.fromEntries((L.rows || []).map((r) => [r.s, r]));
  const ix = L.index?.VNINDEX || {};
  const abn = (L.market || []).filter((m) => m.sev >= 3).slice(0, 6);
  return `<section class="season-banner live-banner sec"><div class="sb-h"><span class="dot-live"></span><b>Trong phiên ${esc((L.at || "").slice(11, 16))}</b>
      <span>VN-Index ${nf(ix.close)} <b class="${cls(ix.chg)}">${pct(ix.chg, 2)}</b></span><a href="#/swing/live">Mở bảng trong phiên →</a></div>
    ${pers.length ? `<ul class="plist">${persList([...hits, ...others], rows, 8)}</ul>` : `<p class="muted" style="margin:4px 0">Không có việc gấp với mã của anh.</p>`}
    ${abn.length ? `<small>Bất thường trên thị trường: ${abn.map((m) => `<a href="#/s/${m.s}"><b>${m.s}</b></a> ${(m.flags || []).filter((f) => LFLAG[f]).map((f) => LFLAG[f][0]).join(", ")}`).join(" · ")}</small>` : ""}</section>`;
}

function seasonBanner(SS) {
  if (!SS) return "";
  const seen = new Set(), secs = (SS.sectors || []).filter((x) => !seen.has(x.name) && seen.add(x.name));
  const yes = secs.filter((x) => x.support?.verdict === "yes"), other = secs.filter((x) => x.support?.verdict !== "yes");
  const st = (SS.stocks || []).filter((x) => x.support?.verdict === "yes").slice(0, 6);
  if (!secs.length && !st.length) return "";
  const why = (x) => { const parts = []; if (x.h1 && seasonStrong(x.h1)) parts.push(`từ hôm nay 1 tháng: ${nf(x.h1.relhit, 0)}% năm hơn VN-Index, TB ${pct(x.h1.rel, 1)}`);
    (x.months || []).forEach((m) => parts.push(`${MON_VI[m.m - 1]}: ${nf(m.relhit, 0)}% năm hơn, TB ${pct(m.rel, 1)}`)); return parts.join(" · "); };
  const href = (x) => `#/sector/${enc(x.name)}${x.level === "industry" ? "/l3" : ""}`;
  return `<section class="season-banner"><div class="sb-h"><b>🗓 Mùa vụ đang tới</b><span>dựa trên cùng thời điểm các năm trước, chỉ khuyến nghị khi số liệu năm nay ủng hộ</span></div>
    <div class="sb-g">
      <div><h3>Mùa thuận + năm nay ủng hộ – nên để ý</h3>${yes.length ? yes.slice(0, 6).map((x) => `<a class="sb-i yes" href="${href(x)}"><b>${esc(x.name)}</b><small>${esc(why(x))}</small><small class="up">＋ ${esc((x.support.pros || []).slice(0, 3).join(" · "))}</small></a>`).join("") : '<p class="muted">Không ngành nào vừa vào mùa vừa được số liệu năm nay ủng hộ.</p>'}
        ${st.length ? `<p class="sb-st">Mã vào mùa + được ủng hộ: ${st.map((x) => `<a href="#/s/${x.symbol}"><b>${x.symbol}</b> <small>${nf(x.hit, 0)}% năm, ${pct(x.rel, 1)}</small></a>`).join(" ")}</p>` : ""}</div>
      <div><h3>Vào mùa nhưng năm nay chưa ủng hộ – chờ</h3>${other.length ? other.slice(0, 5).map((x) => `<a class="sb-i" href="${href(x)}"><b>${esc(x.name)}</b><small>${esc(why(x))}</small><small class="down">${esc((x.support?.cons || []).slice(0, 3).join(" · ") || "tín hiệu năm nay lẫn lộn")}</small></a>`).join("") : '<p class="muted">Không có.</p>'}</div>
    </div><p class="faint" style="font-size:.72rem;margin-top:6px">${oosLine(SS.oos?.industry || SS.oos?.sector)}</p></section>`;
}
function seasonMatrix(S) {
  const L = (S.sector || []).filter((x) => x.season?.months?.length);
  if (!L.length) return "";
  const nowM = new Date().getMonth() + 1;
  const rows = L.map((x) => ({ x, h1: x.season.same?.h1 || {} })).sort((a, b) => (b.h1.rel ?? -99) - (a.h1.rel ?? -99));
  return `<section class="panel flush sec" id="seasonM"><div class="ph"><h2>Mùa vụ các ngành</h2><span class="meta">so với VN-Index · tháng · % năm hơn · viền vàng = mùa mạnh</span></div>
    <div class="tw"><table class="seas"><thead><tr><th class="l">Ngành</th><th>Từ hôm nay 1 tháng</th><th>2 tháng</th><th>Năm nay</th>${MON_VI.map((m, i) => `<th class="${i + 1 === nowM ? "now" : ""}">${m}</th>`).join("")}</tr></thead><tbody>
    ${rows.map(({ x, h1 }) => { const h2 = x.season.same?.h2 || {}, sup = x.season_support || {};
      return `<tr><td class="l"><a href="#/sector/${enc(x.name)}">${esc(x.name)}</a></td><td class="${seasonStrong(h1) ? "strong" : ""}"><b class="${cls(h1.rel)}">${pct(h1.rel, 1)}</b> <small>${nf(h1.relhit, 0)}%</small></td>
        <td><span class="${cls(h2.rel)}">${pct(h2.rel, 1)}</span> <small>${nf(h2.relhit, 0)}%</small></td><td><span class="${(SUP_VI[sup.verdict] || [])[1] || ""}">${(SUP_VI[sup.verdict] || ["—"])[0].replace("Năm nay ", "")}</span></td>
        ${x.season.months.map((mm) => `<td class="${mm.m === nowM ? "now" : ""}${seasonStrong(mm) ? " strong" : ""}" style="background:${isNum(mm.rel) ? heatColor(mm.rel, 4) : "transparent"};color:${isNum(mm.rel) ? "#fff" : "inherit"}" title="${esc(x.name)} ${MON_VI[mm.m - 1]}: so VN-Index ${pct(mm.rel, 1)}, ${nf(mm.relhit, 0)}% năm hơn (${mm.n} năm)">${isNum(mm.rel) ? nf(mm.rel, 1) : ""}</td>`).join("")}</tr>`; }).join("")}
    </tbody></table></div><p class="faint" style="font-size:.72rem;padding:6px 12px 10px">${oosLine(S.season?.oos?.sector)}</p></section>`;
}

// ================================================================ TRIỂN VỌNG NGÀNH (nhìn về phía trước)
const OUT_VI = { buy: "Đáng đầu tư", neutral: "Trung tính", avoid: "Nên tránh" };
const OUT_H = { m3: "3–6 tháng", m12: "12 tháng" };
const outChip = (o, k, short = false) => o?.[k] ? `<span class="oc ${o[k].verdict}" data-g="outlook">${short ? "" : OUT_H[k] + ": "}<b>${OUT_VI[o[k].verdict]}</b> <i>${nf(o[k].score, 0)}</i></span>` : "";
function outlookSection(S, lv, hz) {
  const O = (S.outlook || {})[lv];
  const list = (lv === "industry" ? S.industry : S.sector) || [];
  if (!O) return `<section class="panel sec"><p class="muted">Chưa có triển vọng ngành – cần lượt chạy kế tiếp.</p></section>`;
  const H = O.horizons?.[hz] || {}, bt = H.bt || {};
  const href = (n) => `#/sector/${enc(n)}${lv === "industry" ? "/l3" : ""}`;
  const withO = list.filter((s) => s.outlook?.[hz]);
  const buy = withO.filter((s) => s.outlook[hz].verdict === "buy").sort((a, b) => b.outlook[hz].score - a.outlook[hz].score);
  const avoid = withO.filter((s) => s.outlook[hz].verdict === "avoid").sort((a, b) => a.outlook[hz].score - b.outlook[hz].score);
  const neutral = withO.filter((s) => s.outlook[hz].verdict === "neutral").sort((a, b) => b.outlook[hz].score - a.outlook[hz].score);
  const bk = Object.fromEntries((bt.buckets || []).map((b) => [b.key, b]));
  const item = (s, good) => { const o = s.outlook, x = o[hz], why = good ? o.pos : o.neg, other = hz === "m3" ? "m12" : "m3";
    return `<a class="oi ${x.verdict}" href="${href(s.name)}"><div class="oi-h"><b>${esc(s.name)}</b>${ring(x.score, 30)}</div>
      <small>${esc((why || []).slice(0, 3).join(" · ") || (good ? "điểm cao nhờ tổng hợp các yếu tố" : "điểm thấp nhờ tổng hợp các yếu tố"))}</small>
      <div class="oi-f">${o[other] ? `<span>${OUT_H[other]}: <b class="${o[other].verdict === "buy" ? "up" : o[other].verdict === "avoid" ? "down" : ""}">${OUT_VI[o[other].verdict]}</b></span>` : ""}${x.trend?.length > 2 ? spark(x.trend, { w: 70, h: 18 }) : ""}<span class="faint">${s.n} mã · P/E ${nf(s.pe_med, 1)}</span></div></a>`; };
  const expl = (key) => bk[key] ? `Lịch sử: nhóm này trung bình <b class="${cls(bk[key].f)}">${pct(bk[key].f, 1)}</b> so với bình quân các ngành sau ${H.h} tháng, hơn bình quân ${nf(bk[key].win, 0)}% số lần.` : "";
  const W = H.weights || {};
  return `<section class="panel sec" id="outlook"><div class="ph"><h2>Triển vọng ngành – nên đầu tư vào đâu</h2>
      <span class="seg" id="oHz">${Object.entries(OUT_H).map(([k, n]) => `<button data-v="${k}" class="${k === hz ? "on" : ""}">${n}</button>`).join("")}</span>
      <span class="seg" id="oLv">${[["sector", "Ngành cấp 2"], ["industry", "Nhóm ngành cấp 3"]].map(([k, n]) => `<button data-v="${k}" class="${k === lv ? "on" : ""}">${n}</button>`).join("")}</span>
      <span class="meta">dự báo nghiêng xác suất, cập nhật mỗi phiên</span></div>
    <p class="faint" style="font-size:.76rem;margin:-2px 0 8px">Điểm 0–100 xếp các ngành với nhau theo: ${Object.entries(W).map(([k, w]) => `${esc(O.names?.[k] || k)} ${nf(w * 100, 0)}%`).join(", ")}. ≥ 65 đáng đầu tư, < 35 nên tránh.</p>
    <div class="ocols">
      <div><h3 class="up">Đáng đầu tư <small>${buy.length} ngành</small></h3><p class="faint oexp">${expl("buy")}</p><div class="olist">${buy.map((s) => item(s, true)).join("") || `<p class="muted">Không ngành nào đạt ≥ 65.</p>`}</div></div>
      <div><h3 class="down">Nên tránh <small>${avoid.length} ngành</small></h3><p class="faint oexp">${expl("avoid")}</p><div class="olist">${avoid.map((s) => item(s, false)).join("") || `<p class="muted">Không ngành nào dưới 35.</p>`}</div></div>
    </div>
    ${neutral.length ? `<p class="sec" style="font-size:.8rem"><b>Trung tính:</b> ${neutral.map((s) => `<a href="${href(s.name)}">${esc(s.name)}</a> <small class="faint">${nf(s.outlook[hz].score, 0)}</small>`).join(", ")}</p>` : ""}
    ${bt.ok ? `<details class="sec"><summary>Dự báo này đúng đến đâu? (kiểm chứng ${esc(bt.start)} → ${esc(bt.end)}, ${bt.n} tháng)</summary>
      <div class="g g2 sec"><div>
        ${kpis([["Nhóm điểm cao hơn nhóm thấp", pct(bt.spread, 1) + ` <small>/ ${H.h} tháng</small>`, cls(bt.spread)], ["Tỷ lệ đúng (cao > thấp)", nf(bt.hit, 0) + "%", bt.hit >= 55 ? "up" : bt.hit < 50 ? "down" : ""],
          ["Nửa đầu / nửa sau", `${nf(bt.hit_a, 0)}% / ${nf(bt.hit_b, 0)}%`, "", `chia ở ${bt.mid}`], ["Tương quan điểm ↔ kết quả", nf(bt.ic, 3)],
          ...(isNum(bt.cagr_top) ? [["Nắm 1/3 ngành điểm cao / năm", pct(bt.cagr_top, 1, false), cls(bt.cagr_top - bt.cagr_all)], ["Bình quân mọi ngành / năm", pct(bt.cagr_all, 1, false)]] : [])])}
        <div class="tw sec"><table><thead><tr><th class="l">Nhóm điểm</th><th>Số lần</th><th>Hơn bình quân ngành sau ${H.h} tháng</th><th>Tỷ lệ hơn</th></tr></thead><tbody>
          ${(bt.buckets || []).map((b) => `<tr><td class="l">${esc(b.label)}</td><td>${nf(b.n, 0)}</td><td class="${cls(b.f)}">${pct(b.f, 2)}</td><td>${nf(b.win, 0)}%</td></tr>`).join("")}</tbody></table></div></div>
      <div><div class="tw"><table><thead><tr><th class="l">Yếu tố</th><th>Tương quan 3 tháng</th><th>nửa đầu</th><th>nửa sau</th><th>Tương quan 12 tháng</th><th>nửa đầu</th><th>nửa sau</th></tr></thead><tbody>
        ${Object.entries(O.ic || {}).map(([k, x]) => `<tr><td class="l">${esc(x.name)}${W[k] ? ` <span class="pill brand">dùng</span>` : ""}</td>${[["ic3"], ["ic3_a"], ["ic3_b"], ["ic12"], ["ic12_a"], ["ic12_b"]].map(([c]) => `<td class="${x[c] > 0.03 ? "up" : x[c] < -0.03 ? "down" : ""}">${nf(x[c], 3)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
        <p class="faint" style="font-size:.72rem;margin-top:6px">Tương quan = độ khớp thứ hạng giữa yếu tố và lợi nhuận ngành sau đó (−1…+1). Mọi số đều nhỏ và đổi theo giai đoạn: thị trường VN không cho dự báo ngành chắc chắn. Trọng số được chọn theo chính giai đoạn kiểm chứng này nên kết quả thực tế thường kém hơn. Ngành "rẻ so với lịch sử" ở VN lại thường tiếp tục kém trong 3–6 tháng (bẫy giá trị) – vì vậy định giá chỉ dùng cho tầm 12 tháng.</p></div></div>
      ${bt.curve?.length ? `<div class="sec">${lineSvg([{ name: "1/3 ngành điểm cao nhất (đổi mỗi tháng)", color: css("--up"), width: 2, pts: bt.curve.map((p) => ({ x: p.d.slice(0, 7), y: p.top })) }, { name: "Bình quân mọi ngành", color: css("--ink-3"), pts: bt.curve.map((p) => ({ x: p.d.slice(0, 7), y: p.all })) }], { h: 170, label: "Kiểm chứng: nắm ngành điểm cao" })}</div>` : ""}
    </details>` : ""}
  </section>`;
}
function bindOutlook(S, rerender) {
  $$("#oHz button").forEach((b) => (b.onclick = () => { lsSet("oHz", b.dataset.v); rerender(); }));
  $$("#oLv button").forEach((b) => (b.onclick = () => { lsSet("oLv", b.dataset.v); rerender(); }));
}
function outlookBox(rec, title = "Triển vọng") {
  const o = rec?.outlook; if (!o) return "";
  return `<section class="panel"><div class="ph"><h2>${title}</h2><a class="meta" href="#/sector">so với các ngành khác</a></div>
    <div class="tags">${outChip(o, "m3")}${outChip(o, "m12")}</div>
    ${o.pos?.length ? `<p class="up" style="font-size:.8rem;margin-top:6px">＋ ${o.pos.map(esc).join(" · ")}</p>` : ""}${o.neg?.length ? `<p class="down" style="font-size:.8rem">− ${o.neg.map(esc).join(" · ")}</p>` : ""}
    ${o.m3?.exp != null ? `<p class="faint" style="font-size:.72rem;margin-top:4px">Lịch sử: ngành ở nhóm "${OUT_VI[o.m3.verdict]}" (3–6 tháng) trung bình ${pct(o.m3.exp, 1)} so với bình quân ngành sau 3 tháng, hơn ${nf(o.m3.win, 0)}% số lần. Chỉ là xác suất nghiêng.</p>` : ""}</section>`;
}

async function viewSectors() {
  const [S, rows, gr] = await Promise.all([secsData(), screenerRows(), Store.get("groups")]);
  const M = S.market || {};
  const groups = gr.data && Array.isArray(gr.data.list) ? gr.data.list : [];
  const st = { lv: lsGet("ovLv", "sector"), meas: lsGet("ovMeas", "pe_w"), sort: lsGet("ovSort", "val"), tsort: "mcap_bn", tasc: false };
  const listOf = (lv) => lv === "sector" ? S.sector || [] : lv === "industry" ? S.industry || [] : groups.map((g) => ({ ...aggRec(groupMembers(g, rows)), name: g.name, _gid: g.id }));
  const href = (s) => (s._gid ? `#/sector/${enc(s._gid)}/g` : `#/sector/${enc(s.name)}${st.lv === "industry" ? "/l3" : ""}`);
  const mh = M.val_hist || [];
  app().innerHTML = `
  <div class="ph"><h1>Toàn cảnh các ngành</h1><span class="meta">${(S.sector || []).length} ngành · ${(S.industry || []).length} nhóm ngành · ${nf(M.n_fin, 0)} DN có BCTC</span></div>
  <div id="oBox">${outlookSection(S, lsGet("oLv", "sector"), lsGet("oHz", "m3"))}</div>
  ${seasonMatrix(S)}
  <section class="panel hero sec">
    <div class="ph"><h2>Định giá toàn thị trường</h2><span class="meta">so với ${mh.length} quý gần nhất</span></div>
    <div class="g g-main">
      <div>
        <div class="bigs">
          <div class="big hlb"><small>P/E gia quyền</small><b>${nf(M.pe_w_pos ?? M.pe_w, 1)}</b><span>TB lịch sử ${nf(M.pew_hist_med, 1)} · ${vsCell(M.pew_vs_hist)} · ${pctlChip(M.pew_pctl_hist)}</span></div>
          <div class="big hlb"><small>P/E trung vị</small><b>${nf(M.pe_med, 1)}</b><span>TB lịch sử ${nf(M.pe_hist_med, 1)} · ${vsCell(M.pe_vs_hist)} · ${pctlChip(M.pe_pctl_hist)}</span></div>
          <div class="big"><small>P/B gia quyền / trung vị</small><b>${nf(M.pb_w)} <small>/ ${nf(M.pb_med)}</small></b><span>TB lịch sử ${nf(M.pbw_hist_med)} / ${nf(M.pb_hist_med)}</span></div>
          <div class="big"><small>Lợi suất LN vs TPCP 10N</small><b>${nf(M.ey_w, 1)}% <small>vs ${nf(M.rf, 1)}%</small></b><span>phần bù rủi ro <b class="${M.erp >= 4 ? "up" : M.erp < 2 ? "down" : ""}">${nf(M.erp, 1)}%</b></span></div>
        </div>
        ${kpis([["ROE gia quyền", pct(M.roe_w, 1, false)], ["ROE trung vị", pct(M.roe_med, 1, false)], ["LN 12T (TV)", pct(M.ni_yoy_med), cls(M.ni_yoy_med)], ["DT 12T (TV)", pct(M.rev_yoy_med), cls(M.rev_yoy_med)],
          ["PEG (TV)", nf(M.peg_med), "", "P/E ÷ tăng trưởng LN 12T (%) – dưới 1 là rẻ so với tăng trưởng"], ["Cổ tức (TV)", pct(M.div_med, 1, false)], ["% DN lỗ", pct(M.loss_share, 0, false)], ["Vốn hoá có BCTC", mcapFmt(M.mcap_bn)]], false, "sec")}
      </div>
      <div>${mh.length ? lineSvg([{ name: "P/E gia quyền", color: css("--brand"), width: 2.2, pts: mh.map((x) => ({ x: x.p, y: x.pe_w })) }, { name: "P/E trung vị", color: css("--ref"), pts: mh.map((x) => ({ x: x.p, y: x.pe })) }],
        { h: 190, hlines: [{ y: M.pew_hist_med, label: "TB " + nf(M.pew_hist_med, 1), color: css("--ink-3") }], label: "P/E thị trường theo quý" }) : `<p class="muted">Chưa có lịch sử.</p>`}
        <p class="faint" style="font-size:.72rem">Lợi suất LN = 1 ÷ P/E. Phần bù = lợi suất LN – lãi TPCP: càng cao cổ phiếu càng hấp dẫn so với trái phiếu (trên 4% là hấp dẫn).</p></div>
    </div></section>

  <section class="panel sec"><div class="ph"><h2 id="mTitle"></h2>
    <span class="seg" id="lvSel">${[["sector", "Ngành cấp 2"], ["industry", "Nhóm ngành cấp 3"], ["group", "Nhóm của tôi"]].map(([k, n]) => `<button data-v="${k}" class="${k === st.lv ? "on" : ""}">${n}</button>`).join("")}</span>
    <span class="seg" id="msSel">${Object.entries(MEAS).map(([k, x]) => `<button data-v="${k}" class="${k === st.meas ? "on" : ""}">${x.n}</button>`).join("")}</span>
    <span class="seg" id="soSel">${[["val", "Thấp → cao"], ["vs", "Rẻ nhất so với lịch sử"], ["mcap", "Vốn hoá"]].map(([k, n]) => `<button data-v="${k}" class="${k === st.sort ? "on" : ""}">${n}</button>`).join("")}</span></div>
    <p class="faint" id="mNote" style="font-size:.74rem;margin-bottom:6px"></p>
    <div id="bars"></div>
    <div class="leg" style="margin-top:6px"><span><i style="background:var(--up)"></i>rẻ hơn lịch sử ≥ 15%</span><span><i style="background:var(--brand)"></i>quanh mức lịch sử</span><span><i style="background:var(--down)"></i>đắt hơn lịch sử ≥ 15%</span>
      <span><i style="background:color-mix(in srgb,var(--brand) 18%,transparent)"></i>vùng lịch sử 10%–90%</span><span><i style="background:var(--ink);width:2px"></i>TB lịch sử ngành</span><span><i style="background:var(--down);width:2px"></i>thị trường</span></div></section>

  <div class="g g2 sec">
    <section class="panel"><div class="ph"><h2>P/B và ROE các ngành</h2><span class="meta">ROE cao mà P/B thấp = đáng chú ý</span></div><div id="scPB"></div></section>
    <section class="panel"><div class="ph"><h2>P/E và tăng trưởng lợi nhuận</h2><span class="meta">góc dưới-phải = rẻ mà tăng nhanh</span></div><div id="scPE"></div></section>
  </div>
  <section class="panel flush sec"><div class="ph"><h2>Bảng so sánh tất cả ngành</h2><span class="meta">bấm tiêu đề để sắp xếp · dòng đầu = toàn thị trường</span></div><div class="tw tall"><table id="cmp" class="cmp"></table></div></section>
  <section class="panel sec"><div class="ph"><h2>P/E từng ngành theo thời gian</h2><span class="meta">đường xanh = ngành (trung vị) · xám = thị trường · dải = 10–90% lịch sử · vòng tròn = hiện tại</span></div><div class="multi" id="multi"></div></section>`;

  const curList = () => listOf(st.lv);
  const draw = () => {
    const X = MEAS[st.meas], L = curList().filter((s) => isNum(X.cur(s)));
    $("#mTitle").textContent = `${X.n} các ${st.lv === "sector" ? "ngành" : st.lv === "industry" ? "nhóm ngành" : "nhóm của tôi"}`;
    $("#mNote").textContent = X.note;
    const mk = X.mk(M);
    const sorted = [...L].sort((a, b) => st.sort === "vs" ? (a[X.vs] ?? 999) - (b[X.vs] ?? 999) : st.sort === "mcap" ? (b.mcap_bn || 0) - (a.mcap_bn || 0) : X.cur(a) - X.cur(b));
    const vmax = Math.min(Math.max(mk || 0, ...sorted.map((s) => Math.max(X.cur(s), s[X.hi] || 0))) * 1.05, X.dec === 1 ? 45 : 6);
    const P = (v) => Math.max(0, Math.min(100, (v / vmax) * 100));
    $("#bars").innerHTML = `<div class="pebars">
      <div class="pb-row mkt"><span class="nm"><b>Toàn thị trường</b></span><div class="trk"><i class="bar" style="width:${P(mk)}%;background:var(--ink-2)"></i>
        ${isNum(M[X.lo]) ? `<i class="band" style="left:${P(M[X.lo])}%;width:${P(M[X.hi]) - P(M[X.lo])}%"></i>` : ""}${isNum(M[X.med]) ? `<i class="tick" style="left:${P(M[X.med])}%"></i>` : ""}</div>
        <b class="v">${nf(mk, X.dec)}</b><span class="d">${vsCell(M[X.vs])} <small class="faint">vs LS</small></span></div>
      ${sorted.map((s) => { const v = X.cur(s), vh = s[X.vs]; const col = !isNum(vh) ? "var(--brand)" : vh <= -15 ? "var(--up)" : vh >= 15 ? "var(--down)" : "var(--brand)";
        return `<a class="pb-row" href="${href(s)}" title="${esc(s.name)}: ${X.n} ${nf(v, X.dec)} · TB lịch sử ${nf(s[X.med], X.dec)} · thị trường ${nf(mk, X.dec)}">
          <span class="nm">${s.quadrant ? `<span class="quad" style="background:${qcol(s.quadrant)}"></span>` : s._gid ? "★ " : ""}${esc(s.name)} <small class="faint">${s.n}</small></span>
          <div class="trk">${isNum(s[X.lo]) ? `<i class="band" style="left:${P(s[X.lo])}%;width:${Math.max(0.5, P(s[X.hi]) - P(s[X.lo]))}%"></i>` : ""}<i class="bar" style="width:${P(v)}%;background:${col}"></i>
            ${isNum(s[X.med]) ? `<i class="tick" style="left:${P(s[X.med])}%"></i>` : ""}${isNum(mk) ? `<i class="mk" style="left:${P(mk)}%"></i>` : ""}${v > vmax ? `<em>›</em>` : ""}</div>
          <b class="v">${nf(v, X.dec)}</b><span class="d">${vsCell(vsPct(v, mk))} <small class="faint">vs TT</small> · ${vsCell(vh)} <small class="faint">vs LS</small></span></a>`; }).join("")}</div>`;
    // scatter
    const L2 = curList();
    const pt = (s, x, y) => ({ x: s[x], y: s[y], r: Math.max(3.5, Math.min(13, Math.sqrt((s.mcap_bn || 1) / 3000))), label: s.name.length > 18 ? s.name.slice(0, 16) + "…" : s.name, color: s.quadrant ? qcol(s.quadrant) : css("--brand"), href: href(s),
      title: `${s.name}: P/B ${nf(s.pb_w)} · ROE ${nf(s.roe_w, 1)}% · P/E ${nf(s.pe_w_pos ?? s.pe_w, 1)} · LN 12T ${pct(s.ni_yoy_med, 0)}` });
    $("#scPB").innerHTML = scatterSvg(L2.map((s) => pt(s, "pb_w", "roe_w")), { xl: "P/B gia quyền", yl: "ROE gia quyền %", clip: true, h: 320, xdec: 1, ydec: 0, labels: L2.length <= 30 });
    $("#scPE").innerHTML = scatterSvg(L2.map((s) => ({ ...pt(s, "ni_yoy_med", "pe_med"), y: s.pe_med })), { xl: "Tăng trưởng LN 12T (trung vị, %)", yl: "P/E trung vị", clip: true, h: 320, xdec: 0, ydec: 0, labels: L2.length <= 30 });
    drawTable(); drawMulti();
  };
  const C = [
    ["name", "Ngành", "nm", ""], ["_o3", "3–6 tháng", "o3", ""], ["_o12", "12 tháng", "o12", ""], ["quadrant", "Vòng", "q", ""], ["n", "Số mã", "i", ""], ["mcap_bn", "Vốn hoá", "bn", ""],
    ["pe_w", "P/E GQ", "pew", "v"], ["_vstt", "vs TT", "vs", "v"], ["pew_vs_hist", "vs LS", "vs", "v"], ["pew_pctl_hist", "Phân vị LS", "pc", "v"], ["pe_med", "P/E TV", "x1", "v"], ["pe_vs_hist", "TV vs LS", "vs", "v"],
    ["pb_w", "P/B GQ", "x2", "v"], ["pb_med", "P/B TV", "x2", "v"], ["pbw_vs_hist", "P/B vs LS", "vs", "v"], ["peg_med", "PEG", "x2", "v"], ["ey_w", "LS lợi nhuận", "p1", "v"], ["div_med", "Cổ tức", "p1", "v"],
    ["roe_w", "ROE GQ", "p1", "q"], ["roe_med", "ROE TV", "p1", "q"], ["fscore_med", "F-Score", "x1", "q"], ["de_med", "Vay/Vốn", "x2", "q"], ["loss_share", "% DN lỗ", "p0", "q"],
    ["ni_yoy_med", "LN 12T", "pct", "g"], ["rev_yoy_med", "DT 12T", "pct", "g"],
    ["r1m", "1 tháng", "pct", "p"], ["r3m", "3 tháng", "pct", "p"], ["r1y", "1 năm", "pct", "p"], ["above50", ">MA50", "p0", "p"], ["value_bn", "GTGD", "i", "p"], ["rs_ratio", "RS", "x1", "p"], ["upside_med", "Tiềm năng", "pct", "p"], ["composite_med", "Điểm", "s", "p"],
  ];
  const GH = [["", 6, ""], ["Định giá", 12, "v"], ["Sinh lời & sức khoẻ", 5, "q"], ["Tăng trưởng", 2, "g"], ["Giá & dòng tiền", 8, "p"]];
  const fmt = (s, k, f) => {
    const v = k === "_vstt" ? vsPct(s.pe_w_pos ?? s.pe_w, M.pe_w_pos ?? M.pe_w) : k === "pe_w" ? (s.pe_w_pos ?? s.pe_w) : s[k];
    if (f === "nm") return s._mkt ? `<b>${esc(v)}</b>` : `<a href="${href(s)}">${esc(v)}</a>`;
    if (f === "q") return v ? `<span class="quad" style="background:${qcol(v)}"></span>${esc(v)}` : "—";
    if (f === "o3" || f === "o12") { const o = s.outlook?.[f === "o3" ? "m3" : "m12"]; return o ? `<span class="oc ${o.verdict} sm"><b>${OUT_VI[o.verdict]}</b> <i>${nf(o.score, 0)}</i></span>` : "—"; }
    if (f === "pew") return `<b>${nf(v, 1)}</b>`;
    if (f === "vs") return vsCell(v);
    if (f === "pc") return pctlChip(v);
    if (f === "pct") return `<span class="${cls(v)}">${pct(v, 0)}</span>`;
    if (f === "p1") return isNum(v) ? nf(v, 1) + "%" : "—";
    if (f === "p0") return isNum(v) ? nf(v, 0) + "%" : "—";
    if (f === "bn") return mcapFmt(v);
    if (f === "i") return nf(v, 0);
    if (f === "x1") return nf(v, 1);
    if (f === "s") return scoreCell(v);
    return nf(v);
  };
  const drawTable = () => {
    const L = curList();
    const key = (s) => (st.tsort === "_vstt" ? vsPct(s.pe_w_pos ?? s.pe_w, M.pe_w_pos ?? M.pe_w) : st.tsort === "pe_w" ? (s.pe_w_pos ?? s.pe_w) : s[st.tsort]);
    const R = [...L].sort((a, b) => { const x = key(a), y = key(b); if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (st.tasc ? 1 : -1); });
    const mrow = { ...M, name: "Toàn thị trường", _mkt: true, n: M.n_fin };
    $("#cmp").innerHTML = `<thead><tr class="gh">${GH.map(([n, sp, g]) => `<th colspan="${sp}" class="${g === "v" ? "hlc" : ""} l">${n}</th>`).join("")}</tr>
      <tr>${C.map(([k, n, f, g]) => `<th data-k="${k}" class="${k === "name" ? "sym" : f === "q" ? "l" : ""} ${g === "v" ? "hlc" : ""} ${st.tsort === k ? "sorted" + (st.tasc ? " asc" : "") : ""}">${n}</th>`).join("")}</tr></thead>
      <tbody>${[mrow, ...R].map((s) => `<tr class="${s._mkt ? "mk" : ""}">${C.map(([k, , f, g]) => `<td class="${k === "name" ? "sym" : f === "q" ? "l" : ""} ${g === "v" ? "hlc" : ""}">${fmt(s, k, f)}</td>`).join("")}</tr>`).join("")}</tbody>`;
    $$("#cmp th[data-k]").forEach((th) => (th.onclick = () => { const k = th.dataset.k; if (st.tsort === k) st.tasc = !st.tasc; else { st.tsort = k; st.tasc = ["name", "pe_w", "pe_med", "pb_w", "pb_med", "peg_med", "_vstt", "pew_vs_hist", "pe_vs_hist", "pbw_vs_hist", "pew_pctl_hist", "de_med", "loss_share"].includes(k); } drawTable(); }));
  };
  const drawMulti = () => {
    const L = curList().filter((s) => (s.val_hist || []).length >= 8);
    const mm = Object.fromEntries((M.val_hist || []).map((x) => [x.p, x.pe]));
    $("#multi").innerHTML = L.length ? [...L].sort((a, b) => (a.pe_vs_hist ?? 999) - (b.pe_vs_hist ?? 999)).map((s) => `<a class="mcell" href="${href(s)}">
      <div class="mh"><b>${esc(s.name)}</b><span>${nf(s.pe_med, 1)} ${vsCell(s.pe_vs_hist)}</span></div>
      ${spark(s.val_hist.map((x) => x.pe), { lo: s.pe_hist_lo, hi: s.pe_hist_hi, med: s.pe_hist_med, cur: s.pe_med, ref2: s.val_hist.map((x) => mm[x.p]), color: isNum(s.pe_vs_hist) ? (s.pe_vs_hist <= -15 ? css("--up") : s.pe_vs_hist >= 15 ? css("--down") : css("--brand")) : css("--brand") })}
      <div class="mf"><small>TB ${nf(s.pe_hist_med, 1)} · ${esc(s.val_hist[0].p)}→nay</small>${pctlChip(s.pe_pctl_hist)}</div></a>`).join("")
      : `<p class="muted">${st.lv === "group" ? "Nhóm tự tạo chưa có lịch sử P/E." : "Chưa đủ lịch sử."}</p>`;
  };
  const seg = (id, key, lsKey) => $$(`#${id} button`).forEach((b) => (b.onclick = () => { st[key] = b.dataset.v; lsSet(lsKey, st[key]); $$(`#${id} button`).forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  seg("lvSel", "lv", "ovLv"); seg("msSel", "meas", "ovMeas"); seg("soSel", "sort", "ovSort");
  const reO = () => { $("#oBox").innerHTML = outlookSection(S, lsGet("oLv", "sector"), lsGet("oHz", "m3")); bindOutlook(S, reO); };
  bindOutlook(S, reO);
  draw();
}

// ================================================================ KHẨU VỊ ĐẦU TƯ (mô phỏng ngay trên trình duyệt)
const BK = ["garp", "growth", "defensive", "dividend", "value"];
const BK_NAME = { garp: "GARP (chất lượng + tăng trưởng hợp lý)", growth: "Tăng trưởng mạnh", defensive: "Phòng thủ", dividend: "Cổ tức", value: "Giá trị" };
const PROFILE_PRESETS = {
  safe: { name: "Thận trọng", allocation: { garp: 30, growth: 10, defensive: 50, dividend: 10, value: 0 }, exposure: { green: 80, yellow: 40, red: 10 }, stop: 15, slots: 8 },
  bal: { name: "Cân bằng (đã kiểm chứng)", allocation: { garp: 40, growth: 30, defensive: 30, dividend: 0, value: 0 }, exposure: { green: 100, yellow: 60, red: 30 }, stop: 20, slots: 8 },
  grow: { name: "Ưu tiên lợi nhuận", allocation: { garp: 50, growth: 40, defensive: 10, dividend: 0, value: 0 }, exposure: { green: 100, yellow: 80, red: 50 }, stop: 20, slots: 8 },
  aggr: { name: "Tấn công", allocation: { garp: 50, growth: 50, defensive: 0, dividend: 0, value: 0 }, exposure: { green: 100, yellow: 100, red: 70 }, stop: 25, slots: 5 },
};
function simulate(G, p) {
  const S = G.series[`s${p.stop}_n${p.slots}`];
  if (!S) return null;
  const al = BK.map((b) => [b, Math.max(0, Number(p.allocation[b]) || 0)]).filter(([b, w]) => w > 0 && S[b]);
  const tot = al.reduce((a, [, w]) => a + w, 0);
  if (!tot) return null;
  const sh = al.map(([b, w]) => [S[b], w / tot]);
  const N = G.dates.length, nav = new Array(N).fill(null), per = G.periods;
  nav[per[0]] = 1;
  for (let k = 0; k < per.length - 1; k++) {
    const i0 = per[k], i1 = per[k + 1], e = (Number(p.exposure[G.lights[k]] ?? 100) || 0) / 100, base = nav[i0];
    for (let t = i0 + 1; t <= i1; t++) {
      let mix = 0;
      for (const [s, w] of sh) mix += w * (s[t] / s[i0]);
      nav[t] = base * (1 + e * (mix - 1));
    }
  }
  return nav;
}
function navStats(dates, nav, rf = 0.03) {
  const pts = nav.map((v, i) => [dates[i], v]).filter(([, v]) => v != null);
  if (pts.length < 10) return null;
  const yrs = (new Date(pts[pts.length - 1][0]) - new Date(pts[0][0])) / 3.156e10;
  const cagr = Math.pow(pts[pts.length - 1][1] / pts[0][1], 1 / yrs) - 1;
  let peak = -Infinity, dd = 0;
  const rets = [];
  pts.forEach(([, v], i) => { peak = Math.max(peak, v); dd = Math.min(dd, v / peak - 1); if (i) rets.push(v / pts[i - 1][1] - 1); });
  const m = rets.reduce((a, b) => a + b, 0) / rets.length, sd = Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / rets.length);
  const ppy = rets.length / yrs, vol = sd * Math.sqrt(ppy);
  const yearly = {}; let prevY = pts[0][1], curY = pts[0][0].slice(0, 4);
  pts.forEach(([d, v], i) => { const y = d.slice(0, 4); if (y !== curY) { yearly[curY] = (pts[i - 1][1] / prevY - 1) * 100; prevY = pts[i - 1][1]; curY = y; } });
  yearly[curY] = (pts[pts.length - 1][1] / prevY - 1) * 100;
  const yv = Object.values(yearly);
  return { cagr: cagr * 100, dd: dd * 100, vol: vol * 100, sharpe: vol ? (cagr - rf) / vol : null, yearly, worst: Math.min(...yv), winYears: yv.filter((x) => x > 0).length, nYears: yv.length };
}

async function viewProfile() {
  const [t, G, saved, SB, BT] = await Promise.all([loadToday(), tryLoad("data/profile_grid.json"), Store.get("profile"), tryLoad("data/styles_bt.json"), tryLoad("data/backtest.json")]);
  const prof0 = saved.data && Object.keys(saved.data).length ? saved.data : null;
  const risk = t.risk || {};
  const P = {
    allocation: { ...(prof0?.allocation || t.allocation || PROFILE_PRESETS.bal.allocation) },
    exposure: { ...(prof0?.exposure || t.exposure_map || PROFILE_PRESETS.bal.exposure) },
    stop: Number(prof0?.sim_stop ?? risk.max_stop_loss_pct ?? 20), slots: Number(prof0?.sim_slots ?? 8),
    target: Number(prof0?.target_return ?? 30), max_dd: Number(prof0?.max_drawdown_target ?? risk.max_drawdown_target ?? 25),
    max_positions: Number(prof0?.max_positions ?? risk.max_positions ?? 8), margin_of_safety: Number(prof0?.margin_of_safety ?? risk.margin_of_safety ?? 20),
    risk_per_trade: Number(prof0?.risk_per_trade ?? risk.risk_per_trade ?? 1.5), max_weight_per_stock: Number(prof0?.max_weight_per_stock ?? risk.max_weight_per_stock ?? 20),
    max_weight_per_sector: Number(prof0?.max_weight_per_sector ?? risk.max_weight_per_sector ?? 30), min_mcap_bn: Number(prof0?.min_mcap_bn ?? t.strategy?.min_mcap_bn ?? 1000),
    style: prof0?.style || t.style || "position",
    trend_filter: prof0?.trend_filter || t.strategy?.trend_filter || "up", exclude_sectors: [...(prof0?.exclude_sectors || [])], exclude_symbols: [...(prof0?.exclude_symbols || [])],
  };
  if (G && G.ok && !G.stops.includes(P.stop)) P.stop = G.stops.reduce((a, b) => (Math.abs(b - P.stop) < Math.abs(a - P.stop) ? b : a), G.stops[0]);
  const rows = await screenerRows();
  const sectors = [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort();
  const slider = (id, label, v, min, max, step, unit, hint) => `<div class="w-item"><header><b>${label}</b><output id="o_${id}">${v}${unit}</output></header>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${v}">${hint ? `<p>${hint}</p>` : ""}</div>`;
  const num = (id, label, v, hint, w = "w90") => `<div class="field ${w}"><label for="${id}" title="${esc(hint || "")}">${label}</label><input id="${id}" inputmode="decimal" value="${v}"></div>`;
  app().innerHTML = `${pfTabs("profile")}
  <div class="ph"><h1>Khẩu vị đầu tư của tôi</h1><span class="meta">${prof0 ? `đang dùng bản lưu ${esc((prof0.updated || "").slice(0, 10))}` : "chưa lưu – hệ thống đang dùng config.yaml"}</span></div>
  <section class="panel hero"><div class="ph"><h2>1. Chọn phong cách đầu tư</h2><span class="meta">mỗi phong cách chọn mã, giá vào, cắt lỗ và thời gian nắm khác nhau</span></div>
    <div class="styles" id="styCards"></div>
    <p class="faint" style="font-size:.72rem;margin-top:6px">Kết quả kiểm chứng ${esc(BT?.start || "")} → ${esc(BT?.end || "")}, đã trừ phí, VN-Index cùng kỳ ${pct(BT?.benchmark?.cagr, 1)}/năm. Trang Hôm nay xem được kế hoạch của cả 4 phong cách; phong cách anh chọn ở đây quyết định danh sách MUA chính, tin Telegram và danh mục giấy.</p></section>
  <details class="panel sec" id="pDetail" ${P.style === "position" ? "open" : ""}><summary>2. Tuỳ chỉnh chi tiết (áp dụng cho phong cách Trung hạn)</summary><div class="sec">
  ${!G || !G.ok ? `<p class="note">Chưa có dữ liệu mô phỏng – sẽ có sau lượt chạy kiểm chứng kế tiếp (thứ Bảy, hoặc bấm chạy lại có chọn "backtest"). Anh vẫn lưu được khẩu vị.</p>` : ""}
  <div class="views" id="presets"><small class="muted" style="align-self:center">Mẫu:</small>${Object.entries(PROFILE_PRESETS).map(([k, x]) => `<button data-pp="${k}">${esc(x.name)}</button>`).join("")}
    <button data-pp="find" class="on" title="Thử hàng chục nghìn tổ hợp, chọn tổ hợp lãi cao nhất mà vẫn nằm trong giới hạn sụt của anh">Tự tìm phương án tốt nhất trong giới hạn sụt</button></div>
  <div class="g g-main">
    <div class="stack">
      <section class="panel"><div class="ph"><h2>Mục tiêu & giới hạn</h2></div>
        <div class="weights">${slider("target", "Lợi nhuận mục tiêu / năm", P.target, 5, 40, 1, "%", "chỉ để so sánh, hệ thống không đuổi theo con số này")}
          ${slider("max_dd", "Mức sụt tối đa chấp nhận", P.max_dd, 5, 50, 1, "%", "từ đỉnh xuống đáy của cả danh mục")}</div></section>
      <section class="panel"><div class="ph"><h2>Phân bổ vốn theo rổ</h2><span class="meta" id="alSum"></span></div>
        <div class="weights">${BK.map((b) => slider("al_" + b, BK_NAME[b], P.allocation[b] || 0, 0, 100, 5, "", "")).join("")}</div>
        <p class="faint" style="font-size:.72rem">Tổng không cần bằng 100 – hệ thống tự chia theo tỷ lệ.</p></section>
      <section class="panel"><div class="ph"><h2>Tỷ trọng cổ phiếu theo đèn thị trường</h2><span class="meta">phần còn lại để tiền mặt</span></div>
        <div class="weights">${slider("ex_green", "Đèn xanh", P.exposure.green, 0, 100, 10, "%", "")}${slider("ex_yellow", "Đèn vàng", P.exposure.yellow, 0, 100, 10, "%", "")}${slider("ex_red", "Đèn đỏ", P.exposure.red, 0, 100, 10, "%", "")}</div></section>
      <section class="panel"><div class="ph"><h2>Cắt lỗ & độ tập trung</h2></div>
        <div class="filters"><div class="field w140"><label>Cắt lỗ khi giảm</label><select id="stop">${(G?.stops || [0, 10, 15, 20, 25]).map((x) => `<option value="${x}" ${x === P.stop ? "selected" : ""}>${x ? x + "% so với giá mua" : "Không cắt lỗ"}</option>`).join("")}</select></div>
          <div class="field w140"><label>Số mã mỗi rổ (mô phỏng)</label><select id="slots">${(G?.slots || [5, 8, 12]).map((x) => `<option value="${x}" ${x === P.slots ? "selected" : ""}>${x} mã${x === 5 ? " – tập trung" : x === 12 ? " – dàn trải" : ""}</option>`).join("")}</select></div>
          ${num("max_positions", "Số mã tối đa (thật)", P.max_positions, "Số mã tối đa trong danh mục thật")}</div></section>
      <section class="panel"><div class="ph"><h2>Quy tắc khác (áp dụng cho danh sách MUA thật)</h2><span class="meta">chưa được mô phỏng ở bên phải</span></div>
        <div class="filters">${num("margin_of_safety", "Biên an toàn %", P.margin_of_safety, "Chỉ mua khi giá thấp hơn giá trị hợp lý ít nhất ngần này")}
          ${num("risk_per_trade", "Rủi ro/lệnh % vốn", P.risk_per_trade, "Nếu chạm cắt lỗ thì chỉ mất ngần này % tổng vốn")}
          ${num("max_weight_per_stock", "Tối đa/mã % vốn", P.max_weight_per_stock)}${num("max_weight_per_sector", "Tối đa/ngành % vốn", P.max_weight_per_sector)}
          ${num("min_mcap_bn", "Vốn hoá tối thiểu (tỷ)", P.min_mcap_bn, "", "w90")}
          <div class="field w200"><label>Điều kiện xu hướng</label><select id="trend_filter">${[["up", "Giá > MA50 > MA200 (đã kiểm chứng)"], ["above200", "Giá trên MA200"], ["not_down", "Chỉ tránh mã đang giảm"]].map(([k, n]) => `<option value="${k}" ${k === P.trend_filter ? "selected" : ""}>${n}</option>`).join("")}</select></div></div>
        <div class="filters sec"><div class="field" style="flex:1;min-width:240px"><label for="exSym">Không bao giờ mua các mã (cách nhau dấu phẩy)</label><input id="exSym" value="${esc(P.exclude_symbols.join(", "))}" placeholder="ví dụ: ROS, FLC"></div></div>
        <details class="sec"><summary>Ngành không muốn đầu tư (${P.exclude_sectors.length})</summary><div class="gtree" style="margin-top:6px">${sectors.map((s) => `<label class="gnode" style="display:flex;gap:6px;align-items:center;font-size:.78rem"><input type="checkbox" data-xs="${esc(s)}" ${P.exclude_sectors.includes(s) ? "checked" : ""}>${esc(s)}</label>`).join("")}</div></details></section>
      <section class="panel"><button class="btn primary" id="pSave">Lưu khẩu vị – áp dụng từ lượt chạy kế tiếp</button> <button class="btn" id="pRun">Lưu & chạy lại ngay</button> ${prof0 ? `<button class="btn" id="pReset">Bỏ, dùng lại config.yaml</button>` : ""}
        <p class="muted" id="pMsg" style="font-size:.76rem;margin-top:6px">Sau khi lưu, danh sách MUA, tỷ trọng, cắt lỗ và cảnh báo Telegram sẽ theo khẩu vị này.</p></section>
    </div>
    <div class="stack sticky">
      <section class="panel hero"><div class="ph"><h2>Kết quả nếu đã làm theo khẩu vị này</h2><span class="meta">${G?.ok ? `${esc(G.dates[G.periods[0]])} → ${esc(G.dates[G.dates.length - 1])}` : ""}</span></div><div id="simOut"><p class="muted">Chưa có dữ liệu mô phỏng.</p></div></section>
    </div>
  </div>
  <section class="panel sec" id="findBox" hidden><div class="ph"><h2 id="findTitle">Phương án lãi cao nhất trong giới hạn sụt</h2>
    <label style="display:flex;gap:5px;align-items:center;font-size:.78rem"><input type="checkbox" id="robust" checked> Chỉ xét phương án đa dạng (≥ 2 rổ, ≥ 8 mã/rổ) – giảm rủi ro "tối ưu quá khứ"</label><span class="meta" id="findMeta"></span></div><div id="findOut"></div></section></div></details>`;
  const read = () => {
    P.target = Number($("#target").value); P.max_dd = Number($("#max_dd").value);
    BK.forEach((b) => (P.allocation[b] = Number($("#al_" + b).value)));
    ["green", "yellow", "red"].forEach((k) => (P.exposure[k] = Number($("#ex_" + k).value)));
    P.stop = Number($("#stop").value); P.slots = Number($("#slots").value);
    ["max_positions", "margin_of_safety", "risk_per_trade", "max_weight_per_stock", "max_weight_per_sector", "min_mcap_bn"].forEach((k) => { const v = Number(String($("#" + k).value).replace(",", ".")); if (!Number.isNaN(v)) P[k] = v; });
    P.trend_filter = $("#trend_filter").value;
    P.exclude_symbols = [...new Set(String($("#exSym").value).toUpperCase().split(/[^A-Z0-9]+/).filter((x) => /^[A-Z0-9]{3}$/.test(x)))];
    P.exclude_sectors = $$("[data-xs]").filter((x) => x.checked).map((x) => x.dataset.xs);
  };
  const setUI = (x) => {
    BK.forEach((b) => { $("#al_" + b).value = x.allocation[b] || 0; });
    ["green", "yellow", "red"].forEach((k) => { $("#ex_" + k).value = x.exposure[k]; });
    if (x.stop != null) $("#stop").value = x.stop; if (x.slots != null) $("#slots").value = x.slots;
    $$("input[type=range]").forEach((el) => { const o = $("#o_" + el.id); if (o) o.textContent = el.value + (["target", "max_dd"].includes(el.id) || el.id.startsWith("ex_") ? "%" : ""); });
  };
  let chart = null;
  const draw = () => {
    read();
    const tot = BK.reduce((a, b) => a + (P.allocation[b] || 0), 0);
    $("#alSum").textContent = tot ? BK.filter((b) => P.allocation[b]).map((b) => `${BASKET_SHORT[b]} ${nf(P.allocation[b] / tot * 100, 0)}%`).join(" · ") : "chưa phân bổ";
    if (!G || !G.ok) return;
    const nav = simulate(G, P);
    const dflt = simulate(G, { ...PROFILE_PRESETS.bal });
    const st = nav && navStats(G.dates, nav), sd = dflt && navStats(G.dates, dflt);
    const bn_ = G.bench.map((v, i) => (i >= G.periods[0] ? v / G.bench[G.periods[0]] : null));
    const sb = navStats(G.dates, bn_);
    if (!st) { $("#simOut").innerHTML = `<p class="muted">Chọn ít nhất một rổ.</p>`; return; }
    const okR = st.cagr >= P.target, okD = -st.dd <= P.max_dd;
    const years = Object.keys(st.yearly);
    $("#simOut").innerHTML = `<div class="bigs c2">
        <div class="big hlb"><small>Lãi kép / năm</small><b class="${okR ? "up" : ""}">${pct(st.cagr, 1)}</b><span>mục tiêu ${P.target}% · ${okR ? '<b class="up">đạt</b>' : '<b class="down">chưa đạt</b>'}</span></div>
        <div class="big hlb"><small>Sụt tối đa</small><b class="${okD ? "" : "down"}">${pct(st.dd, 1)}</b><span>giới hạn −${P.max_dd}% · ${okD ? '<b class="up">trong giới hạn</b>' : '<b class="down">vượt giới hạn</b>'}</span></div>
        <div class="big"><small>Năm tệ nhất · số năm lãi</small><b>${pct(st.worst, 0)} <small>· ${st.winYears}/${st.nYears}</small></b></div>
        <div class="big"><small>Biến động · Sharpe</small><b>${nf(st.vol, 0)}% <small>· ${nf(st.sharpe)}</small></b></div></div>
      ${kpis([["VN-Index / năm", pct(sb?.cagr, 1)], ["VN-Index sụt", pct(sb?.dd, 1), "down"], ["Cấu hình kiểm chứng", `${pct(sd?.cagr, 1)} · ${pct(sd?.dd, 0)}`, "", "GARP 40 / Tăng trưởng 30 / Phòng thủ 30, đèn 100/60/30, cắt lỗ 20%"],
        ["Tiền mặt TB", (() => { const L = G.lights; const avg = L.reduce((a, l) => a + (100 - (P.exposure[l] ?? 100)), 0) / L.length; return nf(avg, 0) + "%"; })(), "", "Trung bình phần vốn để tiền mặt theo đèn"]], false, "sec")}
      <div class="chart sm sec" id="simChart"></div>
      <div class="leg"><span><i style="background:${css("--brand")}"></i>Khẩu vị của anh</span><span><i style="background:${css("--up")}"></i>Cấu hình đã kiểm chứng</span><span><i style="background:${css("--ink-3")}"></i>VN-Index</span></div>
      <div class="tw sec"><table><thead><tr><th class="l">Năm</th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
        <tr><td class="l">Khẩu vị</td>${years.map((y) => `<td class="${cls(st.yearly[y])}">${pct(st.yearly[y], 0)}</td>`).join("")}</tr>
        <tr><td class="l">VN-Index</td>${years.map((y) => `<td class="${cls(sb?.yearly[y])}">${pct(sb?.yearly[y], 0)}</td>`).join("")}</tr></tbody></table></div>
      <p class="faint" style="font-size:.72rem;margin-top:6px">Mô phỏng trộn các rổ đã backtest (tái cơ cấu hằng tháng, trừ phí, có cắt lỗ), phần tiền mặt không tính lãi. Dữ liệu lấy mẫu theo tuần nên mức sụt có thể nhẹ hơn thực tế 1–3 điểm. Đèn trong mô phỏng dùng bản rút gọn (VN-Index so với MA50/MA200), gần giống đèn 7 điều kiện của hệ thống thật. Quá khứ không đảm bảo tương lai.</p>`;
    disposeCharts();
    const c = mkChart($("#simChart"), { rightPriceScale: { mode: 1, borderColor: css("--line") } });
    const line = (arr, col, w) => c.addLineSeries({ color: col, lineWidth: w, priceLineVisible: false, lastValueVisible: false }).setData(arr.map((v, i) => (v == null ? null : { time: G.dates[i], value: v })).filter(Boolean));
    line(bn_, css("--ink-3"), 1); line(dflt, css("--up"), 1); line(nav, css("--brand"), 2);
    c.timeScale().fitContent();
  };
  const find = () => {
    read();
    if (!G || !G.ok) return;
    $("#findBox").hidden = false;
    $("#findTitle").textContent = `Phương án lãi cao nhất trong giới hạn sụt ${P.max_dd}%`;
    const robust = $("#robust").checked;
    const t0 = performance.now(), res = [];
    const steps = [0, 20, 40, 60, 80, 100];
    const mixes = [];
    const rec = (i, left, cur) => { if (i === BK.length - 1) { mixes.push({ ...cur, [BK[i]]: left }); return; } for (const s of steps) if (s <= left) rec(i + 1, left - s, { ...cur, [BK[i]]: s }); };
    rec(0, 100, {});
    for (const n of G.slots) for (const sp of G.stops) for (const al of mixes) for (const red of [0, 30, 50, 70, 100]) for (const yel of [60, 80, 100]) {
      if (red > yel) continue;
      if (robust && (n < 8 || Object.values(al).filter((x) => x > 0).length < 2)) continue;
      const p = { allocation: al, exposure: { green: 100, yellow: yel, red }, stop: sp, slots: n };
      const nav = simulate(G, p); if (!nav) continue;
      const s = navStats(G.dates, nav); if (!s) continue;
      if (-s.dd <= P.max_dd) res.push({ p, s });
    }
    res.sort((a, b) => b.s.cagr - a.s.cagr);
    $("#findMeta").textContent = `${nf(res.length, 0)} tổ hợp đạt · ${nf((performance.now() - t0) / 1000, 1)} giây`;
    $("#findOut").innerHTML = res.length ? `<div class="tw"><table data-hm="c4 c7"><thead><tr><th class="l">Phân bổ</th><th>Đèn X/V/Đ</th><th>Cắt lỗ</th><th>Mã/rổ</th><th>Lãi/năm</th><th>Sụt</th><th>Năm tệ</th><th></th></tr></thead><tbody>
      ${res.slice(0, 8).map((x, i) => `<tr><td class="l">${BK.filter((b) => x.p.allocation[b]).map((b) => `${BASKET_SHORT[b]} ${x.p.allocation[b]}`).join(" · ")}</td><td>${x.p.exposure.green}/${x.p.exposure.yellow}/${x.p.exposure.red}</td>
        <td>${x.p.stop ? x.p.stop + "%" : "không"}</td><td>${x.p.slots}</td><td class="up"><b>${pct(x.s.cagr, 1)}</b></td><td class="down">${pct(x.s.dd, 0)}</td><td>${pct(x.s.worst, 0)}</td><td><button class="chip" data-use="${i}">Dùng</button></td></tr>`).join("")}</tbody></table></div>
      <p class="note" style="margin-top:6px">Cẩn thận "tối ưu quá khứ": tổ hợp đứng đầu thường may mắn. Nên chọn phương án mà các phương án lân cận (phân bổ gần giống) cũng cho kết quả tốt, và ưu tiên dàn trải hơn tập trung.</p>`
      : `<p class="muted">Không tổ hợp nào giữ được mức sụt trong ${P.max_dd}%. Thử nới giới hạn sụt.</p>`;
    $$("[data-use]").forEach((b) => (b.onclick = () => { const x = res[Number(b.dataset.use)].p; setUI(x); draw(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  };
  $$("input[type=range]").forEach((el) => (el.oninput = () => { const o = $("#o_" + el.id); if (o) o.textContent = el.value + (["target", "max_dd"].includes(el.id) || el.id.startsWith("ex_") ? "%" : ""); draw(); }));
  $$("#stop, #slots").forEach((el) => (el.onchange = draw));
  $("#robust").onchange = find;
  $$("#presets [data-pp]").forEach((b) => (b.onclick = () => {
    $$("#presets [data-pp]").forEach((x) => x.classList.toggle("on", x === b));
    if (b.dataset.pp === "find") { find(); return; }
    setUI(PROFILE_PRESETS[b.dataset.pp]); draw();
  }));
  const save = async (run) => {
    read();
    const out = { style: P.style, allocation: P.allocation, exposure: P.exposure, max_stop_loss_pct: P.stop || 100, sim_stop: P.stop, sim_slots: P.slots, target_return: P.target, max_drawdown_target: P.max_dd,
      max_positions: P.max_positions, margin_of_safety: P.margin_of_safety, risk_per_trade: P.risk_per_trade, max_weight_per_stock: P.max_weight_per_stock,
      max_weight_per_sector: P.max_weight_per_sector, min_mcap_bn: P.min_mcap_bn, trend_filter: P.trend_filter, exclude_sectors: P.exclude_sectors, exclude_symbols: P.exclude_symbols,
      updated: new Date().toISOString() };
    const ok = await Store.put("profile", out);
    $("#pMsg").innerHTML = ok ? "Đã lưu. Lượt chạy kế tiếp sẽ dùng khẩu vị này." : "Đã lưu trên trình duyệt này, nhưng <b>chưa đồng bộ lên máy chủ</b> – hệ thống chạy hằng ngày chưa đọc được.";
    if (ok && run) { try { const r = await fetch("api/run", { method: "POST" }); $("#pMsg").textContent = r.ok ? "Đã lưu và yêu cầu chạy lại – khoảng 10–30 phút nữa xem trang Hôm nay." : "Đã lưu; chưa gọi chạy lại được – sẽ áp dụng ở lượt chạy kế tiếp."; } catch (e) { /* bỏ qua */ } }
  };
  const drawStyles = () => {
    const bench = BT?.benchmark?.cagr;
    $("#styCards").innerHTML = STYLE_ORDER.map((k) => {
      const S = (t.styles || {})[k] || {}, b = (SB || {})[k] || {}, on = P.style === k;
      const lose = isNum(b.cagr) && isNum(bench) && b.cagr < bench;
      return `<div class="sty ${on ? "on" : ""}"><div class="ph"><h3>${esc(S.name || STYLE_SHORT[k])}</h3><span class="pill">${esc(S.horizon || "")}</span>${on ? '<span class="pill buy">đang dùng</span>' : ""}</div>
        <p style="font-size:.78rem">${esc(S.desc || "")}</p>
        ${b.ok ? kpis([["Lãi kép/năm", pct(b.cagr, 1), cls(b.cagr)], ["Sụt tối đa", pct(b.max_dd, 0), "down"], ...(k === "swing" ? [["Tỷ lệ thắng", pct(b.win_rate, 0, false)], ["Lệnh/năm", nf(b.trades_per_year, 0)]] : [["Sharpe", nf(b.sharpe)], ["Năm có lãi", `${b.win_years ?? "—"}/${b.n_years ?? "—"}`]])], false, "c2")
          : `<p class="faint" style="font-size:.74rem">Kết quả kiểm chứng có sau lượt chạy cuối tuần.</p>`}
        ${lose ? `<p class="note" style="font-size:.74rem;margin-top:6px">Kiểm chứng: lãi thấp hơn VN-Index (${pct(bench, 1)}/năm${isNum(BT?.benchmark?.max_dd) ? `, nhưng VN-Index từng sụt ${pct(BT.benchmark.max_dd, 0)}` : ""}). ${k === "swing" ? "Lướt sóng ở VN khó có lợi thế vì T+2 và phí – chỉ nên dùng phần vốn nhỏ." : "Phù hợp khi ưu tiên ổn định hơn lợi nhuận."}</p>` : ""}
        <p class="faint" style="font-size:.72rem;margin-top:4px">Hôm nay: ${(S.picks || []).length} mã nên mua · ${(S.watch || []).length} mã chờ</p>
        <details><summary style="font-size:.76rem">Quy tắc vào/ra</summary><ul class="checks">${(S.rules || []).map((x) => `<li class="ok">${esc(x)}</li>`).join("")}</ul></details>
        <p style="margin-top:6px">${on ? `<a class="btn" href="#/">Xem kế hoạch hôm nay</a>` : `<button class="btn primary" data-use-sty="${k}">Dùng phong cách này</button>`}</p></div>`;
    }).join("");
    $$("[data-use-sty]").forEach((b) => (b.onclick = async () => { P.style = b.dataset.useSty; $("#pDetail").open = P.style === "position"; await save(false); drawStyles(); toast(`Đã chọn phong cách ${STYLE_SHORT[P.style]} – áp dụng từ lượt chạy kế tiếp`); }));
  };
  drawStyles();
  $("#pSave").onclick = () => save(false);
  $("#pRun").onclick = () => save(true);
  if ($("#pReset")) $("#pReset").onclick = async () => { await Store.put("profile", {}); toast("Đã bỏ khẩu vị – dùng lại config.yaml từ lượt chạy kế tiếp"); viewProfile(); };
  draw();
  if (G && G.ok && !prof0) find();
}

// ================================================================ NHẬT KÝ GIAO DỊCH
const DECISION = { sys: "Theo hệ thống", self: "Tự quyết (ngoài hệ thống)", against: "Ngược hệ thống" };
function pfTabs(on) {
  return `<div class="views" style="margin-top:0">${[["", "Đang nắm"], ["journal", "Nhật ký giao dịch"], ["profile", "Khẩu vị đầu tư"]].map(([k, n]) => `<a class="btn ${on === (k || "hold") ? "primary" : ""}" href="#/portfolio${k ? "/" + k : ""}">${n}</a>`).join("")}</div>`;
}
function fifo(trades) {
  // khớp lệnh bán với lệnh mua cũ nhất; trả về các lượt đã đóng và các lô còn mở
  const bySym = {};
  [...trades].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0))).forEach((t) => (bySym[t.symbol] = bySym[t.symbol] || []).push(t));
  const closed = [], open = [];
  for (const [s, L] of Object.entries(bySym)) {
    const lots = [];
    for (const t of L) {
      if (t.side === "buy") { lots.push({ ...t, left: t.qty, costPx: t.price * (1 + (t.fee ?? 0.15) / 100) }); continue; }
      let q = t.qty;
      const sellPx = t.price * (1 - (t.fee ?? 0.25) / 100);
      if (!lots.length && isNum(t.avg_cost)) { closed.push({ symbol: s, qty: q, buy: { date: "", price: t.avg_cost, costPx: t.avg_cost, decision: t.decision, reason: "(mua trước khi có nhật ký)" }, sell: t, ret: (sellPx / t.avg_cost - 1) * 100, pnl: (sellPx - t.avg_cost) * q * 1000 }); continue; }
      while (q > 0 && lots.length) {
        const lot = lots[0], m = Math.min(q, lot.left);
        closed.push({ symbol: s, qty: m, buy: lot, sell: t, ret: (sellPx / lot.costPx - 1) * 100, pnl: (sellPx - lot.costPx) * m * 1000 });
        lot.left -= m; q -= m;
        if (lot.left <= 0) lots.shift();
      }
    }
    lots.forEach((l) => open.push({ symbol: s, qty: l.left, buy: l }));
  }
  return { closed, open };
}
async function viewJournal() {
  const [jr, t, rows, m, pfr] = await Promise.all([Store.get("journal"), loadToday(), screenerRows(), load("data/market.json"), Store.get("portfolio")]);
  const J = { trades: (jr.data && jr.data.trades) || [] };
  const pf = pfr.data || { holdings: [], cash: 0, capital: null }; pf.holdings = pf.holdings || [];
  const R = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const picks = new Set((t.plan?.picks || []).map((p) => p.symbol)), watch = new Set((t.plan?.watch || []).map((p) => p.symbol));
  const adv = Object.fromEntries(((t.portfolio && t.portfolio.positions) || []).map((p) => [p.symbol, p]));
  const vi = m.indices?.VNINDEX?.ohlc; const viMap = vi ? Object.fromEntries(vi.t.map((d, i) => [d, vi.c[i]])) : {};
  const viAt = (d) => { if (!vi) return null; let lo = 0, hi = vi.t.length - 1; if (d <= vi.t[0]) return vi.c[0]; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (vi.t[mid] <= d) lo = mid; else hi = mid - 1; } return vi.c[lo]; };
  const viNow = vi ? vi.c[vi.c.length - 1] : null;
  const today = new Date().toISOString().slice(0, 10);
  const suggest = (sym, side) => {
    if (side === "buy") return picks.has(sym) ? "sys" : "self";
    const a = adv[sym]; if (!a) return "self";
    return a.severity >= 2 ? "sys" : a.severity === 0 ? "against" : "self";
  };
  const render = () => {
    const { closed, open } = fifo(J.trades);
    const groups = {};
    const addG = (k, x) => (groups[k] = groups[k] || []).push(x);
    closed.forEach((c) => { const bvi = viAt(c.buy.date), svi = viAt(c.sell.date); c.bench = bvi && svi ? (svi / bvi - 1) * 100 : null; c.excess = c.bench != null ? c.ret - c.bench : null; c.days = Math.round((new Date(c.sell.date) - new Date(c.buy.date)) / 864e5); addG(c.buy.decision || "self", c); });
    open.forEach((o) => { const px = R[o.symbol]?.price; o.ret = px ? (px * 0.9975 / o.buy.costPx - 1) * 100 : null; o.pnl = px ? (px * 0.9975 - o.buy.costPx) * o.qty * 1000 : null; const bvi = viAt(o.buy.date); o.bench = bvi && viNow ? (viNow / bvi - 1) * 100 : null; o.excess = o.ret != null && o.bench != null ? o.ret - o.bench : null; o.open = true; addG(o.buy.decision || "self", o); });
    const sum = (L) => { const v = L.filter((x) => x.ret != null); if (!v.length) return null; const w = (f) => v.reduce((a, x) => a + f(x) * x.qty * x.buy.costPx, 0) / v.reduce((a, x) => a + x.qty * x.buy.costPx, 0);
      return { n: v.length, win: 100 * v.filter((x) => x.ret > 0).length / v.length, ret: w((x) => x.ret), ex: v.some((x) => x.excess != null) ? w((x) => x.excess ?? 0) : null, pnl: v.reduce((a, x) => a + (x.pnl || 0), 0), open: v.filter((x) => x.open).length }; };
    const sells = J.trades.filter((x) => x.side === "sell");
    const sAll = sum([...closed, ...open]);
    app().innerHTML = `${pfTabs("journal")}
    <div class="ph"><h1>Nhật ký giao dịch</h1><span class="meta">${J.trades.length} lệnh · ${jr.remote ? "đã đồng bộ" : "lưu trong trình duyệt này"}</span></div>
    ${sAll ? kpis([["Tổng lãi/lỗ", big(sAll.pnl) + " đ", cls(sAll.pnl), "Đã chốt + chưa chốt (tạm tính theo giá hiện tại)"], ["Lãi TB mỗi lượt", pct(sAll.ret, 1), cls(sAll.ret)], ["Vượt VN-Index TB", pct(sAll.ex, 1), cls(sAll.ex)], ["Tỷ lệ thắng", pct(sAll.win, 0, false)], ["Số lượt", `${sAll.n} <small>· ${sAll.open} mở</small>`]], true) : ""}
    <div class="g g-main sec">
      <div class="stack">
        <section class="panel flush"><div class="ph"><h2>Theo hệ thống hay tự quyết – cái nào tốt hơn?</h2><span class="meta">gia quyền theo vốn · phí mua 0,15%, bán 0,25% (gồm thuế)</span></div>
          <div class="tw"><table data-hm="c3"><thead><tr><th class="l">Quyết định khi mua</th><th>Số lượt</th><th>Thắng</th><th>Lãi TB</th><th>Vượt VNI</th><th>Lãi/lỗ</th></tr></thead><tbody>
          ${Object.entries(DECISION).map(([k, n]) => { const s = sum(groups[k] || []); return `<tr><td class="l">${n}</td>${s ? `<td>${s.n}${s.open ? ` <small class="faint">(${s.open} mở)</small>` : ""}</td><td>${nf(s.win, 0)}%</td><td class="${cls(s.ret)}">${pct(s.ret, 1)}</td><td class="${cls(s.ex)}">${pct(s.ex, 1)}</td><td class="${cls(s.pnl)}">${big(s.pnl)}</td>` : `<td colspan="5" class="l faint">chưa có</td>`}</tr>`; }).join("")}</tbody></table></div>
          <p class="faint" style="font-size:.72rem;padding:6px 12px">Sau 15–20 lượt mỗi nhóm, so sánh cột "Vượt VNI" sẽ cho biết những lần anh tự quyết có thêm giá trị hay không. Ít hơn thế thì kết quả còn nhiều yếu tố may rủi.</p></section>
        <section class="panel flush"><div class="ph"><h2>Các lượt mua – bán</h2><span class="meta">khớp theo FIFO</span></div><div class="tw tall"><table data-hm="c3 c6 c8 c10 c12"><thead><tr><th class="sym">Mã</th><th class="l">Mua</th><th>Giá mua</th><th class="l">Bán</th><th>Giá bán / hiện tại</th><th>KL</th><th>Lãi %</th><th>VNI cùng kỳ</th><th>Vượt</th><th>Lãi/lỗ</th><th class="l">Quyết định</th><th class="l">Lý do mua</th></tr></thead><tbody>
          ${[...open, ...closed].sort((a, b) => ((b.sell?.date || "9") > (a.sell?.date || "9") ? 1 : -1)).map((x) => `<tr><td class="sym"><a href="#/s/${x.symbol}">${x.symbol}</a></td><td class="l">${esc(x.buy.date)}</td><td>${nf(x.buy.price)}</td>
            <td class="l">${x.open ? '<span class="pill brand">đang giữ</span>' : esc(x.sell.date)}</td><td>${nf(x.open ? R[x.symbol]?.price : x.sell.price)}</td><td>${nf(x.qty, 0)}</td>
            <td class="${cls(x.ret)}"><b>${pct(x.ret, 1)}</b></td><td class="${cls(x.bench)}">${pct(x.bench, 1)}</td><td class="${cls(x.excess)}">${pct(x.excess, 1)}</td><td class="${cls(x.pnl)}">${big(x.pnl)}</td>
            <td class="l"><small>${esc(DECISION[x.buy.decision] || "—")}</small></td><td class="wrap"><small>${esc(x.buy.reason || "")}</small></td></tr>`).join("") || `<tr><td colspan="12" class="l" style="padding:14px">Chưa có lệnh nào. Ghi lệnh đầu tiên ở khung bên cạnh.</td></tr>`}</tbody></table></div></section>
        ${sells.length ? `<section class="panel flush"><div class="ph"><h2>Bán xong giá đi đâu?</h2><span class="meta">kiểm tra kỷ luật bán – bán non hay bán đúng</span></div><div class="tw"><table><thead><tr><th class="sym">Mã</th><th class="l">Ngày bán</th><th>Giá bán</th><th>Giá hiện tại</th><th>Thay đổi sau khi bán</th><th class="l">Quyết định</th></tr></thead><tbody>
          ${sells.slice().reverse().map((s) => { const px = R[s.symbol]?.price; const ch = px ? (px / s.price - 1) * 100 : null; return `<tr><td class="sym"><a href="#/s/${s.symbol}">${s.symbol}</a></td><td class="l">${esc(s.date)}</td><td>${nf(s.price)}</td><td>${nf(px)}</td><td class="${ch > 0 ? "down" : "up"}">${pct(ch, 1)} <small class="faint">${ch > 10 ? "bán sớm" : ch < -10 ? "bán đúng" : ""}</small></td><td class="l"><small>${esc(DECISION[s.decision] || "—")}</small></td></tr>`; }).join("")}</tbody></table></div></section>` : ""}
        <section class="panel flush"><div class="ph"><h2>Tất cả lệnh</h2><span class="meta"><button class="chip" id="jCsv">Tải CSV</button></span></div><div class="tw" style="max-height:420px"><table data-hm="c6 c8 c9"><thead><tr><th class="l">Ngày</th><th class="sym">Mã</th><th class="l">Lệnh</th><th>KL</th><th>Giá</th><th>Phí %</th><th class="l">Quyết định</th><th class="l">Hệ thống lúc đó</th><th class="l">Lý do</th><th></th></tr></thead><tbody>
          ${J.trades.slice().reverse().map((x) => `<tr><td class="l">${esc(x.date)}</td><td class="sym">${esc(x.symbol)}</td><td class="l ${x.side === "buy" ? "up" : "down"}">${x.side === "buy" ? "Mua" : "Bán"}</td><td>${nf(x.qty, 0)}</td><td>${nf(x.price)}</td><td>${nf(x.fee, 2)}</td>
            <td class="l"><small>${esc(DECISION[x.decision] || "—")}</small></td><td class="wrap"><small class="faint">${esc(x.snap || "")}</small></td><td class="wrap"><small>${esc(x.reason || "")}</small></td><td><button class="chip" data-jdel="${esc(x.id)}">Xoá</button></td></tr>`).join("")}</tbody></table></div></section>
      </div>
      <div class="stack sticky">
        <section class="panel hero"><div class="ph"><h2>Ghi lệnh</h2></div>
          <div class="filters">
            <div class="field w140"><label for="jd">Ngày</label><input id="jd" type="date" value="${today}"></div>
            <div class="field w60"><label for="js">Mã</label><input id="js" placeholder="FPT" autocapitalize="characters"></div>
            <div class="field w90"><label for="jside">Lệnh</label><select id="jside"><option value="buy">Mua</option><option value="sell">Bán</option></select></div>
            <div class="field w90"><label for="jq">KL (cp)</label><input id="jq" inputmode="numeric" placeholder="1000"></div>
            <div class="field w90"><label for="jp">Giá (nghìn)</label><input id="jp" inputmode="decimal" placeholder="95,5"></div>
            <div class="field w60"><label for="jf">Phí %</label><input id="jf" inputmode="decimal" value="0.15"></div>
          </div>
          <div class="field sec"><label for="jdec">Quyết định này là</label><select id="jdec">${Object.entries(DECISION).map(([k, n]) => `<option value="${k}">${n}</option>`).join("")}</select></div>
          <p id="jsys" class="note" style="margin-top:6px;font-size:.76rem" hidden></p>
          <div class="field sec"><label for="jr">Lý do (ngắn gọn – để sau này tự kiểm lại)</label><input id="jr" placeholder="ví dụ: KQKD quý 3 vượt kỳ vọng, P/E thấp hơn ngành"></div>
          <label style="display:flex;gap:6px;align-items:center;font-size:.8rem;margin-top:8px"><input type="checkbox" id="jupd" checked> Cập nhật luôn danh mục đang nắm (và tiền mặt nếu đã nhập)</label>
          <p style="margin-top:8px"><button class="btn primary" id="jadd">Ghi lệnh</button></p></section>
        <section class="panel"><div class="ph"><h2>Vì sao nên ghi?</h2></div><p style="font-size:.8rem">Hệ thống tự ghi lại nó đang khuyên gì vào lúc anh đặt lệnh (có trong danh sách MUA không, điểm, định giá, đèn). Sau vài tháng anh sẽ thấy rõ: những lần anh làm khác hệ thống thì thắng hay thua, và anh có hay bán non không.</p></section>
      </div>
    </div>`;
    const sysInfo = () => {
      const s = $("#js").value.trim().toUpperCase(), side = $("#jside").value, r = R[s];
      if (!/^[A-Z0-9]{3}$/.test(s) || !r) { $("#jsys").hidden = true; return null; }
      const a = adv[s];
      const txt = [picks.has(s) ? "đang trong danh sách MUA" : watch.has(s) ? "đang trong danh sách chờ mua" : "không có trong danh sách MUA",
        `điểm ${nf(r.composite, 0)}`, `kỹ thuật ${r.ta_label || "—"}`, `định giá ${r.verdict || "—"}${isNum(r.fair) ? ` (hợp lý ${nf(r.fair)})` : ""}`, `P/E ${nf(r.pe, 1)} vs ngành ${nf(r.pe_ind, 1)}`,
        `đèn ${LIGHT_VI[t.regime.light]}`, a ? `tư vấn đang nắm: ${a.action}` : ""].filter(Boolean).join(" · ");
      $("#jsys").hidden = false; $("#jsys").textContent = "Hệ thống lúc này: " + txt;
      $("#jdec").value = suggest(s, side);
      if (!$("#jp").value && r.price) $("#jp").placeholder = nf(r.price);
      return txt;
    };
    $("#js").oninput = sysInfo; $("#jside").onchange = () => { $("#jf").value = $("#jside").value === "buy" ? "0.15" : "0.25"; sysInfo(); };
    $("#jadd").onclick = async () => {
      const s = $("#js").value.trim().toUpperCase(), q = Number(String($("#jq").value).replace(/\D/g, "")), side = $("#jside").value;
      const p = Number(String($("#jp").value || R[s]?.price || "").replace(",", "."));
      if (!/^[A-Z0-9]{3}$/.test(s) || !q || !p) { toast("Nhập đủ mã, khối lượng và giá"); return; }
      if (side === "sell") { const held = fifo(J.trades).open.filter((o) => o.symbol === s).reduce((a, o) => a + o.qty, 0); const ph = (pf.holdings.find((h) => h.symbol === s) || {}).qty || 0; if (!held && !ph) { toast(`Chưa có lệnh mua ${s} trong nhật ký – vẫn ghi, nhưng không tính được lãi/lỗ`); } }
      const tr = { id: "t" + Date.now().toString(36), ts: Date.now(), date: $("#jd").value || today, symbol: s, side, qty: q, price: p, fee: Number(String($("#jf").value).replace(",", ".")) || 0,
        decision: $("#jdec").value, reason: $("#jr").value.trim(), snap: "", in_plan: null, composite: null, light: null };
      const recent = (new Date(t.date) - new Date(tr.date)) / 864e5 <= 3;
      if (recent) Object.assign(tr, { snap: sysInfo() || "", in_plan: picks.has(s), composite: R[s]?.composite ?? null, light: t.regime.light });
      else tr.snap = "nhập bù – không có dữ liệu hệ thống của ngày đó";
      let ok;
      if ($("#jupd").checked) ok = await applyTrade(tr, pf, J);
      else { J.trades.push(tr); ok = await Store.put("journal", J); }
      toast(ok ? "Đã ghi lệnh" : "Đã ghi trên trình duyệt này");
      render();
    };
    $$("[data-jdel]").forEach((b) => (b.onclick = async () => { J.trades = J.trades.filter((x) => x.id !== b.dataset.jdel); await Store.put("journal", J); toast("Đã xoá lệnh (danh mục đang nắm không đổi)"); render(); }));
    $("#jCsv").onclick = () => {
      const cols = ["date", "symbol", "side", "qty", "price", "fee", "decision", "reason", "snap"];
      const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + [cols.join(","), ...J.trades.map((x) => cols.map((c) => q(c === "decision" ? DECISION[x[c]] : x[c])).join(","))].join("\n")], { type: "text/csv;charset=utf-8" }));
      a.download = "nhat-ky-giao-dich.csv"; a.click();
    };
  };
  render();
}

// ================================================================ THEO DÕI THỰC TẾ (forward test)
function fbSection(FJ) {
  const S = FJ?.summary || {}, I = FJ?.ind || {};
  if (!S.ok) return "";
  const W = S.walk || {}, H = S.halves || {}, HS = S.halves_sector || {};
  const WN = { naive: "Mọi chỉ số bằng nhau, 50/50", eq: "Trọng số chỉ số theo hiệu lực, 50/50", glob: "… + trọng số nhóm chung", stock: "… + trọng số riêng từng mã", fwd: "Chỉ nhóm tương lai", back: "Chỉ nhóm quá khứ" };
  return `<section class="panel sec"><div class="ph"><h2>Chỉ số tương lai vs quá khứ – kiểm định giả thuyết</h2><span class="meta">${esc(S.start)} → ${esc(S.end)} · ${S.n_stocks} mã · lợi nhuận 3 tháng sau so với bình quân</span></div>
    <div class="g g2"><div>
      <h3>Giả thuyết: mỗi mã cần trọng số tương lai/quá khứ khác nhau</h3>
      ${kpis([["Lặp lại giữa 2 nửa (từng mã)", nf(H.rho, 2), H.p < 0.1 ? "up" : "down", "Tương quan thứ hạng giữa 'mức nghiêng tương lai' của mỗi mã ở nửa đầu và nửa sau"], ["p (hoán vị)", nf(H.p, 2), H.p < 0.1 ? "up" : "down"],
        ["Lặp lại (gộp theo ngành)", nf(HS.rho, 2), HS.p < 0.1 ? "up" : "down"], ["p ngành", nf(HS.p, 2)], ["Độ lệch thật giữa các mã (τ)", nf(S.tau, 3)], ["Trọng số tương lai áp dụng", pct((S.w_glob ?? 0.5) * 100, 0, false)]])}
      <p class="note" style="margin-top:6px">${H.p < 0.1 ? "Khác biệt giữa các mã có lặp lại – dùng trọng số riêng (đã kéo về mức chung theo độ tin cậy)." : `<b>Bác bỏ</b> giả thuyết với dữ liệu hiện có: mã nghiêng tương lai ở nửa đầu không còn nghiêng ở nửa sau (p = ${nf(H.p, 2)}), gộp theo ngành cũng không (p = ${nf(HS.p, 2)}). Khác biệt từng mã là nhiễu, nên mọi mã dùng chung ${pct((S.w_glob ?? 0.5) * 100, 0, false)} tương lai. Trang mã vẫn hiện "riêng lịch sử mã gợi ý" để anh tham khảo. Hệ thống đo lại mỗi tuần – nếu khác biệt trở nên có ý nghĩa, trọng số riêng sẽ tự bật.`}</p>
      <h3 class="sec">Walk-forward (mỗi năm chỉ dùng các năm trước)</h3>
      <div class="tw"><table><thead><tr><th class="l">Cách tính điểm</th><th>Tương quan</th><th>t</th><th>Nhóm 20% điểm cao – 20% thấp / 3 tháng</th><th>% tháng đúng</th></tr></thead><tbody>
        ${Object.entries(WN).map(([k, n]) => { const x = W[k] || {}; return `<tr><td class="l">${n}</td><td class="${x.ic > 0.03 ? "up" : ""}">${nf(x.ic, 3)}</td><td>${nf(x.t, 2)}</td><td class="${cls(x.spread)}">${pct(x.spread, 2)}</td><td>${nf(x.hit, 0)}%</td></tr>`; }).join("")}</tbody></table></div>
    </div><div>
      <h3>Hiệu lực từng chỉ số</h3>
      <div class="tw"><table><thead><tr><th class="l">Chỉ số</th><th>% tương lai</th><th>Tương quan</th><th>t</th><th>Nửa đầu → sau</th><th>Trọng số</th></tr></thead><tbody>
        ${Object.entries(I).sort((a, b) => b[1].f - a[1].f).map(([k, x]) => { const c = S.ind_ic?.[k] || {}; return `<tr class="${(S.ind_w?.[k] || 0) > 0 ? "" : "fboff"}"><td class="l">${esc(x.name)}</td><td>${nf(x.f * 100, 0)}%</td><td class="${c.ic > 0.02 ? "up" : c.ic < -0.02 ? "down" : ""}">${nf(c.ic, 3)}</td><td>${nf(c.t, 1)}</td><td><small>${nf(c.ic_a, 3)} → ${nf(c.ic_b, 3)}</small></td><td>${nf(S.ind_w?.[k], 1)}%</td></tr>`; }).join("")}</tbody></table></div>
      <h3 class="sec">Điểm tổng → kết quả 3 tháng sau</h3>
      <div class="tw"><table><thead><tr><th class="l">Nhóm điểm</th><th>Số lần</th><th>So với bình quân</th><th>% lần hơn</th></tr></thead><tbody>
        ${(S.calib || []).map((c) => `<tr><td class="l">${fbLabel(c.key)} (${c.lo}–${c.hi})</td><td>${nf(c.n, 0)}</td><td class="${cls(c.ret)}">${pct(c.ret, 2)}</td><td>${nf(c.win, 0)}%</td></tr>`).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.72rem;margin-top:6px">Tương quan dương nhưng nhỏ (≈ 0,03–0,05): đủ để nghiêng xác suất khi chọn giữa nhiều mã, không đủ để chắc chắn từng mã. Nhóm điểm cao nhất chưa chắc tốt hơn nhóm "nghiêng mua" – nên coi khuyến nghị tổng là một lớp lọc, kết hợp kế hoạch giá và quản trị rủi ro.</p>
    </div></div></section>`;
}
function fwdSection(F) {
  if (!F || !F.ok) return `<section class="panel hero"><div class="ph"><h2>Theo dõi thực tế – tín hiệu từ nay về sau</h2></div><p class="muted">${esc(F?.reason || "Chưa có dữ liệu – hệ thống bắt đầu ghi từ lượt chạy kế tiếp.")}</p>
    <p class="faint" style="font-size:.74rem">Mỗi ngày hệ thống ghi lại danh sách MUA, sau đó đo xem các mã đó đi thế nào sau 5/20/60 phiên so với VN-Index, và chạy một danh mục giấy làm đúng theo hệ thống. Đây là kết quả không thể "tối ưu ngược" như backtest.</p></section>`;
  const S = F.summary || {};
  const hz = [5, 20, 60].map((h) => [`Sau ${h} phiên`, S[`x${h}_n`] ? `${pct(S[`x${h}_avg`], 1)} <small>vs VNI · đúng ${nf(S[`x${h}_hit`], 0)}% / ${S[`x${h}_n`]}</small>` : "<small>chưa đủ phiên</small>", cls(S[`x${h}_avg`])]);
  return `<section class="panel hero"><div class="ph"><h2>Theo dõi thực tế – tín hiệu từ ${esc(F.start)}</h2><span class="meta">${F.days_logged} ngày ghi nhận · cập nhật ${esc(F.last)}</span></div>
    ${kpis([["Danh mục giấy", pct(F.nav_ret, 1), cls(F.nav_ret), "Làm đúng hệ thống: mua giá đóng cửa ngày báo, theo tỷ trọng; thoát khi thủng cắt lỗ, chạm mục tiêu 1 hoặc sau 60 phiên"], ["VN-Index cùng kỳ", pct(F.bench_ret, 1), cls(F.bench_ret)],
      ["Số lượt mua", `${S.n ?? 0} <small>(${S.open ?? 0} đang giữ)</small>`], ["Tỷ lệ có lãi", pct(S.all_win, 0, false)], ["Thắng VN-Index", pct(S.all_beat, 0, false)], ["Vượt VNI TB/lượt", pct(S.all_excess, 1), cls(S.all_excess)], ...hz,
      ["Nếu mua ngay mã đang chờ", F.watch20?.n ? `${pct(F.watch20.avg_excess, 1)} <small>vs VNI sau 20 phiên (${F.watch20.n} mã)</small>` : "<small>chưa đủ</small>", cls(F.watch20?.avg_excess), "Âm = việc chờ giá về vùng mua là đúng"]], true)}
    ${F.by_style && Object.keys(F.by_style).length ? `<div class="tw sec"><table><thead><tr><th class="l">Phong cách</th><th>Từ ngày</th><th>Lượt mua</th><th>Có lãi</th><th>Vượt VNI TB</th><th>Danh mục giấy</th><th>VN-Index</th></tr></thead><tbody>
      ${STYLE_ORDER.filter((k) => F.by_style[k]).map((k) => { const x = F.by_style[k], s_ = x.summary || {}; return `<tr><td class="l"><b>${esc(STYLE_SHORT[k])}</b></td><td>${esc(x.start)}</td><td>${s_.n ?? 0} <small class="faint">(${s_.open ?? 0} mở)</small></td><td>${pct(s_.all_win, 0, false)}</td><td class="${cls(s_.all_excess)}">${pct(s_.all_excess, 1)}</td><td class="${cls(x.nav_ret)}">${pct(x.nav_ret, 1)}</td><td class="${cls(x.bench_ret)}">${pct(x.bench_ret, 1)}</td></tr>`; }).join("")}</tbody></table></div>` : ""}
    ${(F.nav || []).length > 2 ? `<div class="chart sm sec" id="fwdChart"></div><div class="leg"><span><i style="background:${css("--brand")}"></i>Danh mục giấy theo hệ thống</span><span><i style="background:${css("--ink-3")}"></i>VN-Index</span></div>` : ""}
    <div class="g g2 sec">
      <div class="tw"><table><thead><tr><th class="l">Rổ</th><th>Lượt</th><th>Có lãi</th><th>Lãi TB</th><th>Vượt VNI</th></tr></thead><tbody>${Object.entries(F.by_basket || {}).map(([k, s]) => `<tr><td class="l">${esc(BASKET_SHORT[k] || k)}</td><td>${s.n}</td><td>${pct(s.all_win, 0, false)}</td><td class="${cls(s.all_ret)}">${pct(s.all_ret, 1)}</td><td class="${cls(s.all_excess)}">${pct(s.all_excess, 1)}</td></tr>`).join("")}</tbody></table></div>
      <div class="tw"><table><thead><tr><th class="l">Đèn lúc mua</th><th>Lượt</th><th>Có lãi</th><th>Lãi TB</th><th>Vượt VNI</th></tr></thead><tbody>${Object.entries(F.by_light || {}).map(([k, s]) => `<tr><td class="l">${esc(LIGHT_VI[k] || k)}</td><td>${s.n}</td><td>${pct(s.all_win, 0, false)}</td><td class="${cls(s.all_ret)}">${pct(s.all_ret, 1)}</td><td class="${cls(s.all_excess)}">${pct(s.all_excess, 1)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="tw sec" style="max-height:420px"><table data-hm="c3 c5 c6 c8 c10 c12"><thead><tr><th class="sym">Mã</th><th class="l">Ngày báo</th><th class="l">Rổ</th><th>Giá vào</th><th>Cắt lỗ</th><th>Mục tiêu</th><th class="l">Trạng thái</th><th>Số phiên</th><th>Lãi</th><th>VNI</th><th>Vượt</th><th>Sụt sâu nhất</th></tr></thead><tbody>
      ${(F.episodes || []).map((e) => `<tr><td class="sym"><a href="#/s/${e.symbol}">${e.symbol}</a></td><td class="l">${esc(e.date)}</td><td class="l">${esc(BASKET_SHORT[e.basket] || e.basket || "")}</td><td>${nf(e.entry)}</td><td>${nf(e.stop)}</td><td>${nf(e.t1)}</td>
        <td class="l"><span class="pill ${e.status === "Đang giữ" ? "brand" : e.status.startsWith("Chốt") ? "buy" : e.status === "Cắt lỗ" ? "sell" : ""}">${esc(e.status)}</span></td><td>${e.days}</td>
        <td class="${cls(e.ret)}"><b>${pct(e.ret, 1)}</b></td><td class="${cls(e.bench)}">${pct(e.bench, 1)}</td><td class="${cls(e.excess)}">${pct(e.excess, 1)}</td><td class="down">${pct(e.mae, 1)}</td></tr>`).join("")}</tbody></table></div>
    <p class="faint" style="font-size:.72rem;margin-top:6px">Cần ít nhất 2–3 tháng và 20–30 lượt mua thì kết quả mới có ý nghĩa. Mã được báo mua nhiều ngày liền chỉ tính 1 lượt.</p></section>`;
}
function drawFwd(F) {
  if (!F || !F.ok || !$("#fwdChart")) return;
  const c = mkChart($("#fwdChart"));
  c.addLineSeries({ color: css("--ink-3"), lineWidth: 1, priceLineVisible: false }).setData(F.nav.map((x) => ({ time: x.d, value: x.b })));
  c.addLineSeries({ color: css("--brand"), lineWidth: 2, priceLineVisible: false }).setData(F.nav.map((x) => ({ time: x.d, value: x.v })));
  c.timeScale().fitContent();
}

// ================================================================ THEO DÕI, CẢNH BÁO, SO SÁNH, TÌM NHANH (dùng chung mọi trang)
const WL = {
  data: null,
  async load() { if (!this.data) { const r = await Store.get("watchlist"); this.data = r.data && Array.isArray(r.data.items) ? r.data : { items: [] }; this.remote = r.remote; } return this.data; },
  get(s) { return (this.data?.items || []).find((x) => x.symbol === s) || null; },
  has(s) { return !!this.get(s); },
  async add(s, extra = {}) { await this.load(); let it = this.get(s); if (!it) { it = { symbol: s, added: new Date().toISOString().slice(0, 10), note: "", alerts: [], ...extra }; this.data.items.unshift(it); } await this.save(); return it; },
  async remove(s) { await this.load(); this.data.items = this.data.items.filter((x) => x.symbol !== s); await this.save(); },
  async save() { this.data.updated = new Date().toISOString(); return Store.put("watchlist", this.data); },
};
const starBtn = (s, label = false) => `<button class="star ${WL.has(s) ? "on" : ""}" data-star="${s}" title="${WL.has(s) ? "Bỏ theo dõi" : "Thêm vào danh sách theo dõi"}" aria-pressed="${WL.has(s)}">${WL.has(s) ? "★" : "☆"}${label ? ` <span>${WL.has(s) ? "Đang theo dõi" : "Theo dõi"}</span>` : ""}</button>`;
function refreshStars(s) {
  $$(`[data-star="${s}"]`).forEach((b) => { const on = WL.has(s); b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); const lab = b.querySelector("span"); b.firstChild.textContent = (on ? "★" : "☆") + (lab ? " " : ""); if (lab) lab.textContent = on ? "Đang theo dõi" : "Theo dõi"; b.title = on ? "Bỏ theo dõi" : "Thêm vào danh sách theo dõi"; });
}
const ALERT_TYPES = { below: "Giá giảm tới ≤", above: "Giá tăng tới ≥", pct: "Biến động trong phiên ≥ %", plan: "Vào danh sách MUA" };
async function alertBox(sym, preset = {}) {
  const old = $("#tbox"); if (old) old.remove();
  await screenerRows().catch(() => {});
  const r = (SCREENER || []).find((x) => x.symbol === sym) || {};
  const sug = [["below", r.buy_below, "vùng mua an toàn"], ["below", isNum(r.price) ? Math.round(r.price * 0.93 * 100) / 100 : null, "giảm 7%"], ["above", r.fair, "giá trị hợp lý"], ["above", isNum(r.price) ? Math.round(r.price * 1.1 * 100) / 100 : null, "tăng 10%"]].filter(([, v]) => isNum(v));
  const el = document.createElement("div");
  el.id = "tbox"; el.className = "tbox";
  el.innerHTML = `<div class="tb-in" role="dialog" aria-label="Đặt cảnh báo"><div class="ph"><h2>Đặt cảnh báo ${esc(sym)}</h2><span class="meta">giá hiện tại ${nf(r.price)}</span><button class="chip" id="tbX">Đóng</button></div>
    <div class="views" style="margin:4px 0">${sug.map(([t, v, n]) => `<button data-sg="${t}|${v}">${t === "below" ? "≤" : "≥"} ${nf(v)} <small>${n}</small></button>`).join("")}<button data-sg="plan|">Khi vào danh sách MUA</button></div>
    <div class="filters"><div class="field w200"><label for="alT">Loại</label><select id="alT">${Object.entries(ALERT_TYPES).map(([k, n]) => `<option value="${k}" ${k === (preset.type || "below") ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <div class="field w90"><label for="alV">Giá / %</label><input id="alV" inputmode="decimal" value="${preset.value ?? ""}"></div></div>
    <div class="field sec"><label for="alN">Ghi chú (hiện trong tin Telegram)</label><input id="alN" placeholder="ví dụ: về hỗ trợ thì mua 1/3"></div>
    <p class="faint" style="font-size:.74rem;margin-top:6px">Hệ thống kiểm tra sau mỗi phiên (theo giá cao/thấp nhất trong ngày) và nhắn Telegram một lần khi điều kiện xảy ra.</p>
    <p style="margin-top:8px"><button class="btn primary" id="alOk">Lưu cảnh báo</button></p></div>`;
  document.body.appendChild(el);
  $$("[data-sg]", el).forEach((b) => (b.onclick = () => { const [t, v] = b.dataset.sg.split("|"); $("#alT").value = t; $("#alV").value = v; }));
  $("#tbX").onclick = () => el.remove();
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  $("#alOk").onclick = async () => {
    const t = $("#alT").value, v = Number(String($("#alV").value).replace(",", "."));
    if (t !== "plan" && !v) { toast("Nhập giá hoặc %"); return; }
    const it = await WL.add(sym);
    it.alerts = it.alerts || [];
    it.alerts.push({ id: "a" + Date.now().toString(36), type: t, value: t === "plan" ? null : v, note: $("#alN").value.trim(), active: true, created: new Date().toISOString().slice(0, 10) });
    const ok = await WL.save();
    el.remove(); refreshStars(sym);
    toast(ok ? `Đã đặt cảnh báo ${sym}` : `Đã đặt cảnh báo ${sym} (lưu trên trình duyệt này – Telegram chưa đọc được)`);
    if (location.hash.startsWith("#/watch")) route();
  };
}
async function quickTrade(sym, side) {
  const [pfr, jr, t] = await Promise.all([Store.get("portfolio"), Store.get("journal"), loadToday(), screenerRows()]);
  const pf = pfr.data || { holdings: [], cash: 0, capital: null }; pf.holdings = pf.holdings || [];
  const J = { trades: (jr.data && jr.data.trades) || [] };
  const h = pf.holdings.find((x) => x.symbol === sym), r = (SCREENER || []).find((x) => x.symbol === sym) || {};
  const pkE = Object.entries(t.styles || { position: t.plan }).flatMap(([k, p]) => (p.picks || []).map((x) => [k, x])).sort((a, b) => (a[0] === (t.style || "position") ? -1 : b[0] === (t.style || "position") ? 1 : 0)).find(([, p]) => p.symbol === sym);
  const pk = pkE?.[1];
  if (side === "sell" && !h) { toast(`Chưa có ${sym} trong danh mục`); return; }
  tradeBox({ symbol: sym, side, price: r.price, held: h?.qty || 0, cost: h?.cost, basket: pk?.basket || h?.basket, style: h?.style || pkE?.[0] || null,
    qty: side === "sell" ? h.qty : pk && capitalOf(pf) ? sharesFor(capitalOf(pf), pk.weight, pk.zone[1]) : null,
    decision: side === "buy" ? (pk ? "sys" : "self") : "self",
    note: side === "buy" ? (pk ? `Trong kế hoạch ${BASKET_SHORT[pk.basket] || ""}: vùng mua ${nf(pk.zone[0])}–${nf(pk.zone[1])}, dừng ${nf(pk.stop)}, tỷ trọng ${nf(pk.weight, 1)}%` : "Mã không có trong danh sách MUA hôm nay.") : "",
    snap: `điểm ${nf(r.composite, 0)} · KT ${r.ta_label || "—"} · P/E ${nf(r.pe, 1)} vs ngành ${nf(r.pe_ind, 1)} · đèn ${LIGHT_VI[t.regime.light]}` },
  async (tr) => { const ok = await applyTrade(tr, pf, J); toast((tr.side === "sell" && isNum(tr.realized) ? `Đã ghi – lãi/lỗ chốt ${vnd(tr.realized)}` : "Đã ghi lệnh") + (ok ? "" : " (lưu trên trình duyệt này)")); if (location.hash.startsWith("#/portfolio")) route(); });
}
const recentAdd = (s) => { const r = lsGet("recent", []).filter((x) => x !== s); r.unshift(s); lsSet("recent", r.slice(0, 12)); };
const actBar = (s, opt = {}) => `<div class="qa">${starBtn(s, opt.label)}<button class="chip" data-qt="buy:${s}">Mua</button>${opt.held ? `<button class="chip" data-qt="sell:${s}">Bán</button>` : ""}<button class="chip" data-alert="${s}" title="Đặt cảnh báo giá">🔔</button><button class="chip" data-cmp="${s}" title="So sánh với mã khác">So sánh</button></div>`;
function cmpAdd(s) { const L = lsGet("cmp", []).filter((x) => x !== s); L.push(s); const out = L.slice(-4); lsSet("cmp", out); return out; }

// ---- tìm nhanh (Ctrl/⌘ + K hoặc phím /)
const PAGES = [["Hôm nay", "#/", "h"], ["Bản tin thị trường mỗi phiên", "#/digest", "r"], ["Thông báo", "#/notifications", "o"], ["Tài khoản & cài đặt thông báo", "#/account", "a"], ["Thị trường", "#/market", "m"], ["Trong phiên & biến động", "#/swing", "b"], ["Bảng hành vi giá (đẩy/xả, đảo chiều)", "#/swing/table", "x"], ["Mã liên quan (đồng pha / dẫn dắt)", "#/swing/pairs", "q"], ["Toàn cảnh ngành", "#/sector", "n"], ["Bộ lọc", "#/screener", "l"], ["Theo dõi & cảnh báo", "#/watch", "t"], ["Lịch sự kiện", "#/watch/calendar", "e"],
  ["So sánh mã", "#/compare", "c"], ["Danh mục đang nắm", "#/portfolio", "d"], ["Nhật ký giao dịch", "#/portfolio/journal", "j"], ["Khẩu vị & phong cách đầu tư", "#/portfolio/profile", "p"], ["Kiểm chứng", "#/backtest", "k"], ["Hướng dẫn sử dụng & câu hỏi thường gặp (FAQ)", "#/help", "?"], ["Phương pháp chọn mã & từ điển chỉ số", "#/guide", "y"]];
async function palette(q0 = "") {
  const old = $("#pal"); if (old) { old.remove(); return; }
  const rows = await screenerRows(); await WL.load();
  const S = await secsData();
  const el = document.createElement("div");
  el.id = "pal"; el.className = "tbox pal";
  el.innerHTML = `<div class="tb-in"><input id="palQ" placeholder="Gõ mã, tên công ty, ngành, trang… (vd: FPT, thép, so sánh FPT HPG, mua VNM)" autocomplete="off" value="${esc(q0)}"><div id="palL" class="pal-l"></div>
    <p class="faint" style="font-size:.7rem;margin-top:6px">↑↓ chọn · Enter mở · Esc đóng · phím tắt: <b>g</b> rồi <b>h</b> Hôm nay, <b>n</b> Ngành, <b>l</b> Lọc, <b>t</b> Theo dõi, <b>d</b> Danh mục, <b>c</b> So sánh, <b>k</b> Kiểm chứng</p></div>`;
  document.body.appendChild(el);
  const strip = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
  let items = [], sel = 0;
  const build = () => {
    const q = $("#palQ").value.trim(), qs = strip(q), up = q.toUpperCase();
    items = [];
    const syms = up.split(/[\s,]+/).filter((x) => /^[A-Z0-9]{3}$/.test(x) && rows.some((r) => r.symbol === x));
    const verb = qs.split(/\s+/)[0];
    if (syms.length >= 2 || (verb.startsWith("so") && syms.length)) items.push({ t: `So sánh ${syms.join(", ")}`, s: "mở trang so sánh", go: `#/compare/${syms.join(",")}`, ic: "⇄" });
    if ((verb === "mua" || verb === "ban") && syms[0]) items.push({ t: `${verb === "mua" ? "Ghi lệnh mua" : "Ghi lệnh bán"} ${syms[0]}`, s: "mở hộp ghi lệnh", fn: () => quickTrade(syms[0], verb === "mua" ? "buy" : "sell"), ic: verb === "mua" ? "＋" : "−" });
    if ((verb.startsWith("canh") || verb.startsWith("bao")) && syms[0]) items.push({ t: `Đặt cảnh báo ${syms[0]}`, s: "", fn: () => alertBox(syms[0]), ic: "🔔" });
    if (!q) {
      lsGet("recent", []).forEach((s) => { const r = rows.find((x) => x.symbol === s); if (r) items.push({ t: s, s: `vừa xem · ${r.name || ""}`, go: `#/s/${s}`, ic: "↺", r }); });
      (WL.data?.items || []).slice(0, 6).forEach((w) => { const r = rows.find((x) => x.symbol === w.symbol); if (r && !items.some((i) => i.t === w.symbol)) items.push({ t: w.symbol, s: `đang theo dõi · ${r.name || ""}`, go: `#/s/${w.symbol}`, ic: "★", r }); });
    }
    const st = rows.filter((r) => q && (r.symbol.startsWith(up) || strip(r.name).includes(qs))).sort((a, b) => (b.symbol.startsWith(up) - a.symbol.startsWith(up)) || (b.avg_value_bn || 0) - (a.avg_value_bn || 0)).slice(0, 8);
    st.forEach((r, i) => {
      items.push({ t: r.symbol, s: r.name || "", go: `#/s/${r.symbol}`, ic: "◆", r });
      if (i === 0 && r.symbol === up) {
        items.push({ t: `${WL.has(r.symbol) ? "Bỏ theo dõi" : "Theo dõi"} ${r.symbol}`, s: "", fn: async () => { WL.has(r.symbol) ? await WL.remove(r.symbol) : await WL.add(r.symbol); refreshStars(r.symbol); toast(WL.has(r.symbol) ? "Đã thêm vào theo dõi" : "Đã bỏ theo dõi"); }, ic: "★" });
        items.push({ t: `Ghi lệnh mua ${r.symbol}`, s: "", fn: () => quickTrade(r.symbol, "buy"), ic: "＋" });
        items.push({ t: `Đặt cảnh báo giá ${r.symbol}`, s: "", fn: () => alertBox(r.symbol), ic: "🔔" });
        items.push({ t: `So sánh ${r.symbol} với…`, s: "cùng ngành", go: `#/compare/${[r.symbol, ...rows.filter((x) => x.industry === r.industry && x.symbol !== r.symbol).sort((a, b) => (b.mcap_bn || 0) - (a.mcap_bn || 0)).slice(0, 2).map((x) => x.symbol)].join(",")}`, ic: "⇄" });
      }
    });
    if (qs) {
      (S.sector || []).concat(S.industry || []).filter((x) => strip(x.name).includes(qs)).slice(0, 5).forEach((x) => items.push({ t: x.name, s: `ngành · ${x.n} mã · P/E ${nf(x.pe_med, 1)}`, go: `#/sector/${enc(x.name)}${(S.industry || []).includes(x) ? "/l3" : ""}`, ic: "▦" }));
      PAGES.filter(([n]) => strip(n).includes(qs)).forEach(([n, h]) => items.push({ t: n, s: "trang", go: h, ic: "→" }));
      Object.entries(GLOSS).filter(([k, g]) => strip(g.t).includes(qs) || Object.entries(GLOSS_ALIAS).some(([al, v]) => v === k && strip(al) === qs)).slice(0, 4).forEach(([k, g]) => items.push({ t: g.t, s: "giải thích", fn: () => { location.hash = "#/guide"; setTimeout(() => { const el = document.getElementById("g-" + k); el?.scrollIntoView({ behavior: "smooth", block: "center" }); el?.classList.add("flash"); }, 600); }, ic: "?" }));
    } else PAGES.forEach(([n, h, k]) => items.push({ t: n, s: `g ${k}`, go: h, ic: "→" }));
    sel = 0; draw();
  };
  const draw = () => {
    $("#palL").innerHTML = items.map((it, i) => `<button class="pal-i ${i === sel ? "on" : ""}" data-i="${i}"><span class="pi">${it.ic}</span><b>${esc(it.t)}</b><small>${esc(it.s)}</small>
      ${it.r ? `<span class="pr"><b>${nf(it.r.price)}</b> <small class="${cls(it.r.chg1d)}">${pct(it.r.chg1d, 1)}</small></span>` : ""}</button>`).join("") || `<p class="muted" style="padding:10px">Không tìm thấy.</p>`;
    $$(".pal-i", el).forEach((b) => (b.onclick = () => run(Number(b.dataset.i))));
  };
  const run = (i) => { const it = items[i]; if (!it) return; el.remove(); if (it.go) location.hash = it.go; else if (it.fn) it.fn(); };
  $("#palQ").oninput = build;
  $("#palQ").onkeydown = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { sel = (sel + (e.key === "ArrowDown" ? 1 : items.length - 1)) % Math.max(1, items.length); draw(); e.preventDefault(); }
    else if (e.key === "Enter") { run(sel); e.preventDefault(); }
    else if (e.key === "Escape") el.remove();
  };
  el.onclick = (e) => { if (e.target === el) el.remove(); };
  build(); $("#palQ").focus();
}
function initGlobal() {
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-star],[data-qt],[data-cmp],[data-alert],[data-pal]");
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    if (b.dataset.star) { const s = b.dataset.star; await WL.load(); if (WL.has(s)) { await WL.remove(s); toast(`Đã bỏ theo dõi ${s}`); } else { await WL.add(s, { price0: (SCREENER || []).find((r) => r.symbol === s)?.price }); toast(`Đã thêm ${s} vào theo dõi`); } refreshStars(s); if (location.hash.startsWith("#/watch")) route(); }
    else if (b.dataset.qt) { const [side, s] = b.dataset.qt.split(":"); quickTrade(s, side); }
    else if (b.dataset.alert) alertBox(b.dataset.alert);
    else if (b.dataset.cmp) { const L = cmpAdd(b.dataset.cmp); location.hash = `#/compare/${L.join(",")}`; }
    else if (b.dataset.pal !== undefined) palette();
  }, true);
  let g = 0;
  document.addEventListener("keydown", (e) => {
    const ae = document.activeElement, typing = !!ae && (/TEXTAREA|SELECT/.test(ae.tagName) || ae.isContentEditable || (ae.tagName === "INPUT" && !/checkbox|radio|button|submit|range/.test(ae.type)));
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); palette(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "/") { e.preventDefault(); palette(); return; }
    if (e.key === "?") { e.preventDefault(); palette(""); return; }
    if (e.key === "Escape") { $("#tbox")?.remove(); $("#pal")?.remove(); return; }
    if (e.key === "g") { g = Date.now(); return; }
    if (Date.now() - g < 1200) { const p = PAGES.find(([, , k]) => k === e.key); if (p) { location.hash = p[1]; g = 0; } }
  });
}

// ================================================================ THEO DÕI (danh sách + cảnh báo) & LỊCH SỰ KIỆN
async function viewWatch(sub) {
  const [rows, t, ev, pfr, jr] = await Promise.all([screenerRows(), loadToday(), tryLoad("data/events.json"), Store.get("portfolio"), Store.get("journal")]);
  await WL.load();
  const R = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const hits = Object.fromEntries((t.alerts || []).map((a) => [a.id, a]));
  const inStyles = (s) => STYLE_ORDER.filter((k) => (t.styles?.[k]?.picks || []).some((p) => p.symbol === s));
  const watchStyles = (s) => STYLE_ORDER.filter((k) => (t.styles?.[k]?.watch || []).some((p) => p.symbol === s));
  const pf = pfr.data || { holdings: [] };
  const tabs = `<div class="views" style="margin-top:0"><a class="btn ${sub !== "calendar" ? "primary" : ""}" href="#/watch">Danh sách theo dõi</a><a class="btn ${sub === "calendar" ? "primary" : ""}" href="#/watch/calendar">Lịch sự kiện</a></div>`;
  if (sub === "calendar") {
    const mine = new Set([...(pf.holdings || []).map((h) => h.symbol), ...WL.data.items.map((x) => x.symbol)]);
    const scope = lsGet("calScope", "mine");
    const today = t.date;
    const personal = [];
    (pf.holdings || []).forEach((h) => {
      const lb = h.last_buy || h.date;
      if (lb) { const d = addTradingDays(lb, 2); if (d >= today) personal.push({ date: d, symbol: h.symbol, type: "t2", title: `Hàng về – bán được ${h.symbol} (mua ${lb})` }); }
      if (h.date) { let d = h.date; for (let i = 0; i < 60; i++) d = addTradingDays(d, 1); if (d >= today) personal.push({ date: d, symbol: h.symbol, type: "review", title: `Đủ 60 phiên nắm ${h.symbol} – xem lại luận điểm` }); }
    });
    const all = [...(ev?.events || []), ...personal].filter((e) => scope === "all" || !e.symbol || mine.has(e.symbol) || e.type === "t2" || e.type === "review");
    const by = {};
    all.forEach((e) => (by[e.date] = by[e.date] || []).push(e));
    const days = Object.keys(by).sort();
    const up = days.filter((d) => d >= today), past = days.filter((d) => d < today).reverse().slice(0, 10);
    const ico = { div_cash: "💵", div_stock: "📄", earnings: "📊", agm: "🏛", t2: "📦", review: "🔍" };
    const dayBlock = (d) => `<div class="cal-d ${d === today ? "today" : ""}"><div class="cal-h"><b>${new Date(d + "T00:00:00").toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })}</b><small>${d === today ? "hôm nay" : d > today ? `còn ${tradingDaysBetween(today, d)} phiên` : ""}</small></div>
      ${by[d].map((e) => `<div class="cal-e ${e.type}">${ico[e.type] || "•"} ${e.symbol ? `<a href="#/s/${e.symbol}"><b>${e.symbol}</b></a> ` : ""}${esc(e.title)}${isNum(e.yield) ? ` <span class="pill buy">lợi suất ${nf(e.yield, 1)}%</span>` : ""}${e.symbol && mine.has(e.symbol) ? ' <span class="pill brand">của tôi</span>' : ""}</div>`).join("")}</div>`;
    app().innerHTML = `${tabs}<div class="ph"><h1>Lịch sự kiện</h1><span class="seg" id="calS"><button data-v="mine" class="${scope === "mine" ? "on" : ""}">Mã của tôi</button><button data-v="all" class="${scope === "all" ? "on" : ""}">Tất cả</button></span>
      <span class="meta">chốt quyền cổ tức đã công bố, hạn BCTC & ĐHCĐ, ngày hàng về T+2, hạn xem lại vị thế</span></div>
      <div class="g g-main"><section class="panel"><div class="ph"><h2>Sắp tới</h2><span class="meta">${up.length} ngày có sự kiện</span></div>${up.length ? `<div class="cal">${up.map(dayBlock).join("")}</div>` : `<div class="empty">Không có sự kiện sắp tới${scope === "mine" ? " cho mã anh đang nắm/theo dõi – thử xem Tất cả" : ""}.</div>`}</section>
      <section class="panel"><div class="ph"><h2>Vừa qua</h2></div>${past.length ? `<div class="cal">${past.map(dayBlock).join("")}</div>` : `<p class="muted">Không có.</p>`}
        <p class="faint" style="font-size:.72rem;margin-top:8px">Lịch cổ tức lấy từ dữ liệu sự kiện của sàn, được tải dần theo lượt (chưa đủ mọi mã). Ngày giao dịch không hưởng quyền thường là 1 phiên trước ngày chốt.</p></section></div>`;
    $$("#calS button").forEach((b) => (b.onclick = () => { lsSet("calScope", b.dataset.v); viewWatch("calendar"); }));
    return;
  }
  const sortBy = lsGet("wlSort", "added");
  const items = [...WL.data.items];
  const near = (it) => { const r = R[it.symbol]; if (!r) return 999; const d = (it.alerts || []).filter((a) => a.active && isNum(a.value) && (a.type === "below" || a.type === "above")).map((a) => Math.abs(r.price / a.value - 1) * 100); return d.length ? Math.min(...d) : 999; };
  if (sortBy === "chg") items.sort((a, b) => (R[b.symbol]?.chg1d ?? -99) - (R[a.symbol]?.chg1d ?? -99));
  if (sortBy === "near") items.sort((a, b) => near(a) - near(b));
  if (sortBy === "score") items.sort((a, b) => (R[b.symbol]?.composite ?? 0) - (R[a.symbol]?.composite ?? 0));
  const card = (it) => {
    const s = it.symbol, r = R[s] || {}, st = inStyles(s), ws = watchStyles(s);
    const al = (it.alerts || []).map((a) => {
      const hit = hits[a.id]; const dist = isNum(a.value) && isNum(r.price) ? (a.value / r.price - 1) * 100 : null;
      return `<div class="al ${hit ? "hit" : ""} ${a.active ? "" : "off"}"><span>${a.type === "below" ? "≤" : a.type === "above" ? "≥" : a.type === "pct" ? "±" : "🛒"} ${a.type === "plan" ? "Vào danh sách MUA" : nf(a.value) + (a.type === "pct" ? "%" : "")}</span>
        <small>${hit ? `<b class="ref">đã chạm ${esc(hit.date)}</b>` : isNum(dist) && a.type !== "pct" ? `còn ${pct(dist, 1)}` : ""}${a.note ? " · " + esc(a.note) : ""}</small>
        <button class="chip" data-aoff="${s}|${a.id}">${a.active ? "Tắt" : "Bật"}</button><button class="chip" data-adel="${s}|${a.id}">✕</button></div>`;
    }).join("");
    return `<div class="wl"><div class="pk-head"><div><input type="checkbox" class="wsel" data-ws="${s}" aria-label="Chọn ${s} để so sánh"> <a class="sym" href="#/s/${s}">${s}</a>
        ${st.map((k) => `<span class="pill buy">MUA · ${STYLE_SHORT[k]}</span>`).join(" ")}${ws.map((k) => `<span class="pill wait">chờ · ${STYLE_SHORT[k]}</span>`).join(" ")}
        <small class="pk-name">${esc(r.name || "")} · ${esc(r.sector || "")} · theo dõi từ ${esc(it.added || "")}${isNum(it.price0) ? ` (giá ${nf(it.price0)})` : ""}</small></div>
        <div class="pk-px">${mini(r.spk, { w: 90, h: 30 })}<div><b>${nf(r.price)}</b><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)}</small></div>${ring(r.composite, 34)}</div></div>
      <div class="pk-facts"><div class="hlf"><small>P/E</small><b>${nf(r.pe, 1)}</b><small>ngành ${nf(r.pe_ind, 1)}</small></div><div><small>Định giá</small><b>${esc((r.verdict || "—").split(" – ")[0])}</b><small>hợp lý ${nf(r.fair)}</small></div>
        <div><small>Kỹ thuật</small><b>${esc(r.ta_label || "—")}</b><small>xu hướng ${TREND_VI[r.trend] || "—"}</small></div><div><small>1 tháng · 1 năm</small><b class="${cls(r.chg1m)}">${pct(r.chg1m, 0)}</b><small class="${cls(r.chg1y)}">${pct(r.chg1y, 0)}</small></div></div>
      ${al ? `<div class="als">${al}</div>` : ""}
      <div class="wl-note"><input data-note="${s}" value="${esc(it.note || "")}" placeholder="Ghi chú của anh về mã này (lưu tự động)"></div>
      <div class="pos-act"><button class="btn" data-alert="${s}">🔔 Đặt cảnh báo</button><button class="btn" data-qt="buy:${s}">Ghi lệnh mua</button><button class="btn" data-cmp="${s}">So sánh</button><button class="chip" data-star="${s}">Bỏ theo dõi</button></div></div>`;
  };
  app().innerHTML = `${tabs}<div class="ph"><h1>Theo dõi & cảnh báo</h1><span class="meta">${WL.data.items.length} mã · ${WL.remote ? "đồng bộ – Telegram đọc được" : "đang lưu trong trình duyệt này"}</span></div>
    ${(t.alerts || []).length ? `<section class="panel hero"><div class="ph"><h2>🔔 Cảnh báo đã kích hoạt phiên ${esc(t.date)}</h2></div><div class="rows">${t.alerts.map((a) => row(`#/s/${a.symbol}`, a.symbol, esc(a.text) + (a.note ? " · " + esc(a.note) : ""), "", `<b>${nf(a.close)}</b>`, "")).join("")}</div></section>` : ""}
    <section class="panel sec"><div class="filters"><div class="field w90"><label for="wAdd">Thêm mã</label><input id="wAdd" placeholder="FPT" autocapitalize="characters"></div><button class="btn primary" id="wAddB">Theo dõi</button>
      <div class="field w140"><label for="wSort">Sắp xếp</label><select id="wSort">${[["added", "Mới thêm"], ["chg", "Tăng mạnh hôm nay"], ["near", "Gần cảnh báo nhất"], ["score", "Điểm cao nhất"]].map(([k, n]) => `<option value="${k}" ${k === sortBy ? "selected" : ""}>${n}</option>`).join("")}</select></div>
      <button class="btn" id="wCmp" disabled>So sánh các mã đã chọn</button>
      <span class="faint" style="font-size:.74rem">Gợi ý thêm: ${(t.plan?.picks || []).concat(t.plan?.watch || []).slice(0, 6).filter((p) => !WL.has(p.symbol)).map((p) => `<a href="#" data-wq="${p.symbol}">${p.symbol}</a>`).join(", ") || "—"}</span></div></section>
    ${items.length ? `<div class="wlg sec">${items.map(card).join("")}</div>` : `<div class="empty sec">Chưa theo dõi mã nào. Bấm ☆ ở bất kỳ đâu (trang mã, bộ lọc, Hôm nay) hoặc nhập mã ở trên.</div>`}`;
  const add = async (s) => { s = String(s || "").trim().toUpperCase(); if (!R[s]) { toast("Không thấy mã này"); return; } await WL.add(s, { price0: R[s].price }); toast(`Đã theo dõi ${s}`); viewWatch(); };
  $("#wAddB").onclick = () => add($("#wAdd").value);
  $("#wAdd").onkeydown = (e) => { if (e.key === "Enter") add($("#wAdd").value); };
  $$("[data-wq]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); add(a.dataset.wq); }));
  $("#wSort").onchange = (e) => { lsSet("wlSort", e.target.value); viewWatch(); };
  const upd = () => { const n = $$(".wsel").filter((x) => x.checked).length; $("#wCmp").disabled = n < 2; $("#wCmp").textContent = n >= 2 ? `So sánh ${n} mã đã chọn` : "So sánh các mã đã chọn (chọn 2–4)"; };
  $$(".wsel").forEach((x) => (x.onchange = () => { if ($$(".wsel").filter((y) => y.checked).length > 4) { x.checked = false; toast("Tối đa 4 mã"); } upd(); }));
  $("#wCmp").onclick = () => { const L = $$(".wsel").filter((x) => x.checked).map((x) => x.dataset.ws); lsSet("cmp", L); location.hash = `#/compare/${L.join(",")}`; };
  upd();
  $$("[data-note]").forEach((i) => (i.onchange = async () => { const it = WL.get(i.dataset.note); it.note = i.value.trim(); await WL.save(); toast("Đã lưu ghi chú"); }));
  $$("[data-aoff]").forEach((b) => (b.onclick = async () => { const [s, id] = b.dataset.aoff.split("|"); const a = WL.get(s).alerts.find((x) => x.id === id); a.active = !a.active; if (a.active) a.id = "a" + Date.now().toString(36); await WL.save(); viewWatch(); }));
  $$("[data-adel]").forEach((b) => (b.onclick = async () => { const [s, id] = b.dataset.adel.split("|"); const it = WL.get(s); it.alerts = it.alerts.filter((x) => x.id !== id); await WL.save(); viewWatch(); }));
}

// ================================================================ SO SÁNH 2–4 MÃ
async function viewCompare(arg) {
  const rows = await screenerRows();
  const R = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  let syms = String(arg || "").toUpperCase().split(/[\s,]+/).filter((s) => R[s]).slice(0, 4);
  if (!syms.length) syms = lsGet("cmp", []).filter((s) => R[s]);
  lsSet("cmp", syms);
  const D = {};
  await Promise.all(syms.map(async (s) => { D[s] = await tryLoad(`data/stocks/${s}.json`); }));
  const t = await loadToday(), S = await secsData();
  const per = lsGet("cmpPer", 250);
  const first = syms[0] && R[syms[0]];
  const sug = first ? rows.filter((x) => x.industry === first.industry && !syms.includes(x.symbol)).sort((a, b) => (b.mcap_bn || 0) - (a.mcap_bn || 0)).slice(0, 6) : [];
  const COL = ["--brand", "--up", "--ref", "--ceil"];
  // [nhãn, hàm lấy giá trị, định dạng, hướng tốt (1 cao tốt, -1 thấp tốt, 0 không so)]
  const M = [
    ["Định giá", null], ["P/E", (r) => (r.pe > 0 ? r.pe : null), (v) => nf(v, 1), -1], ["P/E ngành", (r) => r.pe_ind, (v) => nf(v, 1), 0], ["P/E so ngành", (r) => r.pe_vs_ind, (v) => vsCell(v), -1],
    ["P/B", (r) => (r.pb > 0 ? r.pb : null), (v) => nf(v), -1], ["EV/EBITDA", (r) => (r.ev_ebitda > 0 ? r.ev_ebitda : null), (v) => nf(v, 1), -1], ["Giá trị hợp lý", (r) => r.fair, (v) => nf(v), 0], ["Tiềm năng", (r) => r.upside, (v) => `<span class="${cls(v)}">${pct(v, 0)}</span>`, 1],
    ["Sinh lời & sức khoẻ", null], ["ROE", (r) => r.roe, (v) => pct(v, 1, false), 1], ["ROE TB 5 năm", (r) => r.roe_avg5, (v) => pct(v, 1, false), 1], ["Biên LN ròng", (r) => r.net_margin, (v) => pct(v, 1, false), 1], ["Vay/Vốn", (r) => r.de, (v) => nf(v), -1], ["F-Score", (r) => r.fscore, (v) => `${nf(v, 0)}/9`, 1], ["CFO/LN", (r) => r.cfo_ni, (v) => nf(v), 1],
    ["Tăng trưởng", null], ["DT 12 tháng", (r) => r.rev_yoy, (v) => `<span class="${cls(v)}">${pct(v, 0)}</span>`, 1], ["LN 12 tháng", (r) => r.ni_yoy, (v) => `<span class="${cls(v)}">${pct(v, 0)}</span>`, 1], ["LN quý gần nhất", (r) => r.ni_q_yoy, (v) => `<span class="${cls(v)}">${pct(v, 0)}</span>`, 1], ["LN CAGR 3 năm", (r) => r.ni_cagr3, (v) => pct(v, 0), 1],
    ["Cổ tức", null], ["Lợi suất", (r) => r.div_yield, (v) => pct(v, 1, false), 1], ["Năm trả liên tiếp", (r) => r.cash_years, (v) => nf(v, 0), 1],
    ["Giá & kỹ thuật", null], ["1 tháng", (r) => r.chg1m, (v) => `<span class="${cls(v)}">${pct(v, 0)}</span>`, 1], ["1 năm", (r) => r.chg1y, (v) => `<span class="${cls(v)}">${pct(v, 0)}</span>`, 1], ["Cách đỉnh 52T", (r) => r.from_hi52, (v) => pct(v, 0), 1], ["Điểm kỹ thuật", (r) => r.ta_score, (v) => `${nf(v, 0)} <small>${""}</small>`, 1], ["RS", (r) => r.rs_rating, (v) => nf(v, 0), 1], ["Beta", (r) => r.beta, (v) => nf(v), -1], ["GTGD/ngày", (r) => r.avg_value_bn, (v) => bn(v), 1], ["Vốn hoá", (r) => r.mcap_bn, (v) => mcapFmt(v), 0],
    ["Điểm phương pháp", null], ["Tổng hợp", (r) => r.composite, (v) => scoreCell(v), 1], ["Giá trị", (r) => r.value, (v) => scoreCell(v), 1], ["Chất lượng", (r) => r.quality, (v) => scoreCell(v), 1], ["Tăng trưởng", (r) => r.growth, (v) => scoreCell(v), 1], ["Cổ tức", (r) => r.dividend, (v) => scoreCell(v), 1], ["Động lượng", (r) => r.momentum, (v) => scoreCell(v), 1], ["SMC", (r) => r.smc, (v) => scoreCell(v), 1],
  ];
  const best = (f, dir) => { if (!dir) return null; const v = syms.map((s) => f(R[s])).filter(isNum); if (v.length < 2) return null; return dir > 0 ? Math.max(...v) : Math.min(...v); };
  const planOf = (s) => STYLE_ORDER.map((k) => { const p = (t.styles?.[k]?.picks || []).find((x) => x.symbol === s), w = (t.styles?.[k]?.watch || []).find((x) => x.symbol === s); return p ? `<span class="pill buy">MUA · ${STYLE_SHORT[k]}</span>` : w ? `<span class="pill wait">chờ · ${STYLE_SHORT[k]}</span>` : ""; }).join(" ") || '<small class="faint">không trong kế hoạch</small>';
  app().innerHTML = `<div class="ph"><h1>So sánh mã</h1><span class="meta">tối đa 4 mã · ô xanh = tốt nhất trong nhóm</span></div>
    <section class="panel"><div class="filters">${syms.map((s) => `<span class="pill brand" style="font-size:.85rem">${s} <button class="chip" data-rm="${s}" aria-label="Bỏ ${s}">✕</button></span>`).join("")}
      ${syms.length < 4 ? `<div class="field w90"><label for="cA">Thêm mã</label><input id="cA" placeholder="HPG" autocapitalize="characters"></div><button class="btn primary" id="cAB">Thêm</button>` : ""}
      ${sug.length && syms.length < 4 ? `<span class="faint" style="font-size:.76rem">Cùng ngành ${esc(first.industry || "")}: ${sug.map((x) => `<a href="#" data-ca="${x.symbol}">${x.symbol}</a>`).join(", ")}</span>` : ""}</div></section>
    ${syms.length < 2 ? `<div class="empty sec">Chọn ít nhất 2 mã để so sánh. Gợi ý: mở bộ lọc, tick nhiều mã rồi bấm "So sánh", hoặc gõ <b>so sánh FPT CMG</b> ở ô tìm nhanh (phím /).</div>` : `
    <div class="cmp-heads sec" style="--n:${syms.length}">${syms.map((s, i) => { const r = R[s]; return `<section class="panel" style="border-top:3px solid var(${COL[i]})"><div class="pk-head"><div><a class="sym" href="#/s/${s}">${s}</a> ${starBtn(s)}<small class="pk-name">${esc(r.name || "")}</small></div><div class="pk-px"><div><b>${nf(r.price)}</b><small class="${cls(r.chg1d)}">${pct(r.chg1d, 1)}</small></div>${ring(r.composite, 34)}</div></div>
      ${mini(r.spk, { w: 220, h: 34 }).replace('class="mini"', 'class="mini wide"')}<div class="tags" style="margin-top:4px">${planOf(s)}</div><small class="faint">${esc(r.sector || "")} · ${esc(r.verdict || "")}</small></section>`; }).join("")}</div>
    <section class="panel sec"><div class="ph"><h2>Diễn biến giá (cùng gốc 100)</h2><span class="seg" id="cPer">${[[63, "3 tháng"], [126, "6 tháng"], [250, "1 năm"], [500, "2 năm"]].map(([n, l]) => `<button data-n="${n}" class="${n === per ? "on" : ""}">${l}</button>`).join("")}</span></div>
      <div class="chart md" id="cChart"></div><div class="leg">${syms.map((s, i) => `<span><i style="background:var(${COL[i]})"></i>${s}</span>`).join("")}<span><i style="background:var(--ink-3)"></i>VN-Index</span></div></section>
    <section class="panel flush sec"><div class="tw"><table class="cmpt"><thead><tr><th class="l"></th>${syms.map((s, i) => `<th style="color:var(${COL[i]})">${s}</th>`).join("")}</tr></thead><tbody>
      ${M.map(([n, f, fm, dir]) => !f ? `<tr class="gh"><td class="l" colspan="${syms.length + 1}"><b>${n}</b></td></tr>` : (() => { const b = best(f, dir); return `<tr><td class="l">${n}</td>${syms.map((s) => { const v = f(R[s]); return `<td class="${isNum(b) && isNum(v) && v === b ? "best" : ""}">${isNum(v) ? fm(v) : "—"}</td>`; }).join("")}</tr>`; })()).join("")}
      <tr class="gh"><td class="l" colspan="${syms.length + 1}"><b>Kế hoạch theo phong cách</b></td></tr>
      ${STYLE_ORDER.map((k) => `<tr><td class="l">${STYLE_SHORT[k]}</td>${syms.map((s) => { const p = (t.styles?.[k]?.picks || []).find((x) => x.symbol === s) || (t.styles?.[k]?.watch || []).find((x) => x.symbol === s);
        return `<td>${p ? `<small>${p.state === "now" ? '<b class="up">mua</b>' : '<b class="ref">chờ</b>'} ${nf(p.zone[0])}–${nf(p.zone[1])}<br>dừng ${nf(p.stop)} · MT ${nf(p.t1)}</small>` : '<small class="faint">—</small>'}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div></section>
    <section class="panel sec"><div class="ph"><h2>P/E theo quý</h2></div><div id="cPE"></div></section>`}`;
  const go = (L) => { location.hash = `#/compare/${L.join(",")}`; };
  $$("[data-rm]").forEach((b) => (b.onclick = () => go(syms.filter((x) => x !== b.dataset.rm))));
  const addS = (s) => { s = String(s || "").trim().toUpperCase(); if (!R[s]) { toast("Không thấy mã"); return; } go([...syms.filter((x) => x !== s), s].slice(0, 4)); };
  if ($("#cAB")) { $("#cAB").onclick = () => addS($("#cA").value); $("#cA").onkeydown = (e) => { if (e.key === "Enter") addS($("#cA").value); }; }
  $$("[data-ca]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); addS(a.dataset.ca); }));
  if (syms.length < 2) return;
  const m = await tryLoad("data/market.json");
  const drawC = () => {
    disposeCharts();
    const c = mkChart($("#cChart"));
    const ser1 = (t_, c_, col, w) => { const n = Math.min(per, t_.length); const T = t_.slice(-n), V = c_.slice(-n); const b0 = V.find(isNum); c.addLineSeries({ color: col, lineWidth: w, priceLineVisible: false, lastValueVisible: true }).setData(T.map((d, i) => (isNum(V[i]) ? { time: d, value: (V[i] / b0) * 100 } : null)).filter(Boolean)); };
    syms.forEach((s, i) => { const o = D[s]?.ohlc; if (o) ser1(o.t, o.c, css(COL[i]), 2); });
    const vi = m?.indices?.VNINDEX?.ohlc; if (vi) ser1(vi.t, vi.c, css("--ink-3"), 1);
    c.timeScale().fitContent();
  };
  drawC();
  $$("#cPer button").forEach((b) => (b.onclick = () => { lsSet("cmpPer", Number(b.dataset.n)); $$("#cPer button").forEach((x) => x.classList.toggle("on", x === b)); viewCompare(syms.join(",")); }));
  const labs = [...new Set(syms.flatMap((s) => (D[s]?.val_hist || []).map((x) => x.p)))];
  const order = (p) => { const [q, y] = p.slice(1).split("/"); return Number(y) * 10 + Number(q); };
  labs.sort((a, b) => order(a) - order(b));
  $("#cPE").innerHTML = labs.length > 3 ? lineSvg(syms.map((s, i) => { const mp = Object.fromEntries((D[s]?.val_hist || []).map((x) => [x.p, x.pe])); return { name: s, color: css(COL[i]), width: 2, pts: labs.map((p) => ({ x: p, y: mp[p] })) }; }), { w: Math.max(340, Math.min(1200, $("#cPE").clientWidth || 640)), h: 220, label: "P/E theo quý" }) : `<p class="muted">Chưa đủ lịch sử P/E.</p>`;
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

// ================================================================ BẢNG ĐIỆN (dải chạy đầu trang)
const LIMIT = { HOSE: 7, HNX: 10, UPCOM: 15 };
function boardCls(chg, ex) {
  if (!isNum(chg)) return "";
  const lim = LIMIT[ex] || 7;
  if (chg >= lim - 0.35) return "ceil";
  if (chg <= -(lim - 0.35)) return "floor";
  return Math.abs(chg) < 0.005 ? "ref" : chg > 0 ? "up" : "down";
}
const arrow = (c) => (c === "ceil" || c === "up" ? "▲" : c === "floor" || c === "down" ? "▼" : "■");
const IDX_VI = { VNINDEX: "VN-Index", HNXINDEX: "HNX-Index", UPCOMINDEX: "UPCoM", VN30: "VN30" };
async function drawBoard(t, m, meta) {
  const br = m.regime.breadth_now || {}, light = t.regime.light;
  const L = $("#bdLight");
  L.className = `bd-light ${light}`;
  L.querySelector("span").innerHTML = `<b>Đèn ${LIGHT_VI[light].toLowerCase()}</b><small>nắm tối đa ${t.regime.exposure}%</small>`;
  $("#brandDot").style.background = `var(--l-${light})`;
  $("#bdDate").textContent = meta.data_date ? new Date(meta.data_date + "T00:00:00").toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "";
  const it = (href, name, px, chg, cl, extra = "") => `<a class="bi ${cl}" href="${href}"><b>${esc(name)}</b><span class="px">${px}</span><span class="ch">${arrow(cl)} ${pct(Math.abs(chg ?? 0), 2, false)}</span>${extra}</a>`;
  const grp = (name) => `<span class="bg">${esc(name)}</span>`;
  const head = Object.entries(m.indices).map(([k, v]) => it("#/market", IDX_VI[k] || k, nf(v.close), v.chg, boardCls(v.chg, "IDX"))).join("");
  const adv = br.adv || 0, dec = br.dec || 0, tot = adv + dec || 1;
  const breadth = `<a class="bi br" href="#/market"><b>Độ rộng</b><span class="up">${adv} tăng</span><i class="brbar"><i style="width:${(adv / tot) * 100}%"></i></i><span class="down">${dec} giảm</span></a>`;
  const pe = SECS?.market?.pe_med ? `<a class="bi pe" href="#/sector"><b>P/E thị trường</b><span class="px">${nf(SECS.market.pe_w_pos ?? SECS.market.pe_w, 1)}</span><small>trung vị ${nf(SECS.market.pe_med, 1)}</small></a>` : "";
  const roll = $("#ticker");
  const paint = (rest) => {
    const one = `<div class="bd-set">${head}${breadth}${pe}${rest}</div>`;
    roll.innerHTML = `<div class="bd-track">${one}${one.replace('class="bd-set"', 'class="bd-set" aria-hidden="true"')}</div>`;
    const tr = roll.firstChild, w = tr.firstChild.getBoundingClientRect().width;
    tr.style.setProperty("--dur", `${Math.max(30, w / 42)}s`);
  };
  paint("");
  try {
    const [rows, pfr] = await Promise.all([screenerRows(), Store.get("portfolio"), WL.load()]);
    const R = Object.fromEntries(rows.map((r) => [r.symbol, r]));
    try { const LV = await liveData(); if (liveFresh(LV)) (LV.rows || []).forEach((x) => { if (R[x.s]) R[x.s] = { ...R[x.s], price: x.px, chg1d: x.chg }; }); } catch (e) { /* không có dữ liệu trong phiên */ }
    const stock = (s) => { const r = R[s]; if (!r) return ""; const c = boardCls(r.chg1d, r.exchange); return it(`#/s/${s}`, s, nf(r.price), r.chg1d, c); };
    const mine = [...new Set((pfr.data?.holdings || []).map((h) => h.symbol))].filter((s) => R[s]);
    const watch = (WL.data?.items || []).map((x) => x.symbol).filter((s) => R[s] && !mine.includes(s)).slice(0, 12);
    const liq = rows.filter((r) => r.liquid_ok && isNum(r.chg1d));
    const ceil = rows.filter((r) => boardCls(r.chg1d, r.exchange) === "ceil").length, floor = rows.filter((r) => boardCls(r.chg1d, r.exchange) === "floor").length;
    const gain = liq.slice().sort((a, b) => b.chg1d - a.chg1d).slice(0, 5), lose = liq.slice().sort((a, b) => a.chg1d - b.chg1d).slice(0, 5);
    const rest = `<span class="bi tf"><span class="ceil">${ceil} mã trần</span><span class="floor">${floor} mã sàn</span></span>`
      + (mine.length ? grp("Danh mục của anh") + mine.map(stock).join("") : "")
      + (watch.length ? grp("Đang theo dõi") + watch.map(stock).join("") : "")
      + grp("Tăng mạnh") + gain.map((r) => stock(r.symbol)).join("") + grp("Giảm mạnh") + lose.map((r) => stock(r.symbol)).join("");
    paint(rest);
  } catch (e) { /* giữ phần chỉ số */ }
}
// ================================================================ THỜI ĐIỂM CẬP NHẬT + XUẤT PDF
const vnTime = (iso) => {
  if (!iso) return null;
  const s = /[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.length <= 16 ? iso + ":00+07:00" : iso + "+07:00";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};
const fmtVN = (d, withDate = true) => d ? d.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", ...(withDate ? { day: "2-digit", month: "2-digit", year: "numeric" } : {}) }) : "—";
const agoVN = (d) => { if (!d) return ""; const m = Math.round((Date.now() - d.getTime()) / 60000); return m < 1 ? "vừa xong" : m < 60 ? `${m} phút trước` : m < 48 * 60 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`; };
async function updInfo() {
  const [meta, L] = await Promise.all([tryLoad("data/meta.json"), liveData()]);
  const gen = vnTime(meta?.generated), dd = meta?.data_date, lv = liveFresh(L) ? vnTime(L.at) : null;
  return { gen, dd, lv, meta, L,
    text: `Dữ liệu phiên ${dd ? dd.split("-").reverse().join("/") : "—"} · phân tích lúc ${fmtVN(gen)}${lv ? ` · giá trong phiên ${fmtVN(lv, false)}` : ""}` };
}
async function paintUpd() {
  const el = $("#upd"); if (!el) return;
  try {
    const u = await updInfo();
    const last = u.lv && (!u.gen || u.lv > u.gen) ? u.lv : u.gen;
    const stale = last && Date.now() - last.getTime() > 30 * 3600e3;
    const isLive = !!(u.lv && last === u.lv);
    el.innerHTML = `<i class="${isLive ? "live" : stale ? "old" : ""}"></i><span class="u1">${isLive ? "Giá trong phiên" : "Cập nhật"} ${fmtVN(last, false)}</span><span class="u2">${last ? last.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit" }) : ""} · ${agoVN(last)}</span>`;
    el.title = `${u.text}\nLịch chạy: 11:35 và 14:35 (trong phiên) · 15:35 (đầy đủ sau đóng cửa) · 8:00 thứ 7`;
    el.dataset.g = "upd";
  } catch (e) { el.textContent = ""; }
}

const PDFX = {
  async libs() {
    const add = (src) => new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => bad(new Error("Không tải được " + src)); document.head.appendChild(s); });
    if (!window.htmlToImage) await add("vendor/html-to-image.js");
    if (!window.jspdf) await add("vendor/jspdf.umd.min.js");
  },
  overlay(txt) {
    let o = $("#pdfov");
    if (!o) { o = document.createElement("div"); o.id = "pdfov"; o.innerHTML = `<div class="pdfbox"><b>Đang tạo PDF…</b><span id="pdfmsg"></span><div class="pdfbar"><i id="pdfbar"></i></div><button class="btn" id="pdfstop">Dừng</button></div>`; document.body.appendChild(o); $("#pdfstop").onclick = () => (PDFX.stop = true); }
    $("#pdfmsg").textContent = txt || "";
    return o;
  },
  progress(f) { const b = $("#pdfbar"); if (b) b.style.width = Math.round(f * 100) + "%"; },
  // các điểm cắt trang đẹp: mép dưới của khối, dòng bảng, thẻ
  breaks(el) {
    const top = el.getBoundingClientRect().top;
    const ys = new Set();
    el.querySelectorAll(".panel, section, .g > *, .stack > *, tr, .sgc, .pickw, .pick, .row, .stl > li, .pl, .sb-i, .ev, .kpis, .ph, h1, h2, .tw, .chart, details").forEach((n) => {
      const r = n.getBoundingClientRect();
      if (r.height > 0) { ys.add(Math.round(r.bottom - top)); ys.add(Math.round(r.top - top)); }
    });
    return [...ys].filter((y) => y > 0).sort((a, b) => a - b);
  },
  async capture(el) {
    const det = [...el.querySelectorAll("details")].map((d) => [d, d.open]);
    det.forEach(([d]) => (d.open = true));
    document.body.classList.add("pdfing");
    await new Promise((r) => setTimeout(r, 250));
    // bảng rộng hơn khung: thu nhỏ cho vừa (giữ nguyên bố cục như trên web)
    const zs = [];
    el.querySelectorAll(".tw > table").forEach((tb) => {
      const box = tb.parentElement.clientWidth, need = tb.scrollWidth;
      if (box > 0 && need > box + 2) { zs.push([tb, tb.style.zoom]); tb.style.zoom = String(Math.max(0.45, box / need)); }
    });
    await new Promise((r) => setTimeout(r, 150));
    try { await document.fonts?.ready; } catch (e) { /* bỏ qua */ }
    const w = el.scrollWidth, h = el.scrollHeight;
    const brk = PDFX.breaks(el);
    const ratio = Math.max(1, Math.min(w < 600 ? 2.2 : 1.5, Math.sqrt(15e6 / Math.max(1, w * h))));
    const bg = getComputedStyle(document.body).backgroundColor;
    const opt = { pixelRatio: ratio, backgroundColor: bg, cacheBust: false, width: w, height: h, style: { margin: "0" },
      filter: (n) => !(n.id === "gtip" || n.classList?.contains("toast") || n.dataset?.nopdf !== undefined) };
    let cv;
    try {
      cv = await htmlToImage.toCanvas(el, opt);
      // Safari đôi khi vẽ thiếu ảnh/phông ở lần đầu – vẽ lại lần 2
      if (/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) cv = await htmlToImage.toCanvas(el, opt);
    } finally {
      det.forEach(([d, o]) => (d.open = o));
      zs.forEach(([tb, z]) => (tb.style.zoom = z || ""));
      document.body.classList.remove("pdfing");
    }
    return { cv, w, h, ratio, brk };
  },
  band(text, right, wPx, hPx, dark) {
    const c = document.createElement("canvas"); c.width = wPx; c.height = hPx;
    const g = c.getContext("2d");
    g.fillStyle = dark ? "#0B0F13" : "#ffffff"; g.fillRect(0, 0, wPx, hPx);
    const pad = Math.round(wPx * 0.038), F = (w, px) => `${w} ${px}px "Be Vietnam Pro", system-ui, sans-serif`;
    g.textBaseline = "middle";
    let fs = Math.round(hPx * 0.36);
    g.font = F(600, fs);
    const lw = g.measureText(text).width;
    g.font = F(400, Math.round(fs * 0.78));
    const rw = g.measureText(right).width;
    if (lw + rw + pad * 3 <= wPx) {
      g.fillStyle = dark ? "#E9EEF0" : "#14202b"; g.font = F(600, fs); g.fillText(text, pad, hPx / 2);
      g.fillStyle = dark ? "#A6B1B7" : "#5b6770"; g.font = F(400, Math.round(fs * 0.78)); g.fillText(right, wPx - rw - pad, hPx / 2);
    } else {
      fs = Math.round(hPx * 0.3);
      g.fillStyle = dark ? "#E9EEF0" : "#14202b"; g.font = F(700, fs); g.fillText(text, pad, hPx * 0.34);
      g.fillStyle = dark ? "#A6B1B7" : "#5b6770"; g.font = F(400, Math.round(fs * 0.8)); g.fillText(right, pad, hPx * 0.72);
    }
    g.fillStyle = dark ? "#26323a" : "#e3e8ec"; g.fillRect(pad, hPx - 2, wPx - 2 * pad, 2);
    return c.toDataURL("image/png");
  },
  // thêm một trang web (đã chụp) vào PDF, cắt ở các điểm đẹp
  addShot(doc, shot, title, info) {
    const PW = 210, PH = 297, M = 8, HB = 9, FB = 7;
    const cw = PW - 2 * M, ch = PH - 2 * M - HB - FB;
    const mmPerPx = Math.min(cw / shot.w, 0.3), pageH = ch / mmPerPx, iw = shot.w * mmPerPx, ix = M + (cw - iw) / 2;
    const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
    const HH = M + HB - 2;
    const head = PDFX.band(`VN-Stock · ${title}`, info, 2000, Math.round(2000 * HH / PW), dark);
    let y0 = 0, first = true;
    const pages0 = doc.getNumberOfPages();
    while (y0 < shot.h - 2) {
      let y1 = Math.min(shot.h, y0 + pageH);
      if (y1 < shot.h) {
        const c = shot.brk.filter((y) => y > y0 + pageH * 0.45 && y <= y0 + pageH);
        if (c.length) y1 = c[c.length - 1];
      }
      const sh = Math.max(1, Math.round((y1 - y0) * shot.ratio));
      const part = document.createElement("canvas"); part.width = shot.cv.width; part.height = sh;
      part.getContext("2d").drawImage(shot.cv, 0, Math.round(y0 * shot.ratio), shot.cv.width, sh, 0, 0, shot.cv.width, sh);
      if (!(first && pages0 === 1 && doc.__blank)) doc.addPage(); else doc.__blank = false;
      if (dark) { doc.setFillColor(11, 15, 19); doc.rect(0, 0, PW, PH, "F"); }
      doc.addImage(head, "PNG", 0, 0, PW, HH);
      doc.addImage(part.toDataURL("image/jpeg", 0.8), "JPEG", ix, M + HB, iw, (y1 - y0) * mmPerPx, undefined, "FAST");
      first = false;
      y0 = y1;
    }
    return pages0 + (doc.__counted ? 0 : 0);
  },
  footers(doc, dark, note) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      doc.addImage(PDFX.band(note, `Trang ${i}/${n}`, 2000, Math.round(2000 * 7 / 210), dark), "PNG", 0, 297 - 7, 210, 7);
    }
  },
  newDoc() { const doc = new jspdf.jsPDF({ unit: "mm", format: "a4", compress: true }); doc.__blank = true; return doc; },
  async save(doc, name) { doc.setProperties({ title: name, creator: "VN-Stock" }); doc.save(name + ".pdf"); },
  pageTitle() {
    const h = location.hash.replace(/^#\/?/, "");
    const [r, a, b] = h.split("/");
    const T = { "": "Hôm nay", market: "Thị trường", sector: a ? `Ngành ${decodeURIComponent(a)}` : "Toàn cảnh các ngành", screener: "Bộ lọc", watch: "Theo dõi", portfolio: a === "journal" ? "Nhật ký giao dịch" : a === "profile" ? "Khẩu vị đầu tư" : "Danh mục",
      backtest: "Kiểm chứng", compare: "So sánh", guide: "Hướng dẫn", swing: { live: "Trong phiên", today: "Biến động – phiên gần nhất", table: "Bảng hành vi giá", test: "Biến động – kiểm chứng" }[a] || "Biến động", s: `Mã ${(a || "").toUpperCase()}` };
    return T[r] ?? "VN-Stock";
  },
  async thisPage() {
    if (PDFX.busy) return; PDFX.busy = true; PDFX.stop = false;
    try {
      PDFX.overlay("Đang chuẩn bị…"); PDFX.progress(0.1);
      await PDFX.libs();
      const u = await updInfo();
      const title = PDFX.pageTitle();
      PDFX.overlay(`Đang chụp trang ${title}…`); PDFX.progress(0.4);
      const shot = await PDFX.capture($("#app"));
      const doc = PDFX.newDoc();
      PDFX.addShot(doc, shot, title, u.text);
      const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      PDFX.footers(doc, dark, `Tạo lúc ${fmtVN(new Date())} · Thông tin tham khảo, không phải khuyến nghị đầu tư`);
      PDFX.progress(1);
      await PDFX.save(doc, `VN-Stock ${title} ${(u.dd || "").replace(/-/g, "")}`);
    } catch (e) { console.error(e); toast("Không tạo được PDF: " + e.message); }
    finally { PDFX.busy = false; $("#pdfov")?.remove(); }
  },
  async report(sections) {
    if (PDFX.busy) return; PDFX.busy = true; PDFX.stop = false;
    const back = location.hash;
    try {
      PDFX.overlay("Đang chuẩn bị…"); await PDFX.libs();
      const u = await updInfo();
      const doc = PDFX.newDoc(), toc = [];
      for (let i = 0; i < sections.length; i++) {
        if (PDFX.stop) break;
        const [hash, title] = sections[i];
        PDFX.overlay(`${i + 1}/${sections.length}: ${title}`); PDFX.progress(i / sections.length);
        history.replaceState(null, "", hash);
        await route();
        await new Promise((r) => setTimeout(r, 900));
        const shot = await PDFX.capture($("#app"));
        toc.push([title, doc.__blank ? 2 : doc.getNumberOfPages() + 2]);
        PDFX.addShot(doc, shot, title, u.text);
      }
      // trang bìa + mục lục (chèn lên đầu)
      const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
      doc.insertPage(1);
      doc.setPage(1);
      doc.addImage(PDFX.cover(u, toc, dark), "PNG", 0, 0, 210, 297);
      PDFX.footers(doc, dark, `Tạo lúc ${fmtVN(new Date())} · Thông tin tham khảo, không phải khuyến nghị đầu tư`);
      PDFX.progress(1);
      await PDFX.save(doc, `VN-Stock Bao cao ${(u.dd || "").replace(/-/g, "")}`);
    } catch (e) { console.error(e); toast("Không tạo được PDF: " + e.message); }
    finally {
      PDFX.busy = false; $("#pdfov")?.remove();
      history.replaceState(null, "", back || "#/"); route();
    }
  },
  cover(u, toc, dark) {
    const W = 1240, H = 1754, c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d"), F = (w, px) => `${w} ${px}px "Be Vietnam Pro", system-ui, sans-serif`;
    g.fillStyle = dark ? "#0B0F13" : "#ffffff"; g.fillRect(0, 0, W, H);
    g.fillStyle = "#0B0F13"; g.fillRect(0, 0, W, 420);
    [["#F0444B", 120], ["#F4C32F", 190], ["#2FD08F", 260]].forEach(([col, x]) => { g.beginPath(); g.fillStyle = col; g.arc(x, 150, 26, 0, 7); g.fill(); });
    g.fillStyle = "#EEF2F3"; g.font = F(700, 78); g.fillText("VN-Stock", 100, 280);
    g.font = F(500, 34); g.fillStyle = "#A6B1B7"; g.fillText("Báo cáo tổng hợp", 100, 340);
    g.fillStyle = dark ? "#E9EEF0" : "#14202b"; g.font = F(600, 30);
    const L = [`Dữ liệu phiên: ${u.dd ? u.dd.split("-").reverse().join("/") : "—"}`, `Phân tích lúc: ${fmtVN(u.gen)}`, u.lv ? `Giá trong phiên: ${fmtVN(u.lv)}` : "", `Tạo PDF lúc: ${fmtVN(new Date())}`].filter(Boolean);
    L.forEach((t, i) => g.fillText(t, 100, 520 + i * 52));
    g.font = F(700, 38); g.fillText("Mục lục", 100, 790);
    g.font = F(400, 30);
    toc.forEach(([t, p], i) => {
      const y = 860 + i * 50; if (y > H - 160) return;
      g.fillStyle = dark ? "#E9EEF0" : "#14202b"; g.fillText(t, 100, y);
      const pw = g.measureText(String(p)).width; g.fillText(String(p), W - 100 - pw, y);
      g.strokeStyle = dark ? "#33414a" : "#d5dbe0"; g.setLineDash([3, 6]); g.beginPath(); g.moveTo(110 + g.measureText(t).width, y - 8); g.lineTo(W - 115 - pw, y - 8); g.stroke(); g.setLineDash([]);
    });
    g.fillStyle = dark ? "#6D7A81" : "#7a868e"; g.font = F(400, 24);
    g.fillText("Thông tin tham khảo từ hệ thống phân tích tự động – không phải khuyến nghị đầu tư.", 100, H - 90);
    return c.toDataURL("image/png");
  },
  async dialog() {
    const [pf, t] = await Promise.all([Store.get("portfolio"), tryLoadToday()]);
    const held = [...new Set((pf.data?.holdings || []).map((h) => h.symbol))].slice(0, 12);
    const picks = ((t?.styles || {})[t?.style || "position"]?.picks || []).map((p) => p.symbol).filter((s) => !held.includes(s)).slice(0, 8);
    const L = await liveData();
    const S = [["#/", "Hôm nay", 1], ["#/portfolio", "Danh mục", 1], ...(liveFresh(L) ? [["#/swing/live", "Trong phiên", 1]] : []), ["#/swing/today", "Biến động – phiên gần nhất", 1],
      ["#/market", "Thị trường", 1], ["#/sector", "Toàn cảnh các ngành", 1], ["#/swing/table", "Bảng hành vi giá", 0], ["#/swing/pairs", "Mã liên quan (đồng pha / dẫn dắt)", 0], ["#/backtest", "Kiểm chứng", 0],
      ...held.map((s) => [`#/s/${s}`, `Mã ${s} (đang nắm)`, 1]), ...picks.map((s) => [`#/s/${s}`, `Mã ${s} (danh sách mua)`, 1])];
    let o = $("#pdfdlg"); o?.remove();
    o = document.createElement("div"); o.id = "pdfdlg"; o.className = "pdfdlg";
    o.innerHTML = `<div class="pdfbox wide"><div class="ph"><h2>Xuất PDF</h2><button class="chip" id="pdfx">✕</button></div>
      <button class="btn primary" id="pdf1">Trang đang xem → PDF</button>
      <p class="muted" style="margin:10px 0 4px">hoặc <b>báo cáo tổng hợp</b> nhiều trang (có bìa, mục lục, số trang):</p>
      <div class="pdflist">${S.map(([h, n, on], i) => `<label><input type="checkbox" data-i="${i}" ${on ? "checked" : ""}> ${esc(n)}</label>`).join("")}</div>
      <button class="btn" id="pdfall">Tạo báo cáo tổng hợp</button>
      <p class="faint" style="font-size:.72rem;margin-top:6px">PDF giữ nguyên giao diện đang dùng (sáng/tối), mở hết các phần thu gọn, cắt trang ở mép khung. Mỗi trang đầu có thời điểm dữ liệu.</p></div>`;
    document.body.appendChild(o);
    const close = () => o.remove();
    $("#pdfx").onclick = close; o.onclick = (e) => { if (e.target === o) close(); };
    $("#pdf1").onclick = () => { close(); PDFX.thisPage(); };
    $("#pdfall").onclick = () => { const sel = $$("#pdfdlg input:checked").map((x) => S[+x.dataset.i]); close(); if (sel.length) PDFX.report(sel); };
  },
};

// ================================================================ tài khoản, gói hội viên, thông báo, quản trị, bản tin
let ME = null, PLANS = null, PERSONAL;
const multiUser = () => !!ME && !ME.legacy;
const can = (f) => !ME || ME.legacy || (ME.features || []).includes("*") || (ME.features || []).includes(f);
const isAdmin = () => !ME || ME.legacy || ME.role === "admin";
async function fetchMe() {
  try {
    const r = await fetch("api/auth/me", { cache: "no-store" });
    if (r.status === 401) return null;
    if (r.ok && (r.headers.get("content-type") || "").includes("json")) { const j = await r.json(); return j.legacy ? { ...j.me, legacy: true } : j.me; }
  } catch (e) { /* chạy trên máy, không có API */ }
  return { legacy: true, role: "admin", features: ["*"] };
}
async function plansData() { if (!PLANS) { try { PLANS = await (await fetch("api/auth/plans")).json(); } catch (e) { PLANS = { plans: {}, feature_names: {}, order: [] }; } } return PLANS; }
const featName = (f) => (PLANS?.feature_names || {})[f] || f;
async function personalData() {
  if (PERSONAL !== undefined) return PERSONAL;
  if (!multiUser()) return (PERSONAL = null);
  try { const r = await fetch("api/personal", { cache: "no-store" }); PERSONAL = r.ok ? await r.json() : null; } catch (e) { PERSONAL = null; }
  return PERSONAL;
}
async function loadToday() {
  const t = await load("data/today.json");
  if (t.__merged) return t;
  const P = await personalData();
  if (P && P.personal) Object.assign(t, P.personal);
  else if (multiUser()) { t.portfolio = null; t.alerts = []; }
  t.__merged = true;
  return t;
}
async function tryLoadToday() { try { return await loadToday(); } catch (e) { return null; } }
async function api(path, method = "GET", body) {
  const r = await fetch("api/" + path, { method, cache: "no-store", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  let j = {};
  try { j = await r.json(); } catch (e) { /* rỗng */ }
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

// ---- khoá tính năng theo gói
function lockBox(feature, title, small = false) {
  return `<section class="panel lockp ${small ? "sm" : ""}"><div class="ph"><h2>🔒 ${esc(title || featName(feature))}</h2><span class="pill brand">Gói Pro</span></div>
    <p class="muted">${small ? "Phần này dành cho gói Pro." : "Tính năng này dành cho thành viên gói Pro."} Gói hiện tại của anh/chị: <b>${esc(ME?.plan_name || "Miễn phí")}</b>.</p>
    <a class="btn primary" href="#/account">Xem quyền lợi các gói</a></section>`;
}
async function lockView(feature) {
  await plansData();
  app().innerHTML = lockBox(feature) + `<section class="panel sec">${planTable()}</section>`;
}
function planTable() {
  const P = PLANS || { plans: {}, order: [] }, ks = P.order || Object.keys(P.plans);
  const feats = [...new Set(ks.flatMap((k) => P.plans[k].features))];
  return `<div class="ph"><h2>Quyền lợi theo gói</h2></div><div class="tw"><table><thead><tr><th class="l">Tính năng</th>${ks.map((k) => `<th class="${ME?.eff_plan === k ? "brand" : ""}">${esc(P.plans[k].name)}${ME?.eff_plan === k ? " ✓" : ""}</th>`).join("")}</tr></thead><tbody>
    ${feats.map((f) => `<tr><td class="l">${esc(featName(f))}</td>${ks.map((k) => `<td>${P.plans[k].features.includes(f) ? '<b class="up">✓</b>' : '<span class="faint">—</span>'}</td>`).join("")}</tr>`).join("")}
    <tr><td class="l">Số mã trong danh mục / theo dõi / cảnh báo đang bật</td>${ks.map((k) => { const L = P.plans[k].limits || {}; return `<td>${L.holdings} / ${L.watch} / ${L.alerts}</td>`; }).join("")}</tr>
  </tbody></table></div>`;
}
const ROUTE_FEATURE = { swing: (a) => (a === "live" ? "live" : a === "flow" || a === "mood" ? "flow" : a === "pairs" ? "pairs" : "swing"), backtest: () => "backtest" };

// ---- chuông thông báo
const NK = { event: "⚡", event_ok: "🎯", event_new: "🎯", act: "📌", near: "⏳", exit: "🚨", alert: "🔔", pick_new: "🛒", pick_out: "🛒", pick_in: "🛒", pick_chase: "🛒", flow: "🐋", rel: "🔗", flag: "👀",
  light: "🚦", warn: "⚠️", digest: "📰", system: "ℹ️", admin: "🛠️" };
const NKIND = { event: "Mã của anh/chị có sự kiện (giá sập)", event_ok: "Mã của anh/chị qua sự kiện – điểm vào", event_new: "Cơ hội sau sự kiện (mã mới)", act: "Khuyến nghị cho mã đang nắm", near: "Sắp chạm mức thoát", exit: "Đã chạm mức thoát (trong phiên)", alert: "Cảnh báo giá", pick_new: "Mã mới vào danh sách MUA",
  pick_out: "Mã ra khỏi danh sách MUA", pick_in: "Mã trong danh sách MUA vào vùng mua (trong phiên)", flow: "Dòng tiền lớn với mã của anh/chị", rel: "Mã liên quan / rủi ro tập trung",
  flag: "Biến động bất thường mã của anh/chị (trong phiên)", light: "Đèn thị trường đổi màu", warn: "Cảnh báo tỷ trọng danh mục", digest: "Bản tin thị trường mỗi phiên" };
const agoShort = (iso) => { const m = (Date.now() - new Date(iso)) / 60000; return m < 1 ? "vừa xong" : m < 60 ? `${Math.round(m)} phút` : m < 1440 ? `${Math.round(m / 60)} giờ` : new Date(iso).toLocaleDateString("vi-VN"); };
function ntfRow(n) {
  return `<a class="ntf ${n.read_at ? "" : "new"} sev${n.sev || 0}" href="${esc(n.url || "#/notifications")}" data-nid="${n.id}"><span class="ni">${NK[n.kind] || "•"}</span>
    <span class="nb"><b>${esc(n.title)}</b>${n.body ? `<small>${esc(n.body)}</small>` : ""}</span><time>${agoShort(n.created_at)}</time></a>`;
}
let __bellN = 0;
async function bellCount() {
  if (!multiUser() || document.hidden) return;
  try { const j = await api("notifications/count"); __bellN = j.unread || 0; const b = $("#bellN"); if (b) { b.textContent = __bellN > 99 ? "99+" : __bellN; b.hidden = !__bellN; } } catch (e) { /* bỏ qua */ }
}
async function bellOpen() {
  let box = $("#bellBox");
  if (box) { box.remove(); return; }
  box = document.createElement("div"); box.id = "bellBox"; box.className = "menu bellbox";
  box.style.top = Math.round(($("#bell")?.getBoundingClientRect().bottom || 40) + 6) + "px";
  box.innerHTML = `<div class="ph"><h3>Thông báo</h3><button class="chip" id="bellAll">Đánh dấu đã đọc</button></div><div class="ntfs"><p class="muted">Đang tải…</p></div><a class="more" href="#/notifications">Xem tất cả</a>`;
  document.body.appendChild(box);
  const j = await api("notifications?limit=15").catch(() => ({ items: [] }));
  box.querySelector(".ntfs").innerHTML = (j.items || []).map(ntfRow).join("") || `<p class="muted" style="padding:10px">Chưa có thông báo nào. Hệ thống báo khi mã của anh/chị chạm mức thoát, cảnh báo giá, có tín hiệu mới…</p>`;
  bindNtf(box);
  $("#bellAll").onclick = async () => { await api("notifications/read", "POST", { all: true }); box.remove(); bellCount(); };
  setTimeout(() => document.addEventListener("click", function off(e) { if (!box.contains(e.target) && e.target.closest("#bell") == null) { box.remove(); document.removeEventListener("click", off); } }), 0);
}
function bindNtf(root) {
  $$("[data-nid]", root).forEach((a) => a.addEventListener("click", () => { if (a.classList.contains("new")) api("notifications/read", "POST", { ids: [Number(a.dataset.nid)] }).then(bellCount).catch(() => {}); $("#bellBox")?.remove(); }));
}
async function viewNotifications() {
  if (!multiUser()) { app().innerHTML = `<div class="empty">Thông báo trên web có khi trang chạy chế độ nhiều người dùng. Hiện thông báo gửi qua Telegram.</div>`; return; }
  let items = [], more = true;
  const draw = () => {
    const by = {};
    items.forEach((n) => { const d = new Date(n.created_at).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" }); (by[d] = by[d] || []).push(n); });
    app().innerHTML = `<div class="ph"><h1>Thông báo</h1><span class="meta"><button class="btn" id="nAll">Đánh dấu tất cả đã đọc</button> <button class="btn" id="nDel">Xoá thông báo đã đọc</button> <a class="btn" href="#/account">Cài đặt nhận thông báo</a></span></div>
      ${Object.entries(by).map(([d, L]) => `<section class="panel sec"><div class="ph"><h3>${esc(d)}</h3></div><div class="ntfs">${L.map(ntfRow).join("")}</div></section>`).join("") || '<div class="empty">Chưa có thông báo nào.</div>'}
      ${more ? '<button class="btn" id="nMore" style="margin-top:10px">Xem thêm</button>' : ""}`;
    bindNtf(app());
    $("#nAll").onclick = async () => { await api("notifications/read", "POST", { all: true }); items.forEach((n) => (n.read_at = n.read_at || "x")); draw(); bellCount(); };
    $("#nDel").onclick = async () => { await api("notifications", "DELETE"); items = items.filter((n) => !n.read_at); draw(); };
    if ($("#nMore")) $("#nMore").onclick = load_;
  };
  const load_ = async () => { const j = await api(`notifications?limit=50${items.length ? "&before=" + items[items.length - 1].id : ""}`); items = items.concat(j.items || []); more = (j.items || []).length === 50; draw(); };
  await load_();
}

// ---- thông báo đẩy
const u8 = (b64) => { const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };
async function pushState() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { ok: false, why: /iPhone|iPad/.test(navigator.userAgent) ? "Trên iPhone/iPad: bấm Chia sẻ → Thêm vào Màn hình chính, mở trang từ biểu tượng đó rồi bật lại." : "Trình duyệt này không hỗ trợ thông báo đẩy." };
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { ok: true, on: !!sub && Notification.permission === "granted", perm: Notification.permission, sub };
}
async function pushEnable() {
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Chưa cho phép thông báo trên trình duyệt này");
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const { key } = await api("push/key");
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) });
  await api("push/subscribe", "POST", sub.toJSON());
}
async function pushDisable() {
  const st = await pushState();
  if (st.sub) { await api("push/unsubscribe", "POST", { endpoint: st.sub.endpoint }).catch(() => {}); await st.sub.unsubscribe(); }
}

// ---- trang tài khoản
async function viewAccount() {
  await plansData();
  if (!multiUser()) { app().innerHTML = `<div class="ph"><h1>Tài khoản</h1></div><div class="panel"><p>Trang đang chạy chế độ một chủ sở hữu (đăng nhập qua Cloudflare Access). Khi bật chế độ nhiều người dùng (gắn cơ sở dữ liệu D1), mỗi người có tài khoản, danh mục và thông báo riêng.</p></div><section class="panel sec">${planTable()}</section>`; return; }
  const [np, ps, subs] = await Promise.all([api("notify").catch(() => ({})), pushState(), api("push/list").catch(() => ({ subs: [] }))]);
  const N = { push: np.push || "normal", email: np.email || "important", email_to: np.email_to || "", kinds: np.kinds || {} };
  const lv = (k, v) => `<select id="${k}">${[["all", "Tất cả"], ["normal", "Bình thường (bỏ tin nhỏ)"], ["important", "Chỉ việc quan trọng"], ["off", "Tắt"]].map(([a, b]) => `<option value="${a}" ${v === a ? "selected" : ""}>${b}</option>`).join("")}</select>`;
  app().innerHTML = `<div class="ph"><h1>Tài khoản</h1><span class="meta">${esc(ME.email)}</span></div>
  <div class="g g2">
    <section class="panel"><div class="ph"><h2>Thông tin</h2><span class="pill ${ME.eff_plan === "pro" ? "buy" : ""}">Gói ${esc(ME.plan_name || ME.eff_plan)}</span></div>
      ${kpis([["Email", esc(ME.email)], ["Gói", esc(ME.plan_name || ME.eff_plan) + (ME.plan_until ? ` <small>đến ${esc(ME.plan_until)}</small>` : "")], ["Vai trò", ME.role === "admin" ? "Quản trị" : "Thành viên"],
        ["Đăng nhập", [ME.has_pw ? "mật khẩu" : "", ME.google ? "Google" : ""].filter(Boolean).join(" + ") || "—"]], false, "c2")}
      <div class="filters" style="margin-top:8px"><div class="field"><label for="acName">Tên hiển thị</label><input id="acName" value="${esc(ME.name || "")}"></div><button class="btn" id="acSave">Lưu tên</button></div></section>
    <section class="panel"><div class="ph"><h2>Bảo mật</h2></div>
      <div class="filters">${ME.has_pw ? `<div class="field"><label for="pwOld">Mật khẩu hiện tại</label><input id="pwOld" type="password" autocomplete="current-password"></div>` : ""}
        <div class="field"><label for="pwNew">Mật khẩu mới (≥ 8 ký tự)</label><input id="pwNew" type="password" autocomplete="new-password"></div><button class="btn" id="pwSave">${ME.has_pw ? "Đổi mật khẩu" : "Đặt mật khẩu"}</button></div>
      <p style="margin-top:10px"><button class="btn" id="acOut">Đăng xuất</button> <button class="btn" id="acOutAll">Đăng xuất mọi thiết bị</button></p></section>
  </div>
  <section class="panel sec"><div class="ph"><h2>Nhận thông báo</h2><span class="meta">chuông trên web luôn bật</span></div>
    <div class="g g2">
      <div><h3>Thông báo đẩy (điện thoại / máy tính)</h3>
        ${!can("notify_push") ? `<p class="muted">🔒 Thông báo đẩy dành cho gói Pro.</p>` : !ps.ok ? `<p class="note">${esc(ps.why)}</p>`
          : `<p>Trên thiết bị này: <b class="${ps.on ? "up" : "muted"}">${ps.on ? "đang bật" : ps.perm === "denied" ? "bị chặn trong cài đặt trình duyệt" : "chưa bật"}</b> ${ps.on ? '<button class="btn" id="puOff">Tắt</button> <button class="btn" id="puTest">Gửi thử</button>' : '<button class="btn primary" id="puOn">Bật trên thiết bị này</button>'}</p>
          <p class="faint" style="font-size:.74rem">Đang bật trên ${nf((subs.subs || []).length, 0)} thiết bị. Thông báo đẩy được gửi ngay sau các lượt 11:35, 14:35, 15:35.</p>`}
        <div class="field"><label for="nPush">Mức gửi đẩy</label>${lv("nPush", N.push)}</div></div>
      <div><h3>Email</h3>${!can("notify_email") ? `<p class="muted">🔒 Thông báo qua email dành cho gói Pro.</p>` : ""}
        <div class="field"><label for="nEmail">Mức gửi email</label>${lv("nEmail", N.email)}</div>
        <div class="field"><label for="nTo">Gửi tới</label><input id="nTo" type="email" placeholder="${esc(ME.email)}" value="${esc(N.email_to)}"></div></div>
    </div>
    <h3 style="margin-top:10px">Loại thông báo</h3>
    <div class="nkinds">${Object.entries(NKIND).map(([k, t]) => `<label><input type="checkbox" data-nk="${k}" ${N.kinds[k] === false ? "" : "checked"}> ${NK[k] || ""} ${esc(t)}</label>`).join("")}</div>
    <p style="margin-top:8px"><button class="btn primary" id="nSave">Lưu cài đặt thông báo</button></p>
    <p class="faint" style="font-size:.72rem">“Quan trọng” = chạm/sắp chạm mức thoát, khuyến nghị bán/cắt lỗ, cảnh báo giá. “Bình thường” thêm mã mới vào danh sách MUA, dòng tiền lớn, đèn thị trường.</p></section>
  <section class="panel sec">${planTable()}<p class="muted" style="margin-top:6px">Muốn nâng cấp hoặc gia hạn gói, liên hệ quản trị viên.</p></section>`;
  $("#acSave").onclick = async () => { try { const j = await api("auth/profile", "POST", { name: $("#acName").value }); ME = { ...ME, ...j.me }; toast("Đã lưu"); } catch (e) { toast(e.message); } };
  $("#pwSave").onclick = async () => { try { await api("auth/password", "POST", { old: $("#pwOld")?.value || "", new: $("#pwNew").value }); toast("Đã đổi mật khẩu"); viewAccount(); } catch (e) { toast(e.message); } };
  $("#acOut").onclick = logout;
  $("#acOutAll").onclick = async () => { await api("auth/logout_all", "POST").catch(() => {}); clearLocal(); location.href = "/login"; };
  if ($("#puOn")) $("#puOn").onclick = async () => { try { await pushEnable(); toast("Đã bật thông báo đẩy"); viewAccount(); } catch (e) { toast(e.message); } };
  if ($("#puOff")) $("#puOff").onclick = async () => { await pushDisable(); toast("Đã tắt trên thiết bị này"); viewAccount(); };
  if ($("#puTest")) $("#puTest").onclick = async () => { const reg = await navigator.serviceWorker.getRegistration("/"); reg?.showNotification("VN-Stock", { body: "Thông báo đẩy hoạt động trên thiết bị này.", icon: "/icon.svg" }); };
  $("#nSave").onclick = async () => {
    const kinds = Object.fromEntries($$("[data-nk]").map((x) => [x.dataset.nk, x.checked]));
    try { await api("notify", "PUT", { push: $("#nPush").value, email: $("#nEmail").value, email_to: $("#nTo").value.trim(), kinds, updated: new Date().toISOString() }); toast("Đã lưu cài đặt thông báo"); } catch (e) { toast(e.message); }
  };
}
function clearLocal() { ["portfolio", "assumptions", "groups", "profile", "journal", "watchlist", "views"].forEach((k) => { try { localStorage.removeItem("vnstock_" + k); } catch (e) { /* bỏ qua */ } }); }
async function logout() { await api("auth/logout", "POST").catch(() => {}); clearLocal(); location.href = "/login"; }

// ---- trang quản trị
async function viewAdmin(sub = "users") {
  if (!multiUser() || ME.role !== "admin") { app().innerHTML = `<div class="empty">Chỉ quản trị viên (chế độ nhiều người dùng).</div>`; return; }
  const tabs = [["users", "Người dùng"], ["invites", "Mã mời"], ["config", "Cấu hình"], ["audit", "Nhật ký"]];
  const st = await api("admin/stats").catch(() => ({}));
  const head = `<div class="ph"><h1>Quản trị</h1><span class="meta">${nf(st.users, 0)} tài khoản · ${nf(st.active, 0)} hoạt động · <b class="${st.pending ? "ref" : ""}">${nf(st.pending, 0)} chờ duyệt</b> · ${nf(st.pro, 0)} Pro · ${nf(st.active7, 0)} vào web 7 ngày · ${nf(st.push, 0)} thiết bị nhận đẩy · ${nf(st.notif7, 0)} thông báo 7 ngày</span></div>
    <div class="views" style="margin-top:0">${tabs.map(([k, n]) => `<a class="btn ${k === sub ? "primary" : ""}" href="#/admin/${k}">${n}</a>`).join("")}</div>`;
  if (sub === "users") {
    const j = await api("admin/users");
    const P = j.plans || {};
    const sel = (id, k, v, opts) => `<select data-u="${id}" data-k="${k}">${opts.map(([a, b]) => `<option value="${a}" ${v === a ? "selected" : ""}>${esc(b)}</option>`).join("")}</select>`;
    app().innerHTML = head + `<section class="panel sec"><div class="tw"><table class="admt"><thead><tr><th class="l">Email / tên</th><th>Trạng thái</th><th>Gói</th><th>Hết hạn</th><th>Vai trò</th><th class="l">Ghi chú</th><th>Tạo</th><th>Vào gần nhất</th><th>Đẩy</th><th></th></tr></thead><tbody>
      ${j.users.map((u) => `<tr class="${u.status === "pending" ? "pend" : ""}"><td class="l"><b>${esc(u.email)}</b><br><small class="muted">${esc(u.name || "")}${u.google ? " · Google" : ""}${u.invite ? " · mã " + esc(u.invite) : ""}</small></td>
        <td>${sel(u.id, "status", u.status, [["active", "Hoạt động"], ["pending", "Chờ duyệt"], ["disabled", "Khoá"]])}</td>
        <td>${sel(u.id, "plan", u.plan, Object.entries(P))}</td><td><input type="date" data-u="${u.id}" data-k="plan_until" value="${esc(u.plan_until || "")}"></td>
        <td>${sel(u.id, "role", u.role, [["user", "Thành viên"], ["admin", "Quản trị"]])}</td><td class="l"><input data-u="${u.id}" data-k="note" value="${esc(u.note || "")}" style="width:140px"></td>
        <td><small>${esc((u.created_at || "").slice(0, 10))}</small></td><td><small>${u.last_seen ? agoShort(u.last_seen) : "—"}</small></td><td>${nf(u.push, 0)}</td>
        <td><button class="btn" data-save="${u.id}">Lưu</button> <button class="chip" data-rst="${u.id}" title="Tạo liên kết đặt lại mật khẩu (72 giờ)">Link đặt MK</button></td></tr>`).join("")}</tbody></table></div>
      <p class="faint" style="font-size:.72rem;margin-top:4px">Khoá tài khoản hoặc đổi vai trò sẽ đăng xuất người đó khỏi mọi thiết bị. Gói hết hạn tự về Miễn phí.</p><div id="rstOut"></div></section>`;
    $$("[data-save]").forEach((b) => (b.onclick = async () => {
      const id = b.dataset.save, body = { id: Number(id) };
      $$(`[data-u="${id}"]`).forEach((x) => (body[x.dataset.k] = x.value));
      try { await api("admin/user", "POST", body); toast("Đã lưu"); } catch (e) { toast(e.message); }
    }));
    $$("[data-rst]").forEach((b) => (b.onclick = async () => { const r = await api("admin/reset_link", "POST", { id: Number(b.dataset.rst) }); $("#rstOut").innerHTML = `<p class="note">Gửi liên kết này cho người dùng (hết hạn sau ${r.hours} giờ):<br><input readonly value="${esc(r.link)}" style="width:100%" onclick="this.select()"></p>`; }));
    return;
  }
  if (sub === "invites") {
    const [j, p] = await Promise.all([api("admin/invites"), plansData()]);
    const base = location.origin + "/login#invite=";
    app().innerHTML = head + `<section class="panel sec"><div class="ph"><h2>Tạo mã mời</h2></div>
      <div class="filters"><div class="field"><label>Mã (để trống = tự tạo)</label><input id="ivCode" placeholder="VD: BETA2026"></div>
        <div class="field"><label>Gói</label><select id="ivPlan">${Object.entries(p.plans).map(([k, v]) => `<option value="${k}" ${k === "pro" ? "selected" : ""}>${esc(v.name)}</option>`).join("")}</select></div>
        <div class="field"><label>Số ngày dùng gói (trống = không hạn)</label><input id="ivDays" type="number" value="30" style="width:90px"></div>
        <div class="field"><label>Số lượt dùng mã</label><input id="ivMax" type="number" value="5" style="width:80px"></div>
        <div class="field"><label>Mã hết hạn ngày</label><input id="ivExp" type="date"></div>
        <div class="field"><label>Ghi chú</label><input id="ivNote" placeholder="nhóm thử nghiệm…"></div><button class="btn primary" id="ivAdd">Tạo</button></div></section>
      <section class="panel sec"><div class="tw"><table><thead><tr><th class="l">Mã</th><th>Gói</th><th>Ngày dùng</th><th>Đã dùng</th><th>Hết hạn</th><th class="l">Ghi chú</th><th class="l">Liên kết mời</th><th></th></tr></thead><tbody>
        ${j.invites.map((v) => `<tr><td class="l"><b>${esc(v.code)}</b></td><td>${esc((p.plans[v.plan] || {}).name || v.plan)}</td><td>${v.days ? nf(v.days, 0) : "∞"}</td><td>${v.uses}/${v.max_uses}</td><td>${esc(v.expires_at || "—")}</td>
          <td class="l">${esc(v.note || "")}</td><td class="l"><input readonly value="${esc(base + v.code)}" onclick="this.select()" style="width:260px"></td><td><button class="chip" data-ivdel="${esc(v.code)}">Xoá</button></td></tr>`).join("") || '<tr><td colspan="8" class="muted">Chưa có mã mời.</td></tr>'}</tbody></table></div></section>`;
    $("#ivAdd").onclick = async () => { try { const r = await api("admin/invites", "POST", { code: $("#ivCode").value, plan: $("#ivPlan").value, days: $("#ivDays").value, max_uses: $("#ivMax").value, expires_at: $("#ivExp").value, note: $("#ivNote").value }); toast("Đã tạo mã " + r.code); viewAdmin("invites"); } catch (e) { toast(e.message); } };
    $$("[data-ivdel]").forEach((b) => (b.onclick = async () => { await api("admin/invites?code=" + enc(b.dataset.ivdel), "DELETE"); viewAdmin("invites"); }));
    return;
  }
  if (sub === "config") {
    const j = await api("admin/config"), C = j.config;
    const f = (k, label, hint = "", type = "text") => `<div class="field"><label for="cf_${k}">${label}</label><input id="cf_${k}" type="${type}" value="${esc(C[k] || "")}" placeholder="${esc(hint)}"></div>`;
    app().innerHTML = head + `<section class="panel sec"><div class="ph"><h2>Đăng ký & đăng nhập</h2></div>
      <div class="filters"><div class="field"><label for="cf_signup_mode">Đăng ký</label><select id="cf_signup_mode"><option value="invite" ${C.signup_mode !== "open" ? "selected" : ""}>Cần mã mời / chờ duyệt</option><option value="open" ${C.signup_mode === "open" ? "selected" : ""}>Mở tự do (gói Miễn phí)</option></select></div>
        ${f("google_client_id", "Google OAuth Client ID", "xxxx.apps.googleusercontent.com")}${f("site_url", "Địa chỉ trang", "https://vn-stock.pages.dev")}</div>
      <p class="faint" style="font-size:.72rem">Google Client ID: Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID (Web), thêm “Authorized JavaScript origins” = địa chỉ trang. ${j.env.GOOGLE_CLIENT_ID ? "Đang dùng biến môi trường GOOGLE_CLIENT_ID." : ""}</p></section>
      <section class="panel sec"><div class="ph"><h2>Email gửi thông báo</h2></div>
      <div class="filters">${f("mail_from", "Người gửi", "VN-Stock <ban@gmail.com>")}${f("smtp_host", "Máy chủ SMTP", "smtp.gmail.com")}${f("smtp_port", "Cổng", "465")}${f("smtp_user", "Tài khoản SMTP", "ban@gmail.com")}${f("smtp_pass", "Mật khẩu ứng dụng", "16 ký tự", "password")}${f("resend_key", "Resend API key (tuỳ chọn)", "re_…", "password")}</div>
      <p class="faint" style="font-size:.72rem">Gmail: bật xác minh 2 bước → myaccount.google.com/apppasswords → tạo “Mật khẩu ứng dụng”, dán vào ô trên (không dùng mật khẩu Gmail thường). Email thông báo gửi từ các lượt chạy; email đặt lại mật khẩu tức thì cần Resend (có tên miền riêng) – nếu chưa có, người dùng bấm “Quên mật khẩu” sẽ tạo yêu cầu để anh gửi liên kết từ trang Người dùng.</p>
      <p><button class="btn primary" id="cfSave">Lưu cấu hình</button></p></section>`;
    $("#cfSave").onclick = async () => { const b = {}; $$("[id^=cf_]").forEach((x) => (b[x.id.slice(3)] = x.value)); try { await api("admin/config", "POST", b); toast("Đã lưu cấu hình"); } catch (e) { toast(e.message); } };
    return;
  }
  const j = await api("admin/audit");
  app().innerHTML = head + `<section class="panel sec"><div class="tw"><table><thead><tr><th>Lúc</th><th class="l">Người</th><th>Việc</th><th class="l">Chi tiết</th></tr></thead><tbody>
    ${j.audit.map((a) => `<tr><td><small>${esc(new Date(a.at).toLocaleString("vi-VN"))}</small></td><td class="l">${esc(a.email || "—")}</td><td>${esc(a.action)}</td><td class="l wrap"><small>${esc(a.detail || "")}</small></td></tr>`).join("")}</tbody></table></div></section>`;
}

// ---- bản tin thị trường
async function viewDigest(date, home = false) {
  const idx = await tryLoad("data/digest/index.json");
  const dates = idx?.dates || [];
  if (!dates.length) { app().innerHTML = `<div class="empty">Chưa có bản tin – bản tin đầu tiên có sau lượt chạy đóng cửa kế tiếp.</div>`; return; }
  const d = date && dates.find((x) => x.date === date) ? date : dates[0].date;
  const D = await load(`data/digest/${d}.json`);
  let dec = "";
  if (home) { try { const [tt, pr] = await Promise.all([loadToday(), Store.get("portfolio")]); if ((tt.portfolio?.positions || []).length || capitalOf(pr.data || {})) dec = decisionCard(tt, pr.data || {}, { noBuy: !can("today") }); } catch (e) { /* bỏ qua */ } }
  const i = dates.findIndex((x) => x.date === d);
  const IX = D.indices || {}, B = D.breadth || {}, V = D.value || {}, S = D.sentiment || {}, F = D.flow || {}, W = D.swing || {};
  const sym = (s) => `<a href="#/s/${s}"><b>${s}</b></a>`;
  const rowsT = (L, extra) => `<div class="tw"><table><thead><tr><th class="l">Mã</th><th>Giá</th><th>%</th>${extra ? "<th>KL × TB</th>" : ""}<th class="l">Ngành</th></tr></thead><tbody>
    ${(L || []).map((x) => `<tr><td class="l">${sym(x.s)}</td><td>${nf(x.price)}</td><td class="${cls(x.chg)}">${pct(x.chg)}</td>${extra ? `<td>${nf(x.vx, 1)}×</td>` : ""}<td class="l"><small class="muted">${esc((x.sector || "").slice(0, 22))}</small></td></tr>`).join("") || '<tr><td colspan="5" class="muted">—</td></tr>'}</tbody></table></div>`;
  const lightC = { green: "up", yellow: "ref", red: "down" }[D.regime?.light] || "";
  app().innerHTML = `${home ? `<div class="note" style="margin-bottom:10px">Trang chủ gói Miễn phí là bản tin thị trường mỗi phiên. <b>Danh sách MUA, kế hoạch theo phong cách, phân tích đầy đủ từng mã</b> dành cho gói Pro – <a href="#/account">xem quyền lợi</a>. Tư vấn mức thoát cho danh mục của anh/chị ở tab <a href="#/portfolio">Danh mục</a>.</div>` : ""}
  ${dec}
  <div class="ph"><h1>Bản tin thị trường</h1><span class="meta">
    ${i < dates.length - 1 ? `<a class="btn" href="#/digest/${dates[i + 1].date}">← ${esc(dates[i + 1].date.slice(5))}</a>` : ""}
    <select id="dgSel">${dates.map((x) => `<option value="${x.date}" ${x.date === d ? "selected" : ""}>${new Date(x.date).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" })}</option>`).join("")}</select>
    ${i > 0 ? `<a class="btn" href="#/digest/${dates[i - 1].date}">${esc(dates[i - 1].date.slice(5))} →</a>` : ""}</span></div>
  <section class="panel hero dg"><div class="ph"><h2>Phiên ${new Date(d).toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" })}</h2><span class="pill ${lightC === "up" ? "buy" : lightC === "down" ? "sell" : ""}">Đèn ${esc(LIGHT_VI[D.regime?.light] || "—")}</span></div>
    <ul class="dgl">${(D.lines || []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    ${D.regime?.text ? `<p class="muted" style="font-size:.8rem;margin-top:4px">${esc(D.regime.text)}</p>` : ""}</section>
  <div class="snap sec">
    <section class="panel sg"><div class="ph"><h3>Chỉ số</h3></div>${kpis([["VN-Index", `${nf(IX.VNINDEX?.close)} <small class="${cls(IX.VNINDEX?.chg)}">${pct(IX.VNINDEX?.chg, 2)}</small>`], ["VN30", `${nf(IX.VN30?.close)} <small class="${cls(IX.VN30?.chg)}">${pct(IX.VN30?.chg, 2)}</small>`],
      ["HNX", `${nf(IX.HNXINDEX?.close)} <small class="${cls(IX.HNXINDEX?.chg)}">${pct(IX.HNXINDEX?.chg, 2)}</small>`], ["UPCOM", `${nf(IX.UPCOMINDEX?.close)} <small class="${cls(IX.UPCOMINDEX?.chg)}">${pct(IX.UPCOMINDEX?.chg, 2)}</small>`]], false, "c2")}</section>
    <section class="panel sg"><div class="ph"><h3>Độ rộng & thanh khoản</h3></div>${kpis([["Tăng / giảm / đứng", `<b class="up">${B.adv}</b> / <b class="down">${B.dec}</b> / ${B.unch}`], ["Trần / sàn", `<b class="ceil">${B.ceil}</b> / <b class="floor">${B.floor}</b>`],
      ["GTGD", V.today ? `${nf(V.today, 1)} nghìn tỷ <small>TB20 ${nf(V.avg20, 1)}</small>` : "—"], ["Trên MA50", pct(B.above50, 0, false)], ["Đỉnh mới / đáy mới 52T", `${nf(B.new_hi, 0)} / ${nf(B.new_lo, 0)}`]], false, "c2")}</section>
    <section class="panel sg"><div class="ph"><h3>Tâm lý & dòng tiền</h3></div>${kpis([["Tâm lý", `${nf(S.now, 0)}/100 <small>${esc(S.label || "")}</small>`, "", "", ""], ["So với 5 phiên", isNum(S.chg5) ? (S.chg5 > 0 ? "+" : "") + nf(S.chg5, 0) : "—"],
      ["Gom âm thầm", nf(F.count?.acc, 0), "up"], ["Xả âm thầm", nf(F.count?.dist, 0), "down"], ["Bứt phá có KL", nf(F.count?.brk, 0), "up"], ["Phiên bất thường", `${nf(W.n, 0)} <small>${nf(W.neg, 0)} xấu · ${nf(W.pos, 0)} tốt</small>`]], false, "c2")}</section>
  </div>
  <div class="g g3 sec">
    <section class="panel"><div class="ph"><h2>Ngành</h2><span class="meta">bình quân theo vốn hoá, mã GTGD ≥ 5 tỷ</span></div><div class="tw"><table><thead><tr><th class="l">Ngành</th><th>%</th><th>Tăng/giảm</th><th class="l">Mạnh nhất</th></tr></thead><tbody>
      ${(D.sectors || []).map((x) => `<tr><td class="l">${esc(x.name)}</td><td class="${cls(x.chg)}">${pct(x.chg)}</td><td><small>${x.up}/${x.down}</small></td><td class="l"><small>${(x.best || []).map(([s, c]) => `${sym(s)} <span class="${cls(c)}">${pct(c, 1)}</span>`).join(" ")}</small></td></tr>`).join("")}</tbody></table></div></section>
    <section class="panel"><div class="ph"><h2>Kéo / đè VN-Index</h2><span class="meta">ước tính điểm đóng góp</span></div>
      <div class="rows">${(D.pull_up || []).map(([s, p, c]) => `<div class="row"><span>${sym(s)}</span><span class="${cls(c)}">${pct(c)}</span><b class="up">+${nf(p, 1)} điểm</b></div>`).join("")}</div>
      <div class="rows" style="margin-top:6px">${(D.pull_dn || []).map(([s, p, c]) => `<div class="row"><span>${sym(s)}</span><span class="${cls(c)}">${pct(c)}</span><b class="down">${nf(p, 1)} điểm</b></div>`).join("")}</div></section>
    <section class="panel"><div class="ph"><h2>Dòng tiền lớn</h2><a class="meta" href="#/swing/flow">chi tiết</a></div>
      <p><b class="up">Gom âm thầm:</b> ${(F.acc || []).map(sym).join(", ") || "—"}</p><p><b class="down">Xả âm thầm:</b> ${(F.dist || []).map(sym).join(", ") || "—"}</p><p><b class="up">Bứt phá có KL:</b> ${(F.brk || []).map(sym).join(", ") || "—"}</p>
      <p class="faint" style="font-size:.72rem">Kiểm chứng VN: xả âm thầm thường kém VN-Index 20 phiên sau; gom đơn thuần không đủ để mua; bứt phá có KL tăng xác suất có nhịp +20%.</p></section>
  </div>
  <div class="g g3 sec">
    <section class="panel"><div class="ph"><h2>Tăng mạnh</h2></div>${rowsT(D.gainers)}</section>
    <section class="panel"><div class="ph"><h2>Giảm mạnh</h2></div>${rowsT(D.losers)}</section>
    <section class="panel"><div class="ph"><h2>Khối lượng đột biến</h2><span class="meta">≥ 2,2 lần TB 20 phiên</span></div>${rowsT(D.unusual, true)}</section>
  </div>
  <div class="g g3 sec">
    <section class="panel"><div class="ph"><h2>Phiên bất thường đáng chú ý</h2><a class="meta" href="#/swing/today">chi tiết</a></div>
      ${(W.top || []).map((x) => `<div class="ev"><span><b class="${x.dir < 0 ? "down" : x.dir > 0 ? "up" : ""}">${sym(x.s)} ${pct(x.ret)}</b> <small class="muted">${esc(x.meaning)}</small></span></div>`).join("") || '<p class="muted">Không có.</p>'}</section>
    <section class="panel"><div class="ph"><h2>Sự kiện 7 ngày tới</h2><a class="meta" href="#/watch/calendar">lịch</a></div>
      ${(D.events || []).map((e) => `<div class="ev"><time>${esc(e.date.slice(5))}</time><span>${e.symbol ? sym(e.symbol) + " " : ""}${esc(e.title)}${isNum(e.yield) ? ` <small class="up">${nf(e.yield, 1)}%</small>` : ""}</span></div>`).join("") || '<p class="muted">Không có sự kiện.</p>'}</section>
    <section class="panel"><div class="ph"><h2>Tin tức</h2></div>
      ${(D.news || []).map((n) => `<div class="ev"><time>${esc(n.t.slice(11))}</time><span>${n.s ? sym(n.s) + " " : ""}<a href="${esc(n.link)}" target="_blank" rel="noopener">${esc(n.title)}</a> <small class="faint">${esc(n.src)}</small></span></div>`).join("") || '<p class="muted">Không có tin mới gắn với mã thanh khoản.</p>'}</section>
  </div>
  <p class="faint" style="font-size:.72rem;margin-top:8px">Bản tin tự động tạo từ số liệu sau phiên – thông tin tham khảo, không phải khuyến nghị đầu tư.</p>`;
  $("#dgSel").onchange = (e) => (location.hash = "#/digest/" + e.target.value);
  bindDecision();
}

// ---- thanh đầu trang: chuông + tài khoản
function initAccountUI() {
  if (!multiUser()) return;
  const th = $("#theme");
  const bell = document.createElement("button");
  bell.className = "iconbtn bell"; bell.id = "bell"; bell.title = "Thông báo"; bell.setAttribute("aria-label", "Thông báo");
  bell.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg><span id="bellN" hidden></span>`;
  const meb = document.createElement("button");
  meb.className = "iconbtn mebtn"; meb.id = "meBtn"; meb.title = ME.email; meb.setAttribute("aria-label", "Tài khoản");
  meb.textContent = ((ME.name || ME.email || "?").trim()[0] || "?").toUpperCase();
  th.parentNode.insertBefore(bell, th); th.parentNode.insertBefore(meb, th);
  bell.onclick = (e) => { e.stopPropagation(); bellOpen(); };
  meb.onclick = (e) => {
    e.stopPropagation();
    let m = $("#meMenu"); if (m) { m.remove(); return; }
    m = document.createElement("div"); m.id = "meMenu"; m.className = "menu memenu";
    m.style.top = Math.round(meb.getBoundingClientRect().bottom + 6) + "px";
    m.innerHTML = `<div class="mh"><b>${esc(ME.name || ME.email)}</b><small>${esc(ME.email)}</small><span class="pill ${ME.eff_plan === "pro" ? "buy" : ""}">Gói ${esc(ME.plan_name || ME.eff_plan)}${ME.plan_until ? " · đến " + esc(ME.plan_until) : ""}</span></div>
      <a href="#/digest">📰 Bản tin thị trường</a><a href="#/notifications">🔔 Thông báo</a><a href="#/account">⚙️ Tài khoản & cài đặt</a><a href="#/help">❓ Hướng dẫn & FAQ</a>${ME.role === "admin" ? '<a href="#/admin">🛠️ Quản trị</a>' : ""}<button id="meOut">↩ Đăng xuất</button>`;
    document.body.appendChild(m);
    $("#meOut").onclick = logout;
    m.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => m.remove()));
    setTimeout(() => document.addEventListener("click", function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("click", off); } }), 0);
  };
  // khoá tab theo gói
  const tabF = { swing: "swing", backtest: "backtest" };
  $$("#tabs a").forEach((a) => { const f = tabF[a.dataset.r]; if (f && !can(f)) a.classList.add("locked"); });
  if (!can("pdf")) $("#pdfBtn")?.remove();
  bellCount(); setInterval(bellCount, 120000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) bellCount(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
}

function initHelpBtn() {
  const th = $("#theme"); if (!th || $("#helpBtn")) return;
  const b = document.createElement("a");
  b.className = "iconbtn helpbtn"; b.id = "helpBtn"; b.href = "#/help"; b.title = "Hướng dẫn sử dụng & câu hỏi thường gặp"; b.setAttribute("aria-label", "Hướng dẫn");
  b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/></svg>`;
  th.parentNode.insertBefore(b, th);
}
(async function main() {
  ME = await fetchMe();
  if (!ME) { location.replace("/login?next=" + encodeURIComponent("/" + location.hash)); return; }
  initTheme(); initSearch(); initGlobal(); GL.init(); initAccountUI(); initHelpBtn(); plansData();
  $("#pdfBtn")?.addEventListener("click", () => PDFX.dialog());
  paintUpd(); setInterval(paintUpd, 60000);
  WL.load().catch(() => {});
  try {
    const meta = await load("data/meta.json");
    window.__ver = meta.generated;
    if (meta.demo) $("#demo").innerHTML = `<div class="demo-banner">DỮ LIỆU GIẢ LẬP để xem thử giao diện – không dùng để đầu tư</div>`;
    const [t, m, meth] = await Promise.all([loadToday(), tryLoad("data/market.json"), tryLoad("data/methods.json"), secsData()]);
    PSTATS = meth?.pattern_stats?.stats || {};
    if (m) drawBoard(t, m, meta);
  } catch (e) { /* chưa có dữ liệu */ }
  window.addEventListener("hashchange", route);
  route();
})();
