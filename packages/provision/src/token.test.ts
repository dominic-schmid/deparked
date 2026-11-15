import { describe, expect, it } from "vitest";
import { setup } from "./test-helpers";
import { checkTokenPermissions } from "./token";

describe("checkTokenPermissions", () => {
  it("checks an account with more domains than one page of the zone list", async () => {
    const zones = Array.from({ length: 60 }, (_, index) => ({ id: `zone-${index}`, name: `domain-${index}.com` }));
    const { ctx } = await setup({ zones });
    expect(await checkTokenPermissions(ctx.cf)).toMatchObject({ missing: [] });
  });
});
