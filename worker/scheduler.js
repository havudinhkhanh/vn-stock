// Cloudflare Worker: hẹn giờ chạy GitHub Actions ĐÚNG GIỜ (lịch của GitHub hay trễ vài tiếng).
// Giờ trong cron là giờ UTC: 04:35 = 11:35, 07:35 = 14:35, 08:35 = 15:35 giờ Việt Nam; 01:00 thứ 7 = 8:00 sáng thứ 7.
const SLOTS = {
  "35 4 * * 1-5": { mode: "intraday", label: "11:35 trong phiên" },
  "35 7 * * 1-5": { mode: "intraday", label: "14:35 trước ATC" },
  "35 8 * * 1-5": { mode: "full", label: "15:35 sau đóng cửa" },
  "0 1 * * 6": { mode: "full", label: "8:00 thứ 7 (BCTC, cổ tức)" },
};

async function dispatch(env, mode) {
  const url = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/daily.yml/dispatches`;
  let last = "";
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "vn-stock-scheduler" },
      body: JSON.stringify({ ref: "main", inputs: { mode, auto: "true" } }),
    });
    if (r.status === 204) return { ok: true, tries: i + 1 };
    last = `${r.status} ${(await r.text()).slice(0, 200)}`;
    await new Promise((res) => setTimeout(res, 15000));
  }
  throw new Error(`GitHub từ chối: ${last}`);
}

export default {
  async scheduled(event, env, ctx) {
    const s = SLOTS[event.cron] || { mode: "full", label: event.cron };
    const res = await dispatch(env, s.mode);
    console.log(`vn-stock: ${s.label} -> ${s.mode}`, JSON.stringify(res));
  },
  async fetch() {
    return new Response("vn-stock scheduler: " + Object.values(SLOTS).map((s) => s.label).join(" · "), { headers: { "content-type": "text/plain; charset=utf-8" } });
  },
};
