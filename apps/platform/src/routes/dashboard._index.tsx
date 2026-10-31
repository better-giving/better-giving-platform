import { Image } from "@better-giving/ui";
import { LogOutIcon, PlusIcon, ShieldIcon, XIcon } from "lucide-react";
import { Form, href, Link, useFetcher } from "react-router";
import { safeParse } from "valibot";
import { user_ctx } from "#/.server/auth";
import { user_bookmarks, user_npos } from "#/.server/user";
import { UserAvatar } from "#/components/header/user-avatar";
import { metas } from "#/helpers/seo";
import { $int_gte1 } from "@/schemas";
import { user_bookmark_del, user_get } from "$/pg/queries/user";
import type { Route } from "./+types/dashboard._index";

export const meta: Route.MetaFunction = () => metas({ title: "My Account" });

export const loader = async ({ context }: Route.LoaderArgs) => {
  const user = context.get(user_ctx);

  const [bookmarks, orgs, db_user] = await Promise.all([
    user_bookmarks(user.id),
    user_npos(user.id),
    user_get(user.email),
  ]);

  return {
    name: `${user.first_name} ${user.last_name}`.trim(),
    email: user.email,
    avatar_url: db_user?.avatar_url ?? undefined,
    is_admin: user.role === "admin",
    orgs,
    bookmarks,
  };
};

export const action = async ({ request, context }: Route.ActionArgs) => {
  // auth enforced by parent dashboard/route middleware
  const user = context.get(user_ctx);
  const form = await request.formData();

  if (form.get("intent") === "remove-bookmark") {
    const p = safeParse($int_gte1, form.get("npo_id"));
    if (p.issues) return { ok: false };
    await user_bookmark_del(user.id, p.output);
  }

  return { ok: true };
};

export default function Page({ loaderData: d }: Route.ComponentProps) {
  return (
    <div className="grid grid-cols-1 content-start relative px-6 py-4 md:px-10 md:py-8">
      {/* identity header — name is the page's primary heading */}
      <div className="flex items-center gap-x-4 mb-8">
        <UserAvatar avatar={d.avatar_url} classes="size-16" />
        <div className="grid">
          <h1 className="text-3xl font-bold">{d.name}</h1>
          <span className="text-sm text-gray-11">{d.email}</span>
        </div>
        <Form
          method="POST"
          action={href("/logout")}
          className="ml-auto shrink-0"
        >
          <button
            type="submit"
            aria-label="Log Out"
            className="flex items-center gap-x-2 text-sm text-gray-11 transition-colors hover:text-destructive-subtle-fg focus-visible:outline-2 focus-visible:outline-ring rounded"
          >
            <LogOutIcon className="icon-lg shrink-0" />
            <span className="max-sm:sr-only">Log Out</span>
          </button>
        </Form>
      </div>

      {/* platform admin — surfaced first for the few users who have it */}
      {d.is_admin && (
        <Link
          to={href("/platform")}
          className="card flex items-center gap-x-3 mb-8 transition-colors hover:bg-panel hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          <span className="size-8 rounded-full bg-primary/10 text-primary grid place-items-center shrink-0">
            <ShieldIcon className="icon-lg" />
          </span>
          <span className="text-sm font-medium">Platform Admin</span>
        </Link>
      )}

      {/* organizations */}
      <section aria-labelledby="hub-orgs" className="mb-8">
        <h2
          id="hub-orgs"
          className="uppercase text-xs text-gray-11 tracking-wide mb-3"
        >
          My Organizations
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d.orgs.map((org) => (
            <Link
              key={org.id}
              to={href("/admin/:id", { id: org.id.toString() })}
              className="card flex items-center gap-x-3 transition-colors hover:bg-panel hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Image
                loading="lazy"
                src={org.logo}
                className="object-cover aspect-square rounded-full shrink-0"
                height={32}
                width={32}
              />
              <span className="text-sm font-medium truncate">{org.name}</span>
            </Link>
          ))}
          <Link
            to={href("/register")}
            className="flex items-center gap-x-3 border border-dashed border-gray-6 rounded p-3 text-gray-11 transition-colors hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
          >
            {/* placeholder slot sized to match the org logos */}
            <span className="size-8 rounded-full bg-gray-3 grid place-items-center shrink-0">
              <PlusIcon className="icon-lg" />
            </span>
            <span className="text-sm font-medium">
              Register an organization
            </span>
          </Link>
        </div>
      </section>

      {/* favorites — omitted when empty; divider separates it from orgs */}
      {d.bookmarks.length > 0 && (
        <section
          aria-labelledby="hub-favorites"
          className="mb-8 pt-8 border-t border-hairline"
        >
          <h2
            id="hub-favorites"
            className="uppercase text-xs text-gray-11 tracking-wide mb-3"
          >
            My Favorites
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {d.bookmarks.map((b) => (
              <FavoriteCard key={b.id} fav={b} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface IFavorite {
  id: number;
  name: string;
  logo?: string;
}

function FavoriteCard({ fav }: { fav: IFavorite }) {
  const fetcher = useFetcher();
  // optimistically drop the card while its removal is in flight
  if (fetcher.state !== "idle") return null;

  return (
    <div className="relative">
      <Link
        to={href("/org/:org", { org: fav.id.toString() })}
        className="card pr-11 flex items-center gap-x-3 transition-colors hover:bg-panel hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Image
          loading="lazy"
          src={fav.logo}
          className="object-cover aspect-square rounded-full shrink-0"
          height={32}
          width={32}
        />
        <span className="text-sm font-medium truncate">{fav.name}</span>
      </Link>
      <fetcher.Form
        method="POST"
        className="absolute inset-y-0 right-2 flex items-center"
      >
        <input type="hidden" name="intent" value="remove-bookmark" />
        <input type="hidden" name="npo_id" value={fav.id} />
        <button
          type="submit"
          aria-label={`Remove ${fav.name} from favorites`}
          className="grid place-items-center size-7 rounded-full text-gray-11 transition-colors hover:bg-gray-3 hover:text-destructive-subtle-fg focus-visible:outline-2 focus-visible:outline-ring"
        >
          <XIcon className="icon-md" />
        </button>
      </fetcher.Form>
    </div>
  );
}
