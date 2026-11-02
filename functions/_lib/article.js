// Xem nhanh bài báo (giữ lâu 1 thông báo tin tức): máy chủ tải bài gốc, chỉ trả về CHỮ đã lọc + ảnh chính – không trả HTML gốc.
// Link Google News (phần lớn tin) được giải mã ra link bài thật trước. Lưu đệm 12 giờ. Chỉ người đã đăng nhập mới gọi được.
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", ndash: "–", mdash: "—", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’" };
export const dec = (s) => String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m));
const txt = (h) => dec(String(h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
const meta = (h, ...names) => {
  for (const n of names) {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*>`, "i"), m = h.match(re);
    if (m) { const c = m[0].match(/content=["']([^"']*)["']/i); if (c && c[1].trim()) return dec(c[1].trim()); }
  }
  return "";
};
const SKIP = /^(xem thêm|đọc thêm|xem tiếp|>>|tin liên quan|bài liên quan|ảnh:|video:|nguồn:|theo dõi|chia sẻ|bình luận|bản quyền|copyright|©|tags?:|từ khóa)/i;
// nội dung bài: ưu tiên khối thân bài quen thuộc của báo VN, không có thì <article>, cuối cùng cả trang; lấy các đoạn <p> đủ dài
export function extract(html, base) {
  const h = String(html || "").replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, "");
  const title = meta(h, "og:title", "twitter:title") || txt((h.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const desc = meta(h, "og:description", "description", "twitter:description");
  let img = meta(h, "og:image", "og:image:url", "twitter:image", "twitter:image:src");
  const site = meta(h, "og:site_name"), time = meta(h, "article:published_time", "pubdate", "datePublished", "og:updated_time");
  const BODY = /<(div|section|article)[^>]+(?:class|id)=["'][^"']*\b(detail-content|knc-content|fck_detail|detail__content|singular-content|cms-body|the-article-body|article-body|article__body|content-detail|detail-cmain|maincontent|post-content|entry-content|newsbody|article-content|content_detail|dt-news__content|news-content)\b[^"']*["'][^>]*>/i;
  let zone = "", m = h.match(BODY);
  if (m) zone = h.slice(m.index, m.index + 200000);
  else { const a = h.match(/<article[\s\S]*?<\/article>/i); zone = a ? a[0] : h; }
  const paras = [];
  for (const p of zone.matchAll(/<(p|h2|h3)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const t = txt(p[2]); if (!t || SKIP.test(t)) continue;
    if (p[1].toLowerCase() !== "p") { if (t.length >= 8 && t.length <= 160) paras.push({ h: t }); continue; }
    if (t.length < 35 && !/[.:!?]$/.test(t)) continue;
    if (paras.some((x) => x.p === t)) continue;
    paras.push({ p: t }); if (paras.length >= 40) break;
  }
  // bỏ đoạn đầu trùng mô tả, bỏ tiêu đề phụ đứng cuối không có đoạn sau
  while (paras.length && paras[paras.length - 1].h) paras.pop();
  if (!img) { const im = zone.match(/<img[^>]+(?:data-src|data-original|src)=["']([^"']+\.(?:jpe?g|png|webp)[^"']*)["']/i); if (im) img = dec(im[1]); }
  const abs = (u) => { try { return u ? new URL(u, base).href : ""; } catch (e) { return ""; } };
  let chars = 0; const out = [];
  for (const x of paras) { chars += (x.p || x.h).length; out.push(x); if (chars > 9000) break; }
  return { title: title.slice(0, 300), desc: desc.slice(0, 600), img: abs(img), site: site.slice(0, 80), time: time.slice(0, 40), paras: out };
}
// Google News: link /rss/articles/<id> → link bài thật (cách giải mã công khai: lấy chữ ký trên trang rồi gọi batchexecute)
async function gnews(u) {
  const id = new URL(u).pathname.split("/").pop();
  const r = await fetch(`https://news.google.com/articles/${id}`, { headers: { "user-agent": UA, "accept-language": "vi,en;q=0.8" }, redirect: "follow", cf: { cacheTtl: 86400 } });
  if (!r.ok) throw new Error("gnews " + r.status);
  const h = await r.text(), sg = (h.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (h.match(/data-n-a-ts="([^"]+)"/) || [])[1];
  if (!sg || !ts) { const direct = (h.match(/<a[^>]+href="(https?:\/\/(?!news\.google)[^"]+)"[^>]*jsname/i) || [])[1]; if (direct) return dec(direct); throw new Error("gnews no sig"); }
  const req = ["Fbv4je", `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${id}",${ts},"${sg}"]`];
  const b = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", "user-agent": UA },
    body: "f.req=" + encodeURIComponent(JSON.stringify([[req]])),
  });
  const t = await b.text(), chunk = t.split("\n\n")[1];
  const arr = JSON.parse(chunk).slice(0, -2), url = JSON.parse(arr[0][2])[1];
  if (!/^https?:\/\//.test(url)) throw new Error("gnews bad url");
  return url;
}
const okHost = (u) => { try { const x = new URL(u); return /^https?:$/.test(x.protocol) && !x.port && !/^(localhost|[\d.]+|\[.*\])$/i.test(x.hostname) && x.hostname.includes("."); } catch (e) { return false; } };
export async function article({ request }) {
  const q = new URL(request.url).searchParams.get("u") || "";
  if (!okHost(q)) return new Response(JSON.stringify({ error: "Link không hợp lệ" }), { status: 400, headers: { "content-type": "application/json; charset=utf-8" } });
  const ck = new Request(new URL("/__article_cache?u=" + encodeURIComponent(q), request.url).href), cache = globalThis.caches?.default;
  try { const hit = cache && (await cache.match(ck)); if (hit) return new Response(hit.body, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, max-age=43200" } }); } catch (e) { /* không có bộ đệm */ }
  let url = q, o;
  try {
    if (/(^|\.)news\.google\.com$/i.test(new URL(q).hostname)) url = await gnews(q);
    if (!okHost(url)) throw new Error("bad url");
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "vi,en;q=0.8", accept: "text/html,application/xhtml+xml" }, redirect: "follow", cf: { cacheTtl: 3600 } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    if (!/html/i.test(r.headers.get("content-type") || "html")) throw new Error("không phải trang bài báo");
    let h = await r.text(); if (h.length > 3e6) h = h.slice(0, 3e6);
    o = { ok: true, url: r.url || url, ...extract(h, r.url || url) };
  } catch (e) {
    o = { ok: false, url, error: String(e.message || e).slice(0, 120) };
  }
  const res = new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": `private, max-age=${o.ok ? 43200 : 600}` } });
  if (o.ok && cache) try { await cache.put(ck, new Response(JSON.stringify(o), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=43200" } })); } catch (e) { /* bỏ qua */ }
  return res;
}
