import { type ComponentType, createElement, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";

/**
 * Hydrates every `<Island>` on the page. Called once by a variant's client entry with that variant's islands.
 * Not in the task that evaluated the bundle, and in a transition, so React hydrates in slices that yield to the
 * browser: on a slow phone that is several short tasks instead of one long one. The page reads and posts without it.
 */
// biome-ignore lint/suspicious/noExplicitAny: each island has its own props; they arrive as parsed JSON
export function hydrateIslands(islands: Record<string, ComponentType<any>>): void {
  setTimeout(() => {
    for (const node of document.querySelectorAll<HTMLElement>("[data-island]")) {
      const component = islands[node.dataset.island ?? ""];
      if (!component) continue;
      const element = createElement(component, JSON.parse(node.dataset.props ?? "{}"));
      startTransition(() => {
        hydrateRoot(node, element);
      });
    }
  }, 0);
}
