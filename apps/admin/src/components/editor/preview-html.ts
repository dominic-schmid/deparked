// The preview's own additions to the lander's HTML. No imports: the editor runs this in the browser.

/** Shown at the foot of the frame while a link is hovered or focused. */
export const PREVIEW_LINK_HINT = "This is a preview: links do not open here";

// Every link opens a new window, which the sandbox (no `allow-popups`) refuses: nothing navigates the frame. The
// hint is one fixed label at the foot, so it never moves the page's own layout.
const INERT = `<base target="_blank"><style data-deparked-preview>
a[href]{cursor:default}
body:has(a[href]:hover,a[href]:focus-visible)::after{content:"${PREVIEW_LINK_HINT}";position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100% - 32px);padding:6px 10px;border-radius:8px;background:rgb(24 28 20/.9);color:#fff;font:500 13px/1.35 system-ui,sans-serif;text-align:center;pointer-events:none}
</style>`;

/** The lander's HTML with every link inert and the hint wired in. */
export function inertPreview(html: string): string {
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head === null) return `${INERT}${html}`;
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}${INERT}${html.slice(at)}`;
}
