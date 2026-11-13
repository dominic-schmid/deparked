import { cn } from "@deparked/ui/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import type { Thumbnail } from "../server/editor/editor";
import { getThumbnail } from "../server/editor/functions";
import { inertPreview } from "./editor/preview-html";

/** The width the page is laid out at before it is scaled down: a laptop screen. */
const PAGE_WIDTH = 1280;

// One render per host for as long as the admin stays open: scrolling back, switching views or coming home again
// shows it at once. A publish or a draft change shows on the next full load.
const cache = new Map<string, Promise<Thumbnail | null>>();

/**
 * A domain's page as visitors get it, scaled into a small window. The page is rendered on demand, only for windows
 * on or near the screen, and dropped again when one scrolls far away, so a long list never holds hundreds of
 * documents. Inert like the editor's preview (an empty sandbox: no script, no form, no navigation) and hidden from
 * assistive technology: the card around it names the domain. Until it arrives, and if it cannot be rendered, the
 * window shows the domain's name.
 */
export function PageThumbnail({ host, className }: { host: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const render = useServerFn(getThumbnail);
  const [near, setNear] = useState(false);
  const [width, setWidth] = useState(0);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const near = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), {
      rootMargin: "400px 0px",
    });
    const size = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    near.observe(element);
    size.observe(element);
    return () => {
      near.disconnect();
      size.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near || html !== null) return;
    let current = true;
    let request = cache.get(host);
    if (request === undefined) {
      request = render({ data: { host, origin: window.location.origin } }).catch(() => null);
      cache.set(host, request);
    }
    request.then((thumbnail) => {
      if (thumbnail === null) cache.delete(host);
      else if (current) setHtml(inertPreview(thumbnail.html));
    });
    return () => {
      current = false;
    };
  }, [near, html, host, render]);

  const scale = width / PAGE_WIDTH;
  return (
    <div
      ref={box}
      className={cn("relative aspect-[16/10] w-full overflow-hidden bg-muted", className)}
      data-thumbnail={html !== null && near ? "ready" : "waiting"}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center p-4 text-center font-heading text-lg font-bold tracking-[-0.02em] text-muted-foreground/70 [overflow-wrap:anywhere]"
      >
        {host}
      </span>
      {html !== null && near && width > 0 ? (
        <iframe
          title={`Page of ${host}`}
          aria-hidden="true"
          tabIndex={-1}
          sandbox=""
          referrerPolicy="no-referrer"
          srcDoc={html}
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0 bg-white"
          style={{ width: PAGE_WIDTH, height: PAGE_WIDTH / (16 / 10), transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  );
}
