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
      className={`w-full bg-card rounded-card shadow-card divide-y divide-hairline ${classes}`}
    >
      <div className="flex items-center gap-x-3 p-3">
        <button
          type="button"
          onClick={() => set_open((prev) => !prev)}
          className="flex items-center justify-center p-px size-6 border rounded"
          aria-label="toggle section content's visibility"
        >
          {is_open ? (
            <Minus className="icon-lg" />
          ) : (
            <Plus className="icon-lg" />
          )}
        </button>
        <p className="uppercase text-sm font-bold">{title}</p>
      </div>
      {is_open && children}
    </div>
  );
}
