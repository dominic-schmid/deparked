import { createFileRoute } from "@tanstack/react-router";
import { Editor } from "../../../components/editor/editor";
import { PageError, PagePending } from "../../../components/page";
import { getEditor } from "../../../server/editor/functions";

export const Route = createFileRoute("/admin/_shell/d/$host/")({
  loader: ({ params }) => getEditor({ data: { host: params.host } }),
  // The publish bar must show the state after every publish, not a cached one.
  staleTime: 0,
  component: EditorPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
});

function EditorPage() {
  const data = Route.useLoaderData();
  // A new key for another domain: the form starts over from that domain's draft.
  return <Editor key={data.host} data={data} />;
}
