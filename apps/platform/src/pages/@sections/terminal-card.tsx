import { Fragment } from "react";

interface ITerminalCard {
  label: string;
  classes?: string;
  /** body lines — use `TermCmd`/`TermComment`/`TermOk` below */
  children: React.ReactNode;
}

/** illustrative repo snippet as a code block — content is decorative, not real
 *  commands */
export function TerminalCard({ label, classes = "", children }: ITerminalCard) {
  // break only at the " / ", with the slash ending the first line; a hyphenated
  // repo name would otherwise wrap after its hyphen
  const parts = label.split(" / ");
  return (
    <figure className={`${classes} card grid gap-2 min-w-0`}>
      <figcaption className="font-mono text-sm text-gray-11">
        {parts.length < 2
          ? label
          : parts.map((part, i) => (
              <Fragment key={part}>
                {i > 0 && " "}
                <span className="whitespace-nowrap">
                  {i < parts.length - 1 ? `${part} /` : part}
                </span>
              </Fragment>
            ))}
      </figcaption>
      {/* pre-wrap, not a sideways scroll: the lines are prose-length and a
          scroller at 390 hides the end of every one */}
      <pre className="bg-panel rounded p-4 font-mono text-sm/relaxed text-gray-12 whitespace-pre-wrap">
        <code>{children}</code>
      </pre>
    </figure>
  );
}

interface ITermLine {
  children: React.ReactNode;
}

export function TermCmd({ children }: ITermLine) {
  return <span className="block">$ {children}</span>;
}

export function TermComment({ children }: ITermLine) {
  return <span className="block text-gray-11"># {children}</span>;
}

export function TermOk({ children }: ITermLine) {
  return <span className="block">{children}</span>;
}
