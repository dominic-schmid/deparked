import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { normalize, resolve, sep } from "node:path";

/**
 * Stands in for GitHub Releases and for raw.githubusercontent.com: `/v<version>/<file>` from the built release,
 * `/files/<path>` from the sites Worker's committed files. No redirects, like the admin expects.
 */
export async function startReleaseServer(options: { dir: string; files: string }) {
  const server = createServer((request, response) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    const [base, rest] = path.startsWith("/files/")
      ? [options.files, path.slice("/files/".length)]
      : [options.dir, path.split("/").slice(2).join("/")];
    const file = resolve(base, normalize(rest));
    if (!file.startsWith(base + sep) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-length": statSync(file).size });
    createReadStream(file).pipe(response);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
