import { TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

interface IWarningCallout {
  title: string;
  children: ReactNode;
  /** a link or button, right of the text from md and under it below */
  action?: ReactNode;
  classes?: string;
}

export function WarningCallout({
  title,
  children,
  action,
  classes = "",
}: IWarningCallout) {
  const title_id = useId();
  return (
    <section
      aria-labelledby={title_id}
      className={`${classes} flex items-start gap-3 bg-warning-subtle border border-amber-6 rounded-card p-4 text-warning-subtle-fg ${action ? "max-md:grid max-md:grid-cols-[auto_1fr]" : ""}`}
    >
      {/* 2px down: centres the 20px icon on the title's 24px first line */}
      <TriangleAlertIcon
        aria-hidden
        className="icon-lg text-warning shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <h2 id={title_id} className="text-base">
          {title}
        </h2>
        {/* a shorter measure beside an action, which takes the row's end */}
        <p
          className={`text-sm mt-0.5 ${action ? "max-w-[70ch]" : "max-w-[80ch]"}`}
        >
          {children}
        </p>
      </div>
      {action && (
        <div className="shrink-0 md:self-center max-md:col-start-2 max-md:justify-self-start max-md:mt-2">
          {action}
        </div>
      )}
    </section>
  );
}
