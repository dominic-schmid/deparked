import { CONFIG_VERSION, type Config, parseConfig } from "@deparked/config";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@deparked/ui/tabs";
import { useBlocker, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorData, HistoryItem } from "../../server/editor/editor";
import { getEditor, getEditorPublishState, previewDraft } from "../../server/editor/functions";
import { revertTo, saveDraft, startPublish, stepPublish } from "../../server/publish/functions";
import type { StartResult } from "../../server/publish/pipeline";
import { ConfirmDialog } from "../confirm-dialog";
import { EditorFields } from "./fields";
import {
  backgroundForVariant,
  changedFields,
  configKey,
  describeChanges,
  type EditorForm,
  errorsByField,
  type FormField,
  fieldOf,
  fromForm,
  normalize,
  toForm,
} from "./form";
import { PreviewFrame } from "./preview";
import { PublishActions, PublishMessages, type PublishView, type SaveStatus, VersionsCard } from "./publish-bar";
import { type PublishOutcome, progressText, revertWroteDraft, runPublish, waitUntilFree } from "./publish-loop";

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
  /** The server refused the last config (it found a problem the form did not): the page shown is older. */
  const [refused, setRefused] = useState(false);
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
        preview({ data: { host, config, origin: window.location.origin } })
          .then((result) => {
            if (ticket !== sequence.current) return;
            setRefused(!result.ok);
            if (result.ok) setHtml(result.html);
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

  return { html, loading, refused };
}

/** What the stored draft looks like once the form has read it: the state that counts as saved. */
function savedKeyOf(data: EditorData): string | null {
  return data.draftStored ? configKey(normalize(data.draft, colorsOf(data, data.draft.variant))) : null;
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
  const live = useMemo(
    () => (data.live === null ? null : normalize(data.live, colorsOf(data, data.live.variant))),
    [data],
  );
  const [touched, setTouched] = useState<ReadonlySet<FormField>>(() => new Set());
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [savedKey, setSavedKey] = useState<string | null>(() => savedKeyOf(data));
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
  const shown = useMemo(() => {
    const fields = Object.keys(serverErrors)
      .map(fieldOf)
      .filter((field): field is FormField => field !== "form");
    return new Set([...touched, ...fields]);
  }, [touched, serverErrors]);

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
      if (field === "variant") {
        const uses = data.variants.find((candidate) => candidate.id === value)?.uses ?? null;
        next.background = backgroundForVariant(previous.background, data.backgrounds, uses);
      }
      if (field === "variant" && !previous.accentOn) {
        const colors = colorsOf(data, value as string);
        next.accentPrimary = colors.color;
        next.accentContrast = colors.contrast;
      }
      return next;
    });
    setTouched((previous) => (previous.has(field) ? previous : new Set([...previous, field])));
    setEdited(true);
    setServerErrors((previous) => {
      const kept = Object.entries(previous).filter(([path]) => fieldOf(path) !== field);
      return kept.length === Object.keys(previous).length ? previous : Object.fromEntries(kept);
    });
  }

  const preview = usePreview(host, config);

  const unmounted = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    unmounted.current = controller;
    return () => controller.abort();
  }, []);

  /** Runs a publish to its end. `after` runs after every attempt, Retry included. */
  async function drive(
    begin: () => Promise<StartResult>,
    options: { resume?: number; after?: () => Promise<void> } = {},
  ): Promise<void> {
    const { resume, after } = options;
    setView({ phase: "running", text: resume === undefined ? "Starting the publish…" : "Continuing the publish…" });
    const outcome: PublishOutcome = await runPublish({
      start: begin,
      step: (deploymentId) => step({ data: { deploymentId } }),
      onStep: (result) => setView({ phase: "running", text: progressText(result) }),
      signal: unmounted.current.signal,
      ...(resume === undefined ? {} : { resume }),
    });
    if (outcome.status === "stopped") return;
    const retry =
      outcome.status === "failed" && outcome.reason !== "busy" && outcome.reason !== "invalid"
        ? () =>
            void drive(begin, {
              ...(outcome.reason === "network" && outcome.deploymentId !== undefined
                ? { resume: outcome.deploymentId }
                : {}),
              ...(after ? { after } : {}),
            })
        : null;
    if (after) await after();
    setView({ phase: "ended", outcome, retry });
    await router.invalidate();
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
  const publishButton = useRef<HTMLButtonElement>(null);
  /** Set when the wait for another publish ends: Publish takes focus once it can be pressed again. */
  const focusPublish = useRef(false);
  useEffect(() => {
    if (!focusPublish.current || view.phase !== "notice") return;
    focusPublish.current = false;
    publishButton.current?.focus();
  }, [view]);
  useEffect(() => () => following.current?.abort(), []);

  async function follow() {
    following.current?.abort();
    const controller = new AbortController();
    following.current = controller;
    setView({ phase: "following", text: "Waiting for the other publish to finish…" });
    const ended = await waitUntilFree({
      read: () => readState({ data: { host } }),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      signal: controller.signal,
    });
    if (ended === "aborted") return;
    focusPublish.current = ended === "free";
    setView(
      ended === "free"
        ? {
            phase: "notice",
            text: "The other publish has finished. Your draft is not live yet: press Put it live when you are ready.",
          }
        : {
            phase: "notice",
            text: "The admin stopped answering while waiting. Reload the page (you may have to log in again).",
          },
    );
    await router.invalidate();
  }

  /** The form takes over the stored draft, after a revert replaced it. Unsaved edits were saved before. */
  async function reloadDraft() {
    try {
      const fresh = await readEditor({ data: { host } });
      const next = savedKeyOf(fresh);
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

  async function revertToItem(item: HistoryItem) {
    if (pendingTimer.current) clearTimeout(pendingTimer.current);
    setView({ phase: "running", text: "Saving the draft…" });
    while (saving.current) await saving.current;
    // Pending edits are saved first: the revert replaces the stored draft, never one that only lived in the form.
    if (config !== null && edited) await persist(config);
    let wrote = false;
    await drive(
      async () => {
        const result = await revert({ data: { historyId: item.id } });
        wrote ||= revertWroteDraft(result);
        return result;
      },
      { after: async () => (wrote ? reloadDraft() : undefined) },
    );
  }

  function resetToLive() {
    if (data.live === null) return;
    const next = toForm(data.live, colorsOf(data, data.live.variant));
    setForm(next);
    setEdited(true);
    setServerErrors({});
  }

  const changes = config === null ? null : changedFields(config, live);
  const diff = useMemo(() => {
    if (config === null || live === null) return null;
    const label = new Map(data.backgrounds.map((background) => [background.id, background.label]));
    return describeChanges(config, live, { background: (id) => label.get(id) ?? id });
  }, [config, live, data.backgrounds]);
  const canPublish = changes !== null && (changes.length > 0 || data.publish.outOfSync) && !publishing;

  return (
    // Its children are grid items of the domain frame (`d.$host.tsx`): the actions go into the header row.
    <div className="contents *:col-span-full">
      <PublishActions
        state={data.publish}
        changes={changes}
        diff={diff}
        hasLive={data.live !== null}
        canPublish={canPublish}
        view={view}
        save={{ status, invalidCount, problem: errors.form, onRetry: () => config && void persist(config) }}
        onPublish={() => void publish()}
        publishRef={publishButton}
        onResetToLive={resetToLive}
      />
      <PublishMessages
        host={host}
        state={data.publish}
        view={view}
        notice={data.notice}
        onFollow={() => void follow()}
      />
      <Tabs
        value={tab}
        onValueChange={setTab}
        className="mt-1 gap-4 md:grid md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)] md:items-start md:gap-5 lg:grid-cols-[minmax(0,23rem)_minmax(0,1fr)]"
      >
        <TabsList className="w-full md:hidden">
          <TabsTrigger value="edit">Edit</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent
          value="edit"
          forceMount
          className="flex min-w-0 flex-col gap-2.5 data-[state=inactive]:hidden md:data-[state=inactive]:flex"
        >
          <form
            aria-label={`Design of ${host}`}
            onSubmit={(event) => {
              event.preventDefault();
              if (config) void persist(config);
            }}
            noValidate
          >
            <EditorFields
              host={host}
              disabled={publishing}
              form={form}
              errors={errors}
              shown={shown}
              variants={data.variants}
              backgrounds={data.backgrounds}
              onChange={update}
            />
          </form>
          <VersionsCard
            host={host}
            items={data.history}
            now={data.now}
            disabled={publishing}
            onRevert={(item) => void revertToItem(item)}
          />
        </TabsContent>
        <TabsContent
          value="preview"
          forceMount
          className="h-[75dvh] min-h-96 min-w-0 flex-none data-[state=inactive]:hidden md:sticky md:top-4 md:h-[calc(100dvh-2rem)] md:max-h-[60rem] md:data-[state=inactive]:block"
        >
          <PreviewFrame
            html={preview.html}
            host={host}
            live={data.live !== null}
            stale={(config === null || preview.refused) && preview.html !== null}
            loading={preview.loading}
          />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={blocker.status === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={view.phase === "running" ? "A publish is running" : "Leave without saving?"}
        description={
          view.phase === "running"
            ? "A publish only moves forward while this page is open. If you leave, it stops after the step running now and nothing new goes live; the next publish can start once its lock runs out, within five minutes."
            : config === null
              ? "Some fields have problems, so your latest changes are not saved. They are lost if you leave."
              : "Your latest changes could not be saved. They are lost if you leave."
        }
        cancel="Stay here"
        confirm="Leave"
        onConfirm={() => blocker.proceed?.()}
      />
    </div>
  );
}
