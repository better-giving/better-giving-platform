import { GoalBar } from "@better-giving/ui";

// the progress bar on its own: full width of its container, so each story
// gives it one. `raised` and `goal` are raw numbers; the bar writes no figures.

export const PartlyFunded = () => (
  <GoalBar
    raised={48_500}
    goal={75_000}
    label="Clean water for Turkana County: amount raised"
    classes="w-96"
  />
);

// past the goal the fill stays full rather than overflowing.
export const GoalMet = () => (
  <GoalBar raised={82_000} goal={75_000} classes="w-96" />
);

// a first gift against a large goal still shows a 4px sliver: anything raised
// is visible.
export const FirstGift = () => (
  <GoalBar raised={25} goal={100_000} classes="w-96" />
);

export const NothingRaised = () => (
  <GoalBar raised={0} goal={10_000} classes="w-96" />
);
