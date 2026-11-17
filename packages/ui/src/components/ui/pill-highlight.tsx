import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { motionTokens } from "../arc/motion-tokens";

/**
 * The filled background of the current pill in a row of links. Render it inside the current link only: when
 * another link of the same `group` becomes current, it glides there. The link needs `relative` and no
 * background of its own, the row `isolate`, so the fill passes under every label.
 */
export function PillHighlight({ group }: { group: string }) {
  const reduced = useReducedMotion();
  const instance = useId();
  return (
    <motion.span
      aria-hidden="true"
      layoutId={`pill-${group}`}
      // Its own value per link: a move to another link glides, a re-render of the row measures nothing.
      layoutDependency={instance}
      transition={reduced ? { duration: 0 } : motionTokens.spring.morph}
      className="absolute inset-0 -z-10 rounded-full bg-primary"
    />
  );
}
