import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { relative, resolve } from "node:path";

export interface ReleaseFiles {
  /** The admin's `RELEASE_FILES_URL`: served paths (`/catalog/...`) are appended to it. */
  url: string;
  close(): Promise<void>;
}

/**
 * Stands in for the installed release's download location: serves `root` by path, as the release keeps the
 * catalog. The admin downloads a catalog file from here when the mock Cloudflare asks for it during a publish.
 */
export async function startReleaseFiles(root: string): Promise<ReleaseFiles> {
  const server = createServer((incoming, outgoing) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(incoming.url ?? "/", "http://release").pathname);
    } catch {
      outgoing.writeHead(400).end();
      return;
    }
    const file = resolve(root, `.${path}`);
    if (relative(root, file).startsWith("..")) {
      outgoing.writeHead(404).end();
      return;
    }
    readFile(file).then(
      (body) => outgoing.writeHead(200, { "content-length": body.length }).end(body),
      () => outgoing.writeHead(404).end(),
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((done) => server.close(() => done())),
  };
}
