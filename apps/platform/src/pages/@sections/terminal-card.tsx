interface ITerminalCard {
  label: string;
  classes?: string;
  /** body lines — use `term-cmd`/`term-comment`/`term-ok` helpers below */
  children: React.ReactNode;
}

/** illustrative repo terminal — content is decorative, not real commands */
export function TerminalCard({ label, classes = "", children }: ITerminalCard) {
  return (
    // the media lift, not the card one: this sits on a --primary ground, where
    // the card lift's primary-at-5% composites onto primary and paints nothing.
    <div
      className={`${classes} bg-black/25 border border-primary-fg/15 rounded-card overflow-hidden shadow-lift-media`}
    >
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-primary-fg/10">
        <span className="size-3 rounded-full bg-primary-fg/25" />
        <span className="size-3 rounded-full bg-primary-fg/25" />
        <span className="size-3 rounded-full bg-primary-fg/25" />
        <span className="font-mono text-xs text-primary-fg/80 ml-2">
          {label}
        </span>
        <span className="font-mono text-2xs text-primary-fg/80 border border-primary-fg/25 rounded-full px-2 py-0.5 ml-auto">
          Public
        </span>
      </div>
      <div className="px-6 py-5 font-mono text-sm/loose text-primary-fg/75">
        {children}
      </div>
    </div>
  );
}

interface ITermLine {
  children: React.ReactNode;
}

export function TermCmd({ children }: ITermLine) {
  return (
    <p>
      {/* step 9, not the -subtle-fg ink rung: this card's ground is bg-black/25
          over surface-primary, and the ink rungs are tuned to sit ON light. on
          the dark panel step 11 goes under the body copy beside it. */}
      <span className="text-warning">$</span> {children}
    </p>
  );
}

export function TermComment({ children }: ITermLine) {
  return <p className="text-primary-fg/70"># {children}</p>;
}

export function TermOk({ children }: ITermLine) {
  return (
    <p>
      <span className="text-secondary">✓</span> {children}
    </p>
  );
}
