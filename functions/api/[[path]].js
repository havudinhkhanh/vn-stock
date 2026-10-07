// Cloudflare Pages Function: lưu danh mục & giả định của anh vào Workers KV.
// Bảo vệ 2 lớp: (1) cả trang nằm sau Cloudflare Access (đăng nhập bằng mã OTP email);
// (2) API chỉ nhận request có email đăng nhập do Access gắn vào, và đúng email chủ sở hữu.

const KEYS = new Set(["portfolio", "assumptions"]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function authorized(request, env) {
  const email = (request.headers.get("cf-access-authenticated-user-email") || "").toLowerCase();
  if (!email) return false;
  const owners = String(env.OWNER_EMAIL || "").toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  return owners.length === 0 || owners.includes(email);
}

export async function onRequest({ request, env, params }) {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const key = parts[0];
  if (!authorized(request, env)) {
    return json({ error: "Chưa đăng nhập qua Cloudflare Access" }, 401);
  }
  if (!env.VNSTOCK_KV) return json({ error: "Chưa gắn Workers KV (VNSTOCK_KV)" }, 500);

  // Nút "Chạy lại ngay" trên web -> kích hoạt GitHub Actions
  if (key === "run" && request.method === "POST") {
    if (!env.GH_TOKEN || !env.GH_REPO) return json({ error: "Chưa cài GH_TOKEN / GH_REPO" }, 400);
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/daily.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_TOKEN}`, accept: "application/vnd.github+json", "user-agent": "vn-stock" },
      body: JSON.stringify({ ref: "main" }),
    });
    return json({ ok: r.status === 204, status: r.status }, r.status === 204 ? 200 : 502);
  }

  if (!KEYS.has(key)) return json({ error: "Không có API này" }, 404);

  if (request.method === "GET") {
    const v = await env.VNSTOCK_KV.get(key);
    return json(v ? JSON.parse(v) : (key === "portfolio" ? { holdings: [], cash: 0, capital: null } : {}));
  }
  if (request.method === "PUT") {
    let body;
    try { body = await request.json(); } catch (e) { return json({ error: "Dữ liệu không hợp lệ" }, 400); }
    const text = JSON.stringify(body);
    if (text.length > 200000) return json({ error: "Dữ liệu quá lớn" }, 413);
    await env.VNSTOCK_KV.put(key, text);
    return json({ ok: true });
  }
  return json({ error: "Phương thức không hỗ trợ" }, 405);
}
