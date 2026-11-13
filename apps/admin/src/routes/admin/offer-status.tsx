import { OFFER_STATUSES } from "@deparked/db";
import { Button } from "@deparked/ui/button";
import { createFileRoute } from "@tanstack/react-router";
import { AuthForm, AuthPage } from "../../components/auth-form";
import { formatMoneyShort } from "../../components/format";
import { oneOf } from "../../components/messages";
import { offerParam, STATUS_ACTIONS, STATUS_QUESTION } from "../../components/offer-copy";
import { changeOfferStatus, offerBackPath, offerStatusChangeSchema } from "../../server/offers";
import { getOffer } from "../../server/offers.functions";
import { authRequest, badForm, readForm, seeOther } from "../../server/request";
import { requireSession } from "../../server/require-session";

// Changing an offer's status without JavaScript: the Offers screen links here, this page asks once and saves with
// a plain form post, then goes back. Outside the shell, whose controls wait for JavaScript.
export const Route = createFileRoute("/admin/offer-status")({
  validateSearch: (search) => ({
    id: offerParam(search.id),
    status: oneOf(search.status, OFFER_STATUSES),
    back: offerBackPath(search.back),
  }),
  loaderDeps: ({ search }) => ({ id: search.id }),
  loader: ({ deps }) => (deps.id === undefined ? null : getOffer({ data: deps.id })),
  head: () => ({ meta: [{ title: "Offers · Deparked" }] }),
  server: {
    handlers: {
      POST: async ({ request }) => {
        await requireSession();
        const field = await readForm(request);
        if (field === null) return badForm();
        const change = offerStatusChangeSchema.safeParse({ id: field("id"), status: field("status") });
        if (!change.success) return badForm();
        const { db, now } = authRequest(request);
        await changeOfferStatus(db, { ...change.data, now });
        return seeOther(offerBackPath(field("back")));
      },
    },
  },
  component: OfferStatusPage,
});

function OfferStatusPage() {
  const { status, back } = Route.useSearch();
  const offer = Route.useLoaderData();
  const action =
    offer === null || status === undefined
      ? undefined
      : STATUS_ACTIONS[offer.status].find((candidate) => candidate.status === status);
  if (offer === null || status === undefined || action === undefined) {
    return (
      <AuthPage title="Nothing to change" description="This offer is gone, or already has that status.">
        <Button asChild variant="outline">
          <a href={back}>Back to the offers</a>
        </Button>
      </AuthPage>
    );
  }
  return (
    <AuthPage
      title={STATUS_QUESTION[action.status]}
      description={
        <span className="[overflow-wrap:anywhere]">
          The offer of {formatMoneyShort(offer.amountMinor, offer.currency)} for {offer.host} from {offer.name}.
        </span>
      }
    >
      <AuthForm action="/admin/offer-status" submit={action.label} submitting="Saving…">
        <input type="hidden" name="id" value={offer.id} />
        <input type="hidden" name="status" value={status} />
        <input type="hidden" name="back" value={back} />
      </AuthForm>
      <a href={back} className="mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4">
        Back to the offers without a change
      </a>
    </AuthPage>
  );
}
