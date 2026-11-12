import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PageHeader, TabNav, tabLinkClass } from "../../../components/page";

export const Route = createFileRoute("/admin/_shell/settings")({
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <>
      <PageHeader title="Settings" />
      <TabNav label="Settings">
        <Link to="/admin/settings" activeOptions={{ exact: true }} className={tabLinkClass}>
          Notify addresses
        </Link>
        <Link to="/admin/settings/password" className={tabLinkClass}>
          Password
        </Link>
        <Link to="/admin/settings/cloudflare" className={tabLinkClass}>
          Cloudflare token
        </Link>
        <Link to="/admin/settings/updates" className={tabLinkClass}>
          Updates
        </Link>
        <Link to="/admin/settings/danger" className={tabLinkClass}>
          Danger zone
        </Link>
      </TabNav>
      <Outlet />
    </>
  );
}
