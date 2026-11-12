import { Field, FieldDescription, FieldLabel } from "@deparked/ui/field";
import { Input } from "@deparked/ui/input";
import { createFileRoute } from "@tanstack/react-router";
import { useId } from "react";
import { AuthForm, AuthPage, PasswordField } from "../../../components/auth-form";
import { NEW_PASSWORD_ERRORS, oneOf, PASSWORD_HINT } from "../../../components/messages";
import { completeSetup } from "../../../server/auth/account";
import { checkNewPassword, PASSWORD_MIN_LENGTH } from "../../../server/auth/password";
import { sessionCookie } from "../../../server/auth/session";
import { authRequest, badForm, readForm, readSession, seeOther } from "../../../server/request";

const ERRORS = {
  ...NEW_PASSWORD_ERRORS,
  invalid_secret: "This setup link is not valid any more. Open the installer to get a new one.",
} as const;

export const Route = createFileRoute("/admin/setup/")({
  validateSearch: (search) => ({
    // The secret from the installer's link. A value the URL parser read as a number or boolean is not one.
    secret: typeof search.secret === "string" ? search.secret : undefined,
    error: oneOf(search.error, ["too_short", "too_long", "mismatch", "invalid_secret"]),
  }),
  head: () => ({ meta: [{ title: "Create your password · Deparked" }] }),
  server: {
    handlers: {
      POST: async ({ request }) => {
        const field = await readForm(request);
        if (field === null) return badForm();
        const secret = field("secret").trim();
        const password = field("password");
        const passwordError = checkNewPassword(password, field("confirm"));
        if (passwordError !== null) {
          return seeOther(`/admin/setup?secret=${encodeURIComponent(secret)}&error=${passwordError}`);
        }
        const { db, sessionKey, url, now } = authRequest(request);
        const result = await completeSetup(db, { secret, password, sessionKey, now });
        if (result.ok) return seeOther("/admin", sessionCookie(url, result.token));
        // A double submit: the first request already used the secret and logged this browser in.
        if ((await readSession(request)).session !== null) return seeOther("/admin");
        return seeOther("/admin/setup?error=invalid_secret");
      },
    },
  },
  component: SetupPage,
});

function SetupPage() {
  const { secret, error } = Route.useSearch();
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
        {secret ? (
          <input type="hidden" name="secret" value={secret} />
        ) : (
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
          autoFocus={Boolean(secret)}
        />
        <PasswordField label="Repeat password" name="confirm" autoComplete="new-password" />
      </AuthForm>
    </AuthPage>
  );
}
