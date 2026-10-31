import { CheckCircle2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { RouteModal } from "#/components/route-modal";
import type { Route } from "./+types/route";
import type { action, loader } from "./api";
import { SettleForm } from "./form";
import { Preview } from "./preview";
import type { IFormValues } from "./types";

export { ErrorModal as ErrorBoundary } from "#/components/error";
export { action, loader } from "./api";

type Step = "form" | "preview" | "done";

const defaults: IFormValues = {
  from: "cheque",
  npo: undefined,
  donor_name: "",
  donor_email: "settlement@better.giving",
  net: "",
  reference: "",
  for_donation_id: "",
};

/** exactly what the confirm posts, less the key — so the key can be found by it */
const confirm_body = (form: IFormValues) => ({
  from: form.from,
  npo_id: form.npo?.id.toString() ?? "",
  donor_name: form.donor_name || "",
  donor_email: form.donor_email,
  net: form.net,
  reference: form.reference,
  for_donation_id: form.for_donation_id,
});
type IConfirmBody = ReturnType<typeof confirm_body>;

/**
 * the settlement's idempotency key, held in the tab rather than the component.
 *
 * a confirm that fails with a 5xx lands on the route's error boundary, which
 * unmounts the page — a key in component state would be lost, and the admin
 * reopening the dialog for the same cheque would settle it a second time. the
 * values themselves name the entry, so previewing the same settlement again
 * finds its key and any edit is a new settlement. the memory map stands in for
 * a tab whose storage throws (blocked site data), lasting until reload.
 */
const keys_in_memory = new Map<string, string>();
const key_slot = (body: IConfirmBody) =>
  `settlement-idempotency:${JSON.stringify(body)}`;

function held_key(body: IConfirmBody): string {
  const slot = key_slot(body);
  try {
    const held = sessionStorage.getItem(slot);
    if (held) return held;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(slot, fresh);
    return fresh;
  } catch {
    const fresh = keys_in_memory.get(slot) ?? crypto.randomUUID();
    keys_in_memory.set(slot, fresh);
    return fresh;
  }
}

/** a recorded settlement frees its values: the same cheque keyed again is a new one */
function release_key(body: IConfirmBody) {
  const slot = key_slot(body);
  keys_in_memory.delete(slot);
  try {
    sessionStorage.removeItem(slot);
  } catch {}
}

export default function Page(_: Route.ComponentProps) {
  const navigate = useNavigate();
  const close = () =>
    navigate("..", { preventScrollReset: true, replace: true });

  return (
    <RouteModal size="lg" classes="bg-card">
      <Content on_close={close} />
    </RouteModal>
  );
}

function Content({ on_close }: { on_close: () => void }) {
  const submit_fetcher = useFetcher<typeof action>();
  const preview_fetcher = useFetcher<typeof loader>();
  const awaiting_preview = useRef(false);
  const [step, set_step] = useState<Step>("form");
  const [form, set_form] = useState<IFormValues>(defaults);
  // one per previewed set of values: every confirm of it, retries and reopened
  // dialogs included, is the same settlement to the server
  const [idempotency_key, set_idempotency_key] = useState("");

  const submitting = submit_fetcher.state !== "idle";
  const loading_preview = preview_fetcher.state !== "idle";

  useEffect(() => {
    if (step !== "preview" || !submit_fetcher.data?.ok) return;
    release_key(confirm_body(form));
    set_step("done");
  }, [step, submit_fetcher.data, form]);

  // transition to preview when preview data arrives. a load that completed with
  // nothing to show keeps the admin on the form, where the loader's reason is
  // rendered — the alternative is a button that silently does nothing.
  useEffect(() => {
    if (!awaiting_preview.current || preview_fetcher.state !== "idle") return;
    if (!preview_fetcher.data) return;
    awaiting_preview.current = false;
    if (!preview_fetcher.data.preview) return;
    set_idempotency_key(held_key(confirm_body(form)));
    set_step("preview");
  }, [preview_fetcher.data, preview_fetcher.state, form]);

  // a match that names a gift takes its recipient from that gift, so the
  // nonprofit may legitimately be unset — the loader resolves it from the id
  const handle_preview = (values: IFormValues) => {
    set_form(values);
    const for_donation_id =
      values.from === "match" ? values.for_donation_id.trim() : "";
    const params = new URLSearchParams({
      npo_id: values.npo?.id.toString() ?? "",
      net: values.net,
      ...(for_donation_id ? { for_donation_id } : {}),
    });
    awaiting_preview.current = true;
    preview_fetcher.load(`?${params}`);
  };

  const previews = preview_fetcher.data?.previews ?? [];
  // what the money actually reached, falling back to the admin's pick only when
  // nothing resolved — naming a nonprofit that received none of it is worse
  // than naming none at all
  const recipients =
    previews.map((p) => p.npo_name).join(", ") || (form.npo?.name ?? "");

  if (step === "done") {
    return (
      <div className="p-6 sm:p-8 text-center">
        <CheckCircle2Icon className="mx-auto mb-3 text-success pictogram-md" />
        <h3 className="text-lg font-bold mb-1">Settlement created</h3>
        <p className="text-sm text-gray-11 mb-4">
          Settlement for ${form.net} to {recipients} has been recorded.
        </p>
        {submit_fetcher.data && "replayed" in submit_fetcher.data && (
          <p className="text-sm text-gray-11 mb-4">
            It was already recorded by an earlier confirm, so nothing was added
            twice.
          </p>
        )}
        <button type="button" onClick={on_close} className="btn btn-primary">
          Close
        </button>
      </div>
    );
  }

  if (step === "preview") {
    if (!previews.length) return null;
    return (
      <Preview
        form={form}
        previews={previews}
        submitting={submitting}
        error={
          submit_fetcher.data && !submit_fetcher.data.ok
            ? submit_fetcher.data.error
            : null
        }
        on_back={() => set_step("form")}
        on_confirm={() =>
          submit_fetcher.submit(
            { ...confirm_body(form), idempotency_key },
            { method: "post" }
          )
        }
      />
    );
  }

  return (
    <SettleForm
      defaults={form}
      loading={loading_preview}
      // why the last load came back with nothing; a load still in flight has
      // not failed yet, so it says nothing
      error={loading_preview ? null : (preview_fetcher.data?.error ?? null)}
      on_preview={handle_preview}
      on_close={on_close}
    />
  );
}
