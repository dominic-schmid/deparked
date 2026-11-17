import type { ReportInput } from "@deparked/ui/lib/report";
import { ReportLink } from "@deparked/ui/report-problem";
import { useMatch } from "@tanstack/react-router";

/** The release this admin runs, from the shell's loader. Null outside the shell or on a development build. */
export function useRelease(): string | null {
  return useMatch({ from: "/admin/_shell", shouldThrow: false })?.loaderData?.release ?? null;
}

/** "Report this problem" for a failure that is Deparked's, not the owner's. */
export function AdminReportLink(props: Omit<ReportInput, "surface" | "release"> & { className?: string }) {
  const { className, ...input } = props;
  const release = useRelease();
  return (
    <ReportLink input={{ surface: "admin", release, ...input }} {...(className === undefined ? {} : { className })} />
  );
}
