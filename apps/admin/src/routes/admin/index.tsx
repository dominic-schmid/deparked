import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <main>
      <h1>Deparked</h1>
      <p>The admin panel is not ready yet.</p>
    </main>
  );
}
