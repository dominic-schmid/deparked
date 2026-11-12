import { Button } from "@deparked/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@deparked/ui/dropdown-menu";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

const KEY = "deparked-theme";
const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];

/**
 * Runs before the first paint: a stored choice puts `.dark` or `.light` on <html>. Without one, and without
 * JavaScript, the stylesheet follows the system.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="dark"||t==="light")document.documentElement.classList.add(t)}catch(e){}`;

function stored(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function apply(theme: Theme): void {
  const classes = document.documentElement.classList;
  classes.toggle("dark", theme === "dark");
  classes.toggle("light", theme === "light");
}

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  // Another tab changed the choice.
  const onStorage = () => {
    apply(stored());
    listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
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

const LABELS: Record<Theme, string> = { system: "System", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, stored, () => "system" as const);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Colour theme">
          <Sun className="dark:hidden" aria-hidden="true" />
          <Moon className="hidden dark:block" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => choose(THEMES.find((item) => item === value) ?? "system")}
        >
          {THEMES.map((item) => (
            <DropdownMenuRadioItem key={item} value={item}>
              {LABELS[item]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
