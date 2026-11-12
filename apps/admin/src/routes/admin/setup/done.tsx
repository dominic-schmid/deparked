import { Button } from "@deparked/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { AuthPage } from "../../../components/auth-form";

export const Route = createFileRoute("/admin/setup/done")({
  head: () => ({ meta: [{ title: "Setup is done · Deparked" }] }),
  component: SetupDonePage,
});

function SetupDonePage() {
  return (
    <AuthPage
      title="Setup is done"
      description="This workspace already has a password, and the setup link can only be used once. Lost the password? Open the installer to get a new setup link."
    >
      <Button asChild className="w-full">
        <a href="/admin/login">Log in</a>
      </Button>
    </AuthPage>
  );
}
