// Source of the bootstrap Worker `deparked-install` (decision doc section 13). It lives in the workspace so it can
// share code with packages/provision and packages/cf; `pnpm install:build` bundles it into apps/install/worker.js,
// which the Deploy button deploys as-is. Skeleton only: the onboarding and install steps arrive with DOM-370.

export interface Env {
  DB: D1Database;
}

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Deparked installer</title></head>
<body><main><h1>Deparked</h1><p>The installer is not ready yet.</p></main></body>
</html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const row = await env.DB.prepare("select 1 as ok").first<{ ok: number }>();
      return Response.json({ ok: row?.ok === 1 });
    }
    return new Response(PAGE, {
      headers: { "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
    });
  },
} satisfies ExportedHandler<Env>;
