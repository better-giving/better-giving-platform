import { RmxForm } from "@better-giving/ui";
import { useNavigation } from "react-router";
import { RouteModal } from "#/components/route-modal";

export { ErrorModal as ErrorBoundary } from "#/components/error";

export default function Page() {
  return (
    <RouteModal classes="grid bg-card text-gray-12 p-6">
      <Content />
    </RouteModal>
  );
}

function Content() {
  const navigation = useNavigation();

  return (
    <>
      <div className="text-center mb-6">
        <h2 className="text-xl font-bold mb-2">Tax Forms Required</h2>
        <p className="text-gray-11">
          To receive payout, kindly fill out the appropriate tax form
        </p>
      </div>

      {/* the form is minted server-side and recorded against this user before
      anvil is opened — no public weld link, so the submission is never
      anonymous. one column holds that record, so a signer is deliberately sent
      to one form at a time: a second mint overwrites the first, and the
      overwritten one can no longer be claimed on the callback. hence the
      controls close while a mint is in flight. */}
      <RmxForm
        disabled={navigation.state !== "idle"}
        busy={navigation.state === "submitting"}
        method="post"
        action="../w-form-start"
      >
        <div className="space-y-4">
          <button
            type="submit"
            name="tax_form"
            value="irs-w9"
            className="w-full block p-4 border rounded hover:bg-gray-3 transition-colors text-left disabled:pointer-events-none disabled:bg-gray-3 disabled:text-gray-11"
          >
            <div className="font-semibold">For US Residents</div>
            <div className="text-sm text-gray-11">
              Complete this W-9 tax status form
            </div>
          </button>

          <button
            type="submit"
            name="tax_form"
            value="fw8ben"
            className="w-full block p-4 border rounded hover:bg-gray-3 transition-colors text-left disabled:pointer-events-none disabled:bg-gray-3 disabled:text-gray-11"
          >
            <div className="font-semibold">For Non-US Residents</div>
            <div className="text-sm text-gray-11">
              Complete this W-8BEN tax status form
            </div>
          </button>
        </div>
      </RmxForm>
    </>
  );
}
