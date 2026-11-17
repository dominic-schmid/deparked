import { describe, expect, it } from "vitest";
import { itemsSummary, lookRows, setupItems, TODAY_ROW } from "./pictures";

const steps = [
  { id: "register", title: "Check the domain", status: "needed" },
  { id: "bot-check", title: "Protect the offer form from bots", status: "needed" },
  { id: "analytics", title: "Count visits", status: "done" },
  { id: "email", title: "Set up the sender of offer emails", status: "needed" },
  { id: "publish-placeholder", title: "Publish the placeholder page", status: "needed" },
  { id: "routes", title: "Point the address at Deparked", status: "done" },
  { id: "dns", title: "Make the address reachable", status: "needed" },
  { id: "ready", title: "Finish", status: "needed" },
];

describe("setupItems", () => {
  it("groups the steps into the things the owner knows, page first, without the bookkeeping", () => {
    const items = setupItems(steps);
    expect(items.map((item) => item.key)).toEqual(["page", "bot", "visits", "email", "address"]);
    expect(itemsSummary(items)).toBe("Page, bot check, visits, email, address");
  });

  it("calls a thing already there only when every step in it was", () => {
    const items = setupItems(steps);
    expect(items.find((item) => item.key === "visits")?.done).toBe(true);
    expect(items.find((item) => item.key === "address")?.done).toBe(false);
  });

  it("keeps a step it does not know under its own title, last", () => {
    const items = setupItems([...steps, { id: "future", title: "Something new" }]);
    expect(items.at(-1)).toMatchObject({ key: "future", label: "Something new" });
  });
});

describe("lookRows", () => {
  it("starts with what the domain shows today, then the same things in the same order", () => {
    const rows = lookRows(steps);
    expect(rows.map((row) => row.key)).toEqual([TODAY_ROW, "page", "bot", "visits", "email", "address"]);
    expect(rows[0]?.steps).toEqual(["register", "ready"]);
    expect(rows.at(-1)?.steps).toEqual(["routes", "dns"]);
  });

  it("puts every step in exactly one row, an unknown one under its own title", () => {
    const all = [...steps, { id: "future", title: "Something new" }];
    const rows = lookRows(all);
    expect(rows.flatMap((row) => row.steps).sort()).toEqual(all.map((step) => step.id).sort());
    expect(rows.at(-1)).toMatchObject({ key: "future", label: "Something new" });
  });
});
