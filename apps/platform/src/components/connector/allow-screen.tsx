import { Button } from "@better-giving/ui";
import { Bot, CircleAlert, Ellipsis } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import { Form, href, Link, useLocation } from "react-router";
import bg_logo from "#/assets/images/bg-logo.webp";
import { type ClientId, clients } from "./clients";

export interface INpoChoice {
  id: number;
  name: string;
}

export interface IAllowScreen {
  nonprofits: INpoChoice[];
  state: string;
  /** the signed-in account the connection would act as */
  email: string;
  client?: ClientId | null;
  error?: string;
  blocked?: boolean;
}

const TILE = "size-12 shrink-0 rounded overflow-hidden";

interface IClientTile {
  client: ClientId | null;
}

function ClientTile({ client }: IClientTile) {
  if (!client) {
    return (
      <span className={`${TILE} flex-center border bg-surface text-gray-11`}>
        <Bot className="icon-lg" aria-hidden />
      </span>
    );
  }
  const c = clients[client];
  return (
    <span className={`${TILE} ${c.tile}`}>
      <img src={c.logo} alt="" className="size-full object-contain" />
    </span>
  );
}

export function AllowScreen({
  nonprofits,
  state,
  email,
  client = null,
  error,
  blocked = false,
}: IAllowScreen) {
  const disclosure_id = useId();
  const empty_id = useId();
  const none = nonprofits.length === 0;
  const alert_ref = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  const client_name = client ? clients[client].name : "An AI assistant";
  const described_by = none ? `${disclosure_id} ${empty_id}` : disclosure_id;

  useLayoutEffect(() => {
    if (error) alert_ref.current?.focus();
  }, [error]);

  return (
    <section className="solo-card grid-cols-1 gap-6">
      <header className="grid gap-6">
        <div className="flex items-center justify-center gap-3">
          <ClientTile client={client} />
          <Ellipsis className="icon-xl text-gray-11" aria-hidden />
          <span className={`${TILE} border bg-surface p-2`}>
            <img src={bg_logo} alt="" className="size-full object-contain" />
          </span>
        </div>
        <h2 className="text-center text-xl font-bold text-balance">
          {client_name} wants to connect to Better Giving
        </h2>
      </header>

      <div className="flex items-center gap-3 rounded border bg-surface px-4 py-3.5">
        <span
          aria-hidden
          className="flex-center size-10 shrink-0 rounded-full bg-primary text-lg font-bold text-primary-fg"
        >
          {email.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-11">Signed in as</p>
          <p className="truncate font-bold">{email}</p>
        </div>
        <Form method="post" action={href("/logout")} className="shrink-0">
          <input type="hidden" name="redirect" value={pathname + search} />
          <Button type="submit" variant="outline" size="sm">
            Switch account
          </Button>
        </Form>
      </div>

      <Form method="post" className="grid min-w-0 grid-cols-1 gap-6">
        {blocked ? null : <input type="hidden" name="state" value={state} />}
        {blocked ? null : none ? (
          <div
            id={empty_id}
            className="grid gap-1 rounded border border-dashed px-4 py-3.5"
          >
            <p className="font-bold">This account doesn't manage a nonprofit</p>
            <p className="text-sm text-gray-11">
              Switch to the account that runs your nonprofit, or register one at{" "}
              <Link to={href("/register")} className="link font-semibold">
                better.giving/register
              </Link>
              .
            </p>
          </div>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="mb-2 font-bold">Connect which nonprofit?</legend>
            {nonprofits.map((npo) => (
              <label
                key={npo.id}
                className="radio rounded border px-3.5 py-3 has-checked:border-primary has-checked:bg-secondary-active"
              >
                <input
                  type="radio"
                  name="npo_id"
                  value={npo.id}
                  defaultChecked={nonprofits.length === 1}
                />
                {npo.name}
              </label>
            ))}
          </fieldset>
        )}
        <p id={disclosure_id} className="text-sm text-gray-11">
          The connection can read donors' names and email addresses, donations,
          campaigns, and forms. It can create, edit, publish, and end campaigns
          and add photos to them. It can create, edit, and publish donation
          forms. It cannot move money.
        </p>
        <div className="grid">
          <div
            ref={alert_ref}
            role="alert"
            tabIndex={error ? -1 : undefined}
            className={
              error
                ? "mb-6 flex items-start gap-2 rounded border border-destructive bg-destructive-subtle p-3 text-sm text-destructive-subtle-fg focus-visible:outline-2 focus-visible:outline-offset-2"
                : undefined
            }
          >
            {error ? (
              <>
                <span className="flex h-lh shrink-0 items-center">
                  <CircleAlert className="icon-sm" />
                </span>
                <p>{error}</p>
              </>
            ) : null}
          </div>
          {blocked ? null : (
            <div className="grid grid-cols-[1fr_2fr] gap-3">
              <Button
                type="submit"
                variant="outline"
                size="lg"
                name="decision"
                value="deny"
                aria-describedby={described_by}
              >
                Deny
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                name="decision"
                value="allow"
                disabled={none}
                aria-describedby={described_by}
              >
                Allow
              </Button>
            </div>
          )}
        </div>
      </Form>
    </section>
  );
}
