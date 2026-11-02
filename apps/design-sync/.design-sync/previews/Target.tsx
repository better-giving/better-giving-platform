import { Target } from "@better-giving/ui";

// the fundraising progress bar. `progress` and `target` are whole USD amounts;
// `to_usd` inside the component does the formatting, so pass raw numbers.

export const PartlyFunded = () => (
  <Target
    text={<Target.Text classes="mb-2" />}
    progress={48_500}
    target={75_000}
    classes="w-96"
  />
);

export const GoalMet = () => (
  <Target
    text={<Target.Text classes="mb-2" />}
    progress={75_000}
    target={75_000}
    classes="w-96"
  />
);

// target="smart" has no fixed goal — it doubles from $100 until it clears
// what has been raised, so $1,450 raised renders against a $1,600 goal.
export const SmartTarget = () => (
  <Target
    text={<Target.Text classes="mb-2" />}
    progress={1_450}
    target="smart"
    classes="w-96"
  />
);

// Target.Inline lays raised / bar / goal on one row — used in the admin
// fundraiser table where vertical space is scarce.
export const Inline = () => (
  <div className="w-full max-w-2xl flex flex-col gap-4">
    <Target.Inline progress={12_800} target={20_000} />
    <Target.Inline progress={3_200} target="smart" />
  </div>
);

// how it sits inside a marketplace card: no prompt text, narrow column.
export const InCard = () => (
  <div className="w-64 bg-card rounded-card p-3">
    <h3 className="text-center mb-2">Ocean Conservancy</h3>
    <p className="text-gray-11 text-sm text-center mb-4">
      Protecting the ocean from today's greatest global challenges.
    </p>
    <Target progress={6_400} target={25_000} />
  </div>
);
