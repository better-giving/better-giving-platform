import { Minus, Plus } from "lucide-react";
import { type PropsWithChildren, useState } from "react";

type Props = PropsWithChildren<{
  title: string;
  classes?: string;
}>;

export function Container({ title, children, classes = "" }: Props) {
  const [is_open, set_open] = useState(true);

  return (
    <div
      className={`w-full bg-card rounded-card border border-hairline divide-y divide-hairline ${classes}`}
    >
      <div className="flex items-center gap-x-3 p-3">
        <button
          type="button"
          onClick={() => set_open((prev) => !prev)}
          className="btn btn-sm btn-icon btn-secondary"
          aria-label="toggle section content's visibility"
        >
          {is_open ? (
            <Minus className="icon-lg" />
          ) : (
            <Plus className="icon-lg" />
          )}
        </button>
        <p className="text-sm font-bold first-letter:uppercase">{title}</p>
      </div>
      {is_open && children}
    </div>
  );
}
