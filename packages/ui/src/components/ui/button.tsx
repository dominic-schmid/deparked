import { cn } from "@deparked/ui/lib/utils";
import { Slot } from "radix-ui";
import type * as React from "react";
import { Button as ArcButton, type ButtonProps as ArcButtonProps } from "../arc/button/button";
import styles from "../arc/button/button.module.css";

type Variant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type Size = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const VARIANT: Record<Variant, ArcButtonProps["variant"]> = {
  default: "primary",
  destructive: "danger",
  outline: "secondary",
  secondary: "secondary",
  ghost: "ghost",
  link: "ghost",
};

const SIZE: Record<Size, ArcButtonProps["size"]> = {
  default: "md",
  xs: "sm",
  sm: "sm",
  lg: "lg",
  icon: "md",
  "icon-xs": "sm",
  "icon-sm": "sm",
  "icon-lg": "lg",
};

/** What Arc's button does not cover: the extra sizes and the link look, plus lucide icons at 16px inside. */
const EXTRA = {
  base: "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  link: "text-primary underline-offset-4 hover:bg-transparent hover:text-primary hover:underline",
  xs: "h-6 min-h-6 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
  icon: "size-9 min-h-0 px-0",
  "icon-xs": "size-6 min-h-0 px-0 [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-8 min-h-0 px-0",
  "icon-lg": "size-10 min-h-0 px-0",
} as const;

type ButtonProps = Omit<ArcButtonProps, "variant" | "size"> & {
  variant?: Variant;
  size?: Size;
  /** Render the child (a link, say) with the button's look instead of a `<button>`. */
  asChild?: boolean;
  ref?: React.Ref<HTMLButtonElement> | undefined;
};

function look(variant: Variant, size: Size, className: string | undefined) {
  return cn(
    EXTRA.base,
    variant === "link" && EXTRA.link,
    size in EXTRA && EXTRA[size as keyof typeof EXTRA],
    className,
  );
}

function Button({ variant = "default", size = "default", asChild = false, className, ...props }: ButtonProps) {
  if (asChild) {
    // Arc's button animates its label and needs to own the element; a link takes its stylesheet only.
    const classes = cn(
      styles.button,
      styles[VARIANT[variant] ?? "primary"],
      styles[SIZE[size] ?? "md"],
      look(variant, size, className),
    );
    const { loading: _loading, ...rest } = props;
    return <Slot.Root data-slot="button" data-variant={variant} data-size={size} className={classes} {...rest} />;
  }
  return (
    <ArcButton
      data-slot="button"
      data-variant={variant}
      data-size={size}
      variant={VARIANT[variant] ?? "primary"}
      size={SIZE[size] ?? "md"}
      className={look(variant, size, className)}
      {...props}
    />
  );
}

export type { ButtonProps };
export { Button };
