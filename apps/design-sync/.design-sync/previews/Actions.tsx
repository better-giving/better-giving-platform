import { Actions, Button, Field } from "@better-giving/ui";

// the default, and what every form ends with: cancel first, submit last. the
// order is not decoration — it is also the stacked order below `sm` and the
// tab order everywhere, so the control that undoes is the one a keyboard
// reaches first.
export const Default = () => (
  <Actions>
    <Button variant="secondary">Cancel</Button>
    <Button variant="primary" type="submit">
      Save changes
    </Button>
  </Actions>
);

// `split` pushes the two apart. it is for a reset or a destructive sitting
// opposite the confirm, so a misclick beside the confirm lands on nothing. a
// cancel never takes it — a cancel belongs next to what it cancels.
export const Split = () => (
  <Actions align="split">
    <Button variant="destructive">Close fund</Button>
    <Button variant="primary" type="submit">
      Update fund
    </Button>
  </Actions>
);

// inside a dialog the row sits on a band — a tinted strip with a top border,
// full-bleed to the dialog's edges. this is the only place that strip is
// authored; never write `bg-gray-3 border-t` on a footer row by hand.
export const InADialog = () => (
  <div className="w-80 rounded-card overflow-hidden bg-card">
    <p className="font-bold text-center border-b bg-gray-3 p-5">
      Delete payout method
    </p>
    <p className="p-6 text-center text-gray-11">This cannot be undone.</p>
    <Actions band>
      <Button variant="secondary">Cancel</Button>
      <Button variant="destructive" type="submit">
        Proceed
      </Button>
    </Actions>
  </div>
);

// three controls read the same way, and a lone one does too — the row is
// where a form ends, not a two-button shape.
export const ThreeControls = () => (
  <Actions>
    <Button variant="secondary">Back</Button>
    <Button variant="destructive">Reject</Button>
    <Button variant="success">Approve</Button>
  </Actions>
);

// at the end of a real form. the margin above is the caller's, as everywhere
// else — the row owns its gap and, under `band`, its padding.
export const EndingAForm = () => (
  <form className="grid gap-6 w-80">
    <Field label="Organization name" placeholder="Acme Foundation" />
    <Field label="Contact email" placeholder="hello@acme.org" />
    <Actions classes="mt-2">
      <Button variant="secondary" type="reset">
        Reset changes
      </Button>
      <Button variant="primary" type="submit">
        Submit changes
      </Button>
    </Actions>
  </form>
);
