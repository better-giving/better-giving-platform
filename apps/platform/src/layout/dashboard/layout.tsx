import type { ReactNode } from "react";
import { Outlet } from "react-router";
import { Footer } from "#/components/footer";
import { AppHeader } from "#/components/header";
import { Sidebar, SidebarOpener } from "./sidebar";
import type { LinkGroup } from "./sidebar/types";

type DashboardLayoutProps = {
  linkGroups: LinkGroup[];
  sidebarHeader?: ReactNode;
  /** sits right of the logo in the app header from `md` up, and at the top of
   *  the mobile drawer below it — e.g. the npo admin's org switcher */
  headerContext?: ReactNode;
  rootRoute: string;
  /** the donor dashboard drops the header's auth slot; the two admin surfaces
   *  keep it. */
  headerVariant?: "default" | "bare";
};

/** the whole dashboard page, not just the sidebar: sticky header, the
 *  sidebar/views grid, minimal footer. all three sidebar surfaces (donor, npo
 *  admin, platform admin) render this and differ only in their links, their
 *  sidebar header, the header context in the logo's place, and whether the app
 *  header carries an auth slot. the route module keeps its own middleware,
 *  loader and meta — those are route-module contracts and cannot be lifted
 *  into a component. */
export function Layout({
  linkGroups,
  sidebarHeader,
  headerContext,
  rootRoute,
  headerVariant = "default",
}: DashboardLayoutProps) {
  return (
    <div className="grid">
      <AppHeader
        variant={headerVariant}
        classes="sticky z-sticky -top-px"
        context={headerContext}
      />
      <div className="grid max-md:content-start md:grid-cols-[auto_1fr]">
        <SidebarOpener
          classes="md:hidden"
          linkGroups={linkGroups}
          rootRoute={rootRoute}
        />
        <Sidebar
          classes="max-md:hidden"
          linkGroups={linkGroups}
          sidebarHeader={sidebarHeader}
        />
        {/* the page's one main landmark: route focus lands on the first h1
            inside it, so the views below must not render a <main> of their own */}
        <main className="@container min-h-[100dvh] min-w-0">
          <Outlet />
        </main>
      </div>
      <Footer variant="minimal" />
    </div>
  );
}
