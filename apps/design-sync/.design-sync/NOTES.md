# design-sync notes (better-giving)

Repo-specific gotchas for future syncs. Read this before re-running anything.

## Where this runs from: read first

Everything lives under **`apps/design-sync/`**, and every command in this file assumes that
as the working directory. The converter resolves `.design-sync/` against the **cwd** in ~15
places, and `PKG_DIR` by walking up from `cfg.entry` to the nearest named `package.json`, so
running from the repo root instead silently resolves a different tree.

```sh
cd apps/design-sync        # <- every command below, including /design-sync itself
```

The skill's own re-sync detection reads `.design-sync/config.json` **relative to the cwd**, so
a `/design-sync` started at the repo root finds no config, calls it a first-time import, and
creates a SECOND claude.ai/design project, orphaning
`2ae8b8b4-efb5-4845-9b62-4401e20f846a`. That is the one mistake this layout makes easy; there
is no marker at the repo root to catch it.

`--node-modules` stays `../../packages/ui/node_modules` (`lucide-react` and friends are real
dependencies of the package, and `workspaceRoot` still derives to the repo root from it).
`--out` goes to `ds-bundle/` inside this app, not the repo root.

## Shape

`shape: "package"`.

The "design system" is split across two packages:

- **`packages/brand`**: the token palette (`src/colors.css`, real `oklch()`, `:root` only,
  the palette is light-only, the `.dark` set was deleted 2026-08-19)
  and `design-system.md`, the token ledger. Read that ledger before touching color; it records
  measured contrast, the fill-vs-ink distinction, and several deliberate decisions that look
  like bugs.
- **`packages/ui`** (`@better-giving/ui`): the components, under `src/components/`, plus the
  CSS layer (`src/styles/`). Source-only: no `dist/` for the TS exports, consumers transpile it.
  It does build one CSS artifact (`dist/styles.css`, gitignored) but this sync does **not**
  consume it, see Stylesheet.

## Why there is a hand-written entry (`.design-sync/entry.tsx`)

Two reasons this file exists beside `packages/ui`'s barrel (`src/index.ts`):

- **`DsProvider`.** Components that call `useNavigate`/`NavLink` (`Prompt`, `Breadcrumbs`) throw
  outside a router, so previews mount through a `MemoryRouter` the package has no business
  shipping.
- **The `Arrow`/`Content` collision.** `tooltip.tsx` and `hover-card.tsx` both export those two
  names, which is exactly why the package publishes them as separate entry points
  (`@better-giving/ui/tooltip`, `/hover-card`) rather than through the flat barrel. This file
  re-exports them as `TooltipContent` / `HoverCardContent`.

So `.design-sync/entry.tsx` is the explicit export surface: one named export per published
component, plus `DsProvider`. **Its import paths mirror `cfg.componentSrcMap`: regenerate the
two together**, and always point at the implementation FILE, never the directory barrel.

**The surface is not only components.** Two lowercase exports ride along because the component
they belong to is unusable without them, and `cfg.componentSrcMap` has no slot for a non-component:
`masks` (the `{format, unmask}` presets: `MaskedInput`'s `mask` is required and has no default)
and `show_toast` (the imperative half of `Toaster`; toasts are pushed into a module-scope manager,
never rendered, so `Toaster` alone is a mount point that can never display anything). Both are
public API of `packages/ui` (the barrel exports them) and both are lowercase, which is what
keeps the converter from mistaking them for components. **When a component's API has a half that
isn't a React element, check it is on this surface**: a design can only reach `window.BetterGiving`,
so an unexported half is a documented call that does nothing.

The previews import the package by name (`from "@better-giving/ui"`); the converter resolves
that bare specifier to this entry.

## Converter bugs worked around (not repo problems)

1. **`cfg.tsconfig` is deliberately UNSET.** The converter's `tsconfigPathsPlugin`
   (`lib/bundle.mjs`) strips comments with `/\/\*[\s\S]*?\*\//g`, which also matches the `/*`
   inside `"#/*": ["src/*"]` and swallows the whole `paths` map up to the next `*/` (supplied by
   `"**/*"` in `include`). The plugin then returns `null` and every alias fails to resolve.
   It is not needed:
   **`packages/ui` declares no `paths` and its source uses no aliases at all**. Do NOT "fix" this by setting `cfg.tsconfig`.

2. **`@types/react` resolves from `apps/design-sync`, which declares it** (`lib/dts.mjs`
   walks up from `PKG_DIR` looking for it). Same for `playwright`. Any leftover
   `node_modules/@types/react` symlink at the repo root is inert; delete it.

## Typecheck the previews: the cheapest way to catch a stale one

The previews are compiled by esbuild, which does **not** typecheck. A preview that passes a prop
the component no longer has therefore builds, renders, and silently shows less than it should:
`Amount` spent a whole sync rendering a currency label with no number, and the render check
called it clean because the root wasn't empty.

`apps/design-sync/tsconfig.json` and its `typecheck` script:

```sh
pnpm --filter design-sync typecheck
```

checks every preview and `entry.tsx` against the real `@better-giving/ui` source. It runs in
CI (the `checks` job's `turbo run typecheck` picks it up from the package's own script) and on
commit (lefthook `type-check-design-sync`).

Run it **before grading**: it takes seconds and it is the only check that sees a prop the
component dropped.

## `extract-props.mjs` is broken for this repo

It now returns a body of just `/** ...plus the standard props inherited from … */` for **every**
component: the declaration-site filter apparently treats `packages/ui`'s own files as external, so
every own-prop is filtered out. Its output is strictly worse than what `cfg.dtsPropsFor` already
holds.

**Do not paste `.cache/props.json` over `cfg.dtsPropsFor`**.
`dtsPropsFor` is hand-maintained: when a component's props change, hand-edit that entry. This is
load-bearing: the `<Name>Props` body IS the contract the design agent codes against, and a stale
one makes it misuse the component everywhere.

## How the prop contracts were originally generated

`cfg.dtsPropsFor` holds all 40 bodies.

`.ds-sync/extract-props.mjs` regenerates them from the real source types via ts-morph:

```sh
node .ds-sync/extract-props.mjs      # writes .design-sync/.cache/props.json
# then merge that file into cfg.dtsPropsFor
```

It does three things that matter: filters props by **declaration site** (own API vs the ~218
attributes inherited from `ComponentProps<"input">`, which are folded into one summary line),
substitutes generic type parameters with their constraints (`Select<T extends string>` → `string`),
and expands platform-local aliases (`Classes`, `FileSpec`) structurally, since those names do not
exist in the emitted `.d.ts`. **Re-run it whenever a component's props change.**
~19 props across the set still land on `unknown`; that is the accepted residue.

## Fonts

`cfg.extraFonts` points at **`../../packages/ui/src/styles/fonts.css`**: the design system's
own `@font-face` layer, one entry for both families.

`packages/ui` self-hosts both faces beside the tokens that
name them (committed `.woff2` in `packages/ui/src/styles/fonts/`, cut by that dir's
`generate.sh` so Quicksand keeps its `zero` feature; see `packages/brand/design-system.md`,
"The faces").

Two things about that path still matter. `extraFonts` is bounded to the **git workspace root**
rather than `PKG_DIR`, which is what makes the `../../` form legal. And the converter needs
`@font-face` CSS whose `url()`s resolve **relative to the CSS file**: `fonts.css` uses
`./fonts/*.woff2`, which does. The
compiled app CSS is no use for this: it references `/assets/*.woff2` (absolute,
root-relative) which resolve to nothing on disk, so the converter drops those as dead
`@font-face` blocks.

Quicksand Variable and Gochi Hand are the only two families the system uses: `--font-display`
and `--font-body` are two roles resolving to the one Quicksand face, so this is two families in
one file, not three. Keep it in step with `--font-*` in `packages/ui/src/styles/theme.css`: a
face swap that misses `fonts.css` makes every preview render in a family the system no longer
has.

## Stylesheet

`cfg.cssEntry` points at `.design-sync/.cache/styles.css`, compiled from
`.design-sync/styles-entry.css` (committed; the output is gitignored):

```sh
pnpm --filter design-sync styles
```

**Rebuild it whenever a component, a preview, or the app writes a utility that wasn't there
before**: Tailwind v4 is JIT, so this stylesheet *is* the vocabulary the design project has.
A utility no scanned file writes does not exist, and a design authored against it renders
unstyled with no error. The entry scans three scopes and the file itself says why: the package's
components (via `packages/ui/src/styles/index.css`, which carries its own `@source ".."`), the
preview files, and `apps/platform/src`: the last so the published vocabulary stays continuous
with what the app actually writes. Dropping the app scope costs ~65 utilities the previews
alone need, `flex-col` and `gap-4` among them.

`apps/design-sync/package.json` bounds `@import "tailwindcss"`'s auto-detect walk, so the
build is exactly the three scopes the entry names.

### The docs were writing the stylesheet

`@import "tailwindcss"` auto-detects sources from the entry file up to the
nearest `package.json` (`apps/design-sync/`) and scans **everything** under it, markdown
included. `NOTES.md` and `conventions.md` both live in that root, so any valid utility name quoted
in their prose minted a real rule in the published stylesheet.

That is worse than it sounds, in three ways:

- **It made the vocabulary depend on the prose.** 20 utilities were reaching the design project
  with no call site in any component, preview or app file: twelve names quoted in this file's
  prose (`antialiased`, `w-12`, `outline-2`, …), `bg-[conic-gradient(…)]` from the
  `LoaderRing` write-up, and `bg-destructive/10` from the header's own don't-do-this example.
- **It was asymmetric, which is the silent-miss trap.** `bg-chart-1` and `bg-chart-5` compiled
  because the prose spelled them; `bg-chart-2` did not, because `…` elides. A design following
  the header got a working swatch or an invisible one depending on the index.
- **It made verification circular.** Every "checked it against the compiled stylesheet" pass in
  this file was partly self-fulfilling for any name the header mentions: the check reads a
  stylesheet the checked document helped write. The `w-16`/`h-20` snippet under
  *Preview-authoring gotchas* was the pure case: it could never report a miss, because writing
  the check minted both classes.

Fixed with `@source not "../**/*.md"` in `styles-entry.css`, which drops the 20. What the header
genuinely promises is then listed back explicitly with `@source inline(...)` rather than left to
whichever names the app happened to write:

- `rounded-none`: the radius ladder names it as one of the two escapes it still allows.
- `{bg,text,border,fill,stroke}-chart-{1..5}`: `theme.css:75-79` maps `--color-chart-*`, so these
  are registered Tailwind colours; nothing in the app writes a utility form because its charts
  reach the tokens as `var(--chart-N)` in recharts props.
- the numeric box ladder (`w-`/`h-`/`size-`/`min-w-`/`min-h-`/`max-w-` to 96, `gap-`/`p-`/`m-`
  and their per-side and per-axis forms to 24). The header claimed "the standard w/h steps" were
  safe and that was false in both directions: `w-16` and `h-20` absent, `w-20` and `h-16`
  present. +17KB on a 207KB sheet.

**So: naming a class in this file or in `conventions.md` no longer makes it real.** Verify a claim
against the build, and if the build disagrees, fix one of the two: do not assume the doc is right
because the class is in the stylesheet.

The general shape of this is worth knowing: **the published vocabulary is only what these three
scopes happen to write**, so a design that reaches for a reasonable utility nobody has used yet
renders unstyled. The previews scope is the deliberate escape hatch: write the utility in a
preview and it exists.

Note `packages/ui` also builds its own `dist/styles.css` (`pnpm --filter @better-giving/ui
build`). This sync does **not** consume it: it covers only the package's own source, so it
carries neither the previews' layout utilities nor the app's vocabulary. It exists for tooling
that is bounded to the package directory.

Check a utility before authoring against it:
`python3 -c "css=open('.design-sync/.cache/styles.css').read(); print([c for c in ['w-16','h-20'] if c not in css])"`

## Playwright

The repo pins `playwright@1.59.1`, whose `browsers.json` pins chromium **1217**. The validator
imports `playwright` relative to `.ds-sync/`, which the skill stages at
`apps/design-sync/.ds-sync/`: node resolution walks up into `apps/design-sync/node_modules`,
where this app **declares `playwright` itself**.

## Validator warnings (triaged)

`package-validate.mjs` ends on one standing `[TOKENS_MISSING]` warning naming six custom
properties: `--transform-origin`, `--marquee-duration`, `--marquee-delay`, `--marquee-loop-count`,
`--marquee-translate`, `--gutter`. All six are injected at runtime, never declared in a
stylesheet: the first five come from Ark UI's positioning/marquee machines, and `--gutter` is an
inline style on `pages/registration/progress-indicator.tsx:54`. This is the case the warning
itself calls expected; there is nothing to set `cfg.tokensPkg` to.

`[GRID_OVERFLOW]` fired for nine components on the first pass and is cleared by
`cfg.overrides`: `cardMode: "column"` for the wide-but-in-flow ones (`Copier`, `ExtLink`,
`Target`, `VerifiedIcon`, `ContentLoader`, `LoadText`, `LoaderRing`, `PayoutStatus`) and
`cardMode: "single"` for the ones that paint outside their cell (`Modal`, `Tooltip`, `HoverCard`,
`Prompt`, `Toaster`). `HeaderButton` and `LoadMoreRow` joined the `column` set on 2026-08-28: a
table is wider than a grid cell by nature, so every component that renders one lands here.
`Accordion`, `Tabs`, `RadioGroup` and `Slider` joined it on 2026-09-14, their first sync: each
stretches to its container, so a story wider than a grid cell is the component working as designed.
`Increments` joined it on 2026-10-24: its amount/description rows outgrew a grid cell once the
field shells widened, same reason.
The validator's remediation text names `preview-rebuild.mjs` (`.ds-sync/lib/preview-rebuild.mjs`); a full
`package-build.mjs` run does the same job and is what the driver runs.

## Scope

43 components, deliberately narrowed to the reusable primitives. App-specific machinery is
excluded on purpose: `csv-exporter`, `img-editor`, `donate-methods`, `donation/**`, `token-field`,
`youtube-player`, `referrals`, `bank-details`, `rich-text`, `chrome`, `header`, `footer`,
`goal-selector`, `fundraiser`, `video`. Widening scope means adding to BOTH `cfg.componentSrcMap`
and `.design-sync/entry.tsx`.

`Button` covers all four elements a button can be (`<button>`, `Link`, `NavLink`, `<a>`), so
`conventions.md` points designs at the component and keeps the classes as the hand-composition
fallback.

## Preview-authoring gotchas (from the fan-out)

- **The capture harness pins the clock to 2024-05-15** (`page.clock.setFixedTime` in
  `.ds-sync/package-capture.mjs`). Date components that clamp against "today" (`DateField` with
  `minToday`/`maxToday`, and `DateRangeField`, whose `maxToday` defaults to true) silently clamp
  their value segment-by-segment to that date. It looks like a wrong card, not an error. Preview
  dates for those two components are chosen to respect the fixed clock, which is why they don't
  carry the brand's usual `Nov 14, 2025` sample. Bump the fixed time if you need current dates;
  don't remove it (it's there for determinism).

- **`.field-err` is `text-align: right`** (`packages/ui/src/styles/components.css`). On a
  component whose root has no intrinsic width (`Toggle` is `grid grid-cols-[auto_1fr]`) the
  error message flies to the far edge, detached from its control. Previews constrain the width
  (`classes={{ container: "w-80" }}`). Controls that stretch are unaffected.

- **Components with no intrinsic size render invisible** unless the preview gives them one:
  `ContentLoader`, `LoaderRing`, `ImagePlaceholder`. Always wrap with explicit height/width.

- **There is no network in the capture environment**: a remote image `src` never loads. Use an
  inline SVG data URI.

- `lucide-react` resolves fine inside previews via `--node-modules packages/ui/node_modules`
  (it is a real dependency of the package). That is the `--node-modules` value every command in
  this file assumes.

- `.design-sync/entry.tsx` also exports `masks` (the `{format, unmask}` presets for
  `MaskedInput`), added because `mask` is a required prop with no default and the presets were
  otherwise unreachable from a design.

- **Only utilities some scanned file writes exist**, because `cfg.cssEntry` is a JIT Tailwind
  build (see Stylesheet) and nothing re-scans at upload time. The scan covers
  the previews themselves, so a utility you author into a preview compiles. It does **not**
  cover a utility invented on claude.ai/design that nothing in this repo writes. Gaps are not symmetric between axes
  (`h-16` present, `w-16` absent → `h-16 w-16` renders a 64px-tall box of whatever width the
  content wants) and a missing utility is silent: no error, just a layout that ignores you.
  The numeric box ladder is now guaranteed by `@source inline(...)` (see *The docs were writing
  the stylesheet*), so sizing and spacing no longer need this check. Everything else still does:
  `python3 -c "css=open('.design-sync/.cache/styles.css').read(); print([c for c in ['columns-3','backdrop-blur-lg'] if '.'+c not in css])"`


- **Previews may compose `platform` components with each other and may import third-party
  packages.** `Group.tsx` renders `Field` and `Select` inside its panel; `Input.tsx` imports
  `lucide-react` directly. What a preview must NOT import is `react-router`: that bundles a
  second copy which doesn't share context with `DsProvider`'s `MemoryRouter`. Components that
  use router links internally (`Breadcrumbs`) are fine; only preview-authored imports are unsafe.

- **Overlays need to be opened synthetically.** `Modal` takes a real `open` prop, but neither
  `Tooltip` nor `HoverCard` does: `Tooltip` holds `useState(false)` and passes it to Ark as a
  *controlled* value (so `defaultOpen` is unreachable too) and `HoverCard` passes nothing. From
  a `useEffect` on a wrapper: click `[data-scope="tooltip"][data-part="trigger"]`, and dispatch
  a `pointerover` `PointerEvent` with `pointerType:"mouse"` on
  `[data-scope="hover-card"][data-part="trigger"]`. Don't query by ref-on-child: Ark's
  `asChild` clones the child and overwrites its ref.

- **`Toaster` needs its toast deferred by a tick.** Toasts are pushed imperatively into a
  module-scope manager, and a component that calls `show_toast` from an effect while sitting
  inside `<Toaster>`'s children runs *before* `ArkToaster` subscribes: the toast is created
  and never picked up, leaving a zero-height group and an empty card. A `setTimeout(…, 0)`
  around the create fixes it. Note also that `createToaster` is configured `overlap: true`, so
  a second simultaneous toast stacks *behind* the first rather than tiling; a "stacked" cell
  reads as a clipping bug and was dropped rather than shipped.

- **`fixed` inside a card resolves against the story root, not the viewport.** The harness's
  cell establishes a containing block, so `fixed bottom-4 right-4` lands wherever that box is
  rather than at the page corner. Compose around it (a narrower panel beside the toast) instead
  of fighting it, and give overlay components `cfg.overrides.<Name> = {"cardMode": "single"}`
  so the product's grid card doesn't stack three backdrops on top of each other.

## Component behaviours a preview (or a design) has to know

Collected across the fan-out; each was hit at least once while authoring.

- **`classes` is `string | object` on most controls** (`components/form/types.ts` + `helpers/
  unpack.ts`): a bare string becomes `classes.container`. `Copier`'s object is
  `{container, icon}` and its `size` is `number | {copy, check}`: the app passes both `size`
  and `classes.icon`. `Group` is the odd one out: it takes `className`, not `classes`.
- **`Label`'s `required` is tri-state and that is its variant axis**: `true` → destructive `*`,
  `false` → muted `(optional)`, `undefined` → nothing. Same on `Field`, `UrlInput`, `MaskedInput`.
- `UrlInput` paints a literal `https://` behind an absolutely-positioned input, so values must
  omit the scheme or it double-prefixes. `MaskedInput`'s `disabled` sets only `aria-disabled`;
  `.field-input` keys off that, so the muted state still renders.
- `Increments` doesn't own its rows: `field(idx)` hands back a render slot and the caller must
  return **exactly two subgrid cells** (amount, description), each `grid grid-rows-subgrid
  row-span-2`. Deviating collapses the parent grid.
- `DateRangeField`'s value is a **spread of two arrays**, not a fixed-length pair: an empty
  start with a filled end renders the end date in the start slot.
- `FileDropzone` treats `value === "loading"` as disabled internally, so its loading and
  disabled states differ only by the spinner.
- `Separator` has no width of its own: it is a `flex` `<p>` whose `::before`/`::after` rules
  are each `w-full`, so a multi-word label gets squeezed onto two lines unless wrapped in
  `whitespace-nowrap`. The app only ever passes `OR`, so it never hit this.
- `ExtLink` ships **zero** styling: `<a target="_blank" rel="noopener noreferrer">` and nothing
  else. An unstyled render is honest, but every real call site passes `className`.
- `Target` renders `null` for `target === null`, a computed goal `<= 0`, or a `NaN` progress:
  pass raw whole-dollar numbers and let `to_usd` format. `target="smart"` doubles from $100
  until it clears progress, so the bar is never less than half full in that variant.
- `Image` falls back to `ImagePlaceholder` when there's no `src` and it isn't loading, or on
  `onError`, unless the caller supplies its own `onError`, which suppresses the fallback.
  `ImagePlaceholder` has no intrinsic size and its glyph is `w-1/2 h-1/2`, so always give it both
  dimensions.
- `Breadcrumbs`' active-crumb style is only reachable by pointing a crumb at `/`, since
  `DsProvider`'s `MemoryRouter` sits there.
- `CurrencySelector` derives disabled from the query state: a literal `QueryState`
  (`{data, is_loading, is_fetching, is_error}`; `is_query()` needs both boolean keys present)
  renders all three of its visibly distinct states.
- `PayoutStatus` deliberately collapses `refunded_loss` into the success "Settled" chip, and its
  `fallback` config is unreachable for the six declared union members.
- `Combo`'s `btn_disp` is required on the trigger variant; real call sites fill it with a country
  flag emoji and fall back to `DrawerIcon`, which puts the chevron on the *left*. Real behaviour,
  but the one pattern here a design agent might imitate unhelpfully.

## States no still capture can reach

Recorded so a future sync doesn't re-litigate them: the `:active` press on the four filled button
variants (`translateY(1px)`, added 2026-09-02 in `746292a`), focus / focus-visible rings on every input,
hover and `data-highlighted` option rows, drag-over on `FileDropzone`, `:user-invalid`,
`MaskedInput`'s caret restoration, `Copier`'s 700ms `text-success` check, `VerifiedIcon`'s
hover tooltip, `DrawerIcon`'s rotation transition (its endpoints are both shown), and the open
option popups on `Combo`/`MultiCombo`/`CurrencySelector` (Ark `lazyMount` + `unmountOnExit`,
portalled through `use_dialog_container`: the closed control carries the component's identity
anyway).

## Preview scope decisions

- `Tooltip`/`HoverCard` each export a `Content` wrapper that `tip` must be wrapped in. They
  collide in one barrel, so `entry.tsx` re-exports them as `TooltipContent` / `HoverCardContent`.
  Their `Arrow` exports are documented no-ops and stay unexported.
- Component-level `.svg` imports resolve (`STORY_LOADERS` maps svg to dataurl), so
  `Target.Text`'s icon renders even though `entry.tsx` avoids asset barrels.

## `extract-props.mjs` no longer beats the config for the selector trio

The combobox unification moved `classes`, `options` and the `Opt<T>` accessors into
`components/select/types.ts` (`FieldProps`, `Source<T>`, `StaticSource<T>`). The extractor
expands only the aliases it knows by name, so for `Combo`, `MultiCombo` and `Select` it now
emits `classes?: unknown` / `options?: unknown`: worse than what `cfg.dtsPropsFor` already
held. It also collapses their unconstrained `T` to `string` and drops `| undefined` off
`value`.

**So do not paste `.cache/props.json` over `cfg.dtsPropsFor` wholesale.** Diff it, take the
prop *sets* (that is what the extractor is still right about), and hand-check the three
selector bodies against `types.ts` and each component's local `Classes` alias:

- `Combo`: `FieldProps` minus `classes`, plus a local `Classes` that adds `input?`.
  `options: Source<T>` has **three** arms: `readonly T[]`, `{items, loading?, error?}`, and
  `{search: (q, signal) => Promise<readonly T[]>}`.
- `MultiCombo`: full `FieldProps` + `Opt<T>`; `options: StaticSource<T>` only.
- `Select`: `FieldProps` minus `classes`/`popup_vars`; its `Classes` renames `control` to
  `button`. `value` is `T | undefined`, not `T`.

## Scope change, 2026-08-20: the ui extraction

The design system moved out of `apps/platform` into **`packages/ui`** (`@better-giving/ui`),
landed on PR #109 alongside the coherence work. What changed in this directory:

- `cfg.pkg` `platform` → `@better-giving/ui`; `cfg.srcDir` and all 40 `componentSrcMap` entries
  `apps/platform/src/…` → `packages/ui/src/…`.
- `cfg.cssEntry` off the app's hashed build output entirely, see Stylesheet.
- `entry.tsx`'s 41 imports repointed; the 40 preview files import `"@better-giving/ui"` where
  they used to import `"platform"`.
- `--node-modules` is now `packages/ui/node_modules`.
- One stale preview class fixed: `Amount.tsx` carried `rounded-xs`, which the coherence work
  deliberately made **uncompilable** (the radius ladder is reset to `initial` so only `rounded`
  survives). It was silently unstyled; it is `rounded` now. This is the closed ladder doing its
  job: a preview is just another call site.
- `--form-primary`/`--form-secondary` moved from `apps/platform/src/index.css` into
  `packages/ui/src/styles/theme.css`. The package's own `btn-form-primary`, `form-*` color
  utilities and `LoaderRing` reference them, so a package that doesn't define them renders those
  surfaces with an unset var in any host that isn't platform, which the validator caught here as
  two extra `[TOKENS_MISSING]` entries. Platform's compiled CSS is byte-identical across the move
  (same content hash), and the per-embed override at `#donation-container` is untouched.

## Scope change, 2026-08-20: the combobox unification

`CurrencySelector` is gone from the repo: the unification replaced it with `Combo`, so this
sync deleted it remotely. `Combo` and `MultiCombo` also moved group: `components/selector/` →
`components/select/`. `Select` stayed at `components/selector/`. The remote still carried the
old paths, which is why the re-sync produced deletes as well as writes.

## Scope change, 2026-08-21: `show_toast` reaches the export surface

Validating `conventions.md` against the build turned up a name that did not resolve.
`conventions.md` tells the design agent toasts "are pushed imperatively with `show_toast(...)`",
but `entry.tsx` exported only `Toaster`, so `window.BetterGiving.show_toast` was **undefined**. A
design following the documented call mounted `<Toaster>` and then nothing ever appeared: silent,
and invisible to every mechanical gate: the bundle built, the card rendered, validate exited 0.
The card only rendered because `Toaster.tsx` reached around the surface into the source module,
which a design cannot do.

Fixed by exporting it (see *Why there is a hand-written entry*) rather than by deleting the line
from `conventions.md`: `show_toast` is already public API of `packages/ui`, and a `Toaster` with
no way to push a toast is not worth publishing. `Toaster.tsx` now imports both halves from
`"@better-giving/ui"` like every other preview, so the card exercises the same path a design takes.

**The general shape:** a component whose API has a non-element half (an imperative function, a
preset object, a hook) has a half `cfg.componentSrcMap` cannot carry, so it reaches the design only
if `entry.tsx` names it. Nothing checks this: the gap is only visible by reading `conventions.md`
against the bundle's export list, which is the validation pass the skill runs before upload.

## Scope change, 2026-08-22: the layout vocabulary

`conventions.md` gained a *Page shape and scrollers* section: `page` (the one page width: width
curve plus gutter, placed per band and never hoisted), `table-scroll` (the wrapper a wide table
sits in) and `scrollbars` (the thin themed skin). Reading measure is documented as a cap on the
text column one level in, not as a second page width.

**Nothing was added to `cfg.componentSrcMap` or `entry.tsx`, and that is correct.** These are CSS
utilities, not components: the repo chose utilities over a `<Container size={…}>` precisely
because a runtime-composed class compiles to nothing under JIT. A utility reaches the design
project through the **stylesheet**, and it is already there: `apps/platform/src` is one of the
three scanned scopes and writes `page` 137 times, `table-scroll` 42. Verified in the rebuilt
`.cache/styles.css`.

The consequence is a dependency worth naming: these three exist in the published vocabulary
**because the app writes them**, not because anything here declares them. If a future change ever
moved the page shape out of `apps/platform/src`, the class would vanish from the design project
silently, the same failure mode as any other JIT gap, one level up. A `@source inline(…)`
safelist in `styles-entry.css` would pin them; not doing it yet, because the app-scope dependency
is what every other utility in this bundle already has.

Chrome stays unpublished, and `conventions.md` now says so out loud: a design starts below the
header and ends above the footer.

## Scope change, 2026-08-22: the modal size set (#111)

`Modal` gained a `size` prop: a closed geometry set (`packages/ui/src/helpers/modal-box.ts`) of
`panel` 448 / `sm` 512 (the default) / `md` 672 / `lg` 768, each one centering itself, capping its
height at `90dvh` and scrolling its own overflow, plus `"none"` for the dashboard's edge-anchored
drawer. Three things followed in this sync:

- **`cfg.dtsPropsFor.Modal` was hand-updated.** This is the drift the risks list warns about, caught
  by diffing `packages/ui/src/components/` since the last synced sha. Nothing failed: the preview
  rendered and validate exited 0 the whole time; only the published contract would have been wrong.
- **`previews/Modal.tsx` was rewritten off the retired idiom.** It hand-spelled
  `fixed-center … w-full sm:max-w-md rounded` on every cell, which is exactly what #111 replaced. A
  preview is imitated by the design agent, so a stale one teaches the retired spelling to every
  design. `classes` now carries surface and padding only; `size` carries the geometry. The three
  cells still grade `good`, and the tier axis is visible in the sheet (`panel` cells narrower than
  the default-`sm` one).
- **`modal_box` / `ModalSize` were deliberately NOT added to the export surface.** They are exported
  from `@better-giving/ui/helpers`, but a design reaches the tiers through the `size` prop, so
  nothing callable is missing: unlike the `masks` / `show_toast` cases. If a future component ever
  takes a *class string* from `modal_box` rather than a tier name, that changes.

`conventions.md` gained a matching paragraph under *Page shape and scrollers*: dialog size is a
closed set the same way radius and page width are, and without it the agent hand-spells the
geometry (and an arbitrary width may not compile at all).

## conventions.md drift found 2026-08-22: `prose`

The validation pass against the fresh build caught one name that does not exist: the header told the
agent to cap reading measure with the `prose` class, and the compiled stylesheet has only
`.max-w-prose`: there is no typography plugin anywhere in `styles-entry.css` or
`packages/ui/src/styles/`. A design following that line renders an uncapped paragraph, silently.
Corrected to `max-w-prose`.

**Run this pass every sync.** It is cheap (grep the header's names against `ds-bundle/_ds_bundle.css`
and the `components/<group>/<Name>/` tree) and it is the only thing that catches a header that has
quietly stopped being true.

## conventions.md drift found 2026-08-22 (second pass): the color set

With the docs no longer writing the stylesheet (previous section), the header could finally be
measured honestly, and the color section turned out to promise three things the build did not have:

- **`text-card-fg`, `text-sidebar-fg`**: the ink row promises "the `-fg` partner of every surface
  above". `text-popover-fg` compiled and `text-card-fg` did not, for no reason other than a preview
  happening to write the one and not the other.
- **`border-input`**: the lines row names `border`, `input`, `ring`; only `border-gray-6` and
  `outline-ring` had rules.
- **`background-fg`**: promised by that same "every surface" phrasing and **not a token at all**.
  `--color-background`'s ink is plain `--color-fg`; there is no `--color-background-fg` in
  `theme.css`. This one is fixed in the prose, not the build.

Fixed the first two the same way the chart ramp and the box ladder were: an `@source inline(...)`
in `styles-entry.css` listing the semantic set across `bg-`/`text-`/`border-`/`ring-`. Every name in
that list is a registered `--color-*` token in `packages/ui/src/styles/theme.css`, so this adds no
vocabulary the system didn't already mean to have: it only stops the published set from depending
on which tokens the app source happened to reach for. +82 rules, none removed.

**`border-primary-border` and `ring-primary-ring` were deliberately NOT safelisted.** They are
registered tokens, but the design decision is that `surface-primary` rebinds `--ring`/`--border`
for you, and the header used to describe the two utilities as something you could reach for
directly. Reworded instead: the pair exists as tokens, has no utility, and `surface-primary` is
the way. Closing the escape beats widening it.

## Checking the header is now one command

`.design-sync/check-conventions.mjs` (committed) replaces the hand-rolled grep the previous two
sections describe:

```sh
cd apps/design-sync && node .design-sync/check-conventions.mjs   # exits non-zero on a broken promise
```

It holds the header's enumerated claims as data: the surface/ink/lines sets, the chart ramp, both
ladders, the button and utility class lists, the radius trio, plus a `MUST_BE_ABSENT` list for the
names the header says do **not** exist (`rounded-lg`, `btn-outline`, `border-primary-border`, …), so
a fix in one direction can't quietly break the other. It also checks every backticked or JSX-tagged
component name against the `components/` tree and the bundle's export list.

Two things about it that matter:

- **The claim lists are the contract, not a scrape of the prose.** Rewriting a promise in
  `conventions.md` without editing the corresponding list in the script means the script keeps
  verifying the old promise. Change both in the same commit.
- **Tailwind escapes `.` `/` `[` `]` `:` `%` `@` `(` `)` in the emitted selector**: `p-1.5` lands
  as `.p-1\.5`. A naive grep for `.p-1.5` finds nothing and reports a false miss on every
  fractional step; the script's `has()` accounts for it.

## conventions.md drift found 2026-08-24: the checker was minting what it forbids

`check-conventions.mjs` failed on `border-primary-border` and `ring-primary-ring`: documented as
absent, present in the build. Nothing in `packages/ui/src`, `apps/platform/src` or
`.design-sync/previews` writes either: the only file that spells them is the checker's own
`MUST_BE_ABSENT` list, and the checker sits inside the tailwind scan root. It was minting the two
rules it then found and reported.

Same class as the `bg-chart-*` artifact two sections up, and the `@source not "../**/*.md"` added
for that one does not reach a `.mjs`. Fixed by naming it:

```css
@source not "./check-conventions.mjs";
```

Two things worth carrying forward:

- **The checker reads `ds-bundle/`, not `.cache/styles.css`.** After a `pnpm --filter design-sync
  styles` the fix looks unapplied until the converter runs again: grep `.cache/styles.css`
  directly to confirm a stylesheet fix, and re-run the driver before trusting the checker's verdict.
- **A file that lists class names as data is prose, whatever its extension.** The exclusion is
  per-file rather than `../**/*.mjs` so `preview.mjs` and any future script stay scanned; a new
  vocabulary-as-data file needs its own line here.

## The platform names sweeps are vocabulary-as-data too, one tree over

`styles-entry.css` carries `@source "../../platform/src"` so the published vocabulary stays
continuous with the app's. That scope includes `apps/platform/src/__tests__/*.node.test.ts`, and
every one of those sweeps spells the off-system names it hunts for as literals inside its own
regexes. The elevation sweep is the sharpest case: it names `shadow-2xl`, `shadow-none`,
`shadow-[…]`, `shadow-primary/40`, `z-51` and `z-[51]`, so scanning it mints a rule for each name
the closed `--shadow-*`/`--inset-shadow-*` reset exists to strip, and the design agent is then
offered exactly the depth the app is not allowed to have. Same class as `check-conventions.mjs`
above; the per-file exclusion there does not reach another package.

```css
@source not "../../platform/src/__tests__/**/*.node.test.ts";
```

**It needs a twin in the app, not just here.** `apps/platform/src/index.css` compiles its own
stylesheet over the same tree and was emitting the same 13 dead rules, so it carries the same line
against `./__tests__/**/*.node.test.ts`. Two entries, two files, and they only stay in step by
being written together.

## The converter's own deps live in `.ds-sync/node_modules`

`esbuild`, `ts-morph` and `@types/react` are installed **inside the staged `.ds-sync/`**, isolated
from the repo's workspace (this app declares only `playwright` and `@types/react` itself). The
re-sync instruction says to re-copy the staged scripts with `cp -r`; **do not `rm -rf .ds-sync`
first**: that takes the installed deps with it and the driver dies on
`Cannot find package 'esbuild'` before it prints anything useful. If it does get wiped:

```sh
cd apps/design-sync/.ds-sync
echo '{"name":"ds-sync-deps","private":true}' > package.json
pnpm i --ignore-workspace --allow-build=esbuild esbuild ts-morph @types/react
```

`--ignore-workspace` because `.ds-sync/` is not a workspace member. pnpm blocks postinstall scripts
by default and esbuild needs its own, so the build approval rides on the command: pnpm 12 reads
settings from `pnpm-workspace.yaml` only, and `--ignore-workspace` is what stops it reading the
repo's. A `"pnpm"` field in that `package.json` is ignored with a warning and the install then
fails on `ERR_PNPM_IGNORED_BUILDS`.

## Motion reached the header, 2026-08-28, and the safelist is what made it true

`bed97a1` named the three speeds (`duration-fast|base|slow`), bound `--default-transition-duration`
and `-timing-function` to `duration-fast` / `ease-in-out`, and fixed the curve-per-intent rule.
`conventions.md` predated it and said nothing about motion at all, so the design agent had no
guidance on the one axis where **the compiler cannot help**: duration is the only namespace tailwind
gives no theme lookup for: `duration-300` is a bare value, so there is nothing to reset to
`initial` and a raw duration always compiles. The header plus `motion-conformance.node.test.ts` are
the entire gate.

Measuring before writing turned up the familiar trap, and it was worse here than anywhere:

- `duration-base` and `duration-slow` compiled, `duration-fast` did not: the app writes the two it
  needed and takes the third through the bound default, so it never spells it.
- **none of `ease-out` / `ease-in` / `ease-in-out` compiled.** Same reason: they are bound as the
  default, and the commit's whole point was deleting the fourteen call sites that said `ease-in-out`
  out loud.
- **none of the six `--animate-*` shorthands compiled in bare form.** They only ever appear under a
  `data-[state=…]` variant, and a variant compiles that variant: `.data-\[state\=open\]\:animate-popup-in`
  exists, `.animate-popup-in` does not. A design animating a surface it built itself got nothing.

Fixed the way the chart ramp, the box ladder and the semantic color set were: five `@source
inline(...)` lines in `styles-entry.css`, listing the speeds, the curves, the `transition-*` group
(`transition-opacity` was missing too), and the six shorthands **in both the bare and the two
`data-[state]` forms**: both are idiomatic, so promising one and not the other is the asymmetry
again. `check-conventions.mjs` gained a `motion` claim list in the same edit.

`duration-<number>` is deliberately **not** in `MUST_BE_ABSENT`: it compiles by construction and
always will; claiming otherwise would fail the checker on a truth.

## Prop contracts corrected, 2026-08-28

Found by the standing "diff the changed components' props" pass, not by any gate:

- **`Copier` gained `label?: string`** (`0cad947`). The trigger's accessible name; `aria-labelledby`
  points at the children when there are any, so `label` is for the glyph-only case in a row holding
  more than one copier. Added to `cfg.dtsPropsFor` and to `docs/Copier.md`.
- **`Field` stopped omitting `autoComplete`** and now defaults it to `"off"`, and `type="email"`,
  `"url"` and `"tel"` render as `type="text"` + the matching `inputMode`. Neither shows up in the
  props body (`autoComplete` is inherited, so the summary line already covers it) but both change
  what correct calling code looks like, so they went into `docs/Field.md` instead. **That is the
  general rule: a behaviour change with no prop change has nowhere to land except the doc**, and the
  doc is what becomes `.prompt.md`.

Neither drift was visible to any mechanical check: the previews render, typecheck passes, validate
exits 0. The upload partition did ship both (`Copier` and `Field` appear in `upload.components`
purely because their `.d.ts` / `.prompt.md` changed), which is the same lesson the risk list records under *a component rework
with an untouched preview*, seen from the other end.

## Scope change, 2026-09-03: `solo-card`, and the press that no card can show

Two design-system changes landed between syncs, neither of them a component change: `git diff` over
`packages/ui/src/components/` since `1112ea3` is **empty**, and the whole re-sync came back
`47 unchanged / 0 changed / 0 added`, with `upload.styling: true` as the only reason to upload at
all. Both changes are therefore invisible to every partition the driver reports: a stylesheet-only
sync is exactly the case where the header is the only artifact that can carry the change.

- **`solo-card`** (`packages/ui/src/styles/utilities.css`): the bordered `max-w-md` card that *is*
  the whole of a single-purpose screen (login, signup, check-email, the five reset panels). Added to
  `conventions.md` under *Page shape and scrollers* and to `check-conventions.mjs`'s
  `page + scrollers` claim. **Not safelisted**, deliberately: it compiles because
  `apps/platform/src` writes it ten times, which is the same app-scope dependency `page` and
  `table-scroll` already have (see *Scope change, 2026-08-22: the layout vocabulary*). If the solo
  screens ever leave that tree the class vanishes from the published vocabulary silently, and then it
  needs an `@source inline(...)` line like the motion set did.
- **The filled-button press** (`746292a`): `:active` nudges `translateY(1px)` on `.btn-primary` and
  the three semantic variants, instant and never transitioned, because the ramp gives a solid two
  fill steps and not three. A still capture can never show it, so it went into `conventions.md`'s
  motion paragraph as a house rule for a control the agent builds itself. This is the same shape as
  the 2026-08-28 prop corrections: **a behaviour change with no prop change and no render change has
  nowhere to land except the prose.**

`[DOCS_UNMAPPED]` for `Actions`, `EmptyRow`, `HeaderButton`, `LoadMoreRow`, `LoadMoreTr` is standing
and expected: those five have no `docs/*.md` and take a synthesized `.prompt.md`. It has printed on
every run since they were added; it is not new.

## Re-sync risks: the watch-list for the next run

What can silently go stale or wrong, in rough order of how expensive it is to miss:

- **Running `/design-sync` from the repo root instead of `apps/design-sync`.** The skill looks for
  `.design-sync/config.json` relative to the cwd; not finding one, it treats the run as a first-time
  import and creates a second project. Nothing warns. See *Where this runs from*.
- **`cfg.dtsPropsFor` drifting from the source.** Hand-maintained, and the extractor can no longer
  regenerate it (above). Nothing fails loudly when it rots: the previews still render and validate
  still exits 0; only the published contract is wrong. On every re-sync, diff the changed
  components' props against their entries. To find which components changed since the last sync:
  `git diff <last-sync-sha> HEAD -- packages/ui/src/components/`.
- **Previews compiling but passing dead props.** Same silence, but now caught mechanically by
  `pnpm --filter design-sync typecheck`, in CI and on commit.
- **A documented API half that is not on the export surface.** `show_toast` was this until
  2026-08-21 (above) and nothing mechanical caught it. Whenever `conventions.md` or a `docs/*.md`
  names something callable, confirm it is in the bundle's export list: that check is the whole
  defence.
- **A component rework with an untouched preview is invisible to the verification partition, by
  design.** Verification keys off the authored preview `.tsx` + config, so a reworked component whose
  preview did not change reads as `unchanged` and skips re-grading, while the upload partition
  (sourceHashes) still ships it. Check the upload partition, not the verification one, to answer
  "did my change ship?"
- **The stylesheet is a JIT build with three source scopes** (`packages/ui/src`, `.design-sync/previews`,
  `apps/platform/src`). Narrowing any of them silently removes utilities from the published
  vocabulary, and the auto-detected scope is now bounded by `apps/design-sync/package.json`, so
  the whole-repo overspill is gone (see Stylesheet).
- **`.cache/styles.css` is gitignored**, so a fresh clone has no `cssEntry` until it is compiled.
  `pnpm --filter design-sync styles`. A missing one is loud (`! cssEntry: … not found`).
- **`conventions.md` naming something the build doesn't have.** `prose` was this on 2026-08-22,
  then the color set was (both above). The header is trusted verbatim by the design agent, and a
  name with no rule fails silently. Now mechanical: `node .design-sync/check-conventions.mjs` after
  every build whose stylesheet or header moved, before uploading. Its claim lists are hand-
  maintained, so a reworded promise needs the script edited in the same commit.
- **Node is pinned to 24 (`.nvmrc`, `engines`) but the converter runs fine on newer.**
  pnpm prints an `Unsupported engine` warning for every member and nothing else
  happens. Not worth chasing, but don't read those warnings as a sync problem.
- **One orphan font in the project: `fonts/gochi-hand-latin-400-normal.woff`.** Left by an earlier
  sync whose converter emitted a `.woff` fallback beside the `.woff2`; this build emits `.woff2`
  only and `fonts/fonts.css` references nothing else, so it is unreferenced dead weight rather than
  a broken link. The diff's `upload.deletePaths` does not name it: the anchor tracks aux files as
  one `auxSha`, not a path list, and §5 forbids hand-deriving deletes, so it was left in place on
  2026-08-24. Harmless; delete it deliberately if a future run wants the project clean.
- **The capture harness pins the clock to 2024-05-15.** Date previews are authored around it.
- **`check-conventions.mjs` is now a fourth thing that has to move with the prose**, and since
  2026-08-28 with `styles-entry.css` too. A promise in the header needs a claim in the script AND,
  when nothing in the three scanned scopes writes the name, an `@source inline(...)` line. Three
  files, one edit. The motion section is the worked example.
- **Anything the app reaches through a *bound default* is invisible to the JIT scan.** This is a
  distinct failure from "nobody wrote it yet": `--default-transition-duration` means correct app code
  never spells `duration-fast` or `ease-in-out`, so a well-factored theme actively *removes* names
  from the published vocabulary. Whenever a token gets bound as a default, check whether its explicit
  form still compiles. Same for a utility only ever written under a variant: `data-[state=open]:x`
  compiles that variant, never the bare `x`.
- **A stylesheet-only sync reports as "nothing changed".** 2026-09-03 was the worked example: 47
  unchanged, 0 changed, 0 added, and the only true field was `upload.styling`. Neither of that run's
  two real changes (`solo-card`, the filled-button press) could show up in a partition, a render or a
  grade, so on a run whose verdict looks empty, diff `packages/ui/src/styles/` and
  `packages/brand/design-system.md` against the last sync sha before concluding there is nothing to
  say. The header is the only artifact that carries a change of that shape.

## The header's color set moved to radix semantics, 2026-08-25

The palette kept the shadcn habit of minting an `-fg` twin per surface, and after the
retheme five of them resolved to `gray-12`. Radix mints no per-surface foreground
(one contrast token per ramp, everything else reads the grey rungs), so the twins were
deleted and three surfaces renamed. What this directory had to change:

- **`styles-entry.css`'s semantic `@source inline(...)`**: `card`, `card-fg`, `popover`,
  `popover-fg`, `secondary-fg`, `sidebar-fg` and `input` are gone; `panel`, `surface` and
  `overlay` are in. Brace expansion, still not regex-safe: edit the list by hand and count
  the commas.
- **`check-conventions.mjs`**: `SURFACES` split into `INKED` (the four fills whose ink
  follows them, so `text-<x>-fg` is a real claim) and `PLAIN` (fills carrying the neutral
  rung, which have no `-fg` to claim). `border-input` dropped from the lines claim.
- **`conventions.md`**: the surfaces, ink and other-lines rows rewritten. The ink row no
  longer promises "the `-fg` partner of every surface"; that phrasing is what produced the
  2026-08-22 drift above, and it is now false on purpose rather than by accident.

Fifteen previews wrote a deleted name and moved with the rest: `bg-card` → `bg-panel`
in the panel-shaped ones, `bg-input` → `bg-surface` in `Increments`, `text-popover-fg` →
`text-gray-12` in `Tooltip` and `HoverCard`. `Group.tsx` needed nothing and already
covers the page → panel → field stack the rename is about.

## 2026-10-31: the surface model (ground → card → well → field)

Cards, dialogs and floating layers went white, borderless and `rounded-card` (12px);
`--panel` became a well inside a card; `--sidebar` and `card-on-band` were deleted;
`--card` and `--hairline` arrived. What this directory had to change:

- **`styles-entry.css`**: `card` and `hairline` joined the semantic inline list,
  `sidebar` left it, and `divide-hairline` / `rounded-card` are listed explicitly.
- **`check-conventions.mjs`**: `card` in `PLAIN`, `sidebar` out; the hairline pair in
  `lines`; `rounded-card` in `radius`; `bg-sidebar` and `card-on-band` documented absent.
- **previews**: every panel-shaped wrapper (`bg-panel border rounded`) moved to
  `bg-card rounded-card`, and `Modal`'s fills to `bg-card`.

The **ground is not in this bundle**: the app page's flat gray `--ground` is painted once
by platform's `src/index.css` (on `body`), not by `packages/ui`'s stylesheet, so a
preview card renders white on the preview's own white. That is the model with its
ground missing, not a broken card; don't add a border to make it show.
