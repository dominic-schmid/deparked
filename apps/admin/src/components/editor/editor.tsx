import { CONFIG_VERSION, type Config, parseConfig } from "@deparked/config";
import { Alert, AlertDescription } from "@deparked/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@deparked/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deparked/ui/tabs";
import { useBlocker, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorData, HistoryItem } from "../../server/editor/editor";
import { getEditor, getEditorPublishState, previewDraft } from "../../server/editor/functions";
import { revertTo, saveDraft, startPublish, stepPublish } from "../../server/publish/functions";
import type { StartResult } from "../../server/publish/pipeline";
import { EditorFields } from "./fields";
import { changedFields, configKey, type EditorForm, errorsByField, type FormField, fromForm, toForm } from "./form";
import { PreviewFrame } from "./preview";
import { HistoryList, PublishBar, type PublishView, type SaveStatus } from "./publish-bar";
import { progressText, runPublish, waitUntilFree } from "./publish-loop";

const SAVE_DELAY_MS = 800;
const PREVIEW_DELAY_MS = 300;

function colorsOf(data: EditorData, variant: string) {
  const option = data.variants.find((candidate) => candidate.id === variant) ?? data.variants[0];
  return { color: option?.color ?? "#7f9fbf", contrast: option?.contrast ?? "#ffffff" };
}

/** The live preview of whatever the form holds: debounced, and the last good page is kept while it is invalid. */
function usePreview(host: string, config: Config | null) {
  const preview = useServerFn(previewDraft);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  // An invalid form keeps the last valid config, so a preview already on its way is not cancelled.
  const lastValid = useRef<Config | null>(config);
  if (config !== null) lastValid.current = config;
  const shown = lastValid.current;
  const key = shown === null ? null : configKey(shown);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `shown`
  useEffect(() => {
    if (shown === null) return;
    const config = shown;
    const ticket = ++sequence.current;
    setLoading(true);
    const timer = setTimeout(
      () => {
        preview({ data: { host, config } })
          .then((result) => {
            if (ticket === sequence.current && result.ok) setHtml(result.html);
          })
          .catch(() => undefined)
          .finally(() => {
            if (ticket === sequence.current) setLoading(false);
          });
      },
      html === null ? 0 : PREVIEW_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [key, host]);

  return { html, loading };
}

export function Editor(props: { data: EditorData }) {
  const { data } = props;
  const { host } = data;
  const router = useRouter();
  const save = useServerFn(saveDraft);
  const start = useServerFn(startPublish);
  const step = useServerFn(stepPublish);
  const revert = useServerFn(revertTo);
  const readState = useServerFn(getEditorPublishState);
  const readEditor = useServerFn(getEditor);

  const [form, setForm] = useState<EditorForm>(() => toForm(data.draft, colorsOf(data, data.draft.variant)));
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(() => new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(data.draftStored ? configKey(data.draft) : null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [view, setView] = useState<PublishView>({ phase: "idle" });
  const [tab, setTab] = useState("edit");
  /** The owner changed something since the editor opened (or since a revert put a new draft in). */
  const [edited, setEdited] = useState(false);

  const parsed = useMemo(() => parseConfig(fromForm(form, CONFIG_VERSION)), [form]);
  const config = parsed.ok ? parsed.config : null;
  const key = config === null ? null : configKey(config);
  const errors = parsed.ok ? errorsByField(serverErrors) : errorsByField(parsed.errors);
  const invalidCount = Object.keys(errors).length;
  const shown = useMemo(
    () => new Set([...touched, ...(Object.keys(serverErrors) as FormField[])]),
    [touched, serverErrors],
  );

  const status: SaveStatus =
    config === null
      ? "invalid"
      : key === savedKey
        ? "saved"
        : key === failedKey && !inFlight
          ? "error"
          : !edited && savedKey === null
            ? "idle"
            : "saving";

  const savedRef = useRef(savedKey);
  const saving = useRef<Promise<boolean> | null>(null);

  /** Saves `next` once the save before it has finished; true when it is stored. */
  const persist = useCallback(
    async (next: Config): Promise<boolean> => {
      const nextKey = configKey(next);
      while (saving.current) await saving.current;
      if (savedRef.current === nextKey) return true;
      setInFlight(true);
      const attempt = (async () => {
        try {
          const result = await save({ data: { host, config: next } });
          if (!result.ok) {
            setServerErrors(result.errors);
            setFailedKey(nextKey);
            return false;
          }
          savedRef.current = nextKey;
          setSavedKey(nextKey);
          setServerErrors({});
          setFailedKey(null);
          return true;
        } catch {
          setFailedKey(nextKey);
          return false;
        }
      })();
      saving.current = attempt;
      try {
        return await attempt;
      } finally {
        saving.current = null;
        setInFlight(false);
      }
    },
    [host, save],
  );

  // Autosave: a valid form that differs from the stored draft is saved shortly after the last keystroke.
  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `config`
  useEffect(() => {
    if (config === null || key === savedRef.current || !edited) return;
    pendingTimer.current = setTimeout(() => void persist(config), SAVE_DELAY_MS);
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      pendingTimer.current = null;
    };
  }, [key, edited, persist]);

  const latest = useRef({ config, view, edited });
  latest.current = { config, view, edited };

  const publishing = view.phase === "running" || view.phase === "following";
  const unsaved = config === null || key !== savedKey;
  const blocker = useBlocker({
    shouldBlockFn: async ({ next }) => {
      if (next.pathname === router.state.location.pathname) return false;
      const current = latest.current;
      if (current.view.phase === "running") return true;
      if (!current.edited) return false;
      if (current.config === null) return true;
      return !(await persist(current.config));
    },
    enableBeforeUnload: () => publishing || (edited && unsaved),
    withResolver: true,
  });

  function update<K extends FormField>(field: K, value: EditorForm[K]) {
    setForm((previous) => {
      const next = { ...previous, [field]: value };
      if (field === "variant" && !previous.accentOn) {
        const colors = colorsOf(data, value as string);
        next.accentPrimary = colors.color;
        next.accentContrast = colors.contrast;
      }
      return next;
    });
    setTouched((previous) => (previous.has(field) ? previous : new Set([...previous, field])));
    setEdited(true);
    if (field in serverErrors) setServerErrors({});
  }

  const preview = usePreview(host, config);

  async function drive(begin: () => Promise<StartResult>, resume?: number) {
    setView({ phase: "running", text: resume === undefined ? "Starting the publish…" : "Continuing the publish…" });
    const outcome = await runPublish({
      start: begin,
      step: (deploymentId) => step({ data: { deploymentId } }),
      onStep: (result) => setView({ phase: "running", text: progressText(result) }),
      ...(resume === undefined ? {} : { resume }),
    });
    const retry =
      outcome.status === "failed" && outcome.reason !== "busy" && outcome.reason !== "invalid"
        ? () => void drive(begin, outcome.reason === "network" ? outcome.deploymentId : undefined)
        : null;
    setView({ phase: "ended", outcome, retry });
    await router.invalidate();
    return outcome;
  }

  async function publish() {
    if (config === null) return;
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setView({ phase: "running", text: "Saving the draft…" });
    if (!(await persist(config))) {
      setView({
        phase: "ended",
        outcome: {
          status: "failed",
          reason: "network",
          message: "The draft could not be saved, so nothing was published.",
        },
        retry: () => void publish(),
      });
      return;
    }
    await drive(() => start({ data: { kind: "draft", host } }));
  }

  const following = useRef<AbortController | null>(null);
  useEffect(() => () => following.current?.abort(), []);

  async function follow() {
    following.current?.abort();
    const controller = new AbortController();
    following.current = controller;
    setView({ phase: "following", text: "Waiting for the other publish to finish…" });
    await waitUntilFree({
      read: () => readState({ data: { host } }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      signal: controller.signal,
    });
    if (controller.signal.aborted) return;
    setView({ phase: "idle" });
    await router.invalidate();
  }

  async function revertToItem(item: HistoryItem) {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    while (saving.current) await saving.current;
    const outcome = await drive(() => revert({ data: { historyId: item.id } }));
    // The revert replaced the stored draft (unless it never started): the form takes the stored one over.
    if (outcome.status === "failed" && outcome.reason === "busy") return;
    try {
      const fresh = await readEditor({ data: { host } });
      const next = fresh.draftStored ? configKey(fresh.draft) : null;
      savedRef.current = next;
      setSavedKey(next);
      setForm(toForm(fresh.draft, colorsOf(fresh, fresh.draft.variant)));
      setTouched(new Set());
      setEdited(false);
      setServerErrors({});
    } catch {
      // The form keeps what it had; reloading the page shows the reverted draft.
    }
  }

  function resetToLive() {
    if (data.live === null) return;
    const next = toForm(data.live, colorsOf(data, data.live.variant));
    setForm(next);
    setEdited(true);
    setServerErrors({});
  }

  const changes = config === null ? null : changedFields(config, data.live);
  const canPublish = changes !== null && (changes.length > 0 || data.publish.outOfSync) && !publishing;

  return (
    <div className="flex flex-col gap-6">
      {data.notice ? (
        <Alert>
          <AlertDescription>{data.notice}</AlertDescription>
        </Alert>
      ) : null}
      {errors.form ? (
        <Alert variant="destructive">
          <AlertDescription>{errors.form}</AlertDescription>
        </Alert>
      ) : null}
      <PublishBar
        host={host}
        state={data.publish}
        now={data.now}
        changes={changes}
        hasLive={data.live !== null}
        canPublish={canPublish}
        view={view}
        save={{ status, invalidCount, onRetry: () => config && void persist(config) }}
        onPublish={() => void publish()}
        onFollow={() => void follow()}
        onResetToLive={resetToLive}
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8"
      >
        <TabsList className="w-full md:hidden">
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="edit" forceMount className="data-[state=inactive]:hidden md:data-[state=inactive]:block">
          <form
            aria-label={`Design of ${host}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (config) void persist(config);
            }}
            noValidate
          >
            <EditorFields
              form={form}
              errors={errors}
              shown={shown}
              variants={data.variants}
              backgrounds={data.backgrounds}
              onChange={update}
            />
          </form>
        </TabsContent>
        <TabsContent
          value="preview"
          forceMount
          className="h-[75dvh] min-h-96 flex-none data-[state=inactive]:hidden md:mt-2 md:data-[state=inactive]:block lg:sticky lg:top-20 lg:mt-0 lg:h-[calc(100dvh-7rem)]"
        >
          <PreviewFrame
            html={preview.html}
            host={host}
            stale={config === null && preview.html !== null}
            loading={preview.loading}
          />
        </TabsContent>
      </Tabs>
      <HistoryList
        host={host}
        items={data.history}
        now={data.now}
        disabled={publishing}
        onRevert={(item) => void revertToItem(item)}
      />
      <AlertDialog open={blocker.status === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {view.phase === "running" ? "A publish is running" : "Leave without saving?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {view.phase === "running"
                ? "It stops if you leave this page now, and the next publish can only start in a few minutes."
                : config === null
                  ? "Some fields have problems, so your latest changes are not saved. They are lost if you leave."
                  : "Your latest changes could not be saved. They are lost if you leave."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>Stay here</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
