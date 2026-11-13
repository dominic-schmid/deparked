import { cn } from "@deparked/ui/lib/utils";
import type { ComponentProps } from "react";
import { TabsContent as ArcTabsContent } from "../arc/tabs/tabs";

export { Tabs, TabsList, TabsTrigger } from "../arc/tabs/tabs";

/**
 * Arc gives a panel its own top margin, text colour and size, and no pointer events while inactive. The panels here
 * are laid out by their call sites and may stay visible while inactive (the editor's preview on wide screens).
 */
export function TabsContent({ className, ...props }: ComponentProps<typeof ArcTabsContent>) {
  return (
    <ArcTabsContent
      className={cn(
        "mt-0 flex-1 text-[length:inherit] leading-[inherit] text-inherit outline-none data-[state=inactive]:pointer-events-auto",
        className,
      )}
      {...props}
    />
  );
}
