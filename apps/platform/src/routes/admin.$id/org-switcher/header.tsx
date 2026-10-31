import { Menu } from "@ark-ui/react/menu";
import { Portal } from "@ark-ui/react/portal";
import { Image, popup_anim } from "@better-giving/ui";
import { CheckIcon, ChevronsUpDownIcon, PlusIcon } from "lucide-react";
import { href, Link, useParams } from "react-router";
import flying_character from "#/assets/images/flying-character.webp";
import { use_user } from "#/hooks/use-user";

interface IEndow {
  name: string;
  logo?: string | null;
}

export function OrgSwitcher({ name, logo = flying_character }: IEndow) {
  const { user } = use_user();
  const { id: current_id } = useParams();

  const orgs = user && user !== "loading" ? user.orgs : [];
  // trigger always reflects the SSR-loaded current org; fall back to it as the
  // sole entry until /api/me resolves the full org list client-side
  const list = orgs.length
    ? orgs
    : [{ id: Number(current_id), name, logo: logo || undefined }];

  return (
    <Menu.Root positioning={{ placement: "bottom-start", gutter: 4 }}>
      {/* the app header's slot from md up, capped so a long name truncates
          beside the logo; below md the drawer's first row, full width */}
      <Menu.Trigger className="group flex items-center gap-2 min-w-0 max-md:w-full md:max-w-80 p-2 rounded text-left hover:bg-gray-3 transition-colors focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2">
        <Image
          className="size-8 shrink-0 rounded object-cover"
          src={logo || flying_character}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">
          {name}
        </span>
        <ChevronsUpDownIcon className="shrink-0 text-gray-11 group-hover:text-gray-12 icon-md" />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content
            className={`z-floating grid w-max min-w-56 p-2 rounded-card bg-card text-gray-12 shadow-floating focus:outline-0 ${popup_anim}`}
          >
            {list.map((org) => {
              const is_current = org.id.toString() === current_id;
              return (
                <Menu.Item key={org.id} value={org.id.toString()} asChild>
                  <Link
                    to={href("/admin/:id", { id: org.id.toString() })}
                    className="hover:bg-gray-3 data-highlighted:bg-gray-3 data-highlighted:text-gray-12 data-highlighted:outline-2 data-highlighted:outline-ring data-highlighted:-outline-offset-2 flex items-center gap-2 px-2 py-2 rounded text-gray-11 hover:text-gray-12"
                  >
                    <Image
                      src={org.logo || flying_character}
                      className="size-6 shrink-0 rounded-full object-cover aspect-square"
                    />
                    <span className="text-sm truncate flex-1">{org.name}</span>
                    {is_current && (
                      <CheckIcon className="shrink-0 text-primary icon-md" />
                    )}
                  </Link>
                </Menu.Item>
              );
            })}
            <Menu.Item value="register" asChild>
              <Link
                to={href("/register")}
                className="hover:bg-gray-3 data-highlighted:bg-gray-3 data-highlighted:text-gray-12 data-highlighted:outline-2 data-highlighted:outline-ring data-highlighted:-outline-offset-2 border-t border-hairline mt-1 flex items-center gap-2 px-2 py-2 rounded text-gray-11 hover:text-gray-12"
              >
                <PlusIcon className="shrink-0 icon-md" />
                <span className="text-sm">Register another org</span>
              </Link>
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
