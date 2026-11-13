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
 * window shows the domain's name on the surface colour; the page fades in over it once it has painted.
 * `asServed`: the page visitors get right now, the placeholder before the first publish.
 */
export function PageThumbnail({
  host,
  asServed = false,
  className,
}: {
  host: string;
  asServed?: boolean;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const render = useServerFn(getThumbnail);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [html, setHtml] = useState<string | null>(null);
  // The frame stays invisible until its page has painted, so the window never flashes white or sits blank.
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    const element = box.current;
    if (element === null) return;
    const near = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting ?? false), {
      rootMargin: "400px 0px",
    });
    const resize = new ResizeObserver(([entry]) =>
      setSize({ width: entry?.contentRect.width ?? 0, height: entry?.contentRect.height ?? 0 }),
    );
    near.observe(element);
    resize.observe(element);
    return () => {
      near.disconnect();
      resize.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!near || html !== null) return;
    let current = true;
    const key = asServed ? `${host} as served` : host;
    let request = cache.get(key);
    if (request === undefined) {
      request = render({ data: { host, origin: window.location.origin, asServed } }).catch(() => null);
      cache.set(key, request);
    }
    request.then((thumbnail) => {
      if (thumbnail === null) cache.delete(key);
      else if (current) setHtml(inertPreview(thumbnail.html));
    });
    return () => {
      current = false;
    };
  }, [near, html, host, asServed, render]);

  useEffect(() => {
    if (!near) setPainted(false);
  }, [near]);

  const { width } = size;
  const scale = width / PAGE_WIDTH;
  return (
    <div
      ref={box}
      className={cn("relative aspect-[16/10] w-full overflow-hidden bg-muted", className)}
      data-thumbnail={painted ? "ready" : "waiting"}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 grid place-items-center p-4 text-center font-heading text-lg font-bold max-sm:p-2 max-sm:text-xs tracking-[-0.02em] text-muted-foreground/70 [overflow-wrap:anywhere]"
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
          onLoad={() => requestAnimationFrame(() => setPainted(true))}
          className={cn(
            "pointer-events-none absolute top-0 left-0 origin-top-left border-0 transition-opacity duration-150 ease-out motion-reduce:transition-none",
            painted ? "opacity-100" : "opacity-0",
          )}
          // Tall enough to fill the window whatever its shape (16:10 on a card, a taller crop in a phone row).
          style={{ width: PAGE_WIDTH, height: size.height / scale, transform: `scale(${scale})` }}
        />
      ) : null}
    </div>
  );
}
