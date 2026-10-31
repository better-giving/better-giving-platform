import { Menu } from "@ark-ui/react/menu";
import { Portal } from "@ark-ui/react/portal";
import { popup_anim } from "@better-giving/ui";
import { LayoutDashboardIcon, LogOutIcon } from "lucide-react";
import { Form, href, Link, useNavigate } from "react-router";
import { UserAvatar } from "./user-avatar";

interface IAccountMenu {
  avatar: string | undefined;
}

const row =
  "hover:bg-gray-3 data-highlighted:bg-gray-3 data-highlighted:text-gray-12 data-highlighted:outline-2 data-highlighted:outline-ring data-highlighted:-outline-offset-2 flex items-center gap-2 px-2 py-2 rounded text-gray-11 hover:text-gray-12 text-sm text-left";

export function AccountMenu({ avatar }: IAccountMenu) {
  const navigate = useNavigate();
  return (
    <Menu.Root
      positioning={{ placement: "bottom-end", gutter: 4 }}
      // Enter on a link item otherwise falls to ark's default, a full-page load
      navigate={({ node }) => navigate(node.getAttribute("href") ?? "/")}
    >
      <Menu.Trigger
        aria-label="Account menu"
        className="rounded-full focus-visible:outline-2 focus-visible:outline-ring"
      >
        <UserAvatar avatar={avatar} classes="size-7" />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content
            className={`z-floating grid w-max min-w-48 p-2 rounded-card bg-card text-gray-12 shadow-floating focus:outline-0 ${popup_anim}`}
          >
            <Menu.Item value="dashboard" asChild>
              <Link to={href("/dashboard")} className={row}>
                <LayoutDashboardIcon className="shrink-0 icon-md" />
                <span className="flex-1">Dashboard</span>
              </Link>
            </Menu.Item>
            {/* zag clicks a highlighted non-anchor item on Enter/Space, so the
                submit button carries keyboard selection through to the form */}
            <Form method="POST" action={href("/logout")} className="contents">
              <Menu.Item value="logout" asChild>
                <button type="submit" className={row}>
                  <LogOutIcon className="shrink-0 icon-md" />
                  <span className="flex-1">Log out</span>
                </button>
              </Menu.Item>
            </Form>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
