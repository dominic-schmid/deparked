import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Deparked admin</h1>
      <p className="mt-2 text-neutral-600">Nothing to manage yet.</p>
    </main>
  );
}
