import { Button } from "@deparked/ui/button";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ComingSoon, PageHeader } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/add")({
  head: () => ({ meta: [{ title: "Add domain · Deparked" }] }),
  component: AddDomainPage,
});

function AddDomainPage() {
  return (
    <>
      <PageHeader title="Add domain" />
      <ComingSoon
        title="Arrives soon"
        action={
          <Button asChild variant="outline">
            <Link to="/admin">Back to all domains</Link>
          </Button>
        }
      >
        Here you will pick one of the domains in your Cloudflare account, see what it serves today, and let Deparked set
        up its for-sale page. This screen is not built yet.
      </ComingSoon>
    </>
  );
}
