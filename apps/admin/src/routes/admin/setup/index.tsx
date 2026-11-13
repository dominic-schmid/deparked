import { PasswordField } from "@deparked/ui/arc/password-field";
import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { FlowTitle } from "@deparked/ui/flow";
import { Input } from "@deparked/ui/input";
import { createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { AuthForm } from "../../../components/auth-form";
import { NEW_PASSWORD_ERRORS, oneOf, PASSWORD_HINT } from "../../../components/messages";
import { Screen, SetupShell, Split } from "../../../components/onboarding";
import { LockedAdmin } from "../../../components/pictures";
import { completeSetup } from "../../../server/auth/account";
import { checkNewPassword, PASSWORD_MIN_LENGTH } from "../../../server/auth/password";
import { clearedSetupSecretCookie, readSetupSecret, sessionCookie } from "../../../server/auth/session";
import { afterSetupPath, loadOnboarding } from "../../../server/onboarding";
import { authRequest, badForm, readForm, readSession, seeOther } from "../../../server/request";

const ERRORS = {
  ...NEW_PASSWORD_ERRORS,
  invalid_secret: "This setup link is not valid any more. Open the installer to get a new one.",
} as const;

export const Route = createFileRoute("/admin/setup/")({
  validateSearch: (search) => ({
    // Set by the middleware after it moved the link's secret into a cookie: no code field is needed.
    link: search.link === 1 ? (1 as const) : undefined,
    error: oneOf(search.error, ["too_short", "too_long", "mismatch", "invalid_secret"]),
  }),
  head: () => ({ meta: [{ title: "Create your password · Deparked" }] }),
  server: {
    handlers: {
      POST: async ({ request }) => {
        const field = await readForm(request);
        if (field === null) return badForm();
        // A pasted code wins; otherwise the secret the middleware took from the link. It never goes into a URL.
        const pasted = field("secret").trim();
        const fromLink = pasted === "" ? readSetupSecret(request) : null;
        const password = field("password");
        const passwordError = checkNewPassword(password, field("confirm"));
        if (passwordError !== null) {
          return seeOther(`/admin/setup?${fromLink === null ? "" : "link=1&"}error=${passwordError}`);
        }
        const { db, sessionKey, url, now } = authRequest(request);
        const result = await completeSetup(db, { secret: fromLink ?? pasted, password, sessionKey, now });
        if (result.ok) {
          const { addresses, domainCount } = await loadOnboarding(db);
          const next = afterSetupPath({ addressCount: addresses.length, domainCount });
          return seeOther(next, sessionCookie(url, result.token), clearedSetupSecretCookie(url));
        }
        // A double submit: the first request already used the secret and logged this browser in.
        if ((await readSession(request)).session !== null) return seeOther("/admin");
        return seeOther("/admin/setup?error=invalid_secret", clearedSetupSecretCookie(url));
      },
    },
  },
  component: SetupPage,
});

function SetupPage() {
  const { link, error } = Route.useSearch();
  const secretId = useId();
  const secretHintId = useId();
  return (
    <SetupShell>
      <Screen>
        <Split picture={<LockedAdmin />}>
          <FlowTitle title="Create your password" focus={!link}>
            <p>One password opens this admin and every domain in it.</p>
          </FlowTitle>
          <div className="max-w-[30rem]">
            <AuthForm
              action="/admin/setup"
              submit="Create password"
              submitting="Creating…"
              look="flow"
              error={error ? ERRORS[error] : undefined}
            >
              {link ? null : (
                <Field>
                  <FieldLabel htmlFor={secretId}>Setup code</FieldLabel>
                  <Input
                    id={secretId}
                    name="secret"
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby={secretHintId}
                    className="h-12 font-mono"
                  />
                  <FieldDescription id={secretHintId}>
                    The installer shows it as a link. Open that link, or paste the code after “secret=” here.
                  </FieldDescription>
                </Field>
              )}
              <PasswordField
                label="Password"
                name="password"
                required
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                minLength={PASSWORD_MIN_LENGTH}
                description={PASSWORD_HINT}
                autoFocus={Boolean(link)}
              />
              <PasswordField
                label="Repeat password"
                name="confirm"
                required
                autoComplete="new-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </AuthForm>
          </div>
        </Split>
      </Screen>
    </SetupShell>
  );
}
