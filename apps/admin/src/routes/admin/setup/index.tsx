import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { AuthForm, AuthPage, PasswordField } from "../../../components/auth-form";
import { NEW_PASSWORD_ERRORS, oneOf, PASSWORD_HINT } from "../../../components/messages";
import { completeSetup } from "../../../server/auth/account";
import { checkNewPassword, PASSWORD_MIN_LENGTH } from "../../../server/auth/password";
import { clearedSetupSecretCookie, readSetupSecret, sessionCookie } from "../../../server/auth/session";
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
        if (result.ok) return seeOther("/admin", sessionCookie(url, result.token), clearedSetupSecretCookie(url));
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
    <AuthPage title="Create your password" description="One password for this Deparked workspace and all its domains.">
      <AuthForm
        action="/admin/setup"
        submit="Create password"
        submitting="Creating…"
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
              className="font-mono"
            />
            <FieldDescription id={secretHintId}>
              The installer shows it as a link. Open that link, or paste the code after “secret=” here.
            </FieldDescription>
          </Field>
        )}
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          hint={PASSWORD_HINT}
          autoFocus={Boolean(link)}
        />
        <PasswordField label="Repeat password" name="confirm" autoComplete="new-password" />
      </AuthForm>
    </AuthPage>
  );
}
