import { Printer, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, type Tone } from "./badge";
import { flag_total, items, sections, total } from "./data";

/* the tally survives a reload so a nonprofit can work through 28 questions over
   more than one sitting. version suffix: bump it rather than renaming any id in
   data.ts, which would restore a partial tally instead of none. */
const STORE_KEY = "bg-ethics-checklist-v1";

const IDS = new Set(items.map((i) => i.id));
const FLAG_IDS = new Set(items.filter((i) => i.flashpoint).map((i) => i.id));

export interface IVerdict {
  headline: string;
  sub: string;
  /** the flashpoint tally badge — the reading that matters most */
  tally: string;
  tone: Tone;
}

/** unchecked means unanswered, so the verdict leads with the flashpoints */
export function verdict_for(done: number, flags_done: number): IVerdict {
  const missing = flag_total - flags_done;

  if (done === 0) {
    return {
      headline: "Start ticking boxes",
      sub: "Your score updates as you go.",
      tally: `${flag_total} flashpoints to check`,
      tone: "neutral",
    };
  }
  if (missing > 0) {
    return {
      headline: "Gaps to raise with your platform",
      sub: "Some questions are still unanswered. The flagged ones matter most.",
      tally: `${missing} flashpoint${missing > 1 ? "s" : ""} unchecked`,
      tone: "warning",
    };
  }
  if (done < total) {
    return {
      headline: "No red flags, with a few items left",
      sub: "All enforcement flashpoints clear. Finish the remaining items.",
      tally: "All flashpoints clear",
      tone: "success",
    };
  }
  return {
    headline: "Meets every principle",
    sub: "This platform clears the full NCN framework.",
    tally: "All flashpoints clear",
    tone: "success",
  };
}

interface IChecklist {
  classes?: string;
}

export function Checklist({ classes = "" }: IChecklist) {
  const [checked, set_checked] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );

  // restored after mount, never during render: the server has no localStorage,
  // so a first paint from it would be a hydration mismatch on every visit that
  // has ticks saved.
  useEffect(() => {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    } catch {
      // storage blocked or the entry is malformed — start from empty.
      return;
    }
    if (!Array.isArray(saved)) return;
    // ids that no longer exist are dropped, so an edit to data.ts can't leave a
    // visitor with a count higher than the number of questions on the page.
    const restored = saved.filter(
      (id): id is string => typeof id === "string" && IDS.has(id)
    );
    if (restored.length) set_checked(new Set(restored));
  }, []);

  const commit = (next: ReadonlySet<string>) => {
    set_checked(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...next]));
    } catch {
      // storage blocked (private mode / cookie policy) — the checklist still
      // works for this sitting, it just doesn't survive a reload.
    }
  };

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (!next.delete(id)) next.add(id);
    commit(next);
  };

  const done = checked.size;
  let flags_done = 0;
  for (const id of checked) if (FLAG_IDS.has(id)) flags_done++;

  const verdict = verdict_for(done, flags_done);
  const pct = ((done / total) * 100).toFixed(1);

  return (
    /* print-color-adjust is inherited, so one declaration here keeps every
       fill below it on paper: the orange flashpoint chips, the tick inside a
       checked box, the progress bar. the print dialog drops background
       graphics by default, and without them a checked row and an unchecked
       one print identically. */
    <div
      className={`${classes} [-webkit-print-color-adjust:exact] [print-color-adjust:exact]`}
    >
      {/* sticks below the 4rem marketing header. print puts it back in flow —
          a fixed box repeats on every sheet. */}
      <div
        role="status"
        aria-live="polite"
        className="sticky top-16 z-subbar flex flex-wrap items-center gap-5 rounded-card bg-card shadow-floating p-4 print:static"
      >
        <p className="flex items-baseline gap-1.5 leading-none figures">
          {/* the space is load-bearing: without it the live region announces
              "12of 28" — the flex gap is visual only */}
          <span className="text-4xl font-bold text-primary">{done}</span>{" "}
          <span className="text-lg font-medium text-gray-11">of {total}</span>
        </p>
        <div className="min-w-56 flex-1">
          <p className="text-sm font-bold">{verdict.headline}</p>
          <p className="mt-0.5 text-xs text-gray-11">{verdict.sub}</p>
          {/* the count above says the same thing in words */}
          <div
            aria-hidden="true"
            className="mt-2 h-1.5 overflow-hidden rounded bg-gray-3"
          >
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <Badge tone={verdict.tone}>{verdict.tally}</Badge>
      </div>

      <div className="flex flex-wrap gap-2 py-4 print:hidden">
        <button
          type="button"
          onClick={() => window.print()}
          className="btn btn-secondary gap-2"
        >
          <Printer className="icon-md" />
          Print or save as PDF
        </button>
        <button
          type="button"
          onClick={() => commit(new Set())}
          className="btn btn-ghost gap-2 border border-gray-6"
        >
          <RotateCcw className="icon-md" />
          Reset all
        </button>
      </div>

      <p className="mb-6 flex flex-wrap items-start gap-2 card shadow-lift-card text-sm text-gray-11">
        <Badge tone="warning">Flashpoint</Badge>
        <span className="min-w-64 flex-1">
          A practice named in the Alaska, multi-state GoFundMe, or California
          Flipcause actions. If you can't check it, ask the platform why.
        </span>
      </p>

      <div className="flex flex-col gap-5">
        {sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`${section.id}-heading`}
            className="card shadow-lift-card"
          >
            <h2 id={`${section.id}-heading`} className="article-heading">
              {section.title}
            </h2>
            <p className="mt-1.5 max-w-prose text-sm text-gray-11">
              {section.sub}
            </p>
            <div className="mt-4">
              {section.items.map((item) => (
                <div
                  key={item.id}
                  /* the row is the unit that must not split, not the panel: a
                     panel of eleven questions is taller than a sheet, and
                     `break-inside: avoid` on a box that can't fit is ignored */
                  className="grid break-inside-avoid grid-cols-[auto_1fr] items-start gap-x-3 border-t border-hairline py-2.5"
                >
                  <input
                    id={item.id}
                    type="checkbox"
                    checked={checked.has(item.id)}
                    onChange={() => toggle(item.id)}
                    className="checkbox mt-0.5"
                  />
                  <label htmlFor={item.id} className="cursor-pointer text-sm">
                    {item.text}{" "}
                    {item.flashpoint && (
                      <Badge tone="warning">Flashpoint</Badge>
                    )}
                    {item.note && (
                      <span className="mt-1 block text-xs text-gray-11">
                        {item.note}
                      </span>
                    )}
                  </label>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
