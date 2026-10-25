import type { CSSProperties } from "react";

/** a revealed item rises in. only for what a press reveals, or every item
 * would rise on load */
export const REVEAL_IN =
  "transition-[opacity,translate] duration-base ease-out starting:translate-y-2 starting:opacity-0";

/** a third of the fast step per item, capped at the fifth; reduced motion
 * collapses it with the ladder */
export function reveal_delay(k: number): CSSProperties {
  return {
    transitionDelay: `calc(var(--duration-fast) * ${Math.min(k, 4)} / 3)`,
  };
}
