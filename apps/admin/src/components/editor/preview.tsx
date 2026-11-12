import { cn } from "@deparked/ui/lib/utils";
import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { inertPreview } from "./preview-html";

const DEVICES = [
  { id: "phone", label: "Phone", width: 390, Icon: Smartphone },
  { id: "tablet", label: "Tablet", width: 768, Icon: Tablet },
  { id: "desktop", label: "Desktop", width: 1280, Icon: Monitor },
] as const;

type DeviceId = (typeof DEVICES)[number]["id"];

/**
 * The lander as visitors get it, in a sandbox with no permissions: no script runs, no form is sent, nothing reaches
 * the admin's origin, and links stay put (`inertPreview`). Laid out at the device's width and scaled down to fit.
 */
export function PreviewFrame(props: { html: string | null; host: string; stale: boolean; loading: boolean }) {
  const [device, setDevice] = useState<DeviceId>("desktop");
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const srcDoc = useMemo(() => (props.html === null ? null : inertPreview(props.html)), [props.html]);
  const width = DEVICES.find((candidate) => candidate.id === device)?.width ?? 1280;
  const scale = size.width === 0 ? 1 : Math.min(1, size.width / width);

  return (
    <section aria-label="Preview" className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <fieldset className="inline-flex rounded-lg bg-muted p-[3px]">
          <legend className="sr-only">Preview width</legend>
          {DEVICES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={device === id}
              onClick={() => setDevice(id)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            >
              <Icon aria-hidden className="size-4" />
              <span className="max-[360px]:sr-only">{label}</span>
            </button>
          ))}
        </fieldset>
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {props.stale
            ? "Preview out of date: it shows the last version that could be rendered."
            : props.loading
              ? "Updating…"
              : ""}
        </p>
      </div>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted">
        {srcDoc === null ? (
          <p className="p-4 text-sm text-muted-foreground">
            {props.loading ? "Loading the preview…" : "No preview yet."}
          </p>
        ) : (
          <iframe
            title={`Preview of ${props.host}`}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={srcDoc}
            className={cn("absolute top-0 border-0 bg-white", props.stale && "opacity-60")}
            style={{
              width,
              height: size.height / scale,
              left: Math.max(0, (size.width - width * scale) / 2),
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          />
        )}
      </div>
    </section>
  );
}
