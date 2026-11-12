import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Config } from "@deparked/config";
import { defaultConfig } from "@deparked/config";
import { expect, type Page, test } from "@playwright/test";
import { html, ORIGIN, open, serve, TOKEN, variants } from "./lander";

const page1 = (variant: keyof typeof variants, change: Partial<Config> = {}) =>
  html({ ...defaultConfig(), ...change, variant }, "example.com");
const amount = (page: Page) => page.locator('input[name="amount"]');
const name = (page: Page) => page.locator('input[name="name"]');
const email = (page: Page) => page.locator('input[name="email"]');
const send = (page: Page) => page.locator('button[type="submit"]');

async function fillOffer(page: Page, value = "1500") {
  await amount(page).fill(value);
  await name(page).fill("Ada Example");
  await email(page).fill("ada@example.com");
}

for (const variant of Object.keys(variants) as (keyof typeof variants)[]) {
  test.describe(`${variant}: offer form`, () => {
    test("hydrates cleanly", async ({ page }) => {
      const problems: string[] = [];
      page.on("pageerror", (error) => problems.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(message.text());
      });
      await open(page, page1(variant));
      await expect(page.locator("form")).toHaveAttribute("novalidate", "");
      expect(problems).toEqual([]);
    });

    test("keeps what was typed before the script arrived", async ({ page }) => {
      await page.route("**/catalog/islands/*", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 600));
        await route.fallback();
      });
      await open(page, page1(variant));
      await name(page).fill("Ada Example");
      await expect(page.locator("form")).toHaveAttribute("novalidate", "");
      await expect(name(page)).toHaveValue("Ada Example");
    });

    test("rejects an offer under the minimum at once, without asking the server", async ({ page }) => {
      const offers = await open(page, page1(variant));
      await fillOffer(page, "999");
      await send(page).click();
      await expect(page.getByRole("alert")).toHaveText("Offers start at €1,000");
      await expect(amount(page)).toHaveAttribute("aria-invalid", "true");
      await expect(amount(page)).toBeFocused();
      expect(offers).toHaveLength(0);

      await amount(page).pressSequentially("9");
      await expect(page.getByRole("alert")).toBeHidden();
      await expect(amount(page)).not.toHaveAttribute("aria-invalid", "true");
      await expect(amount(page)).toHaveValue("9,999");
    });

    test("names the first missing field and clears the message as it is filled", async ({ page }) => {
      const offers = await open(page, page1(variant));
      await send(page).click();
      await expect(page.getByRole("alert")).toHaveText("Add an amount");
      await amount(page).fill("2000");
      await expect(page.getByRole("alert")).toBeHidden();
      await send(page).click();
      await expect(page.getByRole("alert")).toHaveText("Add your name");
      await name(page).fill("Ada Example");
      await email(page).fill("not-an-address");
      await send(page).click();
      await expect(page.getByRole("alert")).toHaveText("Add an email we can reply to");
      expect(offers).toHaveLength(0);
    });

    test("sends the offer as JSON with the Turnstile token and thanks the buyer", async ({ page }) => {
      const offers = await open(page, page1(variant));
      await fillOffer(page, "12500");
      await expect(amount(page)).toHaveValue("12,500");
      await send(page).click();
      await expect(page.getByRole("heading", { level: 2 })).toHaveText(
        "Thanks, Ada Example. Your €12,500 offer is with the owner.",
      );
      await expect(page.getByText("The reply goes to ada@example.com.")).toBeVisible();
      await expect(page.locator("form")).toBeHidden();
      expect(offers).toHaveLength(1);
      expect(offers[0]?.headers()["content-type"]).toBe("application/json");
      expect(offers[0]?.postDataJSON()).toEqual({
        amount: 12500,
        name: "Ada Example",
        email: "ada@example.com",
        website: "",
        "cf-turnstile-response": TOKEN,
      });
    });

    test("shows the server's message on the field it names and lets the buyer try again", async ({ page }) => {
      let attempts = 0;
      await open(page, page1(variant), () =>
        attempts++ === 0
          ? {
              status: 400,
              body: JSON.stringify({ ok: false, field: "email", error: "Enter an email address we can reply to." }),
            }
          : { status: 200, body: '{"ok":true}' },
      );
      await fillOffer(page);
      await send(page).click();
      await expect(page.getByRole("alert")).toHaveText("Enter an email address we can reply to.");
      await expect(email(page)).toHaveAttribute("aria-invalid", "true");
      await expect(send(page)).toBeEnabled();
      await expect(send(page)).toHaveText("Send offer");
      await send(page).click();
      await expect(page.locator("form")).toBeHidden();
    });

    test("says so when the server cannot be reached", async ({ page }) => {
      await open(page, page1(variant), () => ({ status: 500, body: "upstream error" }));
      await fillOffer(page);
      await send(page).click();
      await expect(page.getByRole("alert")).toHaveText("That didn't go through. Try again in a minute.");
      await expect(send(page)).toBeEnabled();
    });

    test("renders hostile copy as text", async ({ page }) => {
      const hostile = `"><img src=x onerror="window.pwned=1"><script>window.pwned=1</script>`;
      let dialogs = 0;
      page.on("dialog", () => dialogs++);
      await open(
        page,
        page1(variant, {
          headline: hostile,
          sentence: `${hostile} {amount} {name} {email}`,
          escrowLine: hostile,
          seo: { title: hostile, description: hostile },
        }),
      );
      await expect(page.locator("h1")).toHaveText(hostile);
      expect(await page.evaluate(() => (window as { pwned?: number }).pwned)).toBeUndefined();
      expect(await page.locator("img[src=x]").count()).toBe(0);
      expect(dialogs).toBe(0);
    });
  });

  test.describe(`${variant}: without JavaScript`, () => {
    test.use({ javaScriptEnabled: false });

    test("shows all the copy, and says offers need JavaScript where the button would be", async ({ page }) => {
      await open(page, page1(variant));
      await expect(page.locator("h1")).toHaveText("example.com");
      await expect(page.getByText("I'd like to buy example.com for")).toBeVisible();
      await expect(page.getByText("The owner reads every offer and replies by email.")).toBeVisible();
      await expect(page.locator(".nojs")).toBeVisible();
      await expect(page.locator(".nojs")).toHaveText(
        "Offers need JavaScript for the spam check. Turn it on and reload this page to send yours.",
      );
      // the bot check cannot run, so no button pretends the offer can be sent
      await expect(send(page)).toBeHidden();
      await expect(page.locator("form")).toHaveAttribute("method", "post");
      await expect(page.locator("form")).toHaveAttribute("action", "/api/offer");
      for (const field of [amount(page), name(page), email(page)]) {
        await expect(field).toBeVisible();
        await expect(field).toHaveAttribute("required", "");
      }
      // nothing waits for a script to fade it in
      expect(await page.locator("h1").evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
    });

    test("offers the marketplace listing as the way to make an offer", async ({ page }) => {
      await open(page, page1(variant, { marketplaceUrl: "https://www.example.org/listing/1" }));
      const note = page.locator(".nojs");
      await expect(note).toHaveText(
        "Offers need JavaScript for the spam check. Turn it on and reload, or make your offer on example.org.",
      );
      await expect(note.getByRole("link", { name: "example.org" })).toHaveAttribute(
        "href",
        "https://www.example.org/listing/1",
      );
    });

    // A real server here: a redirect answered by request interception is not followed.
    test("posts the fields form-encoded and shows the thank-you the server redirects to", async ({ page }) => {
      const posted: { contentType: string | undefined; body: string }[] = [];
      const server = createServer((request, response) => {
        if (request.method !== "POST") return response.setHeader("content-type", "text/html").end(page1(variant));
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          posted.push({ contentType: request.headers["content-type"], body });
          response.writeHead(303, { location: "/#offer-sent" }).end();
        });
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      try {
        await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
        await fillOffer(page);
        // Enter still submits: the server answers, and the static page shows its answer
        await email(page).press("Enter");
        await expect(page.getByText("Thanks. Your offer is with the owner.")).toBeVisible();
        await expect(page.locator("form")).toBeHidden();
        expect(posted).toHaveLength(1);
        expect(posted[0]?.contentType).toBe("application/x-www-form-urlencoded");
        expect(Object.fromEntries(new URLSearchParams(posted[0]?.body))).toEqual({
          amount: "1500",
          name: "Ada Example",
          email: "ada@example.com",
          website: "",
        });
      } finally {
        server.close();
      }
    });

    test("shows the reason the server redirects back with", async ({ page }) => {
      await serve(page, page1(variant));
      await page.goto(`${ORIGIN}/`);
      await expect(page.getByText("Offers start at €1,000")).toBeHidden();
      await page.goto(`${ORIGIN}/#offer-error-amount`);
      await expect(page.getByText("Offers start at €1,000")).toBeVisible();
      await expect(page.getByText("Add your name")).toBeHidden();
      await expect(page.locator("form")).toBeVisible();
    });
  });
}
