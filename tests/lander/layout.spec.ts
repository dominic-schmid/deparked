import { expect, test } from "@playwright/test";
import { BUYER, CASES, html, open, variants } from "./lander";
import { findLayoutFaults } from "./layout-check";

// Phones upright and on their side, tablets, laptops, desktops, 4K: 280x653 to 3840x2160.
const VIEWPORTS = [
  [280, 653],
  [320, 568],
  [360, 640],
  [375, 667],
  [390, 844],
  [412, 915],
  [430, 932],
  [568, 320],
  [667, 375],
  [740, 360],
  [844, 390],
  [932, 430],
  [600, 960],
  [768, 1024],
  [820, 1180],
  [1024, 1366],
  [1024, 768],
  [1180, 820],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
] as const;

test("covers 25 viewports", () => {
  expect(new Set(VIEWPORTS.map(([width, height]) => `${width}x${height}`)).size).toBe(25);
});

// Every variant in the registry is picked up here: a new one needs no change to this file.
for (const variant of Object.keys(variants) as (keyof typeof variants)[]) {
  for (const { name, host, config } of CASES) {
    test(`${variant}: ${name}`, async ({ page }) => {
      const faults: string[] = [];
      const check = async (state: string, size: readonly [number, number]) => {
        for (const fault of await page.evaluate(findLayoutFaults)) faults.push(`${size.join("x")} ${state}: ${fault}`);
      };
      await open(page, html({ ...config, variant }, host));

      for (const size of VIEWPORTS) {
        await page.setViewportSize({ width: size[0], height: size[1] });
        await check("as loaded", size);
      }

      // the worst a buyer can type, then Send with a missing name: long values and the error message at once
      await page.locator('input[name="amount"]').fill(BUYER.amount);
      await page.locator('input[name="email"]').fill(BUYER.email);
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole("alert")).not.toBeEmpty();
      await page.locator('input[name="name"]').fill(BUYER.name);
      await page.locator('input[name="amount"]').fill("1");
      await page.locator('button[type="submit"]').click();
      await expect(page.getByRole("alert")).not.toBeEmpty();
      for (const size of VIEWPORTS) {
        await page.setViewportSize({ width: size[0], height: size[1] });
        await check("filled in, with an error", size);
      }

      // and the thank-you that repeats the name, the amount and the address
      await page.locator('input[name="amount"]').fill(BUYER.amount);
      await page.locator('button[type="submit"]').click();
      await expect(page.locator("form")).toBeHidden();
      for (const size of VIEWPORTS) {
        await page.setViewportSize({ width: size[0], height: size[1] });
        await check("offer sent", size);
      }

      expect(faults, faults.join("\n")).toEqual([]);
    });
  }
}
