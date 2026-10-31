import { Button } from "@better-giving/ui";
import {
  ArrowUpFromLine,
  Check,
  CircleAlert,
  CircleCheck,
  Clock,
  ImageIcon,
  Link2Off,
  LoaderCircle,
  Lock,
  type LucideIcon,
} from "lucide-react";
import {
  type DragEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { DappLogo } from "#/components/image";
import {
  photo_link_ttl_ms,
  photo_types,
  photo_upload_quota,
  upload_limits,
} from "@/constants/upload";

/** `gone | limited | ready | failed | unknown | saved` mirror the server's `PhotoPage`,
 * so the route passes a server page straight through */
export type PhotoView =
  | { state: "gone" }
  | { state: "limited" }
  | { state: "ready"; campaign: string; error?: string }
  | { state: "failed"; campaign: string }
  | { state: "unknown"; campaign: string }
  | {
      state: "uploading";
      campaign: string;
      file_name: string;
      preview_url: string;
      /** bytes */
      loaded: number;
      /** bytes */
      total: number;
    }
  | { state: "saved"; campaign: string; photo: string };

export interface IPhotoUploadPage {
  view: PhotoView;
  /** JS path only: the route intercepts the submit (preventDefault) and uploads itself */
  on_submit?: (e: FormEvent<HTMLFormElement>) => void;
  /** called with the file input after every pick or drop, so the caller can hold an oversized or wrong-type pick with setCustomValidity; the page shows the hold */
  on_pick?: (input: HTMLInputElement) => void;
}

const ACCEPT = photo_types.join(",");
const MIB = 1024 * 1024;

const count = (n: number, unit: string) =>
  n === 1 ? `a ${unit}` : `${n} ${unit}s`;

/** a span of whole seconds as prose: 60 → "a minute", 120 → "2 minutes", 30 → "30 seconds" */
export function format_duration(seconds: number): string {
  return seconds % 60 === 0
    ? count(seconds / 60, "minute")
    : count(seconds, "second");
}

const LINK_TTL = format_duration(photo_link_ttl_ms / 1000);

/** bytes as MB to one decimal, in the same MiB `upload_limits.max_bytes` is counted in */
export function format_mb(bytes: number): string {
  return (bytes / MIB).toFixed(1);
}

const FORM_STATES: ReadonlySet<PhotoView["state"]> = new Set([
  "ready",
  "failed",
  "uploading",
]);

const STATUS: Record<Exclude<PhotoView["state"], "uploading">, string> = {
  ready: "",
  // the failed band takes focus and reads itself
  failed: "",
  unknown:
    "We couldn't confirm your photo was saved. Open this link again to check; if it's been used up, ask for a new one.",
  saved: "Photo added",
  limited: "Too many uploads",
  gone: "This link can't be used",
};

export function PhotoUploadPage({
  view,
  on_submit,
  on_pick,
}: IPhotoUploadPage) {
  // an outcome that replaces the form takes focus from the button that was pressed;
  // one the server rendered first (a reopened, spent link) leaves focus alone
  const result = useRef<HTMLHeadingElement>(null);
  const prev_state = useRef(view.state);
  useEffect(() => {
    const was = prev_state.current;
    prev_state.current = view.state;
    if (FORM_STATES.has(was) && !FORM_STATES.has(view.state)) {
      result.current?.focus();
    }
  }, [view.state]);

  // the region outlives every swap so each outcome is a change it announces,
  // not a node that arrives already holding it
  const status =
    view.state === "uploading"
      ? `Uploading ${view.file_name}`
      : STATUS[view.state];
  switch (view.state) {
    case "gone":
      return (
        <Shell status={status}>
          <Outcome
            tone="neutral"
            Icon={Link2Off}
            title="This link can't be used"
            heading={result}
            lede={`Upload links work once and expire after ${LINK_TTL}. Ask whoever sent you this link for a new one.`}
          />
        </Shell>
      );
    case "limited":
      return (
        <Shell chip status={status}>
          <Outcome
            tone="neutral"
            Icon={Clock}
            title="Too many uploads"
            heading={result}
            lede={`Too many uploads came from this connection. Wait ${format_duration(photo_upload_quota.window_s)}, then try again.`}
          >
            {/* a GET of the link's own url: the link was not used up */}
            <Button variant="secondary" size="lg" href="" classes="w-full">
              Try again
            </Button>
          </Outcome>
        </Shell>
      );
    case "unknown":
      return (
        <Shell status={status}>
          <Outcome
            tone="neutral"
            Icon={CircleAlert}
            title="We couldn't confirm your photo was saved"
            heading={result}
            lede="Open this link again to check; if it's been used up, ask for a new one."
          />
        </Shell>
      );
    case "saved":
      return (
        <Shell status={status}>
          <Outcome
            tone="success"
            Icon={CircleCheck}
            title="Photo added"
            heading={result}
            lede={
              <>
                It's now the banner of{" "}
                <span className="text-gray-12 font-bold">{view.campaign}</span>.
              </>
            }
          >
            <figure className="rounded overflow-hidden bg-gray-3 aspect-video">
              <img
                src={view.photo}
                alt={`The new banner for ${view.campaign}`}
                className="size-full object-cover"
              />
            </figure>
            {/* not a second status: the shell's region already announces the save */}
            <p className="flex items-start gap-2.5 rounded px-4 py-3 bg-success-subtle text-success-subtle-fg text-sm font-semibold">
              <Check className="icon-md mt-px" aria-hidden />
              This link is now used up. You can close this tab.
            </p>
          </Outcome>
        </Shell>
      );
    case "ready":
    case "failed":
    case "uploading":
      // one form through all three, so focus and the picked file survive the
      // swaps and "try again" needs no re-pick
      return (
        <Shell
          chip
          foot={
            view.state === "uploading"
              ? "Keep this tab open until the upload finishes."
              : `This link works once and expires ${LINK_TTL} after it was created. No sign-in needed.`
          }
          status={status}
        >
          <UploadForm view={view} on_submit={on_submit} on_pick={on_pick} />
        </Shell>
      );
  }
}

interface IShell {
  /** the "Secure upload link" chip: shown while the link still works */
  chip?: boolean;
  foot?: string;
  /** the sr-only live region's text */
  status: string;
  children: ReactNode;
}

function Shell({ chip, foot, status, children }: IShell) {
  return (
    <div className="min-h-dvh flex flex-col">
      {/* logo only: the visitor has no account here, so no auth slot */}
      <header>
        <div className="page flex items-center justify-between h-18">
          <DappLogo classes="h-10" />
          {chip && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-11">
              <Lock className="icon-sm" aria-hidden />
              Secure upload link
            </span>
          )}
        </div>
      </header>
      <main className="page grow grid justify-items-center content-start gap-4 py-8 sm:pt-16 sm:pb-12">
        {children}
        {foot && (
          <p className="max-w-xl px-5 text-center text-xs text-gray-11 text-pretty">
            {foot}
          </p>
        )}
        <span role="status" className="sr-only">
          {status}
        </span>
      </main>
    </div>
  );
}

const CARD = "card grid gap-5 w-full max-w-xl";

interface IHead {
  campaign: string;
  title_id: string;
}

function Head({ campaign, title_id }: IHead) {
  return (
    <div className="grid gap-2">
      <p className="eyebrow text-gray-11">Campaign photo</p>
      <h1
        id={title_id}
        className="text-2xl font-bold tracking-tight text-balance"
      >
        Add a photo to <span className="text-gray-12">{campaign}</span>
      </h1>
      <p className="text-gray-11 text-pretty">
        It replaces the banner at the top of the campaign page, if there is one.
      </p>
    </div>
  );
}

interface ILimits {
  id?: string;
}

function Limits({ id }: ILimits) {
  const pill =
    "inline-flex items-center gap-1.5 rounded-full border border-gray-7 bg-surface px-2.5 py-1 text-xs font-semibold text-gray-12";
  return (
    <div id={id} className="flex flex-wrap gap-2">
      <span className={pill}>
        <ImageIcon className="icon-sm" aria-hidden />
        JPEG, PNG or WebP
      </span>
      <span className={pill}>Up to {upload_limits.max_bytes / MIB} MB</span>
    </div>
  );
}

type FormView = Extract<PhotoView, { state: "ready" | "failed" | "uploading" }>;

interface IUploadForm {
  view: FormView;
  on_submit?: IPhotoUploadPage["on_submit"];
  on_pick?: IPhotoUploadPage["on_pick"];
}

function UploadForm({ view, on_submit, on_pick }: IUploadForm) {
  const ids = useId();
  const title_id = `${ids}-title`;
  const input_id = `${ids}-photo`;
  const limits_id = `${ids}-limits`;
  const error_id = `${ids}-error`;
  const input = useRef<HTMLInputElement>(null);
  const band = useRef<HTMLDivElement>(null);
  const [picked, set_picked] = useState<string | null>(null);
  const [dragging, set_dragging] = useState(false);

  const uploading = view.state === "uploading";
  // every byte is sent; the server is still checking and storing it
  const saving = uploading && view.total > 0 && view.loaded >= view.total;
  const failed = view.state === "failed";
  const server_error = view.state === "ready" ? view.error : undefined;

  // a pick replaces whatever error was showing; a new server result replaces the pick's
  const [pick_error, set_pick_error] = useState<string | null>();
  const [seen, set_seen] = useState({ state: view.state, server_error });
  if (seen.state !== view.state || seen.server_error !== server_error) {
    set_seen({ state: view.state, server_error });
    set_pick_error(undefined);
  }
  const error = pick_error === undefined ? server_error : pick_error;

  // a refusal arrives with a round trip: the field it is about takes focus,
  // which scrolls it in and reads the message it is described by
  useEffect(() => {
    if (server_error) input.current?.focus();
  }, [server_error]);

  useEffect(() => {
    if (failed) band.current?.focus();
  }, [failed]);

  // a drop that misses the area would open the file in the tab and leave the page
  useEffect(() => {
    const hold = (e: globalThis.DragEvent) => e.preventDefault();
    document.addEventListener("dragover", hold);
    document.addEventListener("drop", hold);
    return () => {
      document.removeEventListener("dragover", hold);
      document.removeEventListener("drop", hold);
    };
  }, []);

  const pick = (el: HTMLInputElement) => {
    set_picked(el.files?.[0]?.name ?? null);
    on_pick?.(el);
    // only on_pick's own hold: `required`'s message on an empty input is not a pick's error
    set_pick_error(el.validity.customError ? el.validationMessage : null);
  };

  const drop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    set_dragging(false);
    const file = e.dataTransfer.files[0];
    const el = input.current;
    if (!file || !el) return;
    // the input is not `multiple`: keep the first of a multi-file drop
    const one = new DataTransfer();
    one.items.add(file);
    el.files = one.files;
    pick(el);
  };

  return (
    <form
      method="post"
      encType="multipart/form-data"
      aria-labelledby={title_id}
      onSubmit={(e) => {
        // the held button stays enabled, so a second press still submits: it must not send twice
        if (uploading) e.preventDefault();
        else on_submit?.(e);
      }}
      className={CARD}
    >
      <Head campaign={view.campaign} title_id={title_id} />
      {failed && (
        <div
          ref={band}
          tabIndex={-1}
          className="flex items-start gap-2.5 rounded px-4 py-3 bg-destructive-subtle text-destructive-subtle-fg text-sm focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        >
          <CircleAlert className="icon-md mt-px" aria-hidden />
          <p>
            <strong className="block font-bold">
              The photo couldn't be saved
            </strong>
            Nothing changed, and this link still works. Try again.
          </p>
        </div>
      )}
      <div className="grid gap-2">
        {/* hidden, not unmounted, while uploading: the input holds the pick a failed upload retries */}
        <label
          htmlFor={input_id}
          hidden={uploading}
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            set_dragging(true);
          }}
          onDragLeave={(e) => {
            // leaving for a child of the drop area is still over it
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              set_dragging(false);
            }
          }}
          onDrop={drop}
          className="group grid place-items-center gap-1 min-h-54 px-6 py-10 text-center rounded border border-dashed border-gray-8 bg-surface cursor-pointer hover:bg-secondary has-aria-invalid:border-destructive has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:-outline-offset-2 data-dragging:bg-secondary data-dragging:border-primary data-dragging:outline-2 data-dragging:outline-ring data-dragging:-outline-offset-2"
        >
          <input
            ref={input}
            id={input_id}
            type="file"
            name="photo"
            accept={ACCEPT}
            required
            className="sr-only"
            aria-describedby={error ? `${limits_id} ${error_id}` : limits_id}
            aria-invalid={error ? true : undefined}
            onChange={(e) => pick(e.currentTarget)}
          />
          <span className="grid place-items-center size-12 mb-3 rounded-full bg-secondary text-primary">
            <ArrowUpFromLine className="icon-2xl" aria-hidden />
          </span>
          {picked ? (
            <span className="font-bold break-all">{picked}</span>
          ) : (
            <span className="font-bold">
              {/* no JS: the input's own validity is the only sign a pick took */}
              <span className="group-has-valid:hidden">
                <span className="max-sm:hidden pointer-coarse:hidden">
                  Drag a photo here or{" "}
                  <span className="text-primary underline underline-offset-2">
                    browse
                  </span>
                </span>
                <span className="hidden max-sm:inline pointer-coarse:inline text-primary underline underline-offset-2">
                  Choose a photo
                </span>
              </span>
              <span className="hidden group-has-valid:inline">
                Photo chosen
              </span>
            </span>
          )}
        </label>
        {uploading && <Progress {...view} saving={saving} />}
        {error && (
          <p
            id={error_id}
            role="alert"
            className="text-sm text-destructive-subtle-fg"
          >
            {error}
          </p>
        )}
      </div>
      <Limits id={limits_id} />
      {uploading ? (
        // aria-disabled, not disabled: `disabled` would blur the button the press left focus on
        <Button
          variant="primary"
          size="lg"
          type="submit"
          aria-disabled
          classes="w-full gap-2 pending"
        >
          <LoaderCircle className="icon-md animate-spin" aria-hidden />
          {saving ? "Saving…" : "Uploading…"}
        </Button>
      ) : (
        <Button
          variant="primary"
          size="lg"
          type="submit"
          classes="w-full gap-2"
        >
          <ArrowUpFromLine className="icon-md" aria-hidden />
          Upload photo
        </Button>
      )}
    </form>
  );
}

interface IProgress extends Extract<PhotoView, { state: "uploading" }> {
  saving: boolean;
}

function Progress({
  file_name,
  preview_url,
  loaded,
  total,
  saving,
}: IProgress) {
  const pct =
    total > 0
      ? Math.min(100, Math.max(0, Math.round((loaded / total) * 100)))
      : 0;
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-4 rounded bg-panel p-3">
      <div className="w-18 h-12 rounded overflow-hidden bg-gray-3">
        <img src={preview_url} alt="" className="size-full object-cover" />
      </div>
      <div className="grid gap-1.5 min-w-0">
        <span className="truncate text-sm font-semibold">{file_name}</span>
        <div
          role="progressbar"
          aria-label={saving ? "Saving photo" : "Uploading photo"}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-2 rounded-full overflow-hidden bg-gray-3 inset-shadow-track"
        >
          <div
            className="h-full rounded-full bg-primary shadow-track-fill"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-gray-11 figures">
          <span>
            {format_mb(loaded)} of {format_mb(total)} MB
          </span>
          <span>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

interface IOutcome {
  tone: "success" | "neutral";
  Icon: LucideIcon;
  title: string;
  lede: ReactNode;
  /** focused when the outcome replaces the form */
  heading: RefObject<HTMLHeadingElement | null>;
  children?: ReactNode;
}

const RING: Record<IOutcome["tone"], string> = {
  success: "bg-success-subtle text-success",
  neutral: "bg-gray-3 text-gray-11",
};

function Outcome({ tone, Icon, title, lede, heading, children }: IOutcome) {
  const title_id = `${useId()}-title`;
  return (
    <section aria-labelledby={title_id} className={CARD}>
      <div className="grid justify-items-center gap-3 text-center">
        <span
          className={`grid place-items-center size-18 rounded-full ${RING[tone]}`}
        >
          <Icon className="pictogram-md" aria-hidden />
        </span>
        <h1
          ref={heading}
          id={title_id}
          tabIndex={-1}
          className="text-2xl font-bold tracking-tight text-balance focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
        >
          {title}
        </h1>
        <p className="text-gray-11 text-pretty">{lede}</p>
      </div>
      {children}
    </section>
  );
}
