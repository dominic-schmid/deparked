import { type ComponentType, createElement } from "react";
import { hydrateRoot } from "react-dom/client";

/** Hydrates every `<Island>` on the page. Called once by a variant's client entry with that variant's islands. */
// biome-ignore lint/suspicious/noExplicitAny: each island has its own props; they arrive as parsed JSON
export function hydrateIslands(islands: Record<string, ComponentType<any>>): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-island]")) {
    const component = islands[node.dataset.island ?? ""];
    if (component) hydrateRoot(node, createElement(component, JSON.parse(node.dataset.props ?? "{}")));
  }
}
