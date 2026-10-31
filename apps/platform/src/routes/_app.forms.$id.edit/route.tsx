import { Target } from "@better-giving/ui";
import { ChevronLeftIcon, TagIcon } from "lucide-react";
import { NavLink, useFetcher } from "react-router";
import { fill } from "#/components/donate-methods";
import { to_form_target } from "#/components/goal-selector";
import { to_freq_bools } from "@/helpers/donation";
import type { FormRow } from "$/pg/queries/form";
import type { Route } from "./+types/route";
import { Preview } from "./preview";
import { SettingsAdv } from "./settings-adv";
import { SettingsBasic } from "./settings-basic";
import { Snippet } from "./snippet";
import { SnippetAdv } from "./snippet-adv";

// flat DB columns → compound target for <Target> component
function row_target(r: FormRow): "smart" | number | null {
  return r.target_smart ? "smart" : (r.target_number ?? null);
}

export { ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";
export const meta: Route.MetaFunction = ({ loaderData: d, params }) => {
  if (!d || !params.id) return [{ name: "robots", content: "noindex" }];
  return [
    { title: `Form - ${d.name}` },
    { name: "robots", content: "noindex" },
  ];
};

export default function Page({ loaderData }: Route.ComponentProps) {
  const fetcher = useFetcher();
  const { back_url, base_url, ...d } = loaderData;

  const type: "script" | "iframe" = d.success_redirect ? "script" : "iframe";

  return (
    <div>
      <div className="grid py-4 content-start grid-rows-[auto_auto_1fr] lg:container lg:mx-auto px-4 lg:grid-cols-2 gap-4">
        <header className="col-span-full lg:mb-6">
          <NavLink to={back_url} className="flex link items-center gap-x-1">
            <ChevronLeftIcon className="icon-md" />
            <span className="text-sm">Forms</span>
          </NavLink>
          {d.tag && (
            <p className="-mb-3 mt-2 pl-2">
              <TagIcon className="inline-block  mr-1 icon-xs" />
              <span className=" text-sm">{d.tag}</span>
            </p>
          )}
          <div
            key={d.id}
            className="card flex gap-2 max-lg:flex-col max-lg:items-start items-center mt-4 gap-y-4"
          >
            <div className="flex-1">
              <h3 className="text-lg flex-1">{d.name}</h3>
              {d.program_id && (
                <p className="text-sm mt-1">
                  <span className="text-xs bg-gray-3 p-1 rounded">Program</span>{" "}
                  <span className="text-sm font-medium text-gray-11">
                    {d.program_name}
                  </span>
                </p>
              )}
            </div>
            <Target.Inline
              classes="w-64"
              target={row_target(d)}
              progress={d.ltd ?? 0}
            />
          </div>
        </header>
        <div className="row-span-2 grid gap-y-4">
          <SettingsBasic
            type="basic"
            frequencies={to_freq_bools(d.freq_opts ?? undefined)}
            is_submitting={fetcher.state === "submitting"}
            increments={d.increments ?? []}
            target={to_form_target(row_target(d)?.toString() ?? "0")}
            methods={fill(d.donate_methods ?? undefined)}
            accent_primary={d.accent_primary ?? undefined}
            accent_secondary={d.accent_secondary ?? undefined}
            tag={d.tag ?? ""}
            on_submit={(x) =>
              fetcher.submit(x, { method: "POST", encType: "application/json" })
            }
          />
          <SettingsAdv
            type="adv"
            is_submitting={fetcher.state === "submitting"}
            success_redirect={d.success_redirect ?? undefined}
            on_submit={(x) =>
              fetcher.submit(x, { method: "POST", encType: "application/json" })
            }
          />
        </div>

        {type === "script" ? (
          <SnippetAdv base_url={base_url} form_id={d.id} />
        ) : (
          <Snippet base_url={base_url} form_id={d.id} classes="self-start" />
        )}
        <Preview {...loaderData} form_id={d.id} type={type} classes="mt-4" />
      </div>
    </div>
  );
}
