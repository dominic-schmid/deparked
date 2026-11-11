import { createFileRoute, redirect } from "@tanstack/react-router";

// Only reachable on workers.dev: on a managed domain "/" belongs to the lander.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin" });
  },
});
