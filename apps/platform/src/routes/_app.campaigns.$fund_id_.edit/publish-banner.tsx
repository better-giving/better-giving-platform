import { Confirmed, Info } from "@better-giving/ui";
import { href, Link } from "react-router";

interface Props {
  published: boolean;
  fundId: string;
  onToggle: () => void;
  isToggling: boolean;
}

export function PublishBanner(props: Props) {
  return (
    <div
      className={`flex flex-wrap justify-between items-center border rounded p-4 gap-4 ${
        props.published
          ? "bg-success-subtle border-success"
          : "bg-warning-subtle border-warning"
      }`}
    >
      {props.published ? (
        <Confirmed>Your campaign is public</Confirmed>
      ) : (
        <Info classes="text-warning-subtle-fg">
          Your campaign is not public yet
        </Info>
      )}
      <div className="flex items-center gap-x-2">
        <button
          disabled={props.isToggling}
          onClick={props.onToggle}
          type="button"
          className="btn btn-primary"
        >
          {props.isToggling
            ? "Updating.."
            : props.published
              ? "Unpublish"
              : "Publish"}
        </button>
        <Link
          target="_blank"
          to={href("/campaigns/:fund_id", { fund_id: props.fundId })}
          className="link text-sm flex items-center gap-1"
        >
          View
        </Link>
      </div>
    </div>
  );
}
