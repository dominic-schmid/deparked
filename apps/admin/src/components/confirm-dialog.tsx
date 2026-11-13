import { Dialog, DialogContent } from "@deparked/ui/arc/dialog";
import { Button } from "@deparked/ui/button";
import { type ReactNode, useRef } from "react";

/**
 * A question that must be answered before something changes: Arc's dialog, announced as an alert dialog. It opens
 * with focus on the safe answer, and a press outside does not close it (Escape and the safe answer do).
 */
export function ConfirmDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** One line under the title; the rest goes in `children`. */
  description?: string;
  children?: ReactNode;
  cancel: string;
  confirm: string;
  tone?: "danger" | "default";
  /** Called on the confirm button. The dialog stays open: the caller closes it when it is done. */
  onConfirm: () => void;
  /** The confirm button waits (nothing to confirm yet, or a request is running). */
  confirmDisabled?: boolean;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent
        role="alertdialog"
        title={props.title}
        {...(props.description === undefined ? {} : { description: props.description })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancel.current?.focus();
        }}
        onPointerDownOutside={(event) => event.preventDefault()}
        className="w-[min(calc(100vw-2rem),30rem)]"
      >
        {props.children === undefined ? null : <div className="mb-6 flex flex-col gap-4">{props.children}</div>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button ref={cancel} variant="outline" onClick={() => props.onOpenChange(false)}>
            {props.cancel}
          </Button>
          <Button
            variant={props.tone === "danger" ? "destructive" : "default"}
            aria-disabled={props.confirmDisabled || undefined}
            onClick={() => {
              if (!props.confirmDisabled) props.onConfirm();
            }}
          >
            {props.confirm}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
