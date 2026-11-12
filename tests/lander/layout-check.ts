/**
 * Runs inside the page. Returns one line per layout fault at the current viewport; an empty list is a pass.
 * It knows nothing about a variant's markup: it reads the rendered text, controls and boxes.
 */
export function findLayoutFaults(): string[] {
  const TOLERANCE = 1.5;
  const faults: string[] = [];
  const viewport = document.documentElement.clientWidth;
  const label = (element: Element) => {
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 32);
    const id = element.id ? `#${element.id}` : "";
    const classes =
      typeof element.className === "string" && element.className ? `.${element.className.split(" ")[0]}` : "";
    return `<${element.tagName.toLowerCase()}${id}${classes}> "${text}"`;
  };
  const visible = (element: Element) => {
    if (!(element instanceof HTMLElement) || !element.checkVisibility({ visibilityProperty: true })) return false;
    // visually-hidden text (labels for screen readers) and off-screen honeypots are not part of the layout
    const { width, height, right } = element.getBoundingClientRect();
    return width > 2 && height > 2 && right > 0 && getComputedStyle(element).clipPath === "none";
  };
  const isBlock = (element: Element) =>
    !getComputedStyle(element).display.startsWith("inline") || element.parentElement?.matches("body") === true;
  const blockOf = (node: Node): Element => {
    let element = node.parentElement as Element;
    while (!isBlock(element) && element.parentElement) element = element.parentElement;
    return element;
  };

  if (document.documentElement.scrollWidth > viewport + TOLERANCE) {
    faults.push(
      `horizontal overflow: the page is ${document.documentElement.scrollWidth}px wide in a ${viewport}px viewport`,
    );
  }

  // every line of visible text, and every control, inside the viewport's width
  const lines: { node: Node; block: Element; rect: DOMRect }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim() || parent.closest("script, style, noscript") || !visible(parent)) continue;
    if (parent.closest("[hidden]") || [...ancestors(parent)].some((element) => !visible(element))) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      if (rect.width > 0.5 && rect.height > 0.5) lines.push({ node, block: blockOf(node), rect });
    }
  }
  function* ancestors(element: Element) {
    for (let current = element.parentElement; current && current !== document.body; current = current.parentElement)
      yield current;
  }
  const controls = [...document.querySelectorAll("input, textarea, select, button, a[href]")].filter(visible);

  for (const { node, rect } of lines) {
    if (rect.left < -TOLERANCE || rect.right > viewport + TOLERANCE) {
      faults.push(
        `text outside the viewport (${Math.round(rect.left)}..${Math.round(rect.right)} of ${viewport}): ${label(node.parentElement as Element)}`,
      );
    }
  }
  for (const control of controls) {
    const rect = control.getBoundingClientRect();
    if (rect.left < -TOLERANCE || rect.right > viewport + TOLERANCE) {
      faults.push(
        `control outside the viewport (${Math.round(rect.left)}..${Math.round(rect.right)} of ${viewport}): ${label(control)}`,
      );
    }
  }

  // clipped text: a box that hides overflow and holds more than it shows
  for (const block of new Set(lines.map((line) => line.block))) {
    const style = getComputedStyle(block);
    const clipsX = style.overflowX !== "visible" && block.scrollWidth > block.clientWidth + TOLERANCE;
    const clipsY =
      style.overflowY !== "visible" &&
      style.overflowY !== "auto" &&
      block.scrollHeight > block.clientHeight + TOLERANCE;
    if (clipsX || clipsY) faults.push(`clipped text: ${label(block)}`);
  }
  // a field too narrow for what was typed into it (the page's fields grow with their content)
  for (const control of controls) {
    if (control instanceof HTMLInputElement && control.value && control.scrollWidth > control.clientWidth + TOLERANCE) {
      // it may scroll once its blank (the input with the currency and the punctuation around it) fills the line
      const blank = control.parentElement;
      const fullWidth =
        control.getBoundingClientRect().width >= (blank?.getBoundingClientRect().width ?? 0) - TOLERANCE ||
        (blank?.getBoundingClientRect().width ?? 0) >= (blank?.parentElement?.clientWidth ?? 0) - TOLERANCE;
      if (!fullWidth) faults.push(`clipped field: ${label(control)} holds "${control.value}"`);
    }
  }

  // overlapping text: two blocks of text that are not one inside the other must not share space
  const intersects = (a: DOMRect, b: DOMRect) =>
    Math.min(a.right, b.right) - Math.max(a.left, b.left) > TOLERANCE &&
    Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > TOLERANCE;
  const blocks = [...new Set([...lines.map((line) => line.block), ...controls.filter(isBlock)])];
  for (const [index, a] of blocks.entries()) {
    for (const b of blocks.slice(index + 1)) {
      if (a.contains(b) || b.contains(a)) continue;
      if (intersects(a.getBoundingClientRect(), b.getBoundingClientRect()))
        faults.push(`overlap: ${label(a)} and ${label(b)}`);
    }
  }
  // inline fields against the words around them
  for (const control of controls) {
    for (const { node, rect } of lines) {
      if (control.contains(node) || !blockOf(control).contains(node)) continue;
      if ([...control.getClientRects()].some((box) => intersects(box, rect)))
        faults.push(`overlap: ${label(control)} and the text "${node.textContent?.trim().slice(0, 24)}"`);
    }
  }

  // a wrapped button label
  for (const button of document.querySelectorAll("button, [role=button], a[href]")) {
    if (!visible(button) || (button.matches("a") && !isBlock(button))) continue;
    const range = document.createRange();
    range.selectNodeContents(button);
    const tops = new Set(
      [...range.getClientRects()].filter((rect) => rect.width > 0.5).map((rect) => Math.round(rect.top / 4)),
    );
    const texts = [...range.getClientRects()].filter((rect) => rect.width > 0.5 && rect.height > 8);
    const spread = texts.length
      ? Math.max(...texts.map((rect) => rect.bottom)) - Math.min(...texts.map((rect) => rect.top))
      : 0;
    const lineHeight = Math.min(...texts.map((rect) => rect.height));
    if (tops.size > 1 && spread > lineHeight * 1.6) faults.push(`wrapped button label: ${label(button)}`);
  }
  return [...new Set(faults)];
}
