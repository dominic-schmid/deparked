import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, AuthPage, PasswordField } from "../../components/auth-form";
import { lockedMessage, oneOf, retryMinutes, retrySearch } from "../../components/messages";
import { login } from "../../server/auth/account";
import { sessionCookie } from "../../server/auth/session";
import { authRequest, badForm, readForm, seeOther } from "../../server/request";

export const Route = createFileRoute("/admin/login")({
  validateSearch: (search) => ({
    error: oneOf(search.error, ["invalid", "locked"]),
    retry: retryMinutes(search.retry),
  }),
  head: () => ({ meta: [{ title: "Log in · Deparked" }] }),
  server: {
    handlers: {
      POST: async ({ request }) => {
        const field = await readForm(request);
        if (field === null) return badForm();
        const { db, sessionKey, url, ip, now } = authRequest(request);
        const result = await login(db, { password: field("password"), ip, sessionKey, now });
        if (result.ok) return seeOther("/admin", sessionCookie(url, result.token));
        if (result.reason === "locked")
          return seeOther(`/admin/login?error=locked&${retrySearch(result.retryAfterMs)}`);
        return seeOther("/admin/login?error=invalid");
      },
    },
  },
  component: LoginPage,
});

function LoginPage() {
  const { error, retry } = Route.useSearch();
  const message =
    error === "locked" ? lockedMessage(retry) : error === "invalid" ? "That password is not right." : undefined;
  return (
    <AuthPage title="Log in to Deparked">
      <AuthForm action="/admin/login" submit="Log in" submitting="Logging in…" error={message}>
        <PasswordField label="Password" name="password" autoComplete="current-password" autoFocus />
      </AuthForm>
    </AuthPage>
  );
}
