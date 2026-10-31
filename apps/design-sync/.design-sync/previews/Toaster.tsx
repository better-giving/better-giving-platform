// both halves come from the package, which is what a design does: they share one
// module-scope toast manager, and pushing through a second copy would render
// nothing. `show_toast` is on the entry surface for exactly this reason.
import { show_toast, Toaster } from "@better-giving/ui";
import { useEffect } from "react";

type Toast = { type?: "success" | "error" | "info"; message: string };

// toasts are pushed imperatively, never rendered — this mounts them so the
// card shows the component's only visible state.
function Emit({ toasts }: { toasts: Toast[] }) {
  useEffect(() => {
    // deferred by a tick: `Emit` is a child of `Toaster`, so its effect runs
    // before ArkToaster subscribes to the manager, and a toast created first
    // is never picked up.
    const id = setTimeout(() => {
      for (const t of toasts) show_toast(t);
    }, 0);
    return () => clearTimeout(id);
  }, [toasts]);
  return null;
}

// the page underneath a toast — kept realistic so the overlay reads in context.
function MembersPanel() {
  return (
    <div className="w-96 overflow-hidden rounded-card bg-card">
      <div className="border-b bg-gray-3 px-4 py-3 text-sm font-medium text-gray-12">
        Members — Rainforest Trust
      </div>
      {[
        { name: "Amara Osei", email: "amara@rainforesttrust.org" },
        { name: "Daniel Reyes", email: "daniel@rainforesttrust.org" },
      ].map((m) => (
        <div
          key={m.email}
          className="flex items-center gap-4 border-b px-4 py-3"
        >
          <div className="flex flex-col">
            <span className="text-sm text-gray-12">{m.name}</span>
            <span className="text-xs text-gray-11">{m.email}</span>
          </div>
          <button type="button" className="btn btn-ghost ml-auto px-4 py-1.5">
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

export const SuccessToast = () => (
  <Toaster>
    <MembersPanel />
    <Emit
      toasts={[{ type: "success", message: "Payout of $1,200.00 requested" }]}
    />
  </Toaster>
);

export const ErrorToast = () => (
  <Toaster>
    <MembersPanel />
    <Emit
      toasts={[
        {
          type: "error",
          message: "You can't remove yourself from this nonprofit",
        },
      ]}
    />
  </Toaster>
);

export const InfoToast = () => (
  <Toaster>
    <MembersPanel />
    <Emit
      toasts={[
        {
          type: "info",
          message:
            "Your donation receipt was sent to amara@rainforesttrust.org",
        },
      ]}
    />
  </Toaster>
);
