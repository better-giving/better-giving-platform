import { Progress } from "@ark-ui/react/progress";

export interface IGoalBar {
  raised: number;
  goal: number;
  /** the bar's accessible name */
  label?: string;
  classes?: string;
}

/** progress toward a goal: brand fill, fully rounded, 8px, on the recessed
 *  track pair. past the goal the fill stays full; anything raised shows at
 *  least a 4px sliver, so a first gift against a large goal is seen. */
export function GoalBar({
  raised,
  goal,
  label = "Amount raised",
  classes = "",
}: IGoalBar) {
  // a goal of 0 is met by anything raised; as a max it would divide 0 by 0
  const max = goal > 0 ? goal : 1;
  const value = goal > 0 ? Math.min(raised, goal) : raised > 0 ? max : 0;
  return (
    <Progress.Root value={value} max={max} className={`h-2 w-full ${classes}`}>
      <Progress.Track
        aria-label={label}
        className="h-full w-full overflow-hidden rounded-full bg-gray-4 inset-shadow-track"
      >
        <Progress.Range
          className={`h-full rounded-full bg-primary shadow-track-fill ${raised > 0 ? "min-w-1" : ""}`}
        />
      </Progress.Track>
    </Progress.Root>
  );
}
