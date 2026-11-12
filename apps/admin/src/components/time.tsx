import { useEffect, useState } from "react";
import { absoluteTime, relativeTime } from "./format";

/**
 * "3 hours ago", with the exact time as its title. The server renders the title in UTC; the browser swaps in the
 * owner's own time zone once it runs.
 */
export function RelativeTime({ time, now }: { time: number; now: number }) {
  const [title, setTitle] = useState(() => absoluteTime(time, "UTC"));
  useEffect(() => setTitle(absoluteTime(time)), [time]);
  return (
    <time dateTime={new Date(time).toISOString()} title={title} className="whitespace-nowrap">
      {relativeTime(time, now)}
    </time>
  );
}
