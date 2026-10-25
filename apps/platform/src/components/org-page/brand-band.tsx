import { createContext, type ReactNode, use } from "react";

/** the ground a hero part sits on. the page is the default; a band sets its
 * own for everything inside it, so a part picks its ink without being told */
export type TGround = "page" | "tint" | "deep";

export const GroundContext = createContext<TGround>("page");

export const use_ground = () => use(GroundContext);

/** a ground that carries --primary-fg as its ink */
export const is_brand_ground = (g: TGround) => g === "deep";

/** the deep fill has no utility of its own, so it rebinds the ring here —
 * --primary-fg on --primary-deep is the ledger's Lc 99.6 */
const FILL: Record<Exclude<TGround, "page">, string> = {
  tint: "bg-band",
  deep: "bg-primary-deep text-primary-fg [--ring:var(--primary-ring)]",
};

interface IBrandBand {
  /** tint: Hub and Feature's hero. deep: Poster's hero */
  tone: Exclude<TGround, "page">;
  children: ReactNode;
  /** vertical rhythm and placement; the band owns only its fill and ink */
  classes?: string;
}

export function BrandBand({ tone, children, classes = "" }: IBrandBand) {
  return (
    <GroundContext value={tone}>
      <div className={`${FILL[tone]} ${classes}`}>{children}</div>
    </GroundContext>
  );
}
