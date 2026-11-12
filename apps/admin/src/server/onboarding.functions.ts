import { env } from "cloudflare:workers";
import { createDb } from "@deparked/db";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadOnboarding, onboardingScreen } from "./onboarding";
import { requireSession } from "./require-session";

/** The wizard's screen and the addresses its inbox screen shows. A workspace with a domain goes to the overview. */
export const getOnboarding = createServerFn()
  .validator(z.object({ wantsDomainStep: z.boolean() }))
  .handler(async ({ data }) => {
    await requireSession();
    const { addresses, domainCount } = await loadOnboarding(createDb(env.DB));
    const screen = onboardingScreen({ addressCount: addresses.length, domainCount, ...data });
    if (screen === "done") throw redirect({ href: "/admin" });
    return { screen, addresses, now: Date.now() };
  });
