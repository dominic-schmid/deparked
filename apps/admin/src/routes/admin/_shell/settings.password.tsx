import { Button } from "@deparked/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@deparked/ui/card";
import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, PasswordField } from "../../../components/auth-form";
import {
  lockedMessage,
  NEW_PASSWORD_ERRORS,
  oneOf,
  PASSWORD_HINT,
  retryMinutes,
  retrySearch,
} from "../../../components/messages";
import { changePassword } from "../../../server/auth/account";
import { checkNewPassword, PASSWORD_MIN_LENGTH } from "../../../server/auth/password";
import { sessionCookie } from "../../../server/auth/session";
import { authRequest, badForm, readForm, seeOther } from "../../../server/request";
import { requireSession } from "../../../server/require-session";

const PATH = "/admin/settings/password";

export const Route = createFileRoute("/admin/_shell/settings/password")({
  validateSearch: (
    search,
  ): {
    error?: "too_short" | "too_long" | "mismatch" | "invalid" | "locked" | undefined;
    retry?: number | undefined;
    changed?: 1 | undefined;
  } => ({
    error: oneOf(search.error, ["too_short", "too_long", "mismatch", "invalid", "locked"]),
    retry: retryMinutes(search.retry),
    changed: search.changed === 1 ? (1 as const) : undefined,
  }),
  head: () => ({ meta: [{ title: "Change password · Deparked" }] }),
  server: {
    handlers: {
      POST: async ({ request }) => {
        await requireSession();
        const field = await readForm(request);
        if (field === null) return badForm();
        const newPassword = field("password");
        const passwordError = checkNewPassword(newPassword, field("confirm"));
        if (passwordError !== null) return seeOther(`${PATH}?error=${passwordError}`);
        const { db, sessionKey, url, ip, now } = authRequest(request);
        const result = await changePassword(db, {
          currentPassword: field("current"),
          newPassword,
          ip,
          sessionKey,
          now,
        });
        if (result.ok) return seeOther(`${PATH}?changed=1`, sessionCookie(url, result.token));
        if (result.reason === "locked") return seeOther(`${PATH}?error=locked&${retrySearch(result.retryAfterMs)}`);
        return seeOther(`${PATH}?error=invalid`);
      },
    },
  },
  component: ChangePasswordPage,
});

function ChangePasswordPage() {
  const { error, retry, changed } = Route.useSearch();
  const message =
    error === "locked"
      ? lockedMessage(retry)
      : error === "invalid"
        ? "The current password is not right."
        : error
          ? NEW_PASSWORD_ERRORS[error]
          : undefined;
  return (
    <div className="flex max-w-md flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Change password</h2>
          </CardTitle>
          <CardDescription>Changing it logs out every other browser. This one stays logged in.</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm
            action={PATH}
            submit="Change password"
            submitting="Changing…"
            error={message}
            notice={changed ? "Password changed. Every other browser was logged out." : undefined}
          >
            <PasswordField label="Current password" name="current" autoComplete="current-password" />
            <PasswordField
              label="New password"
              name="password"
              autoComplete="new-password"
              minLength={PASSWORD_MIN_LENGTH}
              hint={PASSWORD_HINT}
            />
            <PasswordField label="Repeat new password" name="confirm" autoComplete="new-password" />
          </AuthForm>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Log out everywhere</h2>
          </CardTitle>
          <CardDescription>Log out here and in every other browser, without changing the password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/admin/settings/logout-everywhere">
            <Button type="submit" variant="outline">
              Log out everywhere
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
