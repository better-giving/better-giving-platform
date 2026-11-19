import { Checklist, type ChecklistWords } from "@better-giving/ui";
import { sections } from "./data";

// unchanged from the page's own checklist, so a reader keeps their ticks
export const STORAGE_KEY = "bg-ethics-checklist-v1";

const words: Partial<ChecklistWords> = {
  flag: "Flashpoint",
  legend:
    "A practice named in the Alaska, multi-state GoFundMe, or California Flipcause actions. If you can't check it, ask the platform why.",
  to_check: (n) => `${n} flashpoints to check`,
  unchecked: (n) => `${n} flashpoint${n === 1 ? "" : "s"} unchecked`,
  clear: "All flashpoints clear",
  verdict: {
    empty: {
      headline: "Start ticking boxes",
      sub: "Your score updates as you go.",
    },
    gaps: {
      headline: "Gaps to raise with your platform",
      sub: "Some questions are still unanswered. The flagged ones matter most.",
    },
    flags_clear: {
      headline: "No red flags, with a few items left",
      sub: "All enforcement flashpoints clear. Finish the remaining items.",
    },
    done: {
      headline: "Meets every principle",
      sub: "This platform clears the full NCN framework.",
    },
  },
};

export function EthicsChecklist() {
  return (
    <Checklist
      sections={sections}
      storage_key={STORAGE_KEY}
      words={words}
      link_ids
    />
  );
}
