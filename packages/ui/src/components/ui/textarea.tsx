import { cn } from "@deparked/ui/lib/utils";
import type * as React from "react";
import styles from "../arc/textarea/textarea.module.css";

/** Arc's field styles on a bare textarea: labels and messages stay with Field and Label at the call site. */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(styles.control, "flex field-sizing-content min-h-16", className)}
      {...props}
    />
  );
}

export { Textarea };
