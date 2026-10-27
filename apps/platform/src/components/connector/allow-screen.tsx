import { Actions, Button } from "@better-giving/ui";
import { CircleAlert } from "lucide-react";
import { useId, useLayoutEffect, useRef } from "react";
import { Form } from "react-router";

export interface INpoChoice {
  id: number;
  name: string;
}

export interface IAllowScreen {
  nonprofits: INpoChoice[];
  state: string;
  error?: string;
  blocked?: boolean;
}

export function AllowScreen({
  nonprofits,
  state,
  error,
  blocked = false,
}: IAllowScreen) {
  const disclosure_id = useId();
  const empty_id = useId();
  const none = nonprofits.length === 0;
  const alert_ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (error) alert_ref.current?.focus();
  }, [error]);

  return (
    <section className="card">
      <Form method="post" className="grid gap-6">
        <div className="grid gap-2">
          <h2 className="text-lg">This chat wants to connect to a nonprofit</h2>
          <p id={disclosure_id} className="max-w-prose text-sm text-gray-11">
            The connection can read donors' names and email addresses,
            donations, campaigns, and forms. It can create, edit, publish, and
            end campaigns and add photos to them. It can create, edit, and
            publish donation forms. It cannot move money.
          </p>
        </div>
        {blocked ? null : <input type="hidden" name="state" value={state} />}
        {blocked ? null : none ? (
          <p id={empty_id} className="text-sm">
            This account does not administer a nonprofit yet.
          </p>
        ) : (
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Nonprofit</legend>
            <div className="grid gap-5">
              {nonprofits.map((npo) => (
                <label key={npo.id} className="radio text-sm">
                  <input
                    type="radio"
                    name="npo_id"
                    value={npo.id}
                    defaultChecked={nonprofits.length === 1}
                  />
                  {npo.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div
          ref={alert_ref}
          role="alert"
          tabIndex={error ? -1 : undefined}
          className={
            error
              ? "flex items-start gap-2 rounded border border-destructive bg-destructive-subtle p-3 text-sm text-destructive-subtle-fg focus-visible:outline-2 focus-visible:outline-offset-2"
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
          <Actions>
            <Button
              type="submit"
              variant="outline"
              name="decision"
              value="deny"
              aria-describedby={
                none ? `${disclosure_id} ${empty_id}` : disclosure_id
              }
            >
              Deny
            </Button>
            {none ? null : (
              <Button
                type="submit"
                variant="primary"
                name="decision"
                value="allow"
                aria-describedby={disclosure_id}
              >
                Allow
              </Button>
            )}
          </Actions>
        )}
      </Form>
    </section>
  );
}
