import type { DomainToday, SetupStepPreview } from "@deparked/hosting";
import { describe, expect, it } from "vitest";
import { assembleLook, LOOK_START } from "./domain-look";

const today: DomainToday = {
  host: "example.com",
  inAccount: true,
  summary: "example.com shows nothing today.",
  blockers: [],
  asks: [],
  servesWebsite: false,
  takenRoutes: [],
  mail: "none",
  mailServers: [],
};
const titles = [
  { id: "register", title: "Check the domain" },
  { id: "email", title: "Set up the sender of offer emails" },
];
const step = (id: string, status: SetupStepPreview["status"]): [string, SetupStepPreview] => [
  id,
  { id, title: id, status, effects: [], reason: "" },
];

describe("assembleLook", () => {
  it("is not finished while the steps, today or one step's answer is missing", () => {
    expect(assembleLook(LOOK_START)).toBeNull();
    expect(assembleLook({ steps: titles, today: null, checked: new Map([step("register", "done")]) })).toBeNull();
    expect(assembleLook({ steps: titles, today, checked: new Map([step("register", "done")]) })).toBeNull();
  });

  it("lists the steps in the order of the attach, whatever order they answered in", () => {
    const checked = new Map([step("email", "needed"), step("register", "done")]);
    const preview = assembleLook({ steps: titles, today, checked });
    expect(preview?.steps.map((entry) => entry.id)).toEqual(["register", "email"]);
    expect(preview?.nothingToDo).toBe(false);
  });

  it("has nothing to do once every step is done, unless moving the mail is still on offer", () => {
    const checked = new Map([step("register", "done"), step("email", "done")]);
    expect(assembleLook({ steps: titles, today, checked })?.nothingToDo).toBe(true);
    const kept: DomainToday = { ...today, mail: "external", asks: ["replaceExistingMx"] };
    expect(assembleLook({ steps: titles, today: kept, checked })?.nothingToDo).toBe(false);
  });
});
