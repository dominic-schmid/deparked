import { createFileRoute, redirect } from "@tanstack/react-router";

// The Offers screen was called Inbox; its old address, with any filter, still leads there.
export const Route = createFileRoute("/admin/_shell/inbox")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/admin/offers", search, replace: true });
  },
});
