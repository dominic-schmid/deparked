import { cn } from "@deparked/ui/lib/utils";
import { Badge as ArcBadge, type BadgeProps as ArcBadgeProps } from "../arc/badge/badge";

type Variant = "default" | "secondary" | "destructive" | "outline" | "ghost" | "link";

const TONE: Record<Variant, Pick<ArcBadgeProps, "tone" | "outline">> = {
  default: { tone: "neutral" },
  secondary: { tone: "neutral" },
  destructive: { tone: "danger" },
  outline: { tone: "neutral", outline: true },
  ghost: { tone: "neutral" },
  link: { tone: "neutral" },
};

/** `default` is the filled, inverted badge (new items); the others take Arc's tinted tones. */
const FILLED = "[--badge-background:var(--foreground)] [--badge-foreground:var(--background)]";

type BadgeProps = Omit<ArcBadgeProps, "tone" | "outline"> & { variant?: Variant };

function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <ArcBadge
      data-slot="badge"
      data-variant={variant}
      pill
      {...TONE[variant]}
      className={cn(variant === "default" && FILLED, className)}
      {...props}
    />
  );
}

export type { BadgeProps };
export { Badge };
