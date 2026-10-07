/* VN-Stock – giao diện web (vanilla JS, không cần build) */
"use strict";

// ================================================================ tiện ích
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isNum = (x) => x !== null && x !== undefined && x !== "" && !Number.isNaN(Number(x));
const nf = (x, d = 2) => (isNum(x) ? Number(x).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—");
const pct = (x, d = 1, sign = true) => (isNum(x) ? (sign && x > 0 ? "+" : "") + nf(x, d) + "%" : "—");
const cls = (x) => (!isNum(x) ? "" : x > 0 ? "up" : x < 0 ? "down" : "ref");
const bn = (x) => (isNum(x) ? nf(x, 0) + " tỷ" : "—");
const vnd = (x) => (isNum(x) ? nf(x, 0) + " đ" : "—");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const LIGHT_VI = { green: "Xanh", yellow: "Vàng", red: "Đỏ" };
const BASKET_SHORT = { garp: "GARP", dividend: "Cổ tức", value: "Giá trị", defensive: "Phòng thủ", growth: "Tăng trưởng" };

const cache = {};
async function load(path) {
  if (cache[path]) return cache[path];
  const r = await fetch(path + (path.includes("?") ? "" : `?v=${window.__ver || ""}`), { cache: "no-cache" });
  if (!r.ok) throw new Error(`Không tải được ${path} (HTTP ${r.status})`);
  return (cache[path] = await r.json());
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
function scoreColor(v) {
  if (!isNum(v)) return "var(--sunk)";
  const t = Math.max(0, Math.min(1, v / 100));
  const a = t < 0.5 ? css("--down") : css("--up");
  const alpha = Math.round(Math.abs(t - 0.5) * 2 * 60 + 12);
  return `color-mix(in srgb, ${a} ${alpha}%, transparent)`;
}
const scoreCell = (v) => `<span class="score" style="background:${scoreColor(v)}">${isNum(v) ? Math.round(v) : "—"}</span>`;

// ================================================================ danh mục (lưu trên Cloudflare KV, dự phòng localStorage)
const Store = {
  async get(key) {
    try {
      const r = await fetch(`api/${key}`, { cache: "no-store" });
      if (r.ok && (r.headers.get("content-type") || "").includes("json")) return { data: await r.json(), remote: true };
    } catch (e) { /* chạy trên máy: không có API */ }
    try { return { data: JSON.parse(localStorage.getItem("vnstock_" + key) || "null"), remote: false }; }
    catch (e) { return { data: null, remote: false }; }
  },
  async put(key, data) {
    try { localStorage.setItem("vnstock_" + key, JSON.stringify(data)); } catch (e) { /* bỏ qua */ }
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

// ================================================================ khung trang
let SCREENER = null;
async function screenerRows() {
  if (SCREENER) return SCREENER;
  const s = await load("data/screener.json");
  SCREENER = s.rows.map((r) => Object.fromEntries(s.cols.map((c, i) => [c, r[i]])));
  return SCREENER;
}
function setTab(r) { $$("#tabs a").forEach((a) => a.classList.toggle("on", a.dataset.r === r)); }
const app = () => $("#app");
const charts = [];
function disposeCharts() { while (charts.length) { try { charts.pop().remove(); } catch (e) { /* đã huỷ */ } } }

async function route() {
  disposeCharts();
  const h = location.hash.replace(/^#\/?/, "");
  const [r, arg] = h.split("/");
  window.scrollTo(0, 0);
  try {
    if (!r) { setTab("today"); await viewToday(); }
    else if (r === "market") { setTab("market"); await viewMarket(); }
    else if (r === "portfolio") { setTab("portfolio"); await viewPortfolio(); }
    else if (r === "screener") { setTab("screener"); await viewScreener(arg); }
    else if (r === "backtest") { setTab("backtest"); await viewBacktest(); }
    else if (r === "s" && arg) { setTab(""); await viewStock(arg.toUpperCase()); }
    else if (r === "guide") { setTab(""); await viewGuide(); }
    else { app().innerHTML = `<div class="empty">Không có trang này. <a href="#/">Về trang Hôm nay</a></div>`; }
  } catch (e) {
    console.error(e);
    app().innerHTML = `<div class="panel"><h2>Chưa có dữ liệu để hiển thị</h2><p>${esc(e.message)}</p>
      <p class="muted">Hệ thống cập nhật mỗi chiều sau 15h35. Nếu đây là lần đầu, chờ lượt chạy đầu tiên hoàn tất (khoảng 30–60 phút).</p></div>`;
  }
  app().focus({ preventScroll: true });
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

async function viewToday() {
  const [t, meta, pfr] = await Promise.all([load("data/today.json"), load("data/meta.json"), Store.get("portfolio")]);
  const pf = pfr.data || {};
  const reg = t.regime, plan = t.plan;
  const capital = capitalOf(pf) ?? t.capital;
  const stale = (Date.now() - new Date(meta.data_date).getTime()) / 864e5 > 4;
  const held = new Set((pf.holdings || []).map((h) => String(h.symbol).toUpperCase()));
  const pos = (t.portfolio && t.portfolio.positions) || [];
  const sells = pos.filter((p) => p.severity >= 1);
  const holds = pos.filter((p) => p.severity < 1);

  const pickRow = (p) => {
    const sh = sharesFor(capital, p.weight, p.zone[1]);
    return `<a class="act" href="#/s/${p.symbol}" style="color:inherit;text-decoration:none"><div class="act-in">
      <div class="act-head"><span class="sym">${p.symbol}</span><span class="pill buy">MUA</span>
        <span class="pill">${esc(BASKET_SHORT[p.basket] || p.basket)}</span>${held.has(p.symbol) ? '<span class="pill">đang nắm</span>' : ""}
        <span class="muted" style="margin-left:auto">giá ${nf(p.price)}</span></div>
      <div class="act-nums">
        <div><small>Vùng mua</small><b>${nf(p.zone[0])} – ${nf(p.zone[1])}</b></div>
        <div><small>Cắt lỗ</small><b class="down">${nf(p.stop)}</b> <small>(${pct(p.stop_pct, 0)})</small></div>
        <div><small>Mục tiêu 1 / 2</small><b class="up">${nf(p.t1)} / ${nf(p.t2)}</b></div>
        <div><small>Tỷ trọng</small><b>${nf(p.weight, 1)}% vốn</b>${sh ? `<small>≈ ${nf(sh, 0)} cp</small>` : ""}</div>
      </div>
      <div class="why">${esc(p.why || "")}</div></div></a>`;
  };
  const sellRow = (p) => `<a class="act ${p.severity >= 2 ? "sell" : "wait"}" href="#/s/${p.symbol}" style="color:inherit;text-decoration:none"><div class="act-in">
      <div class="act-head"><span class="sym">${p.symbol}</span><span class="pill ${p.severity >= 2 ? "sell" : "wait"}">${esc(p.action)}</span>
      <span class="muted" style="margin-left:auto">lãi/lỗ <b class="${cls(p.pnl_pct)}">${pct(p.pnl_pct)}</b></span></div>
      <div class="act-nums"><div><small>Giá hiện tại</small><b>${nf(p.price)}</b></div><div><small>Giá vốn</small><b>${nf(p.cost)}</b></div>
      <div><small>Điểm dừng</small><b>${nf(p.stop)}</b></div><div><small>Giá trị hợp lý</small><b>${nf(p.fair)}</b></div></div>
      <div class="why">${esc((p.reasons || []).join("; "))}</div></div></a>`;

  app().innerHTML = `
  ${stale ? `<div class="note" style="margin-bottom:14px">Dữ liệu ngày ${esc(meta.data_date)} – đã cũ hơn 4 ngày. Lượt chạy tự động có thể đang lỗi; xem tab Actions trên GitHub.</div>` : ""}
  <section class="panel">
    <div class="signal">
      ${lamps(reg.light)}
      <div>
        <div class="exposure">Nắm tối đa ${reg.exposure}% <span>cổ phiếu, còn lại tiền mặt</span></div>
        <p>${esc(reg.text)}</p>
        <p class="muted">VN-Index ${nf(reg.index.close)} <span class="${cls(reg.index.chg1d)}">${pct(reg.index.chg1d, 2)}</span>,
          1 tháng <span class="${cls(reg.index.chg1m)}">${pct(reg.index.chg1m)}</span>. Dữ liệu phiên ${esc(t.date)}.</p>
        <details><summary>Vì sao đèn ${LIGHT_VI[reg.light]}? (${reg.score}/${reg.max_score} điều kiện đạt)</summary>
          <ul class="checks">${reg.checks.map((c) => `<li class="${c.ok ? "ok" : ""}">${esc(c.name)}</li>`).join("")}</ul></details>
      </div>
    </div>
  </section>

  <section class="sec"><h2>Việc cần làm hôm nay</h2>
    ${sells.length ? `<h3 style="margin:6px 0 8px">Danh mục của anh</h3><div class="acts">${sells.map(sellRow).join("")}</div>` : ""}
    <h3 style="margin:14px 0 8px">Mua theo kế hoạch <small class="muted">(${plan.picks.length} mã, tổng ${nf(plan.invested, 0)}% vốn, giữ ${nf(plan.cash, 0)}% tiền mặt)</small></h3>
    ${plan.picks.length ? `<div class="acts">${plan.picks.map(pickRow).join("")}</div>` :
      `<div class="empty">Hôm nay không có mã nào đạt đủ điều kiện mua. Giữ tiền mặt là một quyết định đúng.</div>`}
    ${!capital ? `<p class="muted" style="margin-top:8px">Nhập số vốn ở tab <a href="#/portfolio">Danh mục</a> để thấy số cổ phiếu cần mua cho từng mã.</p>` : ""}
  </section>

  ${holds.length ? `<section class="sec"><h2>Đang nắm – giữ nguyên</h2><div class="acts">${holds.map((p) => `
    <a class="act hold" href="#/s/${p.symbol}" style="color:inherit;text-decoration:none"><div class="act-in">
      <div class="act-head"><span class="sym">${p.symbol}</span><span class="pill">GIỮ</span>
      <span class="muted" style="margin-left:auto">lãi/lỗ <b class="${cls(p.pnl_pct)}">${pct(p.pnl_pct)}</b></span></div>
      <div class="why">${esc((p.reasons || []).join("; "))}</div></div></a>`).join("")}</div></section>` : ""}

  ${plan.watch.length ? `<section class="sec"><h2>Theo dõi – chưa đến lúc mua</h2>
    <div class="tbl-wrap"><table><thead><tr><th class="l">Mã</th><th class="l">Rổ</th><th>Giá</th><th>Vùng chờ mua</th><th class="l">Lý do chờ</th></tr></thead><tbody>
    ${plan.watch.map((w) => `<tr><td><a href="#/s/${w.symbol}">${w.symbol}</a></td><td class="l">${esc(BASKET_SHORT[w.basket] || w.basket)}</td>
      <td>${nf(w.price)}</td><td>${nf(w.zone[0])} – ${nf(w.zone[1])}</td><td class="l" style="white-space:normal;min-width:240px">${esc(w.reason)}</td></tr>`).join("")}
    </tbody></table></div></section>` : ""}

  <section class="sec"><h2>Phân bổ vốn đang dùng</h2>
    <div class="panel"><div class="kv">${Object.entries(t.allocation || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `<div><dt>${esc(BASKET_SHORT[k] || k)}</dt><dd>${v}%</dd></div>`).join("")}
      <div><dt>Tối đa số mã</dt><dd>${t.risk?.max_positions}</dd></div><div><dt>Biên an toàn</dt><dd>${t.risk?.margin_of_safety}%</dd></div></div>
      <p class="muted" style="margin-top:10px">Muốn đổi tỷ lệ: sửa file <b>config.yaml</b> trên GitHub. <a href="#/guide">Hệ thống chọn mã thế nào?</a></p></div>
  </section>
  <p style="margin-top:22px"><button class="btn" id="runNow">Chạy lại phân tích ngay</button>
    <small class="muted" id="runMsg">Thường tự chạy lúc 15h35. Bấm khi muốn cập nhật sớm hơn (mất 10–30 phút).</small></p>
  <p class="faint" style="margin-top:28px;font-size:.8rem">Cập nhật ${esc(meta.generated)} · ${nf(meta.symbols, 0)} mã · Đây là công cụ hỗ trợ ra quyết định, không phải lời khuyên đầu tư có giấy phép.</p>`;
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
function themeOpts() {
  return {
    layout: { background: { color: "transparent" }, textColor: css("--ink-2"), fontFamily: "Be Vietnam Pro, system-ui" },
    grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
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
    const vs = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vs.setData(o.t.map((d, i) => ({ time: d, value: o.v[i], color: o.c[i] >= (o.c[i - 1] ?? o.c[i]) ? css("--up") + "66" : css("--down") + "66" })));
  }
  return { c, cs };
}

async function viewMarket() {
  const m = await load("data/market.json");
  const reg = m.regime;
  const idx = m.indices.VNINDEX;
  const others = Object.entries(m.indices);
  const heatColor = (v) => !isNum(v) ? "var(--ink-3)" : `color-mix(in srgb, ${v >= 0 ? css("--up") : css("--down")} ${Math.min(100, 35 + Math.abs(v) * 6)}%, #333)`;
  app().innerHTML = `
  <h1>Thị trường</h1>
  <div class="kv" style="margin:12px 0">${others.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${nf(v.close)} <span class="${cls(v.chg)}">${pct(v.chg, 2)}</span></dd></div>`).join("")}
    <div><dt>Đèn thị trường</dt><dd>${LIGHT_VI[reg.light]} (${reg.score}/${reg.max_score})</dd></div>
    <div><dt>Ngày phân phối (25 phiên)</dt><dd>${reg.distribution_days}</dd></div></div>
  <div class="panel"><h2>VN-Index</h2><div class="toolbar" id="ixTools"></div><div class="chart" id="ixChart"></div>
    <p class="muted" style="margin-top:8px">Kỹ thuật: <b>${esc(m.index_ta.label)}</b> (${m.index_ta.score}/100) – ${esc(m.index_ta.trend_vi)}</p></div>
  <div class="grid2 sec">
    <div class="panel"><h2>Độ rộng thị trường</h2><p class="muted">Tỷ lệ cổ phiếu thanh khoản nằm trên MA50 / MA200. Trên 50% là khoẻ.</p>
      <div class="chart sm" id="brChart"></div><div class="leg"><span><i style="background:${css("--brand")}"></i>% trên MA50</span><span><i style="background:${css("--ref")}"></i>% trên MA200</span></div>
      <div class="kv" style="margin-top:10px"><div><dt>Tăng / giảm hôm nay</dt><dd><span class="up">${reg.breadth_now.adv ?? "—"}</span> / <span class="down">${reg.breadth_now.dec ?? "—"}</span></dd></div>
      <div><dt>Đỉnh / đáy 52 tuần mới</dt><dd>${reg.breadth_now.new_hi ?? "—"} / ${reg.breadth_now.new_lo ?? "—"}</dd></div></div></div>
    <div class="panel"><h2>Sóng VN-Index</h2>${wavesBlock(m.index_waves, true)}</div>
  </div>
  <section class="sec"><h2>Bản đồ ngành <small class="muted">hiệu suất 1 tháng, gia quyền theo thanh khoản</small></h2>
    <div class="heat">${m.sectors.map((s) => `<div style="background:${heatColor(s.r1m)}"><b>${pct(s.r1m)}</b>${esc(s.sector)}<br><small style="color:#fff;opacity:.85">${s.n} mã · ${nf(s.above50, 0)}% trên MA50</small></div>`).join("")}</div>
    <div class="tbl-wrap" style="margin-top:12px"><table id="secTbl"><thead><tr><th class="l">Ngành</th><th>1 ngày</th><th>1 tuần</th><th>1 tháng</th><th>3 tháng</th><th>1 năm</th><th>% trên MA50</th><th>GTGD/ngày</th></tr></thead>
    <tbody>${m.sectors.map((s) => `<tr><td>${esc(s.sector)}</td>${["r1d", "r1w", "r1m", "r3m", "r1y"].map((k) => `<td class="${cls(s[k])}">${pct(s[k])}</td>`).join("")}<td>${nf(s.above50, 0)}%</td><td>${bn(s.value_bn)}</td></tr>`).join("")}</tbody></table></div>
  </section>`;
  if (idx) {
    const { c, cs } = candleChart($("#ixChart"), idx.ohlc);
    const s50 = c.addLineSeries({ color: css("--brand"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    const s200 = c.addLineSeries({ color: css("--ref"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    s50.setData(ser(idx.ohlc.t, IND.sma(idx.ohlc.c, 50)));
    s200.setData(ser(idx.ohlc.t, IND.sma(idx.ohlc.c, 200)));
    $("#ixTools").innerHTML = `<span class="leg"><span><i style="background:${css("--brand")}"></i>MA50</span><span><i style="background:${css("--ref")}"></i>MA200</span></span>`;
    c.timeScale().fitContent();
  }
  const bc = mkChart($("#brChart"));
  const a = bc.addLineSeries({ color: css("--brand"), lineWidth: 2 });
  const b = bc.addLineSeries({ color: css("--ref"), lineWidth: 2 });
  a.setData(m.breadth.filter((x) => x.a50 != null).map((x) => ({ time: x.d, value: x.a50 })));
  b.setData(m.breadth.filter((x) => x.a200 != null).map((x) => ({ time: x.d, value: x.a200 })));
  a.createPriceLine({ price: 50, color: css("--ink-3"), lineStyle: 2, axisLabelVisible: false });
  bc.timeScale().fitContent();
}

// ================================================================ SÓNG & MÔ HÌNH (dùng chung)
function reliab(r) {
  if (!r) return `<small class="faint">chưa đủ mẫu để đo độ tin cậy</small>`;
  return `<small class="${r.useful ? "up" : "muted"}">Độ tin cậy trên dữ liệu VN: đúng ${nf(r.hit_rate, 0)}% trong ${nf(r.n, 0)} lần,
    vượt VN-Index TB ${pct(r.avg_excess, 2)} sau 20 phiên → ${r.useful ? "được dùng khi chấm điểm" : "chỉ để tham khảo"}</small>`;
}
function wavesBlock(w, compact = false) {
  if (!w) return `<p class="muted">Chưa có.</p>`;
  const el = w.elliott || {};
  const scen = (s, title) => !s ? "" : `<div style="margin-top:8px"><h3>${title}: ${esc(s.where)}</h3>
    <div class="wave-pts" style="margin:6px 0">${s.points.map((p) => `<span>${esc(p.label)} · ${nf(p.price)} <small class="faint">${esc(p.date)}</small></span>`).join("")}</div>
    ${s.targets.length ? `<p>Vùng mục tiêu: <b>${s.targets.map((x) => nf(x)).join(" / ")}</b></p>` : ""}
    ${s.invalidation ? `<p>Kịch bản sai nếu giá về dưới/vượt <b>${nf(s.invalidation)}</b></p>` : ""}
    <p class="muted" style="font-size:.85rem">${esc((s.notes || []).join(" · "))} – mức khớp ${nf((s.confidence || 0) * 100, 0)}%</p></div>`;
  const wy = w.wyckoff || {};
  const dw = w.dow || {};
  const pats = (w.patterns || []).concat(w.harmonics || []);
  return `
   <div><h3>Elliott</h3>${el.ok ? scen(el.main, "Kịch bản chính") + scen(el.alt, "Kịch bản thay thế") : `<p class="muted">${esc(el.reason || "Không đếm được")}</p>`}
     ${reliab(el.reliability)}</div>
   <div style="margin-top:14px"><h3>Wyckoff: ${esc(wy.phase || "—")}</h3>
     ${(wy.events || []).length ? `<ul>${wy.events.map((e) => `<li>${esc(e.date)}: ${esc(e.event)}</li>`).join("")}</ul>` : ""}
     ${wy.range ? `<p class="muted">Nền giá 60 phiên: ${nf(wy.range[0])} – ${nf(wy.range[1])} (rộng ${nf(wy.width_pct, 1)}%)</p>` : ""}
     ${reliab(wy.reliability)}</div>
   <div style="margin-top:14px"><h3>Lý thuyết Dow</h3><p>Xu hướng chính: <b>${esc(dw.primary || "—")}</b><br>Xu hướng phụ: ${esc(dw.secondary || "—")}</p>${reliab(dw.reliability)}</div>
   ${compact ? "" : `<div style="margin-top:14px"><h3>Mô hình giá & Harmonic</h3>
     ${pats.length ? pats.map((p) => `<div style="padding:8px 0;border-bottom:1px dashed var(--line)">
       <b class="${p.bias > 0 ? "up" : p.bias < 0 ? "down" : ""}">${esc(p.name)}</b> – ${esc(p.status || "")}
       <br><small>${p.trigger ? `Điểm kích hoạt ${nf(p.trigger)}` : ""}${p.prz ? `Vùng đảo chiều ${nf(p.prz)}` : ""}${p.target ? ` · mục tiêu ${nf(p.target)}` : ""}${p.stop ? ` · cắt lỗ ${nf(p.stop)}` : ""}</small><br>${reliab(p.reliability)}</div>`).join("")
       : `<p class="muted">Không phát hiện mô hình nào rõ ràng trong 60 phiên gần đây.</p>`}</div>`}`;
}

// ================================================================ DANH MỤC
async function viewPortfolio() {
  const [{ data, remote }, t, rows] = await Promise.all([Store.get("portfolio"), load("data/today.json"), screenerRows()]);
  const pf = data || { holdings: [], cash: 0, capital: null };
  const priceOf = Object.fromEntries(rows.map((r) => [r.symbol, r]));
  const adv = Object.fromEntries(((t.portfolio && t.portfolio.positions) || []).map((p) => [p.symbol, p]));
  const render = () => {
    let mv = 0, costT = 0;
    pf.holdings.forEach((h) => { const r = priceOf[h.symbol]; const px = r ? r.price : h.cost; mv += h.qty * px * 1000; costT += h.qty * h.cost * 1000; });
    const total = mv + Number(pf.cash || 0);
    app().innerHTML = `
    <h1>Danh mục của tôi</h1>
    <p class="muted">${remote ? "Đã đồng bộ – mở trên điện thoại hay máy tính đều thấy như nhau." :
      "Đang lưu trong trình duyệt này (chưa kết nối máy chủ). Sau khi cài Cloudflare, danh mục sẽ đồng bộ mọi thiết bị."}</p>
    <div class="panel"><div class="kv">
      <div><dt>Tổng tài sản</dt><dd>${vnd(total)}</dd></div>
      <div><dt>Giá trị cổ phiếu</dt><dd>${vnd(mv)}</dd></div>
      <div><dt>Lãi/lỗ tạm tính</dt><dd class="${cls(mv - costT)}">${vnd(mv - costT)} (${pct(costT ? (mv / costT - 1) * 100 : null)})</dd></div>
      <div><dt>Tỷ trọng cổ phiếu</dt><dd>${pct(total ? mv / total * 100 : null, 0, false)} <small class="muted">/ tối đa ${t.regime.exposure}%</small></dd></div>
      ${t.portfolio?.drawdown_1y != null ? `<div><dt>Sụt từ đỉnh 1 năm</dt><dd class="${cls(t.portfolio.drawdown_1y)}">${pct(t.portfolio.drawdown_1y)}</dd></div>` : ""}
    </div>
    ${(t.portfolio?.warnings || []).map((w) => `<p class="note" style="margin-top:10px">${esc(w)}</p>`).join("")}</div>

    <section class="sec"><h2>Vốn</h2><div class="panel"><div class="form-row" style="grid-template-columns:1fr 1fr auto">
      <div class="field"><label for="cap">Tổng vốn dành cho chứng khoán (đồng)</label><input id="cap" inputmode="numeric" value="${pf.capital ?? ""}" placeholder="ví dụ 500000000"></div>
      <div class="field"><label for="cash">Tiền mặt hiện có (đồng)</label><input id="cash" inputmode="numeric" value="${pf.cash ?? ""}"></div>
      <button class="btn primary" id="saveCap">Lưu</button></div>
      <p class="muted" style="margin-top:8px">Số vốn dùng để tính số cổ phiếu cần mua ở trang Hôm nay.</p></div></section>

    <section class="sec"><h2>Mã đang nắm</h2>
      <div class="tbl-wrap"><table><thead><tr><th class="l">Mã</th><th>KL</th><th>Giá vốn</th><th>Giá</th><th>Lãi/lỗ</th><th class="l">Tư vấn</th><th></th></tr></thead><tbody>
      ${pf.holdings.length ? pf.holdings.map((h, i) => { const r = priceOf[h.symbol]; const px = r ? r.price : null; const a = adv[h.symbol];
        return `<tr><td><a href="#/s/${h.symbol}">${h.symbol}</a></td><td>${nf(h.qty, 0)}</td><td>${nf(h.cost)}</td><td>${nf(px)}</td>
        <td class="${cls(px && (px / h.cost - 1))}">${pct(px ? (px / h.cost - 1) * 100 : null)}</td>
        <td class="l" style="white-space:normal;min-width:220px">${a ? `<b class="${a.severity >= 2 ? "down" : a.severity === 1 ? "ref" : ""}">${esc(a.action)}</b> – ${esc((a.reasons || []).join("; "))}` : `<small class="muted">Tư vấn có sau lượt chạy kế tiếp</small>`}</td>
        <td><button class="btn" data-del="${i}" aria-label="Xoá ${h.symbol}">Xoá</button></td></tr>`; }).join("")
        : `<tr><td colspan="7" class="l" style="text-align:center;padding:18px">Chưa có mã nào. Thêm mã đang nắm ở dưới.</td></tr>`}
      </tbody></table></div>
      <div class="panel" style="margin-top:12px"><h3>Thêm / cập nhật mã</h3>
        <div class="form-row" style="margin-top:8px">
          <div class="field"><label for="hs">Mã</label><input id="hs" placeholder="FPT" autocapitalize="characters"></div>
          <div class="field"><label for="hq">Khối lượng (cp)</label><input id="hq" inputmode="numeric" placeholder="1000"></div>
          <div class="field"><label for="hc">Giá vốn (nghìn đ)</label><input id="hc" inputmode="decimal" placeholder="95,5"></div>
          <div class="field"><label for="hd">Ngày mua</label><input id="hd" type="date"></div>
          <button class="btn primary" id="add">Lưu mã</button>
        </div>
        <div class="field" style="margin-top:8px;max-width:260px"><label for="hb">Mua theo rổ (để tư vấn đúng luận điểm)</label>
          <select id="hb"><option value="">Không rõ</option>${Object.entries(BASKET_SHORT).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
        <p class="muted" style="margin-top:8px">Nhập lại cùng mã để cập nhật. Giá vốn tính theo nghìn đồng như trên bảng điện.</p>
      </div></section>`;
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
const SCR_COLS = [
  ["symbol", "Mã", "l"], ["exchange", "Sàn", "l"], ["industry", "Ngành", "l"], ["price", "Giá"], ["chg1m", "1 tháng", "pct"],
  ["composite", "Điểm", "score"], ["upside", "Tiềm năng", "pct"], ["verdict", "Định giá", "l"], ["pe", "P/E"], ["pb", "P/B"],
  ["roe", "ROE", "pct0"], ["ni_yoy", "LN 12T", "pct"], ["fscore", "F-Score", "int"], ["div_yield", "Cổ tức", "pct0"],
  ["ta_label", "Kỹ thuật", "l"], ["avg_value_bn", "GTGD/ngày", "bn"], ["rs_rating", "RS", "int"], ["canslim_flags", "CANSLIM", "l"],
];
async function viewScreener(arg) {
  const [rows, meth] = await Promise.all([screenerRows(), load("data/methods.json")]);
  const W = { ...meth.weights };
  try { Object.assign(W, JSON.parse(localStorage.getItem("vnstock_weights") || "{}")); } catch (e) { /* bỏ qua */ }
  const sectors = [...new Set(rows.map((r) => r.industry).filter(Boolean))].sort();
  const st = { exch: "", ind: "", basket: arg || "", minVal: 3, maxPE: "", minROE: "", minF: "", minDiv: "", text: "", sort: "composite", asc: false, liquidOnly: true };
  app().innerHTML = `
  <h1>Bộ lọc & phương pháp chọn mã</h1>
  <p class="muted">Mỗi mã được chấm 0–100 theo từng phương pháp. Kéo thanh trọng số để đổi cách tính <b>Điểm</b> tổng hợp – bảng xếp lại ngay. <a href="#/guide">Giải thích chi tiết</a></p>
  <details class="panel" style="margin-top:12px"><summary>Trọng số các phương pháp</summary>
    <div class="weights" style="margin-top:12px">${Object.entries(meth.methods).map(([k, m]) => `
      <div class="w-item"><header><b>${esc(m.name)}</b><output id="wo_${k}">${W[k] ?? 0}</output></header>
      <input type="range" min="0" max="40" step="5" value="${W[k] ?? 0}" data-w="${k}" aria-label="Trọng số ${esc(m.name)}"><p>${esc(m.desc)}</p></div>`).join("")}</div>
    <p style="margin-top:10px"><button class="btn" id="wReset">Về trọng số mặc định</button> <small class="muted">Trọng số ở đây chỉ đổi cách xếp hạng trên trang này. Danh sách MUA dùng trọng số trong config.yaml.</small></p>
  </details>
  <div class="panel" style="margin-top:14px"><div class="filters">
    <div class="field"><label>Rổ</label><select id="fB"><option value="">Tất cả mã</option>${Object.entries(meth.baskets).map(([k, b]) => `<option value="${k}" ${st.basket === k ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Sàn</label><select id="fE"><option value="">Cả 3 sàn</option><option>HOSE</option><option>HNX</option><option>UPCOM</option></select></div>
    <div class="field"><label>Ngành</label><select id="fI"><option value="">Tất cả ngành</option>${sectors.map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
    <div class="field"><label>Tìm mã / tên</label><input id="fT" placeholder="ví dụ ngân hàng"></div>
    <div class="field"><label>GTGD tối thiểu (tỷ/ngày)</label><input id="fV" inputmode="decimal" value="3"></div>
    <div class="field"><label>P/E tối đa</label><input id="fPE" inputmode="decimal"></div>
    <div class="field"><label>ROE tối thiểu (%)</label><input id="fR" inputmode="decimal"></div>
    <div class="field"><label>F-Score tối thiểu</label><input id="fF" inputmode="numeric"></div>
    <div class="field"><label>Cổ tức tối thiểu (%)</label><input id="fD" inputmode="decimal"></div>
  </div><p class="muted" id="bRule" style="margin-top:8px"></p></div>
  <p id="cnt" class="muted" style="margin:12px 0 6px"></p>
  <div class="tbl-wrap" style="max-height:70vh"><table id="scr"><thead><tr>${SCR_COLS.map(([k, n, f]) => `<th data-k="${k}" class="${f === "l" ? "l" : ""}">${n}</th>`).join("")}</tr></thead><tbody></tbody></table></div>`;

  const recompute = () => {
    const tot = Object.values(W).reduce((a, b) => a + Number(b || 0), 0) || 1;
    rows.forEach((r) => {
      let s = 0, ws = 0;
      for (const [k, w] of Object.entries(W)) { if (w > 0 && isNum(r[k])) { s += r[k] * w; ws += Number(w); } }
      r._score = ws ? s / ws : null;
    });
    return tot;
  };
  const fmt = (r, k, f) => {
    const v = k === "composite" ? r._score : r[k];
    if (k === "symbol") return `<a href="#/s/${v}">${v}</a>`;
    if (f === "score") return scoreCell(v);
    if (f === "pct") return `<span class="${cls(v)}">${pct(v)}</span>`;
    if (f === "pct0") return isNum(v) ? nf(v, 1) + "%" : "—";
    if (f === "int") return isNum(v) ? nf(v, 0) : "—";
    if (f === "bn") return isNum(v) ? nf(v, 1) : "—";
    if (f === "l") return esc(v ?? "—");
    return nf(v);
  };
  const draw = () => {
    recompute();
    const num = (x) => (x === "" ? null : Number(String(x).replace(",", ".")));
    const minVal = num(st.minVal), maxPE = num(st.maxPE), minR = num(st.minROE), minF = num(st.minF), minD = num(st.minDiv);
    const txt = st.text.toLowerCase();
    let f = rows.filter((r) => (!st.exch || r.exchange === st.exch) && (!st.ind || r.industry === st.ind) && (!st.basket || r["in_" + st.basket] === true)
      && (minVal == null || (r.avg_value_bn ?? 0) >= minVal) && (maxPE == null || (isNum(r.pe) && r.pe > 0 && r.pe <= maxPE))
      && (minR == null || (r.roe ?? -1e9) >= minR) && (minF == null || (r.fscore ?? -1) >= minF) && (minD == null || (r.div_yield ?? 0) >= minD)
      && (!txt || r.symbol.toLowerCase().includes(txt) || String(r.name || "").toLowerCase().includes(txt) || String(r.industry || "").toLowerCase().includes(txt)));
    const k = st.sort === "composite" ? "_score" : st.sort;
    f.sort((a, b) => { const x = a[k], y = b[k]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * (st.asc ? 1 : -1); });
    $("#cnt").textContent = `${f.length} mã khớp điều kiện${f.length > 400 ? " (hiển thị 400 mã đầu)" : ""}`;
    $("#scr tbody").innerHTML = f.slice(0, 400).map((r) => `<tr>${SCR_COLS.map(([kk, , ff]) => `<td class="${ff === "l" ? "l" : ""}">${fmt(r, kk, ff)}</td>`).join("")}</tr>`).join("");
    $$("#scr th").forEach((th) => { th.classList.toggle("sorted", th.dataset.k === st.sort); th.classList.toggle("asc", th.dataset.k === st.sort && st.asc); });
    const b = meth.baskets[st.basket];
    $("#bRule").innerHTML = b ? `<b>Điều kiện rổ ${esc(b.name)}</b> (rủi ro ${esc(b.risk)}): ${esc(b.rule)}` : "";
  };
  $$("input[data-w]").forEach((el) => (el.oninput = () => { W[el.dataset.w] = Number(el.value); $("#wo_" + el.dataset.w).textContent = el.value; try { localStorage.setItem("vnstock_weights", JSON.stringify(W)); } catch (e) { /* bỏ qua */ } draw(); }));
  $("#wReset").onclick = () => { Object.assign(W, meth.weights); try { localStorage.removeItem("vnstock_weights"); } catch (e) { /* bỏ qua */ } viewScreener(st.basket); };
  const bind = (id, key) => ($(id).oninput = () => { st[key] = $(id).value; draw(); });
  bind("#fB", "basket"); bind("#fE", "exch"); bind("#fI", "ind"); bind("#fT", "text"); bind("#fV", "minVal"); bind("#fPE", "maxPE"); bind("#fR", "minROE"); bind("#fF", "minF"); bind("#fD", "minDiv");
  $$("#scr th").forEach((th) => (th.onclick = () => { if (st.sort === th.dataset.k) st.asc = !st.asc; else { st.sort = th.dataset.k; st.asc = ["pe", "pb", "symbol"].includes(th.dataset.k); } draw(); }));
  draw();
}

// ================================================================ KIỂM CHỨNG (BACKTEST)
async function viewBacktest() {
  const [b, meth] = await Promise.all([load("data/backtest.json"), load("data/methods.json")]);
  if (!b.ok) { app().innerHTML = `<h1>Kiểm chứng</h1><div class="empty">${esc(b.reason || "Backtest chưa chạy – sẽ có sau lượt chạy cuối tuần.")}</div>`; return; }
  const series = [["combo", b.combo, css("--brand")], ["combo_regime", b.combo_regime, css("--up")], ["bench", b.benchmark, css("--ink-3")]];
  const bas = Object.entries(b.baskets);
  const palette = [css("--ref"), css("--ceil"), css("--floor"), css("--down"), "#7C8A99"];
  const statRow = (name, s) => `<tr><td class="l">${esc(name)}</td><td class="${cls(s.cagr)}">${pct(s.cagr)}</td><td class="down">${pct(s.max_dd)}</td><td>${nf(s.vol, 1)}%</td><td>${nf(s.sharpe)}</td><td>${s.win_years ?? "—"}/${s.n_years ?? "—"}</td><td>${s.avg_count ?? ""}</td></tr>`;
  const years = [...new Set([b.benchmark, b.combo, ...bas.map(([, v]) => v)].flatMap((s) => Object.keys(s.yearly || {})))].sort();
  const ps = meth.pattern_stats || {};
  app().innerHTML = `
  <h1>Kiểm chứng bằng dữ liệu quá khứ</h1>
  <p class="muted">Chạy lại đúng quy tắc chọn mã của hệ thống từ ${esc(b.start)} đến ${esc(b.end)} (${b.months} tháng), tái cơ cấu mỗi tháng, chỉ dùng thông tin đã có tại thời điểm đó.</p>
  <div class="panel"><div class="chart" id="btChart"></div>
    <div class="leg" style="margin-top:8px">${series.map(([, s, c]) => `<span><i style="background:${c}"></i>${esc(s.name)}</span>`).join("")}
      ${bas.map(([k, s], i) => `<span><i style="background:${palette[i % palette.length]}"></i>${esc(s.name)}</span>`).join("")}</div></div>
  <section class="sec"><h2>Kết quả</h2><div class="tbl-wrap"><table><thead><tr><th class="l">Chiến lược</th><th>Lãi kép/năm</th><th>Sụt tối đa</th><th>Biến động</th><th>Sharpe</th><th>Năm có lãi</th><th>Số mã TB</th></tr></thead><tbody>
    ${statRow(b.combo.name, b.combo)}${statRow(b.combo_regime.name, b.combo_regime)}${statRow("VN-Index", b.benchmark)}
    ${bas.map(([, s]) => statRow("Rổ " + s.name, s)).join("")}</tbody></table></div>
    <p class="muted" style="margin-top:8px">Mục tiêu của anh: 30%/năm, chấp nhận sụt ${esc(String((await load("data/today.json")).risk?.max_drawdown_target ?? 25))}%. So hai cột đầu với mục tiêu này để biết kỳ vọng thực tế.</p></section>
  <section class="sec"><h2>Từng năm</h2><div class="tbl-wrap"><table><thead><tr><th class="l">Chiến lược</th>${years.map((y) => `<th>${y}</th>`).join("")}</tr></thead><tbody>
    ${[[b.combo.name, b.combo], [b.combo_regime.name, b.combo_regime], ["VN-Index", b.benchmark], ...bas.map(([, s]) => [s.name, s])].map(([n, s]) =>
      `<tr><td class="l">${esc(n)}</td>${years.map((y) => `<td class="${cls(s.yearly?.[y])}">${pct(s.yearly?.[y], 0)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></section>
  <section class="sec"><h2>Độ tin cậy của sóng & mô hình giá</h2>
    <p class="muted">Đo trên ${ps.symbols ?? "—"} mã thanh khoản, ${ps.years ?? "—"} năm gần nhất: sau khi tín hiệu xuất hiện, ${ps.horizon_days ?? 20} phiên sau giá có đi đúng hướng (so với VN-Index) không. Chỉ những mô hình đúng ≥ 55% và có lợi thế dương mới được dùng.</p>
    <div class="tbl-wrap"><table><thead><tr><th class="l">Mô hình</th><th>Số lần</th><th>Tỷ lệ đúng</th><th>Vượt VN-Index TB</th><th class="l">Dùng chấm điểm?</th></tr></thead><tbody>
    ${Object.entries(ps.stats || {}).sort((x, y) => y[1].hit_rate - x[1].hit_rate).map(([k, v]) => `<tr><td class="l">${esc(k)}</td><td>${nf(v.n, 0)}</td><td>${nf(v.hit_rate, 1)}%</td><td class="${cls(v.avg_excess)}">${pct(v.avg_excess, 2)}</td><td class="l">${v.useful ? '<b class="up">Có</b>' : "Không – chỉ tham khảo"}</td></tr>`).join("")}
    </tbody></table></div></section>
  <section class="sec"><h2>Giới hạn cần biết</h2><ul>${b.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>`;
  const c = mkChart($("#btChart"), { rightPriceScale: { mode: 1, borderColor: css("--line") } });
  const add = (s, color, w = 2) => { const l = c.addLineSeries({ color, lineWidth: w, priceLineVisible: false }); l.setData(s.curve.map((p) => ({ time: p.d, value: p.v }))); };
  series.forEach(([, s, col]) => add(s, col, 3));
  bas.forEach(([, s], i) => add(s, palette[i % palette.length], 1));
  c.timeScale().fitContent();
}

// ================================================================ CHI TIẾT MÃ
async function viewStock(sym) {
  let d;
  try { d = await load(`data/stocks/${sym}.json`); }
  catch (e) {
    const rows = await screenerRows(); const r = rows.find((x) => x.symbol === sym);
    app().innerHTML = r ? `<h1>${sym}</h1><div class="panel"><p>${esc(r.name)} – thanh khoản quá thấp (${nf(r.avg_value_bn, 2)} tỷ/ngày) nên hệ thống không phân tích sâu.</p>
      <div class="kv"><div><dt>Giá</dt><dd>${nf(r.price)}</dd></div><div><dt>P/E</dt><dd>${nf(r.pe, 1)}</dd></div><div><dt>P/B</dt><dd>${nf(r.pb)}</dd></div><div><dt>ROE</dt><dd>${pct(r.roe, 1, false)}</dd></div></div></div>`
      : `<div class="empty">Không tìm thấy mã ${esc(sym)}.</div>`;
    return;
  }
  const r = d.row, v = d.valuation || {}, ta = d.ta, fa = d.fa || {};
  const o = d.ohlc;
  const last = o.c[o.c.length - 1], prev = o.c[o.c.length - 2];
  const chg = (last / prev - 1) * 100;
  const lv = d.levels;
  app().innerHTML = `
  <div class="stock-head">
    <div><h1>${sym} <small class="muted" style="font-size:.9rem;font-weight:400">${esc(d.exchange)} · ${esc(d.industry)}</small></h1><div class="muted">${esc(d.name)}</div></div>
    <div class="px">${nf(last)}</div><div class="${cls(chg)}" style="font-weight:600">${pct(chg, 2)}</div>
    <div style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${d.in_plan ? '<span class="pill buy">Trong danh sách MUA</span>' : ""}${(d.baskets || []).map((b) => `<span class="pill">${esc(BASKET_SHORT[b] || b)}</span>`).join("")}</div>
  </div>
  <div class="grid3" style="margin-top:14px">
    <div class="panel"><small class="muted">Định giá</small><h2>${esc(v.verdict || "Chưa định giá được")}</h2>
      ${v.ok ? `<p>Giá trị hợp lý <b>${nf(v.fair)}</b> (${nf(v.fair_lo)} – ${nf(v.fair_hi)})<br>Mua an toàn dưới <b>${nf(v.buy_below)}</b> · tiềm năng <b class="${cls(v.upside)}">${pct(v.upside)}</b></p>` : `<p class="muted">${esc(v.reason || "")}</p>`}
      ${v.warning ? `<p class="note">${esc(v.warning)}</p>` : ""}</div>
    <div class="panel"><small class="muted">Kỹ thuật</small><h2>${esc(ta.label)} <small class="muted">${ta.score}/100</small></h2>
      <div class="gauge"><i style="left:${ta.score}%"></i></div><p>${esc(ta.trend_vi)}${d.timing && !d.timing.ok ? `<br><span class="ref">${esc(d.timing.reason)}</span>` : ""}</p></div>
    <div class="panel"><small class="muted">Điểm tổng hợp</small><h2>${scoreCell(r.composite)} <small class="muted">F-Score ${r.fscore ?? "—"}/9</small></h2>
      ${lv ? `<p>Vùng mua ${nf(lv.zone[0])} – ${nf(lv.zone[1])} · cắt lỗ <b class="down">${nf(lv.stop)}</b><br>Mục tiêu <b class="up">${nf(lv.t1)}</b> / ${nf(lv.t2)} · lời/lỗ ${nf(lv.rr, 1)}x</p>` : ""}</div>
  </div>
  <div class="toolbar" id="tools"></div>
  <div class="chart" id="pChart"></div>
  <div class="chart xs" id="oChart" style="margin-top:6px"></div>
  <div class="subtabs" role="tablist">${[["ov", "Tổng quan"], ["ta", "Kỹ thuật"], ["wv", "Sóng & mô hình"], ["fa", "Cơ bản"], ["vl", "Dự phóng & định giá"], ["pe", "Cùng ngành"]]
    .map(([k, n], i) => `<button role="tab" data-t="${k}" class="${i === 0 ? "on" : ""}">${n}</button>`).join("")}</div>
  <div id="tab"></div>`;

  // ---- biểu đồ
  const { c, cs } = candleChart($("#pChart"), o);
  const C = o.c;
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
    overlays[k]().forEach(([vals, col]) => { const s = c.addLineSeries({ color: col, lineWidth: 1, priceLineVisible: false, lastValueVisible: false }); s.setData(ser(o.t, vals)); lines[k].push(s); });
  };
  const priceLines = [];
  const levelsOn = { on: true };
  const drawLevels = () => {
    priceLines.splice(0).forEach((p) => cs.removePriceLine(p));
    if (!levelsOn.on) return;
    if (v.ok && v.reliable && v.fair) priceLines.push(cs.createPriceLine({ price: v.fair, color: css("--up"), lineStyle: 2, title: "Giá trị hợp lý" }));
    if (v.ok && v.reliable && v.buy_below) priceLines.push(cs.createPriceLine({ price: v.buy_below, color: css("--brand"), lineStyle: 2, title: "Mua dưới" }));
    if (lv) priceLines.push(cs.createPriceLine({ price: lv.stop, color: css("--down"), lineStyle: 2, title: "Cắt lỗ" }));
    ((d.waves.levels || {}).support || []).slice(0, 2).forEach((z) => priceLines.push(cs.createPriceLine({ price: z.price, color: css("--ink-3"), lineStyle: 3, title: "Hỗ trợ" })));
    ((d.waves.levels || {}).resistance || []).slice(0, 2).forEach((z) => priceLines.push(cs.createPriceLine({ price: z.price, color: css("--ink-3"), lineStyle: 3, title: "Kháng cự" })));
  };
  const markers = () => {
    const el = d.waves.elliott;
    if (!el || !el.ok) return [];
    return el.main.points.filter((p) => p.date >= o.t[0]).map((p, i) => ({ time: p.date, position: i % 2 === (el.main.points[0].price < el.main.points[1]?.price ? 0 : 1) ? "belowBar" : "aboveBar",
      color: css("--ceil"), shape: "circle", text: p.label }));
  };
  const showEll = { on: false };
  $("#tools").innerHTML = Object.keys(overlays).map((k) => `<button class="chip ${active.has(k) ? "on" : ""}" data-ov="${k}">${k}</button>`).join("") +
    `<button class="chip on" data-lv="1">Mức giá</button><button class="chip" data-el="1">Sóng Elliott</button>
     <span style="margin-left:auto" class="seg" id="osc"><button class="on" data-o="rsi">RSI</button><button data-o="macd">MACD</button><button data-o="vol">KL</button></span>`;
  Object.keys(overlays).forEach(drawOv);
  drawLevels();
  $$("[data-ov]").forEach((b) => (b.onclick = () => { const k = b.dataset.ov; active.has(k) ? active.delete(k) : active.add(k); b.classList.toggle("on"); drawOv(k); }));
  $("[data-lv]").onclick = (e) => { levelsOn.on = !levelsOn.on; e.target.classList.toggle("on"); drawLevels(); };
  $("[data-el]").onclick = (e) => { showEll.on = !showEll.on; e.target.classList.toggle("on"); cs.setMarkers(showEll.on ? markers().sort((a, b) => (a.time < b.time ? -1 : 1)) : []); };
  c.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - 260), to: o.t.length + 3 });
  // dao động
  const oc = mkChart($("#oChart"), { timeScale: { visible: false } });
  let oser = [];
  const drawOsc = (k) => {
    oser.forEach((s) => oc.removeSeries(s)); oser = [];
    if (k === "rsi") { const s = oc.addLineSeries({ color: css("--ceil"), lineWidth: 1 }); s.setData(ser(o.t, IND.rsi(C))); s.createPriceLine({ price: 70, color: css("--down"), lineStyle: 2 }); s.createPriceLine({ price: 30, color: css("--up"), lineStyle: 2 }); oser.push(s); }
    if (k === "macd") { const m = IND.macd(C); const h = oc.addHistogramSeries({}); h.setData(o.t.map((t, i) => (m.hist[i] == null ? null : { time: t, value: m.hist[i], color: m.hist[i] >= 0 ? css("--up") : css("--down") })).filter(Boolean));
      const a = oc.addLineSeries({ color: css("--brand"), lineWidth: 1 }); a.setData(ser(o.t, m.line)); const b = oc.addLineSeries({ color: css("--ref"), lineWidth: 1 }); b.setData(ser(o.t, m.sig)); oser.push(h, a, b); }
    if (k === "vol") { const h = oc.addHistogramSeries({ priceFormat: { type: "volume" } }); h.setData(o.t.map((t, i) => ({ time: t, value: o.v[i], color: css("--ink-3") }))); const m = oc.addLineSeries({ color: css("--brand"), lineWidth: 1 }); m.setData(ser(o.t, IND.sma(o.v, 20))); oser.push(h, m); }
  };
  drawOsc("rsi");
  $$("#osc button").forEach((b) => (b.onclick = () => { $$("#osc button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); drawOsc(b.dataset.o); }));
  const sync = (src, dst) => src.timeScale().subscribeVisibleLogicalRangeChange((rg) => rg && dst.timeScale().setVisibleLogicalRange(rg));
  sync(c, oc);
  oc.timeScale().setVisibleLogicalRange({ from: Math.max(0, o.t.length - 260), to: o.t.length + 3 });

  // ---- các tab
  const tabs = { ov: tabOverview, ta: tabTech, wv: () => `<div class="panel">${wavesBlock(d.waves)}</div>${fibBlock(d.waves)}`, fa: tabFund, vl: tabVal, pe: tabPeers };
  const show = (k) => { $$(".subtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === k)); $("#tab").innerHTML = tabs[k](d); if (k === "vl") bindVal(d); };
  $$(".subtabs button").forEach((b) => (b.onclick = () => show(b.dataset.t)));
  show("ov");
}

function tabOverview(d) {
  const r = d.row, fa = d.fa || {}, sc = d.scores || {};
  const names = { piotroski: "Piotroski", magic_formula: "Magic Formula", value: "Giá trị", quality: "Chất lượng", growth: "Tăng trưởng", dividend: "Cổ tức", momentum: "Sức mạnh giá", canslim: "CANSLIM", low_vol: "Biến động thấp" };
  return `<div class="grid2">
    <div class="panel"><h2>Điểm theo từng phương pháp</h2>
      <div class="tbl-wrap" style="border:0"><table><tbody>${Object.entries(names).map(([k, n]) => `<tr><td class="l" style="font-weight:500">${n}</td><td style="width:60%"><span class="bar" style="width:${Math.round((sc[k] || 0) * 0.9)}%;background:${scoreColor(sc[k])}"></span>${isNum(sc[k]) ? Math.round(sc[k]) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="margin-top:6px">CANSLIM đạt: ${esc(sc.canslim_flags || "—")} · Sức mạnh giá (RS) ${sc.rs_rating ?? "—"}/100</p></div>
    <div class="panel"><h2>Chỉ số chính <small class="muted">${esc(fa.period || "")}</small></h2>
      <dl class="kv">${[["Vốn hoá", bn(fa.mcap_bn)], ["P/E", nf(fa.pe, 1)], ["P/B", nf(fa.pb)], ["EPS (đ)", nf(fa.eps, 0)], ["ROE", pct(fa.roe, 1, false)], ["ROA", pct(fa.roa, 1, false)],
        ["Biên LN gộp", pct(fa.gross_margin, 1, false)], ["Biên LN ròng", pct(fa.net_margin, 1, false)], ["Doanh thu 12T", pct(fa.rev_yoy)], ["LN 12T", pct(fa.ni_yoy)], ["LN quý gần nhất", pct(fa.ni_q_yoy)],
        ["Vay/Vốn chủ", nf(fa.de)], ["Cổ tức tiền mặt", pct(fa.dividend?.yield, 1, false)], ["Beta", nf(d.beta)], ["GTGD/ngày", bn(r.avg_value_bn)]]
        .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></div>
  </div>`;
}
function tabTech(d) {
  const ta = d.ta;
  const groups = Object.entries(ta.groups || {});
  return `<div class="grid3">${groups.map(([g, s]) => `<div class="panel"><small class="muted">${esc(g)}</small><h3>${esc(s.signal)} <small class="muted">${s.score}/100</small></h3>
      <p class="muted" style="font-size:.85rem">${s.buy} mua · ${s.neutral} trung tính · ${s.sell} bán</p></div>`).join("")}</div>
    <div class="tbl-wrap" style="margin-top:14px"><table><thead><tr><th class="l">Nhóm</th><th class="l">Chỉ báo</th><th>Giá trị</th><th class="l">Tín hiệu</th><th class="l">Diễn giải</th></tr></thead><tbody>
    ${ta.table.map((x) => `<tr><td class="l">${esc(x.group)}</td><td class="l">${esc(x.name)}</td><td>${esc(typeof x.value === "number" ? nf(x.value) : x.value ?? "—")}</td>
      <td class="l"><span class="pill ${x.signal === "Mua" ? "buy" : x.signal === "Bán" ? "sell" : ""}">${esc(x.signal)}</span></td><td class="l" style="white-space:normal;min-width:200px">${esc(x.note)}</td></tr>`).join("")}</tbody></table></div>
    <div class="grid2 sec"><div class="panel"><h3>Điểm xoay (pivot) cho phiên tới</h3><dl class="kv">${Object.entries(ta.pivots || {}).map(([k, v]) => `<div><dt>${k}</dt><dd>${nf(v)}</dd></div>`).join("")}</dl></div>
      <div class="panel"><h3>Khác</h3><dl class="kv"><div><dt>ATR</dt><dd>${nf(ta.atr)} (${nf(ta.atr_pct, 1)}%)</dd></div><div><dt>Đỉnh / đáy 52 tuần</dt><dd>${nf(ta.hi52)} / ${nf(ta.lo52)}</dd></div>
      <div><dt>Cách đỉnh 52 tuần</dt><dd>${pct(ta.from_hi52_pct)}</dd></div><div><dt>Phân kỳ RSI</dt><dd>${ta.divergence?.rsi === "bullish" ? "Tăng" : ta.divergence?.rsi === "bearish" ? "Giảm" : "Không"}</dd></div>
      <div><dt>Phân kỳ MACD</dt><dd>${ta.divergence?.macd === "bullish" ? "Tăng" : ta.divergence?.macd === "bearish" ? "Giảm" : "Không"}</dd></div></dl></div></div>`;
}
function fibBlock(w) {
  const f = w.fib || {}, lv = w.levels || {};
  if (!f.swing) return "";
  return `<div class="grid2 sec"><div class="panel"><h3>Fibonacci (nhịp ${esc(f.swing.direction)} ${nf(f.swing.low)} – ${nf(f.swing.high)})</h3>
    <dl class="kv">${Object.entries(f.retracement).map(([k, v]) => `<div><dt>Thoái lui ${(Number(k) * 100).toFixed(1)}%</dt><dd>${nf(v)}</dd></div>`).join("")}
    ${Object.entries(f.extension).map(([k, v]) => `<div><dt>Mở rộng ${(Number(k) * 100).toFixed(1)}%</dt><dd>${nf(v)}</dd></div>`).join("")}</dl></div>
    <div class="panel"><h3>Hỗ trợ & kháng cự</h3><dl class="kv">${(lv.resistance || []).map((z) => `<div><dt>Kháng cự (${z.touches} lần chạm)</dt><dd>${nf(z.price)}</dd></div>`).join("")}
    ${(lv.support || []).map((z) => `<div><dt>Hỗ trợ (${z.touches} lần chạm)</dt><dd>${nf(z.price)}</dd></div>`).join("")}</dl></div></div>`;
}
function barsSvg(rows, keys, colors, labels) {
  if (!rows.length) return `<p class="muted">Chưa có số liệu.</p>`;
  const W = 640, H = 200, pad = 30, n = rows.length, gw = (W - pad) / n, bw = Math.max(3, (gw - 6) / keys.length);
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
function tabFund(d) {
  const fa = d.fa || {};
  if (!fa.ok) return `<div class="empty">${esc(fa.reason || "Chưa có báo cáo tài chính.")}</div>`;
  const h = d.history || {};
  const isBank = fa.ctype !== "CT";
  const dv = fa.dividend || {};
  return `<div class="grid2">
    <div class="panel"><h3>Kết quả kinh doanh theo quý (tỷ đồng)</h3>${barsSvg(h.quarterly || [], isBank ? ["toi", "ni_parent"] : ["revenue", "ni_parent"], [css("--brand"), css("--up")], isBank ? ["Tổng thu nhập HĐ", "LN cổ đông mẹ"] : ["Doanh thu", "LN cổ đông mẹ"])}</div>
    <div class="panel"><h3>Theo năm (tỷ đồng)</h3>${barsSvg(h.annual || [], isBank ? ["toi", "ni_parent"] : ["revenue", "ni_parent"], [css("--brand"), css("--up")], isBank ? ["Tổng thu nhập HĐ", "LN cổ đông mẹ"] : ["Doanh thu", "LN cổ đông mẹ"])}</div>
    <div class="panel"><h3>Dòng tiền theo năm (tỷ đồng)</h3>${barsSvg(h.annual || [], ["cfo", "capex", "fcf"], [css("--floor"), css("--down"), css("--up")], ["Dòng tiền KD", "Đầu tư TSCĐ", "Dòng tiền tự do"])}</div>
    <div class="panel"><h3>Piotroski F-Score: ${fa.fscore ?? "—"}/9</h3><ul class="checks">${(fa.fscore_tests || []).map((t) => `<li class="${t.ok ? "ok" : ""}">${esc(t.name)}</li>`).join("")}</ul></div>
  </div>
  <div class="panel sec"><h3>Sức khoẻ & hiệu quả</h3><dl class="kv">${[["ROE TB 5 năm", pct(fa.roe_avg5, 1, false)], ["Độ lệch ROE 5 năm", nf(fa.roe_std5, 1)], ["Số năm lỗ", fa.loss_years], ["ROIC", pct(fa.roic, 1, false)],
    ["CFO / Lợi nhuận", nf(fa.cfo_ni)], ["Dòng tiền tự do 12T", bn(fa.fcf_ttm)], ["Thanh toán hiện hành", nf(fa.current_ratio)], ["Khả năng trả lãi", fa.interest_cover ? nf(fa.interest_cover, 1) + "x" : "—"],
    ["Nợ vay ròng/EBITDA", nf(fa.net_debt_ebitda)], ["Doanh thu CAGR 3 năm", pct(fa.rev_cagr3)], ["LN CAGR 3 năm", pct(fa.ni_cagr3)], ["Số quý LN tăng liên tiếp", fa.ni_growth_streak],
    ...(isBank ? [["NIM", pct(fa.nim, 2, false)], ["Nợ xấu", pct(fa.npl, 2, false)], ["Cho vay KH", bn(fa.loans_bn)], ["Tiền gửi KH", bn(fa.deposits_bn)]] : [])]
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v ?? "—"}</dd></div>`).join("")}</dl></div>
  <div class="panel sec"><h3>Cổ tức</h3>${dv.has_data ? `<dl class="kv">${[["Tiền mặt 12 tháng", vnd(dv.dps_ttm)], ["Tỷ suất hiện tại", pct(dv.yield, 2, false)], ["Tỷ suất TB 3 năm", pct(dv.yield_avg3, 2, false)],
      ["Số năm trả tiền liên tiếp", dv.cash_years], ["Tỷ lệ chi trả", pct(dv.payout, 0, false)], ["Cổ tức cổ phiếu 3 năm", pct(dv.stock_dividend_3y, 0, false)], ["Lần chốt quyền gần nhất", esc(dv.last_ex_date || "—")]]
      .map(([k, v]) => `<div><dt>${k}</dt><dd>${v ?? "—"}</dd></div>`).join("")}</dl>
      <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th class="l">Năm</th><th>Tiền mặt (đ/cp)</th><th>Cổ phiếu (%)</th></tr></thead><tbody>${dv.history.map((x) => `<tr><td class="l">${x.year}</td><td>${nf(x.cash_dps, 0)}</td><td>${nf(x.stock_pct, 0)}</td></tr>`).join("")}</tbody></table></div>
      <p class="muted" style="margin-top:6px">Cổ tức tiền mặt chịu thuế TNCN 5%. Cổ tức bằng cổ phiếu không phải tiền về tài khoản.</p>` : `<p class="muted">Chưa có lịch sử cổ tức.</p>`}</div>`;
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
  return `<div class="panel"><h2>Giả định dự phóng <small class="muted">sửa số – kết quả tính lại ngay</small></h2>
    ${v.model.overridden?.length ? `<p class="note">Đang dùng giả định anh đã sửa: ${esc(v.model.overridden.join(", "))}</p>` : ""}
    <div class="assump" style="margin-top:10px">${A_FIELDS.filter(([k]) => a[k] !== undefined && a[k] !== null).map(([k, n]) => `
      <div class="field"><label for="as_${k}">${n} (%)</label><input id="as_${k}" data-a="${k}" inputmode="decimal" value="${(a[k] * 100).toFixed(1)}"></div>`).join("")}
      <div class="field"><label for="as_ke">Chi phí vốn chủ ke (%)</label><input id="as_ke" inputmode="decimal" value="${nf(v.ke, 2).replace(",", ".")}"></div></div>
    <p style="margin-top:10px"><button class="btn primary" id="aSave">Lưu giả định cho ${d.symbol}</button> <button class="btn" id="aReset">Về mặc định</button>
    <small class="muted">Lưu rồi thì lần chạy kế tiếp hệ thống dùng giả định của anh khi ra tín hiệu.</small></p></div>
    <div class="panel sec"><h2>Giá trị hợp lý</h2><div id="vOut"></div></div>
    <div class="panel sec"><h2>Bảng dự phóng (kịch bản cơ sở)</h2><div id="pOut"></div>
      <p class="muted" style="margin-top:8px">Mô hình: doanh thu tăng theo giả định, giảm dần về mức dài hạn; biên lợi nhuận và chi phí theo tỷ lệ doanh thu; lợi nhuận khác giảm dần 20%/năm.
      Ngân hàng/CTCK/bảo hiểm dự phóng thẳng lợi nhuận. Kịch bản Xấu/Tốt điều chỉnh tăng trưởng và biên lợi nhuận.</p></div>`;
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
      <p style="font-size:1.1rem">Giá trị hợp lý <b>${nf(fair)}</b> · mua an toàn dưới <b>${nf(buy)}</b> (biên an toàn ${d.mos}%) · giá hiện tại ${nf(price)} → tiềm năng <b class="${cls(up)}">${pct(up)}</b></p>
      <div class="vrange" aria-hidden="true"><div class="track"></div>
        <div class="zone" style="left:${X(lo)}%;width:${X(hi) - X(lo)}%;background:color-mix(in srgb,var(--up) 35%,transparent)"></div>
        <div class="zone" style="left:${X(L)}%;width:${Math.max(0, X(buy) - X(L))}%;background:color-mix(in srgb,var(--brand) 25%,transparent)"></div>
        <div class="mk" style="left:${X(price)}%;color:var(--ink)">Giá ${nf(price)}</div>
        <div class="mk" style="left:${X(fair)}%;color:var(--up);top:34px">Hợp lý ${nf(fair)}</div></div>
      <div class="leg"><span><i style="background:color-mix(in srgb,var(--brand) 25%,transparent)"></i>Vùng mua an toàn</span><span><i style="background:color-mix(in srgb,var(--up) 35%,transparent)"></i>Vùng giá trị hợp lý (Xấu → Tốt)</span></div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th class="l">Phương pháp</th><th>Giá trị</th><th>Xấu</th><th>Tốt</th><th>Trọng số</th></tr></thead><tbody>
      ${ms.map((m) => `<tr style="${m.used ? "" : "opacity:.5"}"><td class="l" style="white-space:normal">${esc(m.name)}${m.used ? "" : " <small>(lệch xa, bỏ qua)</small>"}</td><td><b>${nf(m.value)}</b></td><td>${nf(m.lo)}</td><td>${nf(m.hi)}</td><td>${nf(m.w * 100, 0)}%</td></tr>`).join("")}
      </tbody></table></div>
      <p class="muted" style="margin-top:6px">Chi phí vốn chủ ke = lãi suất phi rủi ro + beta ${nf(v.beta)} × phần bù rủi ro. Giá trị tính theo nghìn đồng/cổ phiếu.</p>`;
    const rows = res.base.rows;
    const yr0 = new Date().getFullYear();
    const lines = base.model === "CT" ? [["Doanh thu", "revenue", 0], ["LN gộp", "gross_profit", 0], ["LN trước thuế", "pbt", 0], ["LN cổ đông mẹ", "ni", 0], ["EPS (đ)", "eps", 0], ["Cổ tức (đ)", "dps", 0], ["Dòng tiền tự do", "fcfe", 0], ["Tăng trưởng", "g", "p"], ["ROE", "roe", "p"]]
      : [["LN cổ đông mẹ", "ni", 0], ["EPS (đ)", "eps", 0], ["Cổ tức (đ)", "dps", 0], ["BVPS (đ)", "bvps", 0], ["Tăng trưởng LN", "g", "p"], ["ROE", "roe", "p"]];
    $("#pOut").innerHTML = `<div class="tbl-wrap"><table><thead><tr><th class="l">Tỷ đồng</th>${rows.map((r) => `<th>${yr0 + r.year_offset - 1}F</th>`).join("")}</tr></thead><tbody>
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
  const p = d.peers;
  const name = { symbol: "Mã", price: "Giá", mcap_bn: "Vốn hoá", pe: "P/E", pb: "P/B", roe: "ROE", ni_yoy: "LN 12T", rev_yoy: "DT 12T", de: "Vay/Vốn", fscore: "F-Score", div_yield: "Cổ tức", upside: "Tiềm năng", composite: "Điểm" };
  const f = (k, x) => k === "symbol" ? `<a href="#/s/${x}">${x}</a>` : k === "mcap_bn" ? nf(x, 0) : ["roe", "div_yield"].includes(k) ? (isNum(x) ? nf(x, 1) + "%" : "—") : ["ni_yoy", "rev_yoy", "upside"].includes(k) ? `<span class="${cls(x)}">${pct(x)}</span>` : k === "composite" ? scoreCell(x) : k === "fscore" ? (x ?? "—") : nf(x);
  const pctl = p.pctl || {};
  const lbl = { pe: "P/E (thấp là tốt)", pb: "P/B (thấp là tốt)", roe: "ROE", roa: "ROA", net_margin: "Biên LN ròng", gross_margin: "Biên LN gộp", rev_yoy: "Tăng trưởng DT", ni_yoy: "Tăng trưởng LN", de: "Vay/Vốn (thấp là tốt)", fscore: "F-Score", div_yield: "Cổ tức", mcap_bn: "Quy mô" };
  return `<div class="panel"><h2>${esc(d.symbol)} đứng thứ mấy trong ${p.n ?? "—"} mã ngành ${esc(d.industry)}</h2><p class="muted">100 = tốt nhất ngành. Trung vị ngành ghi bên cạnh.</p>
    <div class="tbl-wrap" style="border:0"><table><tbody>${Object.entries(lbl).map(([k, n]) => `<tr><td class="l" style="font-weight:500">${n}</td><td style="width:55%"><span class="bar" style="width:${Math.round((pctl[k] || 0) * 0.85)}%;background:${scoreColor(pctl[k])}"></span>${isNum(pctl[k]) ? Math.round(pctl[k]) : "—"}</td><td class="muted">TV ngành ${nf(p.median?.[k], 1)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="tbl-wrap sec"><table><thead><tr>${p.cols.map((c) => `<th class="${c === "symbol" ? "l" : ""}">${name[c] || c}</th>`).join("")}</tr></thead><tbody>
    ${p.rows.map((r) => `<tr style="${r[0] === d.symbol ? "font-weight:700" : ""}">${r.map((x, i) => `<td>${f(p.cols[i], x)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ================================================================ HƯỚNG DẪN
async function viewGuide() {
  const m = await load("data/methods.json");
  app().innerHTML = `<h1>Hệ thống chọn mã thế nào?</h1>
  <div class="panel" style="max-width:820px"><h2>Quy trình mỗi ngày</h2><ol>
    <li>15h35 các ngày giao dịch: tải giá toàn bộ HOSE, HNX, UPCOM. Thứ Bảy tải lại báo cáo tài chính và cổ tức.</li>
    <li>Đèn thị trường quyết định được nắm tối đa bao nhiêu % cổ phiếu (Xanh 100%, Vàng 60%, Đỏ 30%).</li>
    <li>Mỗi mã được phân tích cơ bản, dự phóng 5 năm, định giá đa phương pháp và chấm điểm 9 phương pháp.</li>
    <li>Mã đạt điều kiện từng rổ được xếp hạng; rổ nào được phân bổ bao nhiêu vốn theo config.yaml.</li>
    <li>Hàng rào kỹ thuật: không mua mã đang trong xu hướng giảm; chỉ mua khi giá nằm trong vùng an toàn.</li>
    <li>Mỗi lệnh có điểm cắt lỗ, mục tiêu và tỷ trọng sao cho nếu sai chỉ mất khoảng ${esc(String((await load("data/today.json")).risk?.risk_per_trade ?? 1.5))}% tổng vốn.</li>
    <li>Danh mục đang nắm được kiểm tra: chạm cắt lỗ, định giá đã đắt, hay luận điểm cơ bản gãy thì báo bán qua Telegram.</li></ol></div>
  <section class="sec"><h2>9 phương pháp chấm điểm</h2><div class="grid2">${Object.values(m.methods).map((x) => `<div class="panel"><h3>${esc(x.name)}</h3><p>${esc(x.desc)}</p></div>`).join("")}</div></section>
  <section class="sec"><h2>5 rổ</h2><div class="grid2">${Object.entries(m.baskets).map(([k, b]) => `<div class="panel"><h3>${esc(b.name)}</h3><p class="muted">Rủi ro: ${esc(b.risk)}</p><p>${esc(b.rule)}</p><p><a href="#/screener/${k}">Xem các mã trong rổ</a></p></div>`).join("")}</div></section>
  <section class="sec"><h2>Sóng & mô hình giá</h2><div class="panel" style="max-width:820px"><p>Elliott, Wyckoff, Dow, mô hình giá kinh điển và Harmonic được nhận diện tự động.
    Vì đây là các phương pháp có tính chủ quan cao, hệ thống đo tỷ lệ đúng của từng mô hình trên chính dữ liệu Việt Nam (tab Kiểm chứng) và chỉ để mô hình nào có lợi thế thật tham gia chấm điểm.</p></div></section>`;
}

// ================================================================ khởi động
function initTheme() {
  const saved = (() => { try { return localStorage.getItem("vnstock_theme"); } catch (e) { return null; } })();
  if (saved) document.documentElement.dataset.theme = saved;
  $("#theme").onclick = () => {
    const dark = document.documentElement.dataset.theme ? document.documentElement.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "light" : "dark";
    try { localStorage.setItem("vnstock_theme", document.documentElement.dataset.theme); } catch (e) { /* bỏ qua */ }
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
    box.innerHTML = list.map((r, i) => `<a href="#/s/${r.symbol}" class="${i === 0 ? "on" : ""}"><b>${r.symbol}</b><span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.name || "")}</span><span style="margin-left:auto">${nf(r.price)}</span></a>`).join("") || `<div class="muted" style="padding:10px">Không thấy mã</div>`;
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
    const t = await load("data/today.json");
    const col = { green: "#2FD08F", yellow: "#F4C32F", red: "#F0444B" }[t.regime.light];
    $("#brandDot").style.background = col;
  } catch (e) { /* chưa có dữ liệu */ }
  window.addEventListener("hashchange", route);
  route();
})();
