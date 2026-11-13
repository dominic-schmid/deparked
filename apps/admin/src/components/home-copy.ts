// The home page's words, from the real numbers. No imports: the server reads the view cookie through it too.

type Status = "live" | "draft" | "off" | "error" | "email_pending";
type Shown = { host: string; status: Status; newOffers: number };

const WORDS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
];

/** "six" up to twelve, then digits with grouping: words read better in a sentence, digits once they get long. */
export function countWord(count: number): string {
  return WORDS[count] ?? count.toLocaleString("en");
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const MAX_NAMED = 24;

/** The one line that says what is waiting. */
export function homeHeadline(domains: Shown[]): string {
  if (domains.length === 0) return "Put your first domain in the window.";
  const waiting = domains.reduce((sum, domain) => sum + domain.newOffers, 0);
  // A name too long for a headline is left to the cards below.
  const named = (host: string | undefined) => (host !== undefined && host.length <= MAX_NAMED ? host : null);
  if (waiting === 0) {
    const host = domains.length === 1 ? named(domains[0]?.host) : null;
    return host === null
      ? `Your ${domains.length === 1 ? "domain is" : "domains are"} on show.`
      : `${host} is on show.`;
  }
  if (waiting === 1) {
    const host = named(domains.find((domain) => domain.newOffers > 0)?.host);
    return host === null ? "Someone wants one of your domains." : `Someone wants ${host}.`;
  }
  return `${capital(countWord(waiting))} offers are waiting for you.`;
}

/** "Two pages are live and one is waiting for its design." In the order the owner cares about. */
export function statusSummary(domains: Pick<Shown, "status">[]): string {
  if (domains.length === 0) return "Pick one from your Cloudflare account. Nothing changes until you say yes.";
  const count = (...statuses: Status[]) => domains.filter((domain) => statuses.includes(domain.status)).length;
  const groups: [number, (one: boolean) => string][] = [
    [count("live", "email_pending"), (one) => (one ? "is live" : "are live")],
    [count("draft"), (one) => (one ? "is waiting for its design" : "are waiting for their design")],
    [count("error"), (one) => (one ? "needs a fix" : "need a fix")],
    [count("off"), (one) => (one ? "is turned off" : "are turned off")],
  ];
  const parts = groups
    .filter(([n]) => n > 0)
    .map(([n, verb], index) => {
      // Only the first group present names the noun: "Two pages are live and one needs a fix."
      const noun = index === 0 ? (n === 1 ? " page" : " pages") : "";
      return `${countWord(n)}${noun} ${verb(n === 1)}`;
    });
  const last = parts.pop();
  return `${capital(parts.length > 0 ? `${parts.join(", ")} and ${last}` : (last ?? ""))}.`;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Friday morning", in the browser's own time zone. */
export function greeting(now: Date): string {
  const hour = now.getHours();
  const part = hour < 5 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : hour < 23 ? "evening" : "night";
  // Before five it is still the night of the day before.
  const day = hour < 5 ? (now.getDay() + 6) % 7 : now.getDay();
  return `${DAYS[day]} ${part}`;
}

export type HomeView = "grid" | "list";
export const HOME_VIEW_COOKIE = "deparked-view";

/** The view this browser chose last (a cookie, so the server renders it without a flash). Grid by default. */
export function homeView(cookieHeader: string | null): HomeView {
  const value = cookieHeader
    ?.split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === HOME_VIEW_COOKIE)?.[1];
  return value === "list" ? "list" : "grid";
}
