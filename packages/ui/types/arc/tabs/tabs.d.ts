import * as TabsPrimitive from "@radix-ui/react-tabs";
import type { ComponentPropsWithoutRef } from "react";
type RootProps = ComponentPropsWithoutRef<typeof TabsPrimitive.Root>;
export declare function Tabs({ value, defaultValue, onValueChange, className, ...props }: RootProps): import("react").JSX.Element;
export declare function TabsList({ className, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.List>): import("react").JSX.Element;
export declare function TabsTrigger({ className, children, value, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>): import("react").JSX.Element;
export declare function TabsContent({ className, value, forceMount, children, ...props }: ComponentPropsWithoutRef<typeof TabsPrimitive.Content>): import("react").JSX.Element;
export {};
