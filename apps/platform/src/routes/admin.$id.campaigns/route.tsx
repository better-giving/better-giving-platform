import { EmptyState, TabPanel, Tabs } from "@better-giving/ui";
import { useId } from "react";
import { href, Link, useSearchParams } from "react-router";
import { admin_page_meta } from "#/routes/admin.$id/page-meta";
import { FundsList } from "#/routes/admin.$id.funds/list";
import type { Route } from "./+types/route";
import { fund_row_status, STATUS_WORD } from "./copy";
import { fund_end, Row, when } from "./row";

export { ErrorBoundary } from "#/components/error";
export { loader } from "./api";

export const meta: Route.MetaFunction = ({ matches }) =>
  admin_page_meta("Campaigns", matches);

interface IListedFund {
  id: string;
  name: string;
  active: boolean;
  published: boolean;
  donation_total_usd: number;
  expiration: number;
  banner?: string;
  target?: string;
}

interface IRowLinks {
  edit_to?: string;
  view_to?: string;
}

interface IRowLinksProps extends IRowLinks {
  /** the row's name, so each row's View and Edit are told apart */
  name_id: string;
}

function RowLinks({ edit_to, view_to, name_id }: IRowLinksProps) {
  const view_id = useId();
  const edit_id = useId();
  return (
    <>
      {view_to && (
        <Link
          to={view_to}
          target="_blank"
          rel="noopener noreferrer"
          className="link text-sm"
          aria-labelledby={`${view_id} ${name_id}`}
        >
          <span id={view_id}>View</span>
        </Link>
      )}
      {edit_to && (
        <Link
          className="btn btn-secondary"
          to={edit_to}
          aria-labelledby={`${edit_id} ${name_id}`}
        >
          <span id={edit_id}>Edit</span>
        </Link>
      )}
    </>
  );
}

/** a closed fund has no editor; the public page is the view link */
function fund_links(f: IListedFund): IRowLinks {
  const public_to = href("/fundraisers/:fund_id", { fund_id: f.id });
  if (!f.active) return { view_to: f.published ? public_to : undefined };
  return {
    edit_to: href("/fundraisers/:fund_id/edit", { fund_id: f.id }),
    view_to: f.published ? public_to : undefined,
  };
}

export default function Page({ loaderData }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const tab = loaderData.view;
  const { endow } = loaderData;
  const new_to = href("/admin/:id/campaigns/new", { id: String(endow.id) });

  return (
    <div className="grid px-6 py-4 md:px-10 md:py-8 gap-6 max-w-[1400px]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Campaigns</h1>
        {loaderData.view === "campaigns" && (
          <Link to={new_to} className="btn btn-primary">
            New campaign
          </Link>
        )}
      </div>
      <Tabs
        className="grid gap-6"
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          if (value === "fundraisers") next.set("tab", "fundraisers");
          else next.delete("tab");
          setParams(next, { preventScrollReset: true });
        }}
        items={[
          { value: "campaigns", label: "Your campaigns" },
          { value: "fundraisers", label: "Supporter campaigns" },
        ]}
      >
        {loaderData.view === "campaigns" ? (
          <TabPanel value="campaigns" className="grid gap-6">
            {loaderData.campaigns.length === 0 &&
            loaderData.org_funds.length === 0 ? (
              <EmptyState
                action={
                  <Link to={new_to} className="btn btn-primary">
                    Create campaign
                  </Link>
                }
              >
                No campaigns yet
              </EmptyState>
            ) : (
              <ul className="grid gap-3">
                {loaderData.campaigns.map((c) => {
                  const public_to =
                    c.status !== "draft" && endow.slug
                      ? href("/org/:org/:campaign", {
                          org: endow.slug,
                          campaign: c.slug,
                        })
                      : undefined;
                  const status = STATUS_WORD[c.status_label];
                  return (
                    <Row
                      key={c.id}
                      name={c.name}
                      status={status}
                      thumb={c.hero || null}
                      raised={c.raised}
                      target={c.target}
                      ends={when(c.ends_at, status)}
                      actions={(name_id) => (
                        <RowLinks
                          edit_to={href("/admin/:id/campaigns/:campaign_id", {
                            id: String(endow.id),
                            campaign_id: c.id,
                          })}
                          view_to={public_to}
                          name_id={name_id}
                        />
                      )}
                    />
                  );
                })}
                {loaderData.org_funds.map((f) => {
                  const status = fund_row_status(f);
                  return (
                    <Row
                      key={f.id}
                      name={f.name}
                      status={status}
                      thumb={f.banner || endow.image || null}
                      raised={f.donation_total_usd}
                      target={f.target}
                      ends={fund_end(f.expiration, status)}
                      actions={(name_id) => (
                        <RowLinks {...fund_links(f)} name_id={name_id} />
                      )}
                    />
                  );
                })}
              </ul>
            )}
          </TabPanel>
        ) : (
          <TabPanel value="fundraisers" className="grid gap-6">
            <FundsList
              funds={loaderData.funds}
              endow_id={endow.id}
              platform_admin={loaderData.user.role === "admin"}
            />
          </TabPanel>
        )}
      </Tabs>
    </div>
  );
}
