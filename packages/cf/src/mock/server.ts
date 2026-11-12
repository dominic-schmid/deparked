import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createMockCloudflare, type MockCloudflare, type MockSeed } from "./mock";

export interface MockCloudflareServer {
  /** `http://127.0.0.1:<port>`. The client's `baseUrl` is `${url}/client/v4`; siteverify is `${url}/turnstile/v0/siteverify`. */
  url: string;
  mock: MockCloudflare;
  close(): Promise<void>;
}

/** Serves the mock over HTTP for Workers running under `wrangler dev`. Node only. Port 0 picks a free port. */
export async function startMockCloudflare(
  options: MockSeed & { port?: number; mock?: MockCloudflare } = {},
): Promise<MockCloudflareServer> {
  const { port = 0, mock = createMockCloudflare(options) } = options;
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(name, value);
      }
      const hasBody = incoming.method !== "GET" && incoming.method !== "HEAD";
      const request = new Request(`http://${incoming.headers.host ?? "127.0.0.1"}${incoming.url ?? "/"}`, {
        method: incoming.method ?? "GET",
        headers,
        ...(hasBody ? { body: Buffer.concat(chunks) } : {}),
      });
      mock
        .fetch(request)
        .then(async (response) => {
          outgoing.writeHead(response.status, Object.fromEntries(response.headers));
          outgoing.end(Buffer.from(await response.arrayBuffer()));
        })
        .catch(() => {
          outgoing.writeHead(500, { "content-type": "application/json" });
          outgoing.end(JSON.stringify({ success: false, errors: [{ code: 0, message: "mock crashed" }] }));
        });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    mock,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      }),
  };
}
