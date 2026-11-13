import { cn } from "@deparked/ui/lib/utils";
import type * as React from "react";
import styles from "../arc/input/input.module.css";

/** Arc's field styles on a bare input: labels and messages stay with Field and Label at the call site. */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        styles.input,
        "min-w-0 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
