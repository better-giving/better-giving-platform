import { LoadText } from "@better-giving/ui";

// LoadText swaps its children for a spinner + progress copy while is_loading —
// it renders no wrapper of its own, so it always sits inside a button.

export const IdleAndLoading = () => (
  <div className="flex items-center gap-4">
    <button type="button" className="btn btn-primary px-6 py-2">
      <LoadText is_loading={false}>Submit</LoadText>
    </button>
    <button type="button" className="btn btn-primary px-6 py-2" disabled>
      <LoadText is_loading>Submit</LoadText>
    </button>
  </div>
);

// mirrors routes/_app.register._index/resume-strip.tsx and
// _landing.for-international-nonprofits/eligibility-form.tsx — the `text` prop
// names the action in progress.
export const CustomProgressText = () => (
  <div className="flex flex-col items-start gap-4">
    <button type="button" className="btn btn-primary px-6 py-2" disabled>
      <LoadText is_loading text="Resuming...">
        Resume registration
      </LoadText>
    </button>
    <button type="button" className="btn btn-primary px-6 py-2" disabled>
      <LoadText is_loading text="Sending...">
        Check eligibility
      </LoadText>
    </button>
    <button type="button" className="btn btn-primary px-6 py-2" disabled>
      <LoadText is_loading>Join free forever</LoadText>
    </button>
  </div>
);

export const Variants = () => (
  <div className="flex items-center gap-4">
    <button type="button" className="btn btn-secondary px-6 py-2" disabled>
      <LoadText is_loading text="Saving...">
        Save
      </LoadText>
    </button>
    <button type="button" className="btn btn-ghost px-6 py-2" disabled>
      <LoadText is_loading text="Refreshing...">
        Refresh
      </LoadText>
    </button>
    <button type="button" className="btn btn-destructive px-6 py-2" disabled>
      <LoadText is_loading text="Deleting...">
        Delete member
      </LoadText>
    </button>
  </div>
);

// mirrors routes/dashboard.referrals_.payout/form-buttons.tsx — a form footer
// mid-submit: back stays live, submit takes the spinner.
export const FormFooter = () => (
  <div className="w-[30rem] rounded-card bg-card">
    <div className="p-6">
      <p className="text-sm text-gray-12">Payout amount</p>
      <p className="mt-1 text-2xl font-medium text-gray-12">$1,200.00</p>
      <p className="mt-1 text-sm text-gray-11">
        Requested Nov 14, 2025 — settles to your linked account.
      </p>
    </div>
    <div className="flex justify-end gap-3 border-t bg-gray-3 p-4">
      <button type="button" className="btn btn-secondary px-6 py-2">
        Back
      </button>
      <button type="button" className="btn btn-primary px-6 py-2" disabled>
        <LoadText is_loading>Submit</LoadText>
      </button>
    </div>
  </div>
);
