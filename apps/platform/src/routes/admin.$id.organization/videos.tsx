import { Check, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useNavigation, useSearchParams } from "react-router";
import { YouTubePlayer } from "#/components/youtube-player";
import { sans_https } from "@/helpers/https";
import type { IMedia } from "@/npo";
import type { IVideos } from "./api";
import {
  type IRemoved,
  type Restored,
  use_add_video,
  use_link_input,
  use_restore,
  use_video,
} from "./use-videos";
import { VIDEOS_PAGE, VIDEOS_STEP } from "./videos-page";

const disp = (url: string) => sans_https(url) ?? url;

/** a press while held does nothing; `aria-disabled` keeps focus where it is */
const unless = (held: boolean, run: () => void) => () => {
  if (!held) run();
};

/** a swap unmounted the focused control; a user who moved on keeps their place */
const focus_dropped = () =>
  !document.activeElement || document.activeElement === document.body;

const on_enter = (run: () => void, esc?: () => void) => (e: KeyboardEvent) => {
  if (e.key === "Enter") {
    // the page is one form; Enter here must not reach it
    e.preventDefault();
    run();
  }
  if (e.key === "Escape" && esc) esc();
};

interface IVideosGroup {
  npo_id: number;
  videos: IVideos;
}

interface IRemovedRow extends IRemoved {
  /** why its restore was refused */
  refusal?: string;
  /** a read has come back without it */
  gone?: boolean;
}

export function VideosGroup({ npo_id, videos }: IVideosGroup) {
  const { featured, items, max } = videos;
  const note_id = useId();
  const full_id = useId();
  const full = featured.length >= max;
  const [removed, set_removed] = useState<IRemovedRow[]>([]);
  const [focus_id, set_focus_id] = useState<string>();
  const status_ref = useRef<HTMLParagraphElement>(null);
  const took_off = useRef<string>(undefined);
  const more_ref = useRef<HTMLButtonElement>(null);
  /** a restored video that sorts past the loaded page */
  const [back_off_page, set_back_off_page] = useState<IRemoved>();
  const listed = useRef(items);
  listed.current = items;

  // a delete press is recorded at the press; its Undo shows once the read no
  // longer has the row, so a refused delete never offers one, and stays until
  // its restore settles: a restored row past the loaded page is never listed
  const undoable = removed.filter((r) => !items.some((v) => v.id === r.id));
  // an Undo still pending keeps the spots, so the row it restores lands in place
  const empty = items.length + undoable.length === 0;
  // a second press, or the restored row removed again, replaces the entry: the
  // link may have been edited since
  const on_remove = useCallback((r: IRemoved) => {
    set_back_off_page(undefined);
    set_removed((prev) => [...prev.filter((x) => x.id !== r.id), r]);
  }, []);
  const on_settled = useCallback((r: IRemoved, out: Restored) => {
    const { id } = r;
    if (out !== "restored") {
      const { refusal } = out;
      set_removed((prev) =>
        prev.some((x) => x.id === id && x.refusal !== refusal)
          ? prev.map((x) => (x.id === id ? { ...x, refusal } : x))
          : prev
      );
      return;
    }
    if (!listed.current.some((v) => v.id === id)) set_back_off_page(r);
    set_removed((prev) => prev.filter((x) => x.id !== id));
  }, []);
  // an entry ends once its row is listed again, so a later delete from
  // elsewhere offers no Undo here for a link that may have changed since; a
  // restored row loaded in ends its notice
  useEffect(() => {
    set_removed((prev) => {
      const is_listed = (r: IRemovedRow) => items.some((v) => v.id === r.id);
      const next = prev
        .filter((r) => !(r.gone && is_listed(r)))
        .map((r) => (r.gone || is_listed(r) ? r : { ...r, gone: true }));
      const same =
        next.length === prev.length && next.every((r, i) => r === prev[i]);
      return same ? prev : next;
    });
    set_back_off_page((b) =>
      b && items.some((v) => v.id === b.id) ? undefined : b
    );
  }, [items]);
  // the Undo that held the focus is gone and the row it brought back isn't
  // listed; the way to it is
  useEffect(() => {
    if (back_off_page && focus_dropped()) more_ref.current?.focus();
  }, [back_off_page]);

  // a spot taken off is replaced by an open one; the count says what changed
  useEffect(() => {
    const id = took_off.current;
    if (!id || featured.some((f) => f.id === id)) return;
    took_off.current = undefined;
    if (focus_dropped()) status_ref.current?.focus();
  }, [featured]);
  const on_take_off = useCallback((id: string) => {
    took_off.current = id;
  }, []);

  return (
    <fieldset
      id="videos"
      aria-describedby={note_id}
      // scroll-mt clears the sticky app header on a #videos landing
      className="min-w-0 scroll-mt-20"
    >
      {/* the fieldset's first child, or it names nothing */}
      <legend>
        <h3 className="text-xl">Videos</h3>
      </legend>
      <p id={note_id} className="mt-0.5 text-sm text-gray-11">
        Changes here apply right away.
      </p>

      {/* with nothing to choose, open spots are noise; the add field leads */}
      {!empty && (
        <div className="mt-6 grid gap-2">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <h4 className="text-sm font-semibold">On your page</h4>
            <p ref={status_ref} tabIndex={-1} className="text-gray-11">
              <b className="font-semibold text-gray-12">{featured.length}</b> of{" "}
              {max} spots used
            </p>
          </div>
          <ol className="grid grid-cols-2 @lg:grid-cols-4 gap-3">
            {Array.from({ length: max }, (_, i) => {
              const v = featured.at(i);
              return v ? (
                <li key={v.id} className="min-w-0">
                  <Spot
                    npo_id={npo_id}
                    video={v}
                    n={i + 1}
                    on_take_off={on_take_off}
                  />
                </li>
              ) : (
                <li key={`open-${i}`} className="min-w-0">
                  <OpenSpot />
                </li>
              );
            })}
          </ol>
          {full && (
            <p id={full_id} className="text-sm text-gray-11">
              All {max} spots are in use. Take a video off to show another.
            </p>
          )}
        </div>
      )}

      <div className="mt-6 grid gap-2">
        {!empty && <h4 className="text-sm font-semibold">All videos</h4>}
        <AddVideo
          npo_id={npo_id}
          help={
            empty
              ? `Add a YouTube link. You can show up to ${max} on your page.`
              : undefined
          }
        />
        {!empty && (
          <ul className="mt-2 divide-y border rounded bg-surface">
            {items.map((v) => {
              const spot = featured.findIndex((f) => f.id === v.id) + 1;
              return (
                <Row
                  key={v.id}
                  npo_id={npo_id}
                  video={v}
                  spot={spot}
                  full={full}
                  full_id={full_id}
                  focus={v.id === focus_id}
                  on_remove={on_remove}
                />
              );
            })}
            {undoable.map((r) => (
              <UndoRow
                key={r.id}
                npo_id={npo_id}
                removed={r}
                // the row comes back under its own id, and its listing
                // unmounts this one in the same render
                on_restore={set_focus_id}
                on_settled={on_settled}
              />
            ))}
          </ul>
        )}
        <p role="status" className="text-sm text-gray-11 empty:hidden">
          {back_off_page &&
            `${disp(back_off_page.url)} is back, further down the list.`}
        </p>
        {videos.has_more && <LoadMore ref={more_ref} limit={videos.limit} />}
      </div>
    </fieldset>
  );
}

interface ISpot {
  npo_id: number;
  video: IMedia;
  n: number;
  on_take_off: (id: string) => void;
}

function Spot({ npo_id, video, n, on_take_off }: ISpot) {
  const v = use_video(npo_id, video.id, "spot");
  const url = disp(video.url);
  return (
    <div className="grid gap-1.5">
      <div className="relative aspect-video rounded overflow-clip bg-gray-12">
        <YouTubePlayer url={video.url} thumbnail />
        <span
          aria-hidden
          className="absolute top-1.5 left-1.5 grid place-items-center min-w-5 h-5 px-1.5 rounded-full bg-gray-1 text-gray-12 text-xs font-bold"
        >
          {n}
        </span>
      </div>
      <div className="flex items-center gap-1 min-w-0">
        <span className="flex-1 min-w-0 truncate text-xs text-gray-11">
          {url}
        </span>
        <button
          type="button"
          aria-label={`Take ${url} off your page`}
          aria-disabled={v.pending}
          aria-busy={v.pending}
          onClick={unless(v.pending, () => {
            on_take_off(video.id);
            v.submit({ intent: "feature", featured: "1" });
          })}
          className="btn btn-ghost btn-sm shrink-0"
        >
          Take off
        </button>
      </div>
    </div>
  );
}

function OpenSpot() {
  return (
    <div className="aspect-video grid place-content-center gap-1 p-2 text-center border border-dashed border-gray-8 rounded text-xs text-gray-11">
      <b className="text-sm font-semibold text-gray-12">Open spot</b>
      <span>Choose “Show on page” on a video below</span>
    </div>
  );
}

interface IAddVideo {
  npo_id: number;
  help?: string;
}

function AddVideo({ npo_id, help }: IAddVideo) {
  const add = use_add_video(npo_id);
  const id = useId();
  const err_id = useId();
  const help_id = useId();
  const described =
    [add.error && err_id, help && help_id].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="grid gap-1">
      {/* the placeholder and the button say it */}
      <label htmlFor={id} className="sr-only">
        Add a video
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          ref={add.ref}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          placeholder="Paste a YouTube link"
          value={add.value}
          onChange={(e) => add.set_value(e.target.value)}
          onKeyDown={on_enter(add.add)}
          aria-invalid={!!add.error}
          aria-describedby={described}
          className="field-input flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={add.add}
          aria-disabled={add.pending}
          aria-busy={add.pending}
          className="btn btn-secondary btn-field shrink-0"
        >
          {/* one flex item, so the space before "video" isn't trimmed */}
          <span>
            Add<span className="@max-lg:sr-only"> video</span>
          </span>
        </button>
      </div>
      <p id={err_id} className="field-err empty:hidden">
        {add.error}
      </p>
      {help && (
        <p id={help_id} className="text-sm text-gray-11">
          {help}
        </p>
      )}
    </div>
  );
}

interface IRow {
  npo_id: number;
  video: IMedia;
  /** 1-based spot on the page, 0 when not on it */
  spot: number;
  full: boolean;
  /** the visible reason a full page holds "Show on page" */
  full_id: string;
  focus: boolean;
  on_remove: (r: IRemoved) => void;
}

function Row({ npo_id, video, spot, full, full_id, focus, on_remove }: IRow) {
  const v = use_video(npo_id, video.id, "row");
  const url = disp(video.url);
  const err_id = useId();
  const link_ref = useRef<HTMLAnchorElement>(null);
  const edit_ref = useRef<HTMLButtonElement>(null);
  const [editing, set_editing] = useState(false);
  const closed = useRef(false);
  /** `featured` as it was at this row's own feature press */
  const pressed_at = useRef<boolean>(undefined);

  useEffect(() => {
    if (focus && focus_dropped()) link_ref.current?.focus();
  }, [focus]);
  // the pressed control is swapped for its opposite; the row's link is the
  // nearest thing that stays
  useEffect(() => {
    if (pressed_at.current === undefined) return;
    if (pressed_at.current === video.featured) return;
    pressed_at.current = undefined;
    if (focus_dropped()) link_ref.current?.focus();
  }, [video.featured]);
  useEffect(() => {
    if (v.refusal) pressed_at.current = undefined;
  }, [v.refusal]);
  // the edit box replaced its own trigger; closing hands focus back to it
  useEffect(() => {
    if (editing || !closed.current) return;
    closed.current = false;
    edit_ref.current?.focus();
  }, [editing]);
  const close = useCallback(() => {
    closed.current = true;
    set_editing(false);
  }, []);

  // shown while the page is full: the refusal is the cap, and taking a video
  // off answers it
  const refusal = full ? v.refusal : undefined;
  const show_held = full || v.pending;
  /** `sent` is the featured state this row shows */
  const feature = (sent: boolean) =>
    unless(sent ? v.pending : show_held, () => {
      pressed_at.current = sent;
      v.submit({ intent: "feature", featured: sent ? "1" : "0" });
    });

  return (
    <li aria-busy={v.pending} className="grid gap-2 px-3 py-2.5">
      {editing ? (
        <EditLink
          url={video.url}
          name={url}
          pending={v.pending}
          answer={v.answer}
          save={(next) => v.submit({ intent: "edit", url: next })}
          close={close}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-3 flex-1 min-w-48">
            <div
              aria-hidden
              className="relative w-24 shrink-0 aspect-video rounded overflow-clip bg-gray-12"
            >
              <YouTubePlayer url={video.url} thumbnail />
            </div>
            <a
              ref={link_ref}
              href={video.url}
              target="_blank"
              rel="noopener noreferrer"
              className="link text-sm min-w-0 break-all"
            >
              {url}
            </a>
          </div>
          <div className="flex items-center gap-2">
            {video.featured && spot ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-success-subtle-fg">
                <Check aria-hidden className="icon-md" />
                On page · spot {spot}
              </span>
            ) : video.featured ? (
              // featured past the page's spots (an org that held more before
              // the cap), so the public page doesn't show it
              <button
                type="button"
                aria-label={`Take ${url} off your page`}
                aria-disabled={v.pending}
                aria-busy={v.pending}
                onClick={feature(true)}
                className="btn btn-ghost btn-sm"
              >
                Take off
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Show ${url} on page`}
                aria-disabled={show_held}
                aria-busy={v.pending}
                aria-describedby={refusal ? err_id : full ? full_id : undefined}
                onClick={feature(false)}
                className="btn btn-secondary btn-sm"
              >
                Show on page
              </button>
            )}
            <button
              ref={edit_ref}
              type="button"
              aria-label={`Edit link for ${url}`}
              aria-disabled={v.pending}
              onClick={unless(v.pending, () => set_editing(true))}
              className="btn btn-ghost btn-sm"
            >
              Edit link
            </button>
            <button
              type="button"
              aria-label={`Remove ${url}`}
              aria-disabled={v.pending}
              onClick={unless(v.pending, () => {
                on_remove({
                  id: video.id,
                  url: video.url,
                  featured: video.featured,
                  date_created: video.date_created,
                });
                v.submit({ intent: "delete" });
              })}
              className="btn btn-ghost btn-sm btn-icon"
            >
              <Trash2 aria-hidden className="icon-md" />
            </button>
          </div>
        </div>
      )}
      {refusal && (
        <p id={err_id} className="text-sm text-destructive-subtle-fg">
          {refusal}
        </p>
      )}
    </li>
  );
}

interface IEditLink {
  url: string;
  /** the row's name, as its controls carry it */
  name: string;
  pending: boolean;
  answer: ReturnType<typeof use_video>["answer"];
  save: (url: string) => void;
  close: () => void;
}

function EditLink({ url, name, pending, answer, save, close }: IEditLink) {
  const input = use_link_input(url);
  const err_id = useId();
  const sent = useRef<unknown>(answer);
  const server_error =
    answer && answer !== sent.current && "errors" in answer
      ? answer.errors.url
      : undefined;
  const error = input.error ?? server_error;

  useEffect(() => {
    input.ref.current?.focus();
  }, [input.ref]);
  // closes on its own save's answer, not one the row held when it opened
  useEffect(() => {
    if (answer !== sent.current && answer && "ok" in answer) close();
  }, [answer, close]);

  const submit = unless(pending, () => {
    const next = input.take();
    if (next) save(next);
  });

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input.ref}
          type="text"
          inputMode="url"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Link for ${name}`}
          value={input.value}
          onChange={(e) => input.set_value(e.target.value)}
          onKeyDown={on_enter(submit, close)}
          aria-invalid={!!error}
          aria-describedby={error ? err_id : undefined}
          className="field-input flex-1 min-w-48"
        />
        <button
          type="button"
          onClick={submit}
          aria-disabled={pending}
          aria-busy={pending}
          className="btn btn-primary btn-sm"
        >
          Save link
        </button>
        <button type="button" onClick={close} className="btn btn-ghost btn-sm">
          Cancel
        </button>
      </div>
      <p id={err_id} className="field-err empty:hidden">
        {error}
      </p>
    </div>
  );
}

interface IUndoRow {
  npo_id: number;
  removed: IRemovedRow;
  on_restore: (id: string) => void;
  on_settled: (r: IRemoved, out: Restored) => void;
}

function UndoRow({ npo_id, removed, on_restore, on_settled }: IUndoRow) {
  const r = use_restore(npo_id, removed);
  const ref = useRef<HTMLButtonElement>(null);
  const refusal_ref = useRef<HTMLParagraphElement>(null);
  const url = disp(removed.url);
  const { settled } = r;

  // the row's own controls went with it; the way back takes the focus they
  // dropped
  useEffect(() => {
    if (focus_dropped()) ref.current?.focus();
  }, []);
  useEffect(() => {
    if (settled) on_settled(removed, settled);
  }, [settled, removed, on_settled]);
  // the refusal replaced the pressed Undo
  useEffect(() => {
    if (removed.refusal && focus_dropped()) refusal_ref.current?.focus();
  }, [removed.refusal]);

  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-sm bg-gray-3">
      <span className="flex-1 min-w-0 break-all">Removed {url}</span>
      {removed.refusal ? (
        <p
          ref={refusal_ref}
          tabIndex={-1}
          className="basis-full text-destructive-subtle-fg"
        >
          {removed.refusal}
        </p>
      ) : (
        <button
          ref={ref}
          type="button"
          aria-label={`Undo removing ${url}`}
          aria-disabled={r.pending}
          aria-busy={r.pending}
          onClick={unless(r.pending, () => {
            on_restore(removed.id);
            r.restore();
          })}
          className="btn btn-ghost btn-sm"
        >
          Undo
        </button>
      )}
    </li>
  );
}

interface ILoadMore {
  ref: Ref<HTMLButtonElement>;
  limit: number;
}

function LoadMore({ ref, limit }: ILoadMore) {
  const [, set_search] = useSearchParams();
  const nav = useNavigation();
  const loading =
    nav.state !== "idle" && !!nav.location?.search.includes(VIDEOS_PAGE);
  return (
    <button
      ref={ref}
      type="button"
      aria-disabled={loading}
      aria-busy={loading}
      onClick={unless(loading, () =>
        set_search(
          (p) => {
            p.set(VIDEOS_PAGE, String(limit + VIDEOS_STEP));
            return p;
          },
          { preventScrollReset: true, replace: true }
        )
      )}
      className="btn btn-ghost btn-sm justify-self-start"
    >
      {loading ? "Loading…" : "Load more videos"}
    </button>
  );
}
