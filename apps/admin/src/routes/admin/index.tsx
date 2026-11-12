import { Button } from "@deparked/ui/button";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <main className="mx-auto max-w-xl p-4 sm:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Deparked admin</h1>
      <p className="mt-2 text-muted-foreground">Nothing to manage yet.</p>
      <Button className="mt-6" disabled>
        Add domain
      </Button>
      <form method="post" action="/admin/logout" className="mt-10 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline">
          Log out
        </Button>
        <Button asChild variant="ghost">
          <a href="/admin/settings/password">Change password</a>
        </Button>
      </form>
    </main>
  );
}
