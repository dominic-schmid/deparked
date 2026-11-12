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
 * hostname. `targets.admin` must be an admin that reads its requests as https (`--upstream-protocol https`),
 * as on a real domain: over plain http the admin would redirect a non-local hostname to https. So Origin and
 * Referer become `https://<host>`, and redirects to `<host>` are pointed at the proxy again.
 */
const LOCAL_HOST = /^((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})\.localhost(?::\d+)?$/;

export async function startHostProxy(targets: { admin: string; sites: string }): Promise<HostProxy> {
  const server = createServer((incoming, outgoing) => {
    const local = incoming.headers.host ?? "";
    const host = LOCAL_HOST.exec(local)?.[1];
    if (host === undefined) {
      outgoing.writeHead(400).end("e2e proxy: the Host header must be <domain>.localhost:<port>");
      return;
    }
    const url = new URL(incoming.url ?? "/", "http://proxy");
    const toAdmin = /^\/(admin|api\/)/.test(url.pathname);
    const path =
      toAdmin || url.pathname.startsWith("/catalog/")
        ? url.pathname
        : `/sites/${host}${url.pathname === "/" ? "/index.html" : url.pathname}`;
    const headers = { ...incoming.headers, host };
    for (const name of ["origin", "referer"] as const) {
      const value = headers[name];
      if (value !== undefined) headers[name] = value.replace(`http://${local}`, `https://${host}`);
    }
    const upstream = request(
      new URL(path + url.search, toAdmin ? targets.admin : targets.sites),
      { method: incoming.method, headers },
      (response) => {
        const location = response.headers.location?.replace(
          new RegExp(`^https?://${host.replaceAll(".", "\\.")}(?=/|$)`),
          `http://${local}`,
        );
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
