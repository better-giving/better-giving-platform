import { Actions } from "@better-giving/ui";
import { modal_box } from "@better-giving/ui/helpers";
import { useRef } from "react";
import { useFetcher } from "react-router";

export function DeleteBtn({
  fund_id,
  name,
}: {
  fund_id: string;
  name: string;
}) {
  const dialog_ref = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher({ key: `delete-fund-${fund_id}` });

  return (
    <>
      <button
        type="button"
        disabled={fetcher.state !== "idle"}
        onClick={() => dialog_ref.current?.showModal()}
        className="text-destructive-subtle-fg hover:text-destructive-subtle-fg disabled:text-gray-11 text-xs font-medium"
      >
        Delete
      </button>
      <dialog
        ref={dialog_ref}
        className={`p-6 backdrop:bg-overlay ${modal_box.panel}`}
      >
        <h2 className="text-lg font-semibold mb-2">Delete campaign</h2>
        <p className="mb-4 whitespace-normal">
          Are you sure you want to delete{" "}
          <span className="font-bold">{name}</span> This action cannot be
          undone.
        </p>
        <Actions>
          {/* `contents` so the buttons are the row's own items: each sits in its
              own form, and a form box between them would keep them at content
              width when the row stacks. */}
          <form method="dialog" className="contents">
            <button type="submit" className="btn btn-secondary">
              Cancel
            </button>
          </form>
          <fetcher.Form
            onSubmit={() => dialog_ref.current?.close()}
            method="DELETE"
            className="contents"
          >
            <button
              type="submit"
              name="fund_id"
              value={fund_id}
              className="btn btn-destructive"
            >
              Proceed
            </button>
          </fetcher.Form>
        </Actions>
      </dialog>
    </>
  );
}
