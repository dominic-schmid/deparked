import { createFileRoute } from "@tanstack/react-router";
import { AddDomainFlow } from "../../../components/add-domain";
import { PageHeader } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/add")({
  validateSearch: (search): { host?: string | undefined } => ({
    host: typeof search.host === "string" && search.host !== "" ? search.host.slice(0, 253) : undefined,
  }),
  head: () => ({ meta: [{ title: "Add domain · Deparked" }] }),
  component: AddDomainPage,
});

function AddDomainPage() {
  const { host } = Route.useSearch();
  return (
    <>
      <PageHeader title="Add domain" />
      <AddDomainFlow host={host} />
    </>
  );
}
