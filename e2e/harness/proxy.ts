import { createServer, request } from "node:http";
import type { AddressInfo } from "node:net";

export interface HostProxy {
  port: number;
  close(): Promise<void>;
}

/**
 * Stands in for a zone's routes and rewrite rule, which do not exist locally. A request to
 * `http://<host>.localhost:<port>/…` goes where Cloudflare would send `https://<host>/…`:
 * `/admin*` and `/api/*` to the admin Worker, `/catalog/*` to the sites Worker as is, everything else to
 * the sites Worker under `/sites/<host>/` (`/` is `/sites/<host>/index.html`). The Workers see `<host>` as the
 * hostname, also in Origin and Referer; redirects back to `<host>` are pointed at the proxy again.
 */
export async function startHostProxy(targets: { admin: string; sites: string }): Promise<HostProxy> {
  const server = createServer((incoming, outgoing) => {
    const local = incoming.headers.host ?? "";
    const host = local.replace(/\.localhost(:\d+)?$/, "");
    const url = new URL(incoming.url ?? "/", "http://proxy");
    const toAdmin = /^\/(admin|api\/)/.test(url.pathname);
    const path =
      toAdmin || url.pathname.startsWith("/catalog/")
        ? url.pathname
        : `/sites/${host}${url.pathname === "/" ? "/index.html" : url.pathname}`;
    const headers = { ...incoming.headers, host };
    for (const name of ["origin", "referer"] as const) {
      const value = headers[name];
      if (value !== undefined) headers[name] = value.replace(local, host);
    }
    const upstream = request(
      new URL(path + url.search, toAdmin ? targets.admin : targets.sites),
      { method: incoming.method, headers },
      (response) => {
        const location = response.headers.location?.replace(new RegExp(`^https?://${host}(?=/|$)`), `http://${local}`);
        outgoing.writeHead(response.statusCode ?? 502, {
          ...response.headers,
          ...(location === undefined ? {} : { location }),
        });
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      outgoing.writeHead(502).end("e2e proxy: the Worker did not answer");
    });
    incoming.pipe(upstream);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
