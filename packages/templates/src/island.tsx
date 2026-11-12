import type { ComponentProps, ComponentType } from "react";
import { renderToString } from "react-dom/server";

type IslandProps<P> = {
  /** The key the variant's client entry registers the same component under. */
  name: string;
  component: ComponentType<P>;
  /** Must survive JSON: they are serialised into the page and handed back to the component on hydration. */
  props: P;
} & Omit<ComponentProps<"div">, "children" | "dangerouslySetInnerHTML">;

/**
 * Marks a component for hydration. The page around it is static markup; the island is rendered with
 * `renderToString`, which keeps the markers `hydrateRoot` needs. It reads and works before and without its script.
 */
export function Island<P extends object>({ name, component: Component, props, ...rest }: IslandProps<P>) {
  return (
    <div
      {...rest}
      data-island={name}
      data-props={JSON.stringify(props)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: React's own output for this component, escaped by React
      dangerouslySetInnerHTML={{ __html: renderToString(<Component {...props} />) }}
    />
  );
}
