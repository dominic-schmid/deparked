const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Deparked installer</title>
</head>
<body>
<h1>Deparked installer</h1>
<p>The installer is not built yet.</p>
</body>
</html>
`;

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      return Response.json({ ok: true, worker: "deparked-install" });
    }
    if (pathname === "/") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};
