import { useSyncExternalStore } from "react";

const KEY = "deparked-theme";
export type Theme = "system" | "light" | "dark";

/**
 * Runs before the first paint: a stored choice puts `.dark` or `.light` on <html>, and `data-theme` (Arc's switch)
 * follows the choice, or the system setting without one. Without JavaScript the stylesheet follows the system.
 */
export const THEME_SCRIPT = `try{var d=document.documentElement,t=null;try{t=localStorage.getItem("${KEY}")}catch(e){}if(t==="dark"||t==="light")d.classList.add(t);d.setAttribute("data-theme",t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light")}catch(e){}`;

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  root.setAttribute(
    "data-theme",
    theme === "dark" || (theme === "system" && matchMedia(SYSTEM_DARK).matches) ? "dark" : "light",
  );
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  // Another tab changed the choice.
  const onStorage = () => {
    apply(stored());
    listener();
  };
  // The system setting changed while following it.
  const system = matchMedia(SYSTEM_DARK);
  const onSystem = () => apply(stored());
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  system.addEventListener("change", onSystem);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
    system.removeEventListener("change", onSystem);
  };
}

function choose(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {}
  apply(theme);
  for (const listener of listeners) listener();
}

/** The stored colour theme ("system" without a choice) and the function that changes it, for the account menu. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  return [useSyncExternalStore(subscribe, stored, () => "system" as const), choose];
}
