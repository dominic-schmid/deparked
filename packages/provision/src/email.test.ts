import { getDomain, listLedger } from "@deparked/db";
import { describe, expect, it } from "vitest";
import { planAttachDomain } from "./attach";
import { MX_CLOUDFLARE, MX_EXTERNAL, MX_NONE } from "./fixtures/mx";
import { inspectDomain } from "./inspect";
import { runPlan, setup, ZONE } from "./test-helpers";
import { planTurnOff } from "./turn-off";

const HOST = "example.com";
const OTHER = { id: "zone-2", name: "example.org" };

const mailEntries = async (db: Parameters<typeof listLedger>[0], host = HOST) =>
  (await listLedger(db, { host })).filter((entry) => entry.resource === "email_routing");

describe("Email Routing after the MX check", () => {
  it("no MX records: turns Cloudflare's email service on and sends from the domain itself", async () => {
    const { ctx, mock, db } = await setup({ dnsRecords: { [ZONE.id]: MX_NONE } });
    expect(await inspectDomain(ctx, HOST)).toMatchObject({ mx: { state: "none", targets: [] } });

    await runPlan(planAttachDomain(ctx, HOST));
    expect(mock.callsTo("email.enableRouting")).toHaveLength(1);
    expect(await getDomain(db, HOST)).toMatchObject({ emailRoutingState: "enabled", senderHost: HOST });
    expect(await mailEntries(db)).toMatchObject([{ action: "created", cfId: ZONE.id }]);
  });

  it("Cloudflare's MX records: uses what is there and records nothing to undo", async () => {
    const { ctx, mock, db } = await setup({ dnsRecords: { [ZONE.id]: MX_CLOUDFLARE } });
    mock.state.emailRouting.set(ZONE.id, true);
    expect((await inspectDomain(ctx, HOST)).mx.state).toBe("cloudflare");

    await runPlan(planAttachDomain(ctx, HOST));
    expect(mock.callsTo("email.enableRouting")).toEqual([]);
    expect(await getDomain(db, HOST)).toMatchObject({ emailRoutingState: "enabled", senderHost: HOST });
    expect(await mailEntries(db)).toEqual([]);

    await runPlan(planTurnOff(ctx, HOST));
    expect(mock.callsTo("email.disableRouting")).toEqual([]);
    expect(mock.state.dnsRecords.get(ZONE.id)).toEqual(MX_CLOUDFLARE);
  });

  it("someone else's MX records: leaves mail alone by default", async () => {
    const { ctx, mock, db } = await setup({ dnsRecords: { [ZONE.id]: MX_EXTERNAL } });
    const inspection = await inspectDomain(ctx, HOST);
    expect(inspection.mx).toEqual({ state: "external", targets: ["aspmx.l.google.com", "alt1.aspmx.l.google.com"] });
    expect(inspection.summary).toContain("Deparked leaves your mail alone unless you say otherwise.");

    await runPlan(planAttachDomain(ctx, HOST));
    expect(mock.callsTo("email.enableRouting")).toEqual([]);
    expect(mock.state.dnsRecords.get(ZONE.id)?.filter((record) => record.type !== "AAAA")).toEqual(MX_EXTERNAL);
    expect(await getDomain(db, HOST)).toMatchObject({ emailRoutingState: "kept_external", senderHost: null });
    expect(await mailEntries(db)).toEqual([]);
  });

  it("someone else's MX records, replacement confirmed: remembers them and Turn off puts them back", async () => {
    const { ctx, mock, db } = await setup({ dnsRecords: { [ZONE.id]: MX_EXTERNAL } });
    const mx = () =>
      (mock.state.dnsRecords.get(ZONE.id) ?? [])
        .filter((record) => record.type === "MX")
        .map(({ name, content, priority, ttl }) => ({ name, content, priority, ttl }));
    const original = mx();

    await runPlan(planAttachDomain(ctx, HOST, { replaceExistingMx: true }));
    expect(mx()).toMatchObject([{ name: HOST, content: "route1.mx.cloudflare.net", priority: 10 }]);
    expect(await getDomain(db, HOST)).toMatchObject({ emailRoutingState: "enabled", senderHost: HOST });
    const [entry] = await mailEntries(db);
    expect(entry).toMatchObject({ action: "changed", cfId: ZONE.id });
    expect(JSON.parse(entry?.previousJson ?? "")).toEqual({ mx: original });

    await runPlan(planTurnOff(ctx, HOST));
    expect(mx()).toEqual(original);
    expect(mock.state.emailRouting.get(ZONE.id)).toBe(false);
    expect(mock.state.dnsRecords.get(ZONE.id)?.find((record) => record.type === "TXT")).toEqual(MX_EXTERNAL[2]);
  });

  it("remembers the mail records even when enabling fails, and writes them down only once", async () => {
    const { ctx, mock, db } = await setup({ dnsRecords: { [ZONE.id]: MX_EXTERNAL } });
    mock.failNext({ route: "email.enableRouting", status: 403 });

    const failed = await runPlan(planAttachDomain(ctx, HOST, { replaceExistingMx: true }));
    expect(failed.at(-1)).toMatchObject({ outcome: "failed", step: { id: "email" } });
    await runPlan(planAttachDomain(ctx, HOST, { replaceExistingMx: true }));
    expect(await mailEntries(db)).toHaveLength(1);
    expect(mock.state.emailRouting.get(ZONE.id)).toBe(true);
  });

  it("a domain that keeps its mail sends offers from another managed domain", async () => {
    const { ctx, db } = await setup({ zones: [ZONE, OTHER], dnsRecords: { [ZONE.id]: MX_EXTERNAL } });
    await runPlan(planAttachDomain(ctx, HOST));
    expect((await getDomain(db, HOST))?.senderHost).toBeNull();

    await runPlan(planAttachDomain(ctx, OTHER.name));
    const again = await runPlan(planAttachDomain(ctx, HOST));
    expect(again.filter((report) => report.outcome === "ran").map((report) => report.step?.id)).toEqual(["email"]);
    expect(await getDomain(db, HOST)).toMatchObject({ emailRoutingState: "kept_external", senderHost: OTHER.name });

    // Turning the sender off moves the dependent domain off it.
    await runPlan(planTurnOff(ctx, OTHER.name));
    expect((await getDomain(db, HOST))?.senderHost).toBeNull();
  });
});
