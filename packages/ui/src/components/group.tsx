import { type PropsWithChildren, useId } from "react";

/** a titled section of a form — the fields that belong together, on their own
 *  card. `title` is what makes it one: a named `<section>` is a region a screen
 *  reader can jump to, an unnamed one is a `<div>` with extra letters, so the
 *  name is wired rather than left to the heading sitting nearby. */
export function Group({
  classes = "",
  description,
  title,
  hide_title,
  heading_level = 3,
  children,
}: PropsWithChildren<{
  title?: string;
  /** keeps the section named for screen readers when the page heading already
   *  says what it holds */
  hide_title?: boolean;
  /** the title's rank in the screen's outline: 2 when the group sits directly
   *  under the page's h1, 3 when a section heading sits above it */
  heading_level?: 2 | 3;
  description?: string;
  classes?: string;
}>) {
  const id = useId();
  const Heading = `h${heading_level}` as const;
  return (
    <section
      aria-labelledby={title ? id : undefined}
      className={`card grid grid-cols-1 w-full gap-6 ${classes}`}
    >
      {/* the heading pair is one grid child, not two: as two, the section's
          own `gap-6` falls between title and description, and closing it back
          up pins their spacing to whatever that gap happens to be. */}
      {title && hide_title && !description && (
        <Heading id={id} className="sr-only">
          {title}
        </Heading>
      )}
      {((title && !hide_title) || description) && (
        <div className="grid gap-2">
          {title && (
            <Heading id={id} className={hide_title ? "sr-only" : "text-2xl"}>
              {title}
            </Heading>
          )}
          {description && (
            <p className="text-lg font-semibold">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}
