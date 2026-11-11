import { expect, test } from "vitest";
import worker from "./worker";

test("/health reports the Worker", async () => {
  const response = worker.fetch(new Request("https://install.example.com/health"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, worker: "deparked-install" });
});

test("/ serves the installer page, uncached and unindexed", async () => {
  const response = worker.fetch(new Request("https://install.example.com/"));
  expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(response.headers.get("cache-control")).toBe("no-store");
  const html = await response.text();
  expect(html).toContain("<title>Deparked installer</title>");
  expect(html).toContain('name="robots" content="noindex"');
});

test("unknown paths are 404", () => {
  expect(worker.fetch(new Request("https://install.example.com/nope")).status).toBe(404);
});
