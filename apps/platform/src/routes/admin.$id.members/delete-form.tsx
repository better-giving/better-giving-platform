import { LoaderCircle, Minus } from "lucide-react";
import { useFetcher } from "react-router";

interface Props {
  // user id for existing member, null for pending non-user invite
  to_remove: string | null;
  // for pending rows, the invitee email used to delete the invite row
  pending_email?: string;
  label: string;
}

export function DeleteForm({ to_remove, pending_email, label }: Props) {
  const key = to_remove ?? pending_email ?? label;
  const fetcher = useFetcher({ key: `admin-${key}` });

  return (
    <fetcher.Form method="POST" className="relative">
      <button
        disabled={fetcher.state !== "idle"}
        onClick={() => {
          if (!window.confirm(`Are you sure you want to remove ${label}?`))
            return;
          const body: Record<string, string> = pending_email
            ? { pending_email }
            : { to_remove: to_remove ?? "" };
          fetcher.submit(body, {
            action: ".",
            method: "POST",
            encType: "application/json",
          });
        }}
        type="button"
        aria-label={`Remove ${label}`}
        className="disabled:text-gray-11 hover:text-destructive-subtle-fg active:text-destructive-subtle-fg absolute-center"
      >
        {fetcher.state !== "idle" ? (
          <LoaderCircle className="animate-spin icon-md" />
        ) : (
          <Minus className="icon-md" />
        )}
      </button>
    </fetcher.Form>
  );
}
