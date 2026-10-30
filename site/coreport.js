/* Hồ sơ doanh nghiệp – tab "Hồ sơ" của trang từng mã (tải khi mở tab). Dữ liệu: d.co (app/analysis/coreport.py), d.fa, d.charts.
   Mọi biểu đồ vẽ bằng SVG đúng kích thước khung (chữ không bị co nhỏ trên điện thoại), vẽ lại khi đổi kích thước. */
(function () {
  "use strict";
  const AX = [["val", "Định giá"], ["fut", "Tương lai"], ["past", "Quá khứ"], ["hlth", "Sức khoẻ"], ["div", "Cổ tức"]];
  const SEC = [["co-s0", "Tổng quan"], ["co-s1", "1 Định giá"], ["co-s2", "2 Tăng trưởng tương lai"], ["co-s3", "3 Kết quả quá khứ"], ["co-s4", "4 Sức khoẻ tài chính"],
    ["co-s5", "5 Cổ tức"], ["co-s6", "6 Ban lãnh đạo"], ["co-s7", "7 Cổ đông"], ["co-s8", "8 Thông tin công ty"]];
  const C = (v) => css(v) || "#888";
  const col = () => ({ brand: C("--brand"), up: C("--up"), down: C("--down"), ref: C("--ref"), ink: C("--ink"), ink2: C("--ink-2"), ink3: C("--ink-3"), line: C("--line"), line2: C("--line-2"), floor: C("--floor"), ceil: C("--ceil"), sunk: C("--sunk"), surf: C("--surface") });
  const tyS = (x) => (!isNum(x) ? "—" : Math.abs(x) >= 1000 ? `${nf(x / 1000, 2)} nghìn tỷ` : `${nf(x, 0)} tỷ`);
  const tyA = (x) => (!isNum(x) ? "—" : Math.abs(x) >= 1000 ? `${nf(x / 1000, 1)}k tỷ` : `${nf(x, 0)} tỷ`);
  const shS = (x) => (!isNum(x) ? "—" : Math.abs(x) >= 1e6 ? `${nf(x / 1e6, 2)} tr` : nf(x, 0));
  const pp = (x, d = 1) => (isNum(x) ? `${nf(x, d)}%` : "—");
  const sc = (n, max = 6) => { const t = Math.max(0, Math.min(1, n / max)); return t >= 0.67 ? C("--up") : t >= 0.34 ? C("--ref") : C("--down"); };
  const esc2 = (s) => esc(String(s ?? ""));

  // ---------------------------------------------------------------- tiêu chí
  const icon = (ok) => (ok === true ? '<i class="co-ok" title="Đạt">✓</i>' : ok === false ? '<i class="co-no" title="Không đạt">✕</i>' : '<i class="co-na" title="Chưa đủ số liệu">·</i>');
  function checks(list, label) {
    if (!list?.length) return "";
    const n = list.filter((c) => c.ok).length;
    return `<details class="co-chk"><summary><b>${label} ${n}/${list.length}</b><span class="co-icons">${list.map((c) => icon(c.ok)).join("")}</span><small class="faint">bấm để xem từng tiêu chí</small></summary>
      <ul>${list.map((c) => `<li>${icon(c.ok)}<div><b class="${c.ok === true ? "up" : c.ok === false ? "down" : "faint"}">${esc2(c.n)}</b><small>${esc2(c.w)}</small></div></li>`).join("")}</ul></details>`;
  }
  const verdictLine = (list) => list?.filter((c) => c.ok !== null).slice(0, 3).map((c) => `<li>${icon(c.ok)} <span>${esc2(c.n)}: ${esc2(c.w)}</span></li>`).join("") || "";
  const kv = (rows) => `<dl class="co-kv">${rows.filter(Boolean).map(([k, v, cl, tip]) => `<div${tip ? ` title="${esc2(tip)}"` : ""}><dt>${k}</dt><dd class="${cl || ""}">${v}</dd></div>`).join("")}</dl>`;
  const big = (items) => `<div class="co-big">${items.filter(Boolean).map(([v, k, cl]) => `<div><b class="${cl || ""}">${v}</b><small>${k}</small></div>`).join("")}</div>`;
  const chart = (key, h, extra = "") => `<div class="co-ch" data-ch="${key}" style="height:${h}px"${extra}></div>`;
  const sec = (id, title, body, sub = "") => `<section class="panel co-sec no-clamp" id="${id}"><div class="co-h"><h2>${title}</h2>${sub ? `<span class="meta">${sub}</span>` : ""}</div>${body}</section>`;
  const sub = (t, body, note = "") => `<div class="co-sub"><h3>${t}</h3>${note ? `<p class="faint co-note">${note}</p>` : ""}${body}</div>`;

  // ---------------------------------------------------------------- SVG cơ bản
  const svgO = (w, h, inner) => `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img">${inner}</svg>`;
  const T = (x, y, s, o = {}) => `<text x="${x}" y="${y}" font-size="${o.fs || 11}" fill="${o.c || col().ink2}" text-anchor="${o.a || "start"}"${o.w ? ` font-weight="${o.w}"` : ""}${o.b ? ` dominant-baseline="${o.b}"` : ""}>${esc2(s)}</text>`;
  const nice = (mx) => { if (!(mx > 0)) return 1; const p = 10 ** Math.floor(Math.log10(mx)), f = mx / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };

  // thanh ngang so sánh: [[nhãn, giá trị, màu, chú thích]]
  function hbars(w, rows, fmt = (v) => pp(v)) {
    const h = rows.length * 34 + 6, vals = rows.map((r) => r[1]).filter(isNum), mn = Math.min(0, ...vals), mx = Math.max(0, ...vals), lw = Math.min(150, w * 0.36), W = w - lw - 70;
    const X = (v) => lw + ((v - mn) / ((mx - mn) || 1)) * W, x0 = X(0);
    let s = `<line x1="${x0}" x2="${x0}" y1="0" y2="${h}" stroke="${col().line}"/>`;
    rows.forEach(([lab, v, c, note], i) => {
      const y = 6 + i * 34;
      s += T(lw - 8, y + 13, lab, { a: "end", fs: 12, c: col().ink });
      if (note) s += T(lw - 8, y + 26, note, { a: "end", fs: 10, c: col().ink3 });
      if (isNum(v)) { const a = Math.min(X(v), x0), b = Math.max(X(v), x0); s += `<rect x="${a}" y="${y + 3}" width="${Math.max(2, b - a)}" height="18" rx="3" fill="${c}"/>` + T(v >= 0 ? b + 6 : a - 6, y + 16, fmt(v), { a: v >= 0 ? "start" : "end", fs: 12, w: 600, c: col().ink }); }
      else s += T(x0 + 6, y + 16, "chưa có", { fs: 11, c: col().ink3 });
    });
    return svgO(w, h, s);
  }
  // cột đứng so sánh (công ty / ngành / thị trường)
  function vbars(w, h, rows, fmt = (v) => pp(v)) {
    const vals = rows.map((r) => r[1]).filter(isNum), mx = Math.max(0, ...vals), mn = Math.min(0, ...vals), top = 26, bot = 34, H = h - top - bot;
    const Y = (v) => top + ((mx - v) / ((mx - mn) || 1)) * H, bw = Math.min(90, (w - 20) / rows.length - 14);
    let s = `<line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="${col().line}"/>`;
    rows.forEach(([lab, v, c], i) => {
      const cx = 10 + (i + 0.5) * ((w - 20) / rows.length);
      if (isNum(v)) { const a = Math.min(Y(v), Y(0)), b = Math.max(Y(v), Y(0)); s += `<rect x="${cx - bw / 2}" y="${a}" width="${bw}" height="${Math.max(2, b - a)}" rx="3" fill="${c}"/>` + T(cx, a - 7, fmt(v), { a: "middle", fs: 13, w: 700, c: col().ink }); }
      else s += T(cx, Y(0) - 7, "—", { a: "middle", c: col().ink3 });
      const sw = (w - 20) / rows.length, ws = String(lab).split(" ");
      if (String(lab).length * 6.2 > sw - 4 && ws.length > 1) { const k = Math.ceil(ws.length / 2); [ws.slice(0, k).join(" "), ws.slice(k).join(" ")].forEach((ln, j) => (s += T(cx, h - 22 + j * 12, ln, { a: "middle", fs: 10.5, c: col().ink2 }))); }
      else s += T(cx, h - 18, lab, { a: "middle", fs: 11, c: col().ink2 });
    });
    return svgO(w, h, s);
  }
  // đường / vùng theo thời gian + chú giải bật tắt + rê chuột hiện số
  function lines(el, w, h, xs, series, opt = {}) {
    const on = series.filter((s) => !s.off && s.v.some(isNum));
    const all = on.flatMap((s) => s.v.filter(isNum)), mx0 = Math.max(0, ...all), mn0 = Math.min(0, ...all);
    const mx = nice(mx0), mn = mn0 < 0 ? -nice(-mn0) : 0, L = 54, R = 10, top = 10, bot = 24, W = w - L - R, H = h - top - bot, n = xs.length;
    const X = (i) => L + (n <= 1 ? W / 2 : (i / (n - 1)) * W), Y = (v) => top + ((mx - v) / ((mx - mn) || 1)) * H;
    let s = "";
    for (let k = 0; k <= 4; k++) { const v = mn + ((mx - mn) * k) / 4, y = Y(v); s += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="${col().line2}"/>` + T(L - 6, y + 4, opt.fy ? opt.fy(v) : tyA(v), { a: "end", fs: 10, c: col().ink3 }); }
    if (mn < 0) s += `<line x1="${L}" x2="${w - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="${col().ink3}" stroke-dasharray="3 3"/>`;
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(W / 64))));
    xs.forEach((x, i) => { if ((i % step === 0 && n - 1 - i >= step / 2) || i === n - 1) s += T(X(i), h - 6, x, { a: i === n - 1 ? "end" : i === 0 ? "start" : "middle", fs: 10, c: col().ink3 }); });
    if (opt.fc != null && opt.fc < n) s += `<rect x="${X(opt.fc) - (W / Math.max(1, n - 1)) / 2}" y="${top}" width="${w - R - X(opt.fc) + (W / Math.max(1, n - 1)) / 2}" height="${H}" fill="${col().ref}" fill-opacity=".08"/>` + T(X(opt.fc) + 4, top + 12, "dự phóng", { fs: 10, c: col().ref });
    on.forEach((S) => {
      let d = "", started = false;
      S.v.forEach((v, i) => { if (!isNum(v)) { started = false; return; } d += `${started ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`; started = true; });
      if (S.area && d) { const f = S.v.findIndex(isNum), l = S.v.length - 1 - [...S.v].reverse().findIndex(isNum); s += `<path d="${d}L${X(l)},${Y(Math.max(mn, 0))}L${X(f)},${Y(Math.max(mn, 0))}Z" fill="${S.c}" fill-opacity=".12"/>`; }
      s += `<path d="${d}" fill="none" stroke="${S.c}" stroke-width="${S.bw || 2}"${S.dash ? ` stroke-dasharray="${S.dash}"` : ""}/>`;
    });
    s += `<line class="co-hx" x1="0" x2="0" y1="${top}" y2="${top + H}" stroke="${col().ink3}" stroke-dasharray="2 3" opacity="0"/>`;
    el.innerHTML = svgO(w, h, s) + `<div class="co-tip" hidden></div>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".co-tip"), hx = el.querySelector(".co-hx");
    svg.onmousemove = svg.ontouchstart = (e) => {
      const p = e.touches ? e.touches[0] : e, R0 = svg.getBoundingClientRect(), x = p.clientX - R0.left, i = Math.max(0, Math.min(n - 1, Math.round(((x - L) / W) * (n - 1))));
      hx.setAttribute("x1", X(i)); hx.setAttribute("x2", X(i)); hx.setAttribute("opacity", 1);
      tip.hidden = false; tip.innerHTML = `<b>${esc2(xs[i])}${opt.fc != null && i >= opt.fc ? " · dự phóng" : ""}</b>` + on.map((S) => `<span><i style="background:${S.c}"></i>${esc2(S.n)}<em>${isNum(S.v[i]) ? (S.fmt || tyS)(S.v[i]) : "—"}</em></span>`).join("") + (opt.extra ? opt.extra(i) : "");
      tip.style.left = Math.min(Math.max(0, X(i) + 12), w - tip.offsetWidth - 4) + "px";
    };
    svg.onmouseleave = () => { tip.hidden = true; hx.setAttribute("opacity", 0); };
  }
  const legend = (key, series) => `<div class="co-lg" data-lg="${key}">${series.map((s, i) => `<button type="button" data-i="${i}" class="${s.off ? "" : "on"}" style="--c:${s.c}"><i></i>${esc2(s.n)}</button>`).join("")}</div>`;

  // ---------------------------------------------------------------- radar 5 trục
  function radar(w, h, S) {
    const cx = w / 2, cy = h / 2 + 6, R = Math.min(w, h) / 2 - 34, n = AX.length, ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const P = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];
    let s = "";
    for (const k of [2, 4, 6]) s += `<polygon points="${AX.map((_, i) => P(i, (R * k) / 6).join(",")).join(" ")}" fill="none" stroke="${col().line}"/>`;
    AX.forEach(([key, lab], i) => { const [x, y] = P(i, R), [lx, ly] = P(i, R + 16); s += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${col().line}"/>` + T(lx, ly + 4, `${lab} ${S[key] ?? 0}/6`, { a: Math.abs(lx - cx) < 5 ? "middle" : lx > cx ? "start" : "end", fs: 11, w: 600, c: col().ink2 }); });
    const tot = AX.reduce((a, [k]) => a + (S[k] || 0), 0), c = sc(tot, 30);
    s += `<polygon points="${AX.map(([k], i) => P(i, (R * Math.max(0.35, S[k] || 0)) / 6).join(",")).join(" ")}" fill="${c}" fill-opacity=".35" stroke="${c}" stroke-width="2"/>`;
    return svgO(w, h, s);
  }

  // ---------------------------------------------------------------- dòng doanh thu → chi phí → lợi nhuận
  function sankey(w, h, r, bank) {
    if (!r) return `<p class="muted">Chưa có số liệu.</p>`;
    const K = col(), nodes = {}, links = [];
    const N = (id, lab, v, c, x) => (nodes[id] = { id, lab, v: Math.max(0, v || 0), c, x });
    const Lk = (a, b, v, c) => { if (v > 0) links.push({ a, b, v, c }); };
    if (bank) {
      const toi = r.rev || 0, prov = Math.max(0, r.prov || 0), pbt = Math.max(0, r.pbt || 0), opx = Math.max(0, toi - prov - pbt), tax = Math.max(0, r.tax || 0), ni = Math.max(0, (r.ni || 0));
      N("rev", "Thu nhập hoạt động", toi, K.brand, 0); N("opx", "Chi phí hoạt động", opx, K.ref, 1); N("prov", "Dự phòng rủi ro", prov, K.down, 1); N("pbt", "LN trước thuế", pbt, K.up, 1);
      N("tax", "Thuế", tax, K.ref, 2); N("ni", "Lợi nhuận", ni, K.up, 2);
      Lk("rev", "opx", opx, K.ref); Lk("rev", "prov", prov, K.down); Lk("rev", "pbt", pbt, K.up); Lk("pbt", "tax", tax, K.ref); Lk("pbt", "ni", Math.min(ni, pbt - tax), K.up);
    } else {
      const rev = r.rev || 0, cogs = Math.max(0, r.cogs || 0), gp = Math.max(0, r.gp || 0), fin = (r.fin_in || 0) - (r.fin_ex || 0), oth = r.oth || 0;
      const jv = r.jv || 0, jvP = Math.max(0, jv), jvN = Math.max(0, -jv);
      const sell = Math.max(0, r.sell || 0), adm = Math.max(0, r.adm || 0), finN = Math.max(0, -fin), othN = Math.max(0, -oth), finP = Math.max(0, fin), othP = Math.max(0, oth);
      const exp = sell + adm + finN + othN + jvN, pbt = Math.max(0, gp + finP + othP + jvP - exp), tax = Math.max(0, r.tax || 0), mi = Math.max(0, r.mi || 0), ni = Math.max(0, pbt - tax - mi);
      N("rev", "Doanh thu", rev, K.brand, 0); N("cogs", "Giá vốn", cogs, K.ref, 1); N("gp", "LN gộp", gp, K.up, 1);
      if (finP) N("finP", "Lãi tài chính ròng", finP, K.floor, 1); if (othP) N("othP", "Thu nhập khác", othP, K.floor, 1); if (jvP) N("jvP", "Lãi liên doanh, liên kết", jvP, K.floor, 1);
      N("exp", "Chi phí", exp, K.ref, 2); N("pbt", "LN trước thuế", pbt, K.up, 2);
      N("sell", "Bán hàng", sell, K.ref, 3); N("adm", "Quản lý DN", adm, K.ref, 3); if (finN) N("finN", "Chi phí tài chính ròng", finN, K.ref, 3); if (othN) N("othN", "Chi phí khác", othN, K.ref, 3); if (jvN) N("jvN", "Lỗ liên doanh, liên kết", jvN, K.ref, 3);
      N("tax", "Thuế TNDN", tax, K.ref, 3); if (mi) N("mi", "CĐ thiểu số", mi, K.ink3, 3); N("ni", "LN cổ đông mẹ", ni, K.up, 3);
      Lk("rev", "cogs", cogs, K.ref); Lk("rev", "gp", gp, K.up);
      const gpE = Math.min(gp, exp), gpP = gp - gpE; Lk("gp", "exp", gpE, K.ref); Lk("gp", "pbt", gpP, K.up);
      if (finP) { const a = Math.min(finP, Math.max(0, exp - gpE)); Lk("finP", "exp", a, K.ref); Lk("finP", "pbt", finP - a, K.floor); }
      if (othP) { const used = links.filter((l) => l.b === "exp").reduce((a, l) => a + l.v, 0), a = Math.min(othP, Math.max(0, exp - used)); Lk("othP", "exp", a, K.ref); Lk("othP", "pbt", othP - a, K.floor); }
      if (jvP) { const used = links.filter((l) => l.b === "exp").reduce((a, l) => a + l.v, 0), a = Math.min(jvP, Math.max(0, exp - used)); Lk("jvP", "exp", a, K.ref); Lk("jvP", "pbt", jvP - a, K.floor); }
      Lk("exp", "sell", sell, K.ref); Lk("exp", "adm", adm, K.ref); Lk("exp", "finN", finN, K.ref); Lk("exp", "othN", othN, K.ref); Lk("exp", "jvN", jvN, K.ref);
      Lk("pbt", "tax", tax, K.ref); Lk("pbt", "mi", mi, K.ink3); Lk("pbt", "ni", ni, K.up);
    }
    const ORDER = ["rev", "gp", "finP", "jvP", "othP", "cogs", "opx", "prov", "pbt", "exp", "ni", "mi", "tax", "sell", "adm", "finN", "jvN", "othN"];
    const cols = Math.max(...Object.values(nodes).map((n) => n.x)) + 1, pad = 8, top = 6, H = h - 12, nw = 12, slotMin = 30;
    const colX = (x) => 4 + (x * (w - 140 - nw)) / Math.max(1, cols - 1);
    const byCol = [...Array(cols).keys()].map((x) => Object.values(nodes).filter((n) => n.x === x && n.v > 0).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)));
    const need = (k) => Math.max(...byCol.map((L) => L.reduce((a, n) => a + Math.max(n.v * k, slotMin), 0) + pad * (L.length - 1)));
    let lo = 0, hi = (H * 0.95) / Math.max(1, ...byCol.map((L) => L.reduce((a, n) => a + n.v, 0)));
    if (need(hi) > H) { for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (need(m) > H) hi = m; else lo = m; } hi = lo; }
    const scale = hi;
    byCol.forEach((L) => {
      const tot = L.reduce((a, n) => a + Math.max(n.v * scale, slotMin), 0) + pad * (L.length - 1); let y = top + Math.max(0, (H - tot) / 2);
      L.forEach((n) => { n.h = Math.max(2, n.v * scale); n.y = y; n.slot = Math.max(n.h, slotMin); y += n.slot + pad; n.oy = n.y; n.iy = n.y; });
    });
    let s = "";
    const LL = links.filter((l) => nodes[l.a]?.h && nodes[l.b]?.h);
    [...LL].sort((p, q) => nodes[p.a].y - nodes[q.a].y || nodes[p.b].y - nodes[q.b].y).forEach((l) => { l.t = l.v * scale; l.y0 = nodes[l.a].oy + l.t / 2; nodes[l.a].oy += l.t; });
    [...LL].sort((p, q) => nodes[p.b].y - nodes[q.b].y || nodes[p.a].y - nodes[q.a].y).forEach((l) => { l.y1 = nodes[l.b].iy + l.t / 2; nodes[l.b].iy += l.t; });
    for (const l of LL) {
      const a = nodes[l.a], b = nodes[l.b], x0 = colX(a.x) + nw, x1 = colX(b.x);
      s += `<path d="M${x0},${l.y0}C${(x0 + x1) / 2},${l.y0} ${(x0 + x1) / 2},${l.y1} ${x1},${l.y1}" fill="none" stroke="${l.c}" stroke-opacity=".3" stroke-width="${Math.max(1, l.t)}"><title>${esc2(a.lab)} → ${esc2(b.lab)}: ${tyS(l.v)}</title></path>`;
    }
    for (const n of Object.values(nodes)) {
      if (!n.h) continue;
      const x = colX(n.x); s += `<rect x="${x}" y="${n.y}" width="${nw}" height="${n.h}" rx="2" fill="${n.c}"><title>${esc2(n.lab)}: ${tyS(n.v)}</title></rect>`;
      const tx = x + nw + 6, ty = n.y + 11;
      s += `<g><rect x="${tx - 3}" y="${ty - 11}" width="${Math.max(n.lab.length, tyS(n.v).length) * 6.6 + 6}" height="27" rx="4" fill="${col().surf}" fill-opacity=".72"/>` + T(tx, ty, n.lab, { fs: 11, c: col().ink2 }) + T(tx, ty + 13, tyS(n.v), { fs: 11, w: 700, c: col().ink }) + `</g>`;
    }
    return svgO(w, h, s);
  }

  // ---------------------------------------------------------------- lợi nhuận → dòng tiền tự do (thác nước)
  function waterfall(w, h, f) {
    const steps = [["LN ròng", f.ni, "base"], ["Khấu hao", f.da], ["Chi trả bằng CP", 0], ["Vốn lưu động", f.nwc], ["Khác", f.oth], ["Đầu tư TSCĐ", f.capex], ["Dòng tiền tự do", f.fcf, "end"]];
    let run = 0; const bars = steps.map(([lab, v, k]) => { v = v || 0; let a, b; if (k === "base") { a = 0; b = v; run = v; } else if (k === "end") { a = 0; b = v; } else { a = run; b = run + v; run = b; } return { lab, v, a, b, k }; });
    const all = bars.flatMap((x) => [x.a, x.b]), mx = Math.max(0, ...all), mn = Math.min(0, ...all), bw = (w - 10) / bars.length, nar = bw < 85, top = 24, bot = nar ? 50 : 38, H = h - top - bot, Y = (v) => top + ((mx - v) / ((mx - mn) || 1)) * H;
    let s = `<line x1="0" x2="${w}" y1="${Y(0)}" y2="${Y(0)}" stroke="${col().ink3}"/>`;
    bars.forEach((x, i) => {
      const x0 = 5 + i * bw + 6, ww = bw - 12, y = Math.min(Y(x.a), Y(x.b)), hh = Math.max(2, Math.abs(Y(x.a) - Y(x.b)));
      const c = x.k === "base" ? col().floor : x.k === "end" ? (x.v >= 0 ? col().up : col().ceil) : x.v >= 0 ? col().up : col().down;
      s += `<rect x="${x0}" y="${y}" width="${ww}" height="${hh}" rx="3" fill="${c}"><title>${esc2(x.lab)}: ${tyS(x.v)}</title></rect>` + T(x0 + ww / 2, y - 6, (x.v > 0 && !x.k ? "+" : "") + tyA(x.v), { a: "middle", fs: nar ? 9.5 : 11, w: 700, c: x.v < 0 ? col().down : col().ink });
      x.lab.split(" ").reduce((acc, wd) => { const L = acc[acc.length - 1]; if (L && (L + " " + wd).length <= (nar ? 7 : 11)) acc[acc.length - 1] = L + " " + wd; else acc.push(wd); return acc; }, []).slice(0, 3).forEach((ln, j) => (s += T(x0 + ww / 2, h - bot + 16 + j * 12, ln, { a: "middle", fs: 10, c: col().ink2 })));
    });
    return svgO(w, h, s);
  }

  // ---------------------------------------------------------------- cân đối kế toán (ô vuông theo tỷ trọng)
  function squarify(items, x, y, w, h) {
    const out = [], tot = items.reduce((a, i) => a + i.v, 0); if (!(tot > 0)) return out;
    let rest = items.filter((i) => i.v > 0).sort((a, b) => b.v - a.v).map((i) => ({ ...i, a: (i.v / tot) * w * h }));
    const worst = (row, s) => { const S = row.reduce((a, r) => a + r.a, 0), mx = Math.max(...row.map((r) => r.a)), mn = Math.min(...row.map((r) => r.a)); return Math.max((s * s * mx) / (S * S), (S * S) / (s * s * mn)); };
    while (rest.length) {
      const s = Math.min(w, h); let row = [rest[0]], i = 1;
      while (i < rest.length && worst([...row, rest[i]], s) <= worst(row, s)) { row.push(rest[i]); i++; }
      const S = row.reduce((a, r) => a + r.a, 0);
      if (w >= h) { const ww = S / h; let yy = y; for (const r of row) { const hh = r.a / ww; out.push({ ...r, x, y: yy, w: ww, h: hh }); yy += hh; } x += ww; w -= ww; }
      else { const hh = S / w; let xx = x; for (const r of row) { const ww = r.a / hh; out.push({ ...r, x: xx, y, w: ww, h: hh }); xx += ww; } y += hh; h -= hh; }
      rest = rest.slice(i);
    }
    return out;
  }
  function treemap(w, h, items, title) {
    const R = squarify(items, 0, 22, w, h - 22);
    let s = T(0, 14, title, { fs: 12, w: 700, c: col().ink });
    for (const r of R) {
      s += `<rect x="${r.x + 1}" y="${r.y + 1}" width="${Math.max(0, r.w - 2)}" height="${Math.max(0, r.h - 2)}" rx="4" fill="${r.c}" fill-opacity=".85"><title>${esc2(r.lab)}: ${tyS(r.v)}</title></rect>`;
      if (r.w > 60 && r.h > 30) s += T(r.x + 7, r.y + 16, r.lab, { fs: 11, w: 600, c: "#fff" }) + T(r.x + 7, r.y + 30, tyS(r.v), { fs: 11, c: "#fff" });
      else if (r.w > 34 && r.h > 16) s += T(r.x + 4, r.y + 13, tyA(r.v), { fs: 10, c: "#fff" });
    }
    return svgO(w, h, s);
  }
  // vòng tròn tỷ lệ
  function donut(size, v, label, good) {
    const r = size / 2 - 10, c = size / 2, t = Math.max(0, Math.min(1, Math.abs(v || 0) / 100)), a = t * 2 * Math.PI, x = c + r * Math.sin(a), y = c - r * Math.cos(a);
    const fg = good ? col().floor : col().down;
    let s = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col().line}" stroke-width="16"/>`;
    if (t >= 0.999) s += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${fg}" stroke-width="16"/>`;
    else if (t > 0) s += `<path d="M${c},${c - r}A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x},${y}" fill="none" stroke="${fg}" stroke-width="16"/>`;
    s += T(c, c + 2, isNum(v) ? `${nf(v, 0)}%` : "—", { a: "middle", fs: 20, w: 700, c: col().ink, b: "middle" }) + T(c, c + 22, label, { a: "middle", fs: 10, c: col().ink3 });
    return svgO(size, size, s);
  }

  // ---------------------------------------------------------------- vẽ theo khung thật
  const DRAW = {};
  function drawAll(root, d) { for (const el of root.querySelectorAll(".co-ch[data-ch]")) { const f = DRAW[el.dataset.ch]; if (!f) continue; const w = Math.max(240, Math.floor(el.clientWidth)); if (el._w === w && !el._dirty) continue; el._w = w; el._dirty = false; try { const out = f(el, w, el.clientHeight || 260, d); if (typeof out === "string") el.innerHTML = out; } catch (e) { el.innerHTML = `<p class="muted">Lỗi vẽ biểu đồ: ${esc2(e.message)}</p>`; } } }

  // ---------------------------------------------------------------- HTML từng phần
  function tab(d) {
    const co = d.co;
    if (!co) return `<div class="empty">Hồ sơ doanh nghiệp chưa có cho mã này – cập nhật sau lượt dữ liệu tối nay.</div>`;
    const fa = d.fa || {}, K = co.checks || {}, S = co.score || {}, r = d.row || {}, I = co.co || {};
    const tot = AX.reduce((a, [k]) => a + (S[k] || 0), 0);
    const best = AX.map(([k, n]) => [n, S[k] || 0]).sort((a, b) => b[1] - a[1]);
    const head = `<div class="co-top"><div class="co-radar">${chart("radar", 250)}</div><div class="co-sum"><h2>${esc2(d.symbol)} · ${esc2(I.name || d.name)}</h2>
      <p class="faint">${esc2(I.exchange || d.exchange)} · ${esc2(I.industry || d.industry || "")} · vốn hoá ${tyS(I.mcap ?? r.mcap_bn)}</p>
      <div class="co-ax">${AX.map(([k, n]) => `<a href="#${{ val: "co-s1", fut: "co-s2", past: "co-s3", hlth: "co-s4", div: "co-s5" }[k]}" data-go><b style="color:${sc(S[k] || 0)}">${S[k] ?? 0}/6</b><span>${n}</span></a>`).join("")}</div>
      <p>Tổng <b>${tot}/30</b> tiêu chí. Mạnh nhất: <b>${best[0][0].toLowerCase()}</b> (${best[0][1]}/6) · yếu nhất: <b>${best[4][0].toLowerCase()}</b> (${best[4][1]}/6).</p>
      <ul class="co-hl">${[...(K.past || []), ...(K.hlth || []), ...(K.val || []), ...(K.div || [])].filter((c) => c.ok !== null).sort((a, b) => (b.ok === true) - (a.ok === true)).slice(0, 2).concat([...(K.past || []), ...(K.hlth || []), ...(K.div || [])].filter((c) => c.ok === false).slice(0, 2)).map((c) => `<li>${icon(c.ok)}<span><b>${esc2(c.n)}</b> – ${esc2(c.w)}</span></li>`).join("")}</ul>
      <p class="faint co-note">Mỗi trục 6 tiêu chí đúng / sai, tính tự động từ BCTC & giá – không phải khuyến nghị mua bán.</p></div></div>`;
    const v = co.val || {}, g = co.g || {}, ind = co.ind || {}, mkt = co.mkt || {}, f = co.fwd || {};
    const s1 = sec("co-s1", "1 Định giá", `${checks(K.val, "Tiêu chí định giá")}
      ${big([[isNum(v.fair) ? nf(v.fair, 2) : "—", "giá trị hợp lý (nghìn đ)"], [nf(r.price, 2), "giá hiện tại"], [isNum(v.up) ? pct(v.up, 1) : "—", isNum(v.up) && v.up >= 0 ? "thấp hơn giá trị" : "cao hơn giá trị", isNum(v.up) ? (v.up >= 0 ? "up" : "down") : ""]])}
      ${v.reliable === false && isNum(v.fair) ? `<p class="faint co-note">Mô hình định giá ghi chú độ tin cậy thấp cho mã này – xem tab "Dự phóng & định giá".</p>` : ""}
      <div class="g g2">${sub("1.1 Giá so với giá trị hợp lý", chart("fair", 120))}${sub("1.2 P/E so với mâm, ngành, thị trường", chart("pe", 170), "P/E thấp hơn nghĩa là trả ít tiền hơn cho mỗi đồng lợi nhuận – so cùng ngành mới có ý nghĩa.")}</div>
      ${sub("1.3 P/B so với mâm, ngành, thị trường", chart("pb", 170))}`);
    const s2 = sec("co-s2", "2 Tăng trưởng tương lai", `${checks(K.fut, "Tiêu chí tương lai")}
      ${f.g != null || f.rg != null ? big([[pct(f.g, 1), "LN tăng / năm (dự phóng)"], [pct(f.rg, 1), "doanh thu tăng / năm"], [pp(f.roe), "ROE dự phóng"], [pp(co.savings, 0), "lãi tiết kiệm (mốc)"]]) : ""}
      <p class="faint co-note">Dự phóng theo kịch bản cơ sở của mô hình định giá trên trang (${f.n || "—"} năm) – không phải dự báo của công ty chứng khoán. Sửa giả định ở tab "Dự phóng & định giá".</p>
      <div class="g g2">${sub("2.1 Lợi nhuận & doanh thu: lịch sử và dự phóng", chart("fut", 260))}${sub("2.2 Tăng trưởng dự phóng so với thị trường", chart("futg", 200))}</div>`);
    const kinfo = kv([["Tăng LN bình quân 5 năm", pct(g.g5), cl(g.g5)], ["Tăng LN 12 tháng", pct(g.g1), cl(g.g1)], [`Ngành ${esc2(co.ind_name || "")} – LN 12 tháng`, pct(ind.g1), cl(ind.g1)], ["Tăng doanh thu bình quân 5 năm", pct(g.rg5), cl(g.rg5)],
      ["ROE", pp(fa.roe)], ["Biên LN ròng", pp(fa.net_margin)], ["Kỳ BCTC gần nhất", esc2((co.bs || {}).p || fa.period || "—")]]);
    const evs = (co.ev || []).slice(0, 6);
    const yrs = co.sk || [];
    const s3 = sec("co-s3", "3 Kết quả quá khứ", `${checks(K.past, "Tiêu chí quá khứ")}
      <div class="g g2"><div class="co-sub"><h3>Số chính</h3>${big([[pct(g.g5), "LN tăng bình quân 5 năm", cl(g.g5)], [pct(g.g1), "LN 12 tháng gần nhất", cl(g.g1)]])}${kinfo}</div>
        <div class="co-sub"><h3>Sự kiện gần đây</h3>${evs.length ? `<ul class="co-ev">${evs.map((e) => `<li><small>${esc2(e.d)}</small><span>${esc2(e.t)}</span></li>`).join("")}</ul>` : `<p class="muted">Chưa có dữ liệu sự kiện.</p>`}</div></div>
      ${sub("3.1 Doanh thu đi về đâu", `<div class="co-yrs" data-yrs>${yrs.map((x, i) => `<button type="button" data-y="${i}" class="${i === yrs.length - 1 ? "on" : ""}">${esc2(x.p.startsWith("12T") ? "12 tháng gần nhất" : x.p)}</button>`).join("")}</div>${chart("sankey", 330)}`, "Doanh thu → giá vốn & lợi nhuận gộp → chi phí → lợi nhuận. Rê chuột vào dòng để xem số.")}
      ${sub("3.2 Lịch sử doanh thu & lợi nhuận (12 tháng, theo quý)", `${legend("hist", HS())}${chart("hist", 300)}`, "Mỗi điểm là tổng 4 quý gần nhất tính tới quý đó.")}
      ${!co.bank && co.wf ? sub("3.3 Lợi nhuận → dòng tiền tự do (12 tháng)", chart("wf", 270), "Lợi nhuận kế toán khác tiền thật: cộng khấu hao, trừ tiền kẹt trong phải thu/tồn kho, trừ đầu tư tài sản cố định → dòng tiền tự do. Vốn lưu động ước tính từ bảng cân đối.") : ""}
      <div class="g g2">${sub("3.4 Tăng LN bình quân 5 năm", chart("g5", 210))}${sub("3.5 Tăng LN 12 tháng", chart("g1", 210))}</div>`);
    const bs = co.bs || {};
    const s4 = sec("co-s4", "4 Sức khoẻ tài chính", `${checks(K.hlth, "Tiêu chí sức khoẻ")}
      ${co.bank ? "" : `<div class="g g2">${sub("4.1 Tài sản ngắn hạn so với nợ", chart("pos", 200))}${sub("4.2 Nợ vay, vốn chủ & tiền theo năm", `${chart("dh", 240)}`)}</div>`}
      ${sub(`4.3 Bảng cân đối kế toán (${esc2(bs.p || "")})`, `<div class="g g2">${chart("tmA", 260)}${chart("tmL", 260)}</div>`, co.bank ? "" : `Nợ ngắn hạn khác = nợ ngắn hạn trừ vay ngắn hạn (phải trả người bán, người mua trả trước, thuế…).`)}
      ${kv([["Tổng tài sản", tyS(bs.ta)], ["Nợ phải trả", tyS(bs.tl)], ["Vốn chủ sở hữu", tyS(bs.eq)], ["Nợ vay", tyS(bs.debt)], ["Tiền & đầu tư ngắn hạn", tyS(bs.cash)], ["Nợ vay / vốn chủ", bs.eq ? pp((bs.debt / bs.eq) * 100) : "—"], ["Thanh toán hiện hành", isNum(fa.current_ratio) ? nf(fa.current_ratio, 2) + "×" : "—"], ["EBIT / lãi vay", isNum(fa.interest_cover) ? nf(fa.interest_cover, 1) + "×" : "—"]])}`);
    const dv = co.dv || {};
    const dEv = (co.ev || []).filter((e) => /DIV|ISS/.test(e.c || "") || e.cat === "DIVIDEND").slice(0, 4);
    const s5 = sec("co-s5", "5 Cổ tức", `${checks(K.div, "Tiêu chí cổ tức")}
      <div class="g g2"><div class="co-sub"><h3>Số chính</h3>${big([[pp(dv.yield, 2), "tỷ suất cổ tức tiền mặt"], [vnd(dv.dps), "cổ tức 12 tháng / cp"]])}
        ${kv([["Tỷ lệ chi trả trên lợi nhuận", pp(dv.payout, 0)], ["Cổ tức / dòng tiền tự do", isNum(dv.cash_payout) ? pp(dv.cash_payout, 0) : "—", dv.cash_payout < 0 ? "down" : ""], ["Tỷ suất dự phóng (kịch bản cơ sở)", pp(dv.fwd_yield, 2)], ["Số năm trả tiền mặt liên tiếp", dv.years ?? "—"], ["Ngày GDKHQ gần nhất", esc2(dv.last_ex || "—")]])}</div>
        <div class="co-sub"><h3>Thông báo cổ tức gần đây</h3>${dEv.length ? `<ul class="co-ev">${dEv.map((e) => `<li><small>${esc2(e.d)}${e.x ? ` · GDKHQ ${esc2(e.x)}` : ""}</small><span>${esc2(e.t)}</span></li>`).join("")}</ul>` : `<p class="muted">Chưa có thông báo.</p>`}</div></div>
      ${sub("5.1 Lịch sử cổ tức tiền mặt", `${legend("dvh", DS())}${chart("dvh", 260)}`, "Cột: cổ tức tiền mặt mỗi năm (đồng / cp, theo số cổ phiếu hiện tại). Đường: tỷ suất trên giá trung bình năm, và EPS.")}
      <div class="g g2">${sub("5.2 Tỷ suất so với thị trường & ngành", chart("dvm", 220))}<div class="co-sub"><h3>5.3 – 5.4 Mức chi trả</h3><div class="co-donuts">${chart("dnP", 170)}${chart("dnC", 170)}</div>
        <p class="faint co-note">Trái: phần lợi nhuận đem trả cổ tức. Phải: cổ tức đã trả so với dòng tiền tự do 12 tháng (âm = dòng tiền tự do âm).</p></div></div>`);
    const mg = co.mgr || [], ceo = co.ceo, chair = co.chair;
    const s6 = sec("co-s6", "6 Ban lãnh đạo", `${checks(K.mgmt, "Tiêu chí lãnh đạo")}
      <div class="g g2"><div class="co-sub"><h3>Lãnh đạo chủ chốt</h3>${big([[ceo ? esc2(ceo.n) : "—", ceo ? esc2(ceo.pos) : "Tổng giám đốc (chưa có dữ liệu)"], [chair ? esc2(chair.n) : "—", chair ? esc2(chair.pos) : "Chủ tịch HĐQT (chưa có dữ liệu)"]])}
        ${kv([["Tổng giám đốc nắm giữ", ceo && isNum(ceo.q) ? `${shS(ceo.q)} cp${isNum(ceo.pct) ? ` · ${nf(ceo.pct, 3)}%` : ""}` : "—"], ["HĐQT & ban điều hành nắm", pp((co.own || {}).bod, 2)], ["Lương thưởng, nhiệm kỳ", "chưa có nguồn công khai – xem báo cáo thường niên"]])}</div>
        <div class="co-sub"><h3>Giao dịch của người nội bộ gần đây</h3>${insList((co.ins || []).slice(0, 6))}</div></div>
      ${mg.length ? sub("6.1 Thành viên HĐQT & ban điều hành nắm cổ phiếu", `<div class="tw"><table><thead><tr><th class="l">Họ tên</th><th class="l">Chức vụ</th><th>Số cổ phiếu</th><th>Tỷ lệ</th></tr></thead><tbody>${mg.map((x) => `<tr><td class="l">${esc2(x.n)}</td><td class="l">${esc2(x.pos)}</td><td>${shS(x.q)}</td><td>${isNum(x.pct) ? nf(x.pct, 3) + "%" : "—"}</td></tr>`).join("")}</tbody></table></div>`) : ""}`);
    const own = co.own || {}, top = co.top || [], dil = co.dil;
    const s7 = sec("co-s7", "7 Cổ đông", `<div class="g g2">${sub("7.1 Giao dịch nội bộ 12 tháng (số cổ phiếu)", chart("ins", 230), "Chỉ tính giao dịch đã hoàn tất. Cá nhân: HĐQT, ban điều hành & người liên quan; tổ chức: cổ đông là tổ chức có liên quan.")}
      <div class="co-sub"><h3>Pha loãng</h3>${dil ? `<p>${icon(isNum(dil.adj) ? dil.adj < 5 : null)} Số cổ phiếu 1 năm qua ${pct(dil.raw)}${dil.stock ? ` – trong đó chia cổ tức / thưởng bằng cổ phiếu ${pct(dil.stock)} (không làm giảm phần sở hữu)` : ""}. Pha loãng thật: <b class="${dil.adj >= 5 ? "down" : "up"}">${pct(dil.adj)}</b>.</p>` : `<p class="muted">Chưa đủ số liệu.</p>`}
        ${kv([["Nước ngoài sở hữu", pp(own.foreign, 2)], ["Giới hạn sở hữu nước ngoài", isNum(own.foreign_max) ? pp(own.foreign_max, 0) : "—"], ["Tổng số cổ phiếu", shS(own.total || (I.shares ? I.shares * 1e6 : null))]])}</div></div>
      ${sub("7.2 Cơ cấu sở hữu", chart("own", 110))}
      ${sub(`7.3 Cổ đông lớn${top.length ? ` – ${top.length} cổ đông nắm ${nf(top.reduce((a, x) => a + (x.pct || 0), 0), 1)}%` : ""}`, top.length ? `<div class="tw"><table class="co-top-t"><thead><tr><th class="l">Tỷ lệ</th><th class="l">Cổ đông</th><th>Số cổ phiếu</th><th>Giá trị hiện tại</th><th class="l">Loại</th><th>Ngày công bố</th></tr></thead><tbody>${top.map((x, i) => `<tr class="${i >= 10 ? "co-more" : ""}"><td class="l"><b>${nf(x.pct, 2)}%</b></td><td class="l">${esc2(x.n)}${x.pos ? `<br><small class="faint">${esc2(x.pos)}</small>` : ""}</td><td>${shS(x.q)}</td><td>${tyS(x.val)}</td><td class="l">${x.t === "INDIVIDUAL" ? "Cá nhân" : "Tổ chức"}</td><td><small>${esc2(x.d)}</small></td></tr>`).join("")}</tbody></table></div>${top.length > 10 ? `<button type="button" class="btn sm" data-more>Xem thêm ${top.length - 10} cổ đông</button>` : ""}` : `<p class="muted">Chưa có dữ liệu cổ đông (tải dần – mã thanh khoản cao trước).</p>`)}`);
    const s8 = sec("co-s8", "8 Thông tin công ty", `${kv([["Tên đầy đủ", esc2(I.name || "—")], ["Tên viết tắt", esc2(I.short || "—")], ["Tên tiếng Anh", esc2(I.en || "—")], ["Sàn", esc2(I.exchange || "—")],
        ["Ngành (ICB)", esc2([I.sector, I.industry, I.sub].filter(Boolean).join(" › ") || "—")], ["Vốn hoá", tyS(I.mcap)], ["Số cổ phiếu lưu hành", I.shares ? `${nf(I.shares, 2)} triệu` : "—"],
        ["Cao / thấp 52 tuần", isNum(I.hi52) ? `${nf(I.hi52 / 1000, 2)} / ${nf(I.lo52 / 1000, 2)}` : "—"], ["Số nhân viên", "chưa có nguồn công khai"]])}
      ${I.profile ? sub("Giới thiệu", `<p class="co-prof">${esc2(I.profile)}</p>`) : ""}
      <p class="faint co-note">Nguồn: BCTC (Vietcap / KBS), cổ đông – sự kiện – giao dịch nội bộ (Vietcap IQ${I.fetched ? `, cập nhật ${esc2(I.fetched)}` : ""}). Mốc ngành / thị trường: trung vị các mã trên sàn.</p>`);
    const nav = `<nav class="co-nav">${SEC.map(([id, n]) => `<a href="#${id}" data-go>${n}</a>`).join("")}</nav>`;
    return `<div class="co-wrap">${nav}<div class="co-main">${sec("co-s0", "Tổng quan 5 trục", head)}${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}</div></div>`;
    function HS() { return HSER(co); }
    function DS() { return DSER(co); }
  }
  const cl = (x) => (isNum(x) ? (x >= 0 ? "up" : "down") : "");
  const insList = (L) => (L.length ? `<ul class="co-ev">${L.map((t) => `<li><small>${esc2(t.d)} · ${esc2(t.st || "")}</small><span><b class="${/mua/i.test(t.act || "") ? "up" : /bán/i.test(t.act || "") ? "down" : ""}">${esc2(t.act || "")}</b> ${esc2(t.n || "")} <small class="faint">${esc2(t.pos || "")}</small> · đăng ký ${shS(t.reg)}${t.acq ? ` · thực hiện ${shS(Math.abs(t.acq))}` : ""}</span></li>`).join("")}</ul>` : `<p class="muted">Không có giao dịch nội bộ trong dữ liệu.</p>`);
  const HSER = (co) => { const K = col(), H = co.hist || []; return [{ n: "Doanh thu", k: "rev", c: K.brand, area: true }, { n: "Lợi nhuận", k: "ni", c: K.up }, { n: "Dòng tiền tự do", k: "fcf", c: K.ceil }, { n: "Dòng tiền kinh doanh", k: "cfo", c: K.ref, off: true }, { n: "Chi phí bán hàng & quản lý", k: "opex", c: K.floor, off: true }].filter((s) => H.some((x) => isNum(x[s.k]))); };
  const DSER = () => { const K = col(); return [{ n: "Cổ tức / cp", k: "dps", c: K.floor }, { n: "Tỷ suất", k: "dy", c: K.ref }, { n: "EPS", k: "eps", c: K.up, off: true }]; };

  // ---------------------------------------------------------------- bộ vẽ
  DRAW.radar = (el, w, h, d) => radar(Math.min(w, 330), h, d.co.score || {});
  DRAW.fair = (el, w, h, d) => { const v = d.co.val || {}, p = d.row?.price; return hbars(w, [["Giá hiện tại", p, col().brand], ["Giá trị hợp lý", v.fair, isNum(v.fair) && v.fair >= p ? col().up : col().down, isNum(v.up) ? pct(v.up, 1) : ""]], (x) => nf(x, 2)); };
  DRAW.pe = (el, w, h, d) => { const v = d.co.val || {}; return vbars(w, h, [[d.symbol, v.pe, col().brand], ["Mâm so sánh", v.pe_peer, col().ink3], ["Ngành", v.pe_ind, col().floor], ["Thị trường", v.pe_mkt, col().ceil]], (x) => nf(x, 1) + "×"); };
  DRAW.pb = (el, w, h, d) => { const v = d.co.val || {}; return vbars(w, h, [[d.symbol, v.pb, col().brand], ["Mâm so sánh", v.pb_peer, col().ink3], ["Ngành", v.pb_ind, col().floor], ["Thị trường", v.pb_mkt, col().ceil]], (x) => nf(x, 2) + "×"); };
  DRAW.fut = (el, w, h, d) => {
    const co = d.co, f = co.fwd || {}, S = (co.sk || []).filter((x) => !x.p.startsWith("12T")), y0 = +(S[S.length - 1]?.p || new Date().getFullYear());
    const xs = [...S.map((x) => x.p), ...(f.ni || []).map((_, i) => String(y0 + 1 + i))], n0 = S.length;
    if (!xs.length) return `<p class="muted">Chưa có số liệu.</p>`;
    lines(el, w, h, xs, [{ n: "Doanh thu", c: col().brand, area: true, v: [...S.map((x) => x.rev), ...(f.rev || [])] }, { n: "Lợi nhuận", c: col().up, v: [...S.map((x) => x.ni), ...(f.ni || [])] }], { fc: f.ni?.length ? n0 : null });
  };
  DRAW.futg = (el, w, h, d) => { const f = d.co.fwd || {}, m = d.co.mkt || {}; return hbars(w, [["LN – " + d.symbol, f.g, col().up], ["LN – thị trường", m.fg, col().ceil], ["Lãi tiết kiệm", d.co.savings, col().ink3], ["Doanh thu – " + d.symbol, f.rg, col().brand], ["Doanh thu – thị trường", m.frg, col().ceil]], (x) => pp(x) + "/năm"); };
  DRAW.sankey = (el, w, h, d) => {
    const i = el._y ?? (d.co.sk || []).length - 1, W = Math.max(w, 760);   // điện thoại: giữ đủ rộng để nhãn không chồng, kéo ngang để xem
    el.classList.toggle("co-scroll", W > w);
    return sankey(W, W > w ? h - 12 : h, (d.co.sk || [])[i], d.co.bank);
  };
  DRAW.hist = (el, w, h, d) => { const H = d.co.hist || []; if (!H.length) return `<p class="muted">Chưa có số liệu.</p>`; const S = (el._ser ||= HSER(d.co)).map((s) => ({ ...s, v: H.map((x) => x[s.k]) })); lines(el, w, h, H.map((x) => x.p), S, { extra: (i) => (isNum(H[i].rev) && isNum(H[i].ni) && H[i].rev ? `<span><i></i>Biên LN<em>${pp((H[i].ni / H[i].rev) * 100)}</em></span>` : "") }); };
  DRAW.wf = (el, w, h, d) => waterfall(w, h, d.co.wf);
  DRAW.g5 = (el, w, h, d) => vbars(w, h, [[d.symbol, d.co.g?.g5, col().brand], ["Ngành", d.co.ind?.g5, col().floor], ["Thị trường", d.co.mkt?.g5, col().ceil]]);
  DRAW.g1 = (el, w, h, d) => vbars(w, h, [[d.symbol, d.co.g?.g1, col().brand], ["Ngành", d.co.ind?.g1, col().floor], ["Thị trường", d.co.mkt?.g1, col().ceil]]);
  DRAW.pos = (el, w, h, d) => {
    const b = d.co.bs || {}, K = col(), rows = [["Ngắn hạn", b.ca, b.cl], ["Dài hạn", (b.ta || 0) - (b.ca || 0), b.ltl]], mx = Math.max(1, ...rows.flat().filter(isNum)), lw = w < 420 ? 0 : 74, W = w - lw - 100;
    let s = "", y = 4;
    rows.forEach(([lab, a, l]) => {
      if (!lw) { s += T(0, y + 12, lab, { fs: 12, w: 700, c: K.ink }); y += 18; } else s += T(0, y + 40, lab, { fs: 12, w: 700, c: K.ink });
      [[`Tài sản ${lab.toLowerCase()}`, a, K.up], [`Nợ ${lab.toLowerCase()}`, l, K.down]].forEach(([t, v, c]) => {
        const bw = Math.max(2, ((v || 0) / mx) * W);
        s += T(lw, y + 11, t, { fs: 11, c: K.ink2 }) + `<rect x="${lw}" y="${y + 15}" width="${bw}" height="16" rx="3" fill="${c}" fill-opacity=".85"/>` + T(lw + bw + 6, y + 27, tyS(v), { fs: 11, w: 700, c: K.ink });
        y += 36;
      });
      y += 12;
    });
    return svgO(w, y, s);
  };
  DRAW.dh = (el, w, h, d) => { const H = d.co.dh || []; if (!H.length) return `<p class="muted">Chưa có số liệu.</p>`; lines(el, w, h, H.map((x) => x.p), [{ n: "Vốn chủ", c: col().floor, area: true, v: H.map((x) => x.eq) }, { n: "Nợ vay", c: col().down, v: H.map((x) => x.debt) }, { n: "Tiền & ĐT ngắn hạn", c: col().up, v: H.map((x) => x.cash) }], { extra: (i) => (H[i].eq ? `<span><i></i>Nợ vay / vốn chủ<em>${pp((H[i].debt / H[i].eq) * 100)}</em></span>` : "") }); };
  DRAW.tmA = (el, w, h, d) => {
    const b = d.co.bs || {}, K = col();
    const it = d.co.bank ? [{ lab: "Cho vay khách hàng", v: b.loans, c: K.brand }, { lab: "Tiền & đầu tư ngắn hạn", v: b.cash, c: K.up }, { lab: "Tài sản khác", v: (b.ta || 0) - (b.loans || 0) - (b.cash || 0), c: K.ink3 }]
      : [{ lab: "Tiền & đầu tư ngắn hạn", v: b.cash, c: K.up }, { lab: "Phải thu", v: b.rec, c: K.floor }, { lab: "Hàng tồn kho", v: b.inv, c: K.ref }, { lab: "Tài sản cố định", v: b.fa, c: K.brand }, { lab: "Dài hạn & khác", v: b.oa, c: K.ink3 }];
    return treemap(w, h, it, `Tài sản · ${tyS(b.ta)}`);
  };
  DRAW.tmL = (el, w, h, d) => {
    const b = d.co.bs || {}, K = col();
    const it = d.co.bank ? [{ lab: "Tiền gửi khách hàng", v: b.dep, c: K.floor }, { lab: "Nợ khác", v: (b.tl || 0) - (b.dep || 0), c: K.ink3 }, { lab: "Vốn chủ sở hữu", v: b.eq, c: K.up }]
      : [{ lab: "Vốn chủ sở hữu", v: b.eq, c: K.up }, { lab: "Nợ ngắn hạn khác", v: b.ocl, c: K.ink3 }, { lab: "Nợ dài hạn khác", v: b.oll, c: K.floor }, { lab: "Nợ vay", v: b.debt, c: K.down }];
    return treemap(w, h, it, `Nợ & vốn chủ · ${tyS((b.tl || 0) + (b.eq || 0))}`);
  };
  DRAW.dvh = (el, w, h, d) => {
    const H0 = (d.co.dv || {}).hist || [], H = H0.filter((x, i) => !(i === H0.length - 1 && !x.dps && x.y === new Date().getFullYear())); if (!H.length) return `<p class="muted">Chưa có lịch sử cổ tức tiền mặt.</p>`;
    const ser = (el._ser ||= DSER()), K = col(), L = 54, R = 46, top = 12, bot = 24, W = w - L - R, HH = h - top - bot, n = H.length, bw = Math.min(34, (W / n) * 0.6);
    const mx = nice(Math.max(1, ...H.map((x) => x.dps || 0), ...(ser[2].off ? [] : H.map((x) => x.eps || 0)))), my = nice(Math.max(1, ...H.map((x) => x.dy || 0)));
    const X = (i) => L + ((i + 0.5) / n) * W, Y = (v) => top + HH - (Math.max(0, v) / mx) * HH, Y2 = (v) => top + HH - (Math.max(0, v) / my) * HH;
    let s = "";
    for (let k = 0; k <= 4; k++) { const y = top + (HH * k) / 4; s += `<line x1="${L}" x2="${w - R}" y1="${y}" y2="${y}" stroke="${K.line2}"/>` + T(L - 6, y + 4, nf(mx * (1 - k / 4), 0), { a: "end", fs: 10, c: K.ink3 }) + (ser[1].off ? "" : T(w - R + 6, y + 4, nf(my * (1 - k / 4), 1) + "%", { fs: 10, c: K.ref })); }
    if (!ser[0].off) H.forEach((x, i) => { if (x.dps) s += `<rect x="${X(i) - bw / 2}" y="${Y(x.dps)}" width="${bw}" height="${top + HH - Y(x.dps)}" rx="2" fill="${ser[0].c}"/>`; });
    const pl = (key, Yf, c) => { let p = "", st = false; H.forEach((x, i) => { const v = x[key]; if (!isNum(v)) { st = false; return; } p += `${st ? "L" : "M"}${X(i)},${Yf(v)}`; st = true; }); return p ? `<path d="${p}" fill="none" stroke="${c}" stroke-width="2"/>` + H.map((x, i) => (isNum(x[key]) ? `<circle cx="${X(i)}" cy="${Yf(x[key])}" r="3" fill="${c}"/>` : "")).join("") : ""; };
    if (!ser[1].off) s += pl("dy", Y2, ser[1].c); if (!ser[2].off) s += pl("eps", Y, ser[2].c);
    const step = Math.max(1, Math.ceil(n / Math.floor(W / 40))); H.forEach((x, i) => { if (i % step === 0) s += T(X(i), h - 6, String(x.y), { a: "middle", fs: 10, c: K.ink3 }); });
    el.innerHTML = svgO(w, h, s) + `<div class="co-tip" hidden></div>`;
    const svg = el.querySelector("svg"), tip = el.querySelector(".co-tip");
    svg.onmousemove = (e) => { const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - svg.getBoundingClientRect().left - L) / W) * n))), x = H[i]; tip.hidden = false; tip.innerHTML = `<b>${x.y}</b><span><i style="background:${K.floor}"></i>Cổ tức<em>${vnd(x.dps)}</em></span><span><i style="background:${K.ref}"></i>Tỷ suất<em>${pp(x.dy, 2)}</em></span><span><i style="background:${K.up}"></i>EPS<em>${vnd(x.eps)}</em></span>`; tip.style.left = Math.min(X(i) + 10, w - tip.offsetWidth - 4) + "px"; };
    svg.onmouseleave = () => (tip.hidden = true);
  };
  DRAW.dvm = (el, w, h, d) => { const dv = d.co.dv || {}, m = d.co.mkt || {}, ind = d.co.ind || {}; return vbars(w, h, [[d.symbol, dv.yield, col().brand], ["25% thấp nhất", m.dy25, col().ink3], ["25% cao nhất", m.dy75, col().ceil], ["TB ngành", ind.dy_avg, col().floor], ["Dự phóng", dv.fwd_yield, col().ref]], (x) => pp(x, 1)); };
  DRAW.dnP = (el, w, h, d) => donut(Math.min(w, 170), (d.co.dv || {}).payout, "lợi nhuận đem chia", (d.co.dv || {}).payout <= 90);
  DRAW.dnC = (el, w, h, d) => donut(Math.min(w, 170), (d.co.dv || {}).cash_payout, "dòng tiền tự do", (d.co.dv || {}).cash_payout > 0 && (d.co.dv || {}).cash_payout <= 90);
  DRAW.ins = (el, w, h, d) => {
    const B = d.co.ins12 || [], K = col(), mx = Math.max(1, ...B.flatMap((b) => [b.ib + b.cb, b.is + b.cs])), lw = 84, half = (w - lw - 10) / 2, x0 = lw + half;
    let s = T(x0 - 6, 12, "◀ bán", { a: "end", fs: 10, c: K.down }) + T(x0 + 6, 12, "mua ▶", { fs: 10, c: K.up }) + `<line x1="${x0}" x2="${x0}" y1="18" y2="${18 + B.length * 44}" stroke="${K.line}"/>`;
    B.forEach((b, i) => {
      const y = 22 + i * 44, sc2 = (v) => (v / mx) * (half - 50);
      s += T(lw - 8, y + 18, `${b.m} tháng`, { a: "end", fs: 11, c: K.ink2 });
      let xs = x0; [[b.is, K.down], [b.cs, K.ref]].forEach(([v, c]) => { if (v) { s += `<rect x="${xs - sc2(v)}" y="${y + 4}" width="${sc2(v)}" height="22" fill="${c}"/>`; xs -= sc2(v); } });
      if (b.is + b.cs) s += T(xs - 4, y + 19, shS(b.is + b.cs), { a: "end", fs: 10, c: K.ink });
      let xb = x0; [[b.ib, K.up], [b.cb, K.floor]].forEach(([v, c]) => { if (v) { s += `<rect x="${xb}" y="${y + 4}" width="${sc2(v)}" height="22" fill="${c}"/>`; xb += sc2(v); } });
      if (b.ib + b.cb) s += T(xb + 4, y + 19, shS(b.ib + b.cb), { fs: 10, c: K.ink });
      if (!(b.ib + b.cb + b.is + b.cs)) s += T(x0 + 6, y + 19, "không có", { fs: 10, c: K.ink3 });
    });
    s += `<g transform="translate(4,${30 + B.length * 44})"><rect width="9" height="9" fill="${K.up}"/>${T(13, 9, "cá nhân mua", { fs: 10 })}<rect x="90" width="9" height="9" fill="${K.floor}"/>${T(103, 9, "tổ chức mua", { fs: 10 })}<rect x="180" width="9" height="9" fill="${K.down}"/>${T(193, 9, "cá nhân bán", { fs: 10 })}<rect x="265" width="9" height="9" fill="${K.ref}"/>${T(278, 9, "tổ chức bán", { fs: 10 })}</g>`;
    return svgO(w, 52 + B.length * 44, s);
  };
  DRAW.own = (el, w, h, d) => {
    const o = d.co.own || {}, K = col(); if (!isNum(o.state) && !isNum(o.pub)) return `<p class="muted">Chưa có dữ liệu cơ cấu sở hữu.</p>`;
    const P = [["Nhà nước", o.state, K.ceil], ["Tổ chức khác", o.inst, K.floor], ["HĐQT & ban điều hành", o.bod, K.up], ["Cá nhân & công chúng", o.pub, K.ref]].filter((x) => (x[1] || 0) > 0);
    let x = 0, s = ""; const H0 = 44;
    P.forEach(([lab, v, c], i) => { const ww = (v / 100) * w; s += `<rect x="${x}" y="${H0}" width="${Math.max(1, ww)}" height="34" fill="${c}"><title>${esc2(lab)}: ${nf(v, 2)}%</title></rect>`; const tx = Math.min(Math.max(x, 0), w - 120); s += T(i % 2 ? Math.min(x + ww, w) : tx, i % 2 ? H0 + 52 : H0 - 22, lab, { fs: 11, c: K.ink2, a: i % 2 ? "end" : "start" }) + T(i % 2 ? Math.min(x + ww, w) : tx, i % 2 ? H0 + 65 : H0 - 8, `${nf(v, 2)}%`, { fs: 12, w: 700, c, a: i % 2 ? "end" : "start" }); x += ww; });
    return svgO(w, 112, s);
  };

  // ---------------------------------------------------------------- gắn tương tác
  function bind(d) {
    const root = document.querySelector(".co-wrap"); if (!root) return;
    drawAll(root, d);
    root.querySelectorAll("[data-yrs] button").forEach((b) => (b.onclick = () => { root.querySelectorAll("[data-yrs] button").forEach((x) => x.classList.toggle("on", x === b)); const el = root.querySelector('[data-ch="sankey"]'); el._y = +b.dataset.y; el._dirty = true; drawAll(root, d); }));
    root.querySelectorAll("[data-lg]").forEach((g) => g.querySelectorAll("button").forEach((b) => (b.onclick = () => { const el = root.querySelector(`[data-ch="${g.dataset.lg}"]`), S = el._ser || (g.dataset.lg === "hist" ? HSER(d.co) : DSER()); el._ser = S; S[+b.dataset.i].off = !S[+b.dataset.i].off; b.classList.toggle("on", !S[+b.dataset.i].off); el._dirty = true; drawAll(root, d); })));
    root.querySelectorAll("[data-go]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); const t = document.getElementById(a.getAttribute("href").slice(1)); if (t) window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - (typeof stickTop === "function" ? stickTop() + 50 : 110), behavior: "smooth" }); }));
    const more = root.querySelector("[data-more]"); if (more) more.onclick = () => { root.querySelectorAll(".co-more").forEach((x) => x.classList.add("show")); more.remove(); };
    // mục đang xem sáng lên ở thanh bên
    const links = [...root.querySelectorAll(".co-nav a")], io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a.getAttribute("href") === "#" + e.target.id)); }, { rootMargin: "-30% 0px -60% 0px" });
    root.querySelectorAll(".co-sec").forEach((s) => io.observe(s));
    let t = 0; const ro = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(() => { if (!root.isConnected) { ro.disconnect(); io.disconnect(); return; } drawAll(root, d); }, 120); }); ro.observe(root);
  }
  window.CO_TAB = tab; window.CO_BIND = bind;
})();
