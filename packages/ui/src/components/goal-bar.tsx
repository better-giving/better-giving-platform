import { Progress } from "@ark-ui/react/progress";

export interface IGoalBar {
  raised: number;
  goal: number;
  /** the bar's accessible name */
  label?: string;
  classes?: string;
}

/** progress toward a goal: brand fill, fully rounded, 8px, on the recessed
 *  track pair. past the goal the fill stays full. */
export function GoalBar({
  raised,
  goal,
  label = "Amount raised",
  classes = "",
}: IGoalBar) {
  return (
    <Progress.Root
      value={Math.min(raised, goal)}
      max={goal}
      className={`h-2 w-full ${classes}`}
    >
      <Progress.Track
        aria-label={label}
        className="h-full w-full overflow-hidden rounded-full bg-gray-3 inset-shadow-track"
      >
        <Progress.Range className="h-full rounded-full bg-primary shadow-track-fill" />
      </Progress.Track>
    </Progress.Root>
  );
}
