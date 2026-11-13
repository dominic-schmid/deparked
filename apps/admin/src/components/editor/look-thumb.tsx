import type { CSSProperties } from "react";
import type { BackgroundOption, VariantOption } from "../../server/editor/editor";

/**
 * A look as a small sketch of its page: its colours, the background it would draw with the one picked now, and where
 * its headline sits. Decorative: the card around it names the look.
 */
export function LookThumb(props: {
  variant: VariantOption;
  /** The background picked in the form. */
  background: string;
  backgrounds: ReadonlyMap<string, BackgroundOption>;
}) {
  const { variant } = props;
  const { uses } = variant;
  const picked = props.backgrounds.get(props.background);
  const photo =
    uses === null
      ? null
      : picked?.kind === uses.kind
        ? picked.swatch
        : (props.backgrounds.get(uses.fallback)?.swatch ?? variant.color);
  const ink = variant.contrast;
  const bar = (style: CSSProperties) => (
    <span className="absolute rounded-full" style={{ background: ink, ...style }} />
  );

  return (
    <span
      aria-hidden="true"
      className="relative block aspect-[16/10] w-full overflow-hidden rounded-[10px] outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
      style={{ background: variant.id === "split" ? variant.color : (photo ?? variant.color) }}
    >
      {variant.id === "split" ? (
        <>
          <span className="absolute inset-y-0 left-0 w-1/2" style={{ background: photo ?? variant.color }} />
          {bar({ left: "58%", bottom: "38%", width: "30%", height: 4 })}
          {bar({ left: "58%", bottom: "24%", width: "18%", height: 3, opacity: 0.6 })}
        </>
      ) : variant.id === "editorial" ? (
        <>
          <span className="absolute inset-x-[10%] top-[16%] h-px" style={{ background: ink, opacity: 0.5 }} />
          {bar({ left: "10%", top: "34%", width: "62%", height: 6, borderRadius: 2 })}
          {bar({ left: "10%", top: "52%", width: "44%", height: 6, borderRadius: 2 })}
          {bar({ left: "10%", bottom: "16%", width: "28%", height: 3, opacity: 0.6 })}
        </>
      ) : variant.id === "mono" ? (
        <>
          {bar({ left: "10%", top: "22%", width: "40%", height: 3, borderRadius: 1, opacity: 0.55 })}
          {bar({ left: "10%", top: "42%", width: "54%", height: 5, borderRadius: 1 })}
          <span className="absolute top-[38%] left-[67%] h-[13%] w-[3px]" style={{ background: ink }} />
          {bar({ left: "10%", bottom: "18%", width: "30%", height: 3, borderRadius: 1, opacity: 0.55 })}
        </>
      ) : (
        <>
          {bar({ left: "10%", bottom: "30%", width: variant.id === "gradient" ? "72%" : "60%", height: 5 })}
          {bar({ left: "10%", bottom: "16%", width: "26%", height: 3, opacity: 0.7 })}
        </>
      )}
    </span>
  );
}
