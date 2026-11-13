import { SegmentedControl } from "@deparked/ui/arc/segmented-control";
import { cn } from "@deparked/ui/lib/utils";
import { ArrowUpRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { inertPreview } from "./preview-html";

const DEVICES = [
  { value: "phone", label: "Phone", width: 390 },
  { value: "tablet", label: "Tablet", width: 768 },
  { value: "desktop", label: "Desktop", width: 1280 },
] as const;

type DeviceId = (typeof DEVICES)[number]["value"];

/**
 * The lander as visitors get it, in a sandbox with no permissions: no script runs, no form is sent, nothing reaches
 * the admin's origin, and links stay put (`inertPreview`). Laid out at the device's width and scaled down to fit.
 */
export function PreviewFrame(props: {
  html: string | null;
  host: string;
  stale: boolean;
  loading: boolean;
  /** Whether the domain has a live page to open. */
  live: boolean;
}) {
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
  const width = DEVICES.find((candidate) => candidate.value === device)?.width ?? 1280;
  const scale = size.width === 0 ? 1 : Math.min(1, size.width / width);
  const status = props.stale
    ? "Preview out of date: it shows the last version that could be rendered."
    : props.loading
      ? "Updating…"
      : "";

  return (
    <section
      aria-label="Preview"
      className="flex h-full min-h-0 flex-col gap-3 rounded-[28px] bg-secondary p-2.5 sm:p-3.5 dark:bg-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <SegmentedControl
          label="Preview width"
          options={DEVICES.map(({ value, label }) => ({ value, label }))}
          value={device}
          onValueChange={(next) => setDevice(next as DeviceId)}
        />
        <span
          translate="no"
          className="min-w-0 flex-1 basis-32 truncate rounded-full bg-background px-4 py-2 text-center text-[13px] text-muted-foreground max-sm:hidden lg:max-w-80"
          title={props.host}
        >
          {props.host}
        </span>
        {props.live ? (
          <a
            href={`https://${props.host}/`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center gap-1 rounded-full px-2 text-[13.5px] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            Open the live page
            <ArrowUpRight aria-hidden="true" className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      <p aria-live="polite" className="-mt-1 px-1 text-xs text-muted-foreground empty:hidden">
        {status}
      </p>
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-[18px] bg-background">
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
            className={cn(
              "absolute top-0 border-0 bg-white transition-opacity duration-150 motion-reduce:transition-none",
              props.stale && "opacity-60",
            )}
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
