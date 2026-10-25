import { NAME_DISPLAY_MAX } from "@/org-shape";

/** lg: Poster and Letter. md: Feature and Card. sm: Hub, whose name shares its
 * band with the mark and the give card */
export type TOrgNameScale = "lg" | "md" | "sm";

/** [display, one rung down the type ladder] at each width. 4_5xl carries no
 * line height of its own (theme.css), so its step names one */
const SIZE: Record<TOrgNameScale, [string, string]> = {
  lg: ["hero-heading", "text-2xl md:text-3xl lg:text-5xl"],
  md: ["text-3xl md:text-5xl", "text-2xl md:text-4_5xl/tight"],
  sm: ["text-3xl md:text-4xl", "text-2xl md:text-3xl"],
};

interface IOrgName {
  name: string;
  scale: TOrgNameScale;
  classes?: string;
}

/** the page's h1. a name that fits display size gets it on one line; a longer
 * one steps down a size and wraps in full, never cut off. ink is the ground's */
export function OrgName({ name, scale, classes = "" }: IOrgName) {
  // measured as the shape module measures it, so the layout and the size agree
  const long = name.trim().length > NAME_DISPLAY_MAX;
  const [display, stepped] = SIZE[scale];
  return (
    <h1
      className={`font-bold break-words ${long ? stepped : display} ${classes}`}
    >
      {name}
    </h1>
  );
}
