import { Actions, type AskProps, Modal, use_ask } from "@better-giving/ui";
import { LoaderCircle } from "lucide-react";
import { useId, useRef } from "react";
import {
  href,
  Link,
  NavLink,
  useFetcher,
  useLocation,
  useParams,
} from "react-router";
import { FundCreator } from "#/components/campaign";
import {
  fund_row_status,
  STATUS_WORD,
} from "#/routes/admin.$id.campaigns/copy";
import { fund_end, Row } from "#/routes/admin.$id.campaigns/row";
import type { IFundItem } from "@/campaign";

interface Props extends IFundItem {
  isSelf: boolean;
  isEditor: boolean;
}
export const FundItem = (props: Props) => {
  const fetcher = useFetcher({ key: `fund-${props.id}` });
  const { pathname } = useLocation();
  const { id: npo_id } = useParams();
  // leave stays on the funds action; this row also renders under /campaigns
  const leave_action =
    npo_id && pathname.includes("/campaigns")
      ? href("/admin/:id/funds", { id: npo_id })
      : undefined;
  const ask = use_ask();
  const leave_label_id = useId();
  const view_label_id = useId();
  const edit_label_id = useId();
  const status = fund_row_status(props);
  const editable = status === STATUS_WORD.live || status === STATUS_WORD.draft;
  const busy = fetcher.state !== "idle";
  const leave = () => {
    void ask(LeaveConfirm, {
      name: props.name,
      creator_name: props.creator_name,
      on_leave: () => {
        fetcher.submit(
          { fund_id: props.id },
          leave_action
            ? { method: "POST", action: leave_action }
            : { method: "POST" }
        );
      },
    });
  };

  return (
    <Row
      name={props.name}
      status={status}
      thumb={props.banner || props.logo || null}
      raised={props.donation_total_usd}
      target={props.target}
      byline={
        <div className="text-sm">
          <span className="mr-1">by</span>
          <FundCreator
            name={props.creator_name}
            id={props.creator_id}
            classes="inline"
          />
        </div>
      }
      ends={fund_end(props.expiration, status)}
      actions={(name_id) => (
        <>
          {props.published && (
            <Link
              to={href("/fundraisers/:fund_id", { fund_id: props.id })}
              target="_blank"
              rel="noopener noreferrer"
              className="link text-sm"
              aria-labelledby={`${view_label_id} ${name_id}`}
            >
              <span id={view_label_id}>View</span>
            </Link>
          )}
          {props.isEditor && (
            <NavLink
              aria-disabled={!editable}
              className="btn btn-secondary"
              to={href("/fundraisers/:fund_id/edit", { fund_id: props.id })}
              aria-labelledby={`${edit_label_id} ${name_id}`}
            >
              <span id={edit_label_id}>Edit</span>
            </NavLink>
          )}
          {/** fund item won't show once NPO opted out of it: so no need to hide this button */}
          {!props.isSelf ? (
            // held, not `disabled`, while the leave is in flight: `disabled`
            // would drop the dialog's return focus onto `<body>`
            <button
              type="button"
              className={`btn btn-sm btn-ghost text-destructive gap-2${busy ? " pending" : ""}`}
              disabled={!props.active}
              aria-disabled={busy || undefined}
              aria-busy={busy}
              aria-labelledby={`${leave_label_id} ${name_id}`}
              onClick={() => {
                if (busy) return;
                leave();
              }}
            >
              {busy && <LoaderCircle className="animate-spin icon-xs" />}
              <span id={leave_label_id}>
                {busy ? "Leaving…" : "Leave campaign"}
              </span>
            </button>
          ) : null}
        </>
      )}
    />
  );
};

interface ILeaveConfirm {
  name: string;
  creator_name: string;
  on_leave: () => void;
}

/** asked, never mounted directly. */
function LeaveConfirm({
  name,
  creator_name,
  on_leave,
  open,
  resolve,
  on_closed,
}: ILeaveConfirm & AskProps) {
  const cancel_ref = useRef<HTMLButtonElement>(null);
  // the card's in-flight lock arrives on the next render, so a second
  // press here would post twice
  const sent = useRef(false);
  return (
    <Modal
      open={open}
      onClose={() => resolve()}
      onExitComplete={on_closed}
      initialFocusEl={() => cancel_ref.current}
      returnFocusFallback={() => {
        const heading = document.querySelector("h1");
        return heading instanceof HTMLElement ? heading : null;
      }}
      classes="bg-panel text-gray-12"
    >
      <div className="p-6 sm:p-8 grid gap-2">
        <h3 className="text-lg font-bold">Leave {name}?</h3>
        <p className="text-sm text-gray-11">
          An email goes to {creator_name}. You will stop receiving from this
          campaign.
        </p>
      </div>
      <Actions band>
        <button
          ref={cancel_ref}
          type="button"
          className="btn btn-secondary"
          onClick={() => resolve()}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-destructive"
          onClick={() => {
            if (sent.current) return;
            sent.current = true;
            on_leave();
            resolve();
          }}
        >
          Leave campaign
        </button>
      </Actions>
    </Modal>
  );
}
