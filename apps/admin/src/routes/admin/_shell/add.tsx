import { createFileRoute } from "@tanstack/react-router";
import { AddDomainFlow } from "../../../components/add-domain";

export const Route = createFileRoute("/admin/_shell/add")({
  validateSearch: (search): { host?: string | undefined } => ({
    host: typeof search.host === "string" && search.host !== "" ? search.host.slice(0, 253) : undefined,
  }),
  head: () => ({ meta: [{ title: "Add domain · Deparked" }] }),
  component: AddDomainPage,
});

/** Each step of the flow brings its own heading: the question, then the domain, then the result. */
function AddDomainPage() {
  const { host } = Route.useSearch();
  return <AddDomainFlow host={host} />;
}
