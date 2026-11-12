import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { normalize, resolve, sep } from "node:path";

/** What `/latest` answers, in the shape of GitHub's "latest release" API. Null: no release yet (404). */
export type LatestRelease = { version: string; sha256: string } | null;

/**
 * Stands in for GitHub Releases and for raw.githubusercontent.com: `/v<version>/<file>` from the built release of
 * that version (`<dir>/<version>/`), `/latest` as GitHub's API describes the newest one, `/files/<path>` from the
 * sites Worker's committed files. No redirects, like the admin expects.
 */
export async function startReleaseServer(options: { dir: string; files: string }) {
  let latest: LatestRelease = null;
  const server = createServer((request, response) => {
    let path: string;
    try {
      path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    } catch {
      response.writeHead(400).end();
      return;
    }
    if (path === "/latest") {
      if (latest === null) {
        response.writeHead(404).end();
        return;
      }
      const { version, sha256 } = latest;
      const base = `${url}/v${version}`;
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          tag_name: `v${version}`,
          html_url: `https://github.com/dominic-schmid/deparked/releases/tag/v${version}`,
          assets: [{ name: "release.json", browser_download_url: `${base}/release.json`, digest: `sha256:${sha256}` }],
        }),
      );
      return;
    }
    const version = /^\/v(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+)?)\//.exec(path)?.[1];
    const [base, rest] = path.startsWith("/files/")
      ? [options.files, path.slice("/files/".length)]
      : [resolve(options.dir, version ?? "-"), path.split("/").slice(2).join("/")];
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
  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    setLatest: (release: LatestRelease) => {
      latest = release;
    },
    close: () =>
      new Promise<void>((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
