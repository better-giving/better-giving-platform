interface IGoalBar {
  raised: number;
  goal: number;
  label?: string;
  classes?: string;
}

/** raised against a goal; past the goal the fill stays full */
export function GoalBar({
  raised,
  goal,
  label = "Amount raised",
  classes = "",
}: IGoalBar) {
  const percent = goal > 0 ? Math.min(100, (raised / goal) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={Math.min(raised, goal)}
      aria-label={label}
      className={`h-2 w-full overflow-hidden rounded-full bg-gray-3 inset-shadow-track ${classes}`}
    >
      <div
        className="h-full rounded-full bg-primary shadow-track-fill"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
