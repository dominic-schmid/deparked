import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, AuthPage, PasswordField } from "../../../components/auth-form";
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

export const Route = createFileRoute("/admin/settings/password")({
  validateSearch: (search) => ({
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
    <AuthPage title="Change password" description="Changing it logs out every other browser. This one stays logged in.">
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
        <a href="/admin" className="text-sm text-muted-foreground underline underline-offset-4">
          Back to the admin
        </a>
      </AuthForm>
    </AuthPage>
  );
}
