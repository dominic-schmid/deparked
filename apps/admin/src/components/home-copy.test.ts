import { describe, expect, it } from "vitest";
import { countWord, greeting, homeHeadline, homeView, statusSummary } from "./home-copy";

const domain = (status: "live" | "draft" | "off" | "error" | "email_pending", newOffers = 0, host = "example.com") => ({
  host,
  status,
  newOffers,
});

describe("homeHeadline", () => {
  it("invites the first domain when there is none", () => {
    expect(homeHeadline([])).toBe("Put your first domain in the window.");
  });

  it("says plainly that nothing is waiting", () => {
    expect(homeHeadline([domain("live"), domain("draft", 0, "example.org")])).toBe("Your domains are on show.");
    expect(homeHeadline([domain("live")])).toBe("example.com is on show.");
  });

  it("names the domain someone wants when one offer waits", () => {
    expect(homeHeadline([domain("live", 1, "quietmoney.com"), domain("live")])).toBe("Someone wants quietmoney.com.");
  });

  it("leaves a name too long for a headline to the cards", () => {
    const long = "the-longest-domain-name-anyone-would-register.example";
    expect(homeHeadline([domain("live", 1, long)])).toBe("Someone wants one of your domains.");
    expect(homeHeadline([domain("live", 0, long)])).toBe("Your domain is on show.");
  });

  it("counts the waiting offers in words", () => {
    expect(homeHeadline([domain("live", 4), domain("draft", 2, "example.org")])).toBe(
      "Six offers are waiting for you.",
    );
    expect(homeHeadline([domain("live", 1234)])).toBe("1,234 offers are waiting for you.");
  });
});

describe("statusSummary", () => {
  it("lists what each page is doing", () => {
    expect(
      statusSummary([domain("live"), domain("email_pending"), domain("draft"), domain("error"), domain("off")]),
    ).toBe("Two pages are live, one is waiting for its design, one needs a fix and one is turned off.");
  });

  it("starts with whatever there is", () => {
    expect(statusSummary([domain("draft"), domain("draft")])).toBe("Two pages are waiting for their design.");
    expect(statusSummary([domain("live")])).toBe("One page is live.");
    expect(statusSummary([domain("error"), domain("error"), domain("live")])).toBe(
      "One page is live and two need a fix.",
    );
  });

  it("offers the first step without domains", () => {
    expect(statusSummary([])).toBe("Pick one from your Cloudflare account. Nothing changes until you say yes.");
  });
});

describe("countWord", () => {
  it("spells out small numbers and groups big ones", () => {
    expect(countWord(1)).toBe("one");
    expect(countWord(12)).toBe("twelve");
    expect(countWord(13)).toBe("13");
    expect(countWord(25_000)).toBe("25,000");
  });
});

describe("greeting", () => {
  it("names the day and the part of it", () => {
    expect(greeting(new Date(2026, 10, 13, 8))).toBe("Friday morning");
    expect(greeting(new Date(2026, 10, 13, 14))).toBe("Friday afternoon");
    expect(greeting(new Date(2026, 10, 13, 20))).toBe("Friday evening");
    expect(greeting(new Date(2026, 10, 14, 2))).toBe("Friday night");
  });
});

describe("homeView", () => {
  it("reads the remembered view from the cookie header", () => {
    expect(homeView("a=1; deparked-view=list; b=2")).toBe("list");
    expect(homeView("deparked-view=grid")).toBe("grid");
    expect(homeView("deparked-view=table")).toBe("grid");
    expect(homeView(null)).toBe("grid");
  });
});
