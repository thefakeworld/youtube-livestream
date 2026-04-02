/**
 * 简单反向代理：监听 4000 端口，将所有请求转发到 3000 端口
 *
 * 用途：系统自动运行 bun run dev 占用 3000，代理层提供稳定的访问入口
 */

const PROXY_PORT = parseInt(process.env.PROXY_PORT || "4000", 10);
const TARGET_PORT = parseInt(process.env.TARGET_PORT || "3000", 10);
const TARGET_HOST = process.env.TARGET_HOST || "127.0.0.1";

console.log(`[proxy] Starting on :${PROXY_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);

const server = Bun.serve({
  port: PROXY_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // 健康检查
    if (url.pathname === "/__proxy_health") {
      return new Response(JSON.stringify({ status: "ok", target: `${TARGET_HOST}:${TARGET_PORT}` }), {
        headers: { "content-type": "application/json" },
      });
    }

    // 构建目标 URL
    const targetUrl = `${req.protocol === "https:" ? "https" : "http"}://${TARGET_HOST}:${TARGET_PORT}${url.pathname}${url.search}`;

    // 转发请求头
    const headers = new Headers(req.headers);
    headers.set("host", `${TARGET_HOST}:${TARGET_PORT}`);
    headers.set("x-forwarded-for", headers.get("x-forwarded-for") || "");
    headers.set("x-forwarded-proto", "http");
    headers.set("x-real-ip", "127.0.0.1");

    try {
      const resp = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        redirect: "manual",
      });

      // 构建响应
      const respHeaders = new Headers(resp.headers);
      respHeaders.set("x-proxy", "bun-proxy");

      return new Response(resp.body, {
        status: resp.status,
        statusText: resp.statusText,
        headers: respHeaders,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[proxy] Error forwarding ${req.method} ${url.pathname}: ${message}`);

      return new Response(
        JSON.stringify({
          error: "Proxy Error",
          message: `Failed to reach backend at ${TARGET_HOST}:${TARGET_PORT}`,
          detail: message,
        }),
        {
          status: 502,
          headers: { "content-type": "application/json" },
        },
      );
    }
  },
});

console.log(`[proxy] ✅ Running on http://0.0.0.0:${PROXY_PORT} -> http://${TARGET_HOST}:${TARGET_PORT}`);
