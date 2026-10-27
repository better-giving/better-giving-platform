import { Check, Trash2 } from "lucide-react";
import {
  type KeyboardEvent,
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

export function VideosGroup({ npo_id, videos }: IVideosGroup) {
  const { featured, items, max } = videos;
  const note_id = useId();
  const full_id = useId();
  const full = featured.length >= max;
  const [removed, set_removed] = useState<IRemoved[]>([]);
  const [focus_id, set_focus_id] = useState<string>();

  // a delete press is recorded at the press; its Undo shows once the read no
  // longer has the row, so a refused delete never offers one
  const undoable = removed.filter((r) => !items.some((v) => v.id === r.id));
  const on_remove = useCallback(
    (r: IRemoved) => set_removed((prev) => [...prev, r]),
    []
  );
  const on_restored = useCallback((old_id: string, new_id?: string) => {
    set_removed((prev) => prev.filter((r) => r.id !== old_id));
    set_focus_id(new_id);
  }, []);

  return (
    <fieldset
      id="videos"
      aria-describedby={note_id}
      // scroll-mt clears the sticky app header on a #videos landing
      className="min-w-0 scroll-mt-20"
    >
      {/* the fieldset's first child, or it names nothing */}
      <legend className="label">Videos</legend>
      <p id={note_id} className="mt-0.5 text-sm text-gray-11">
        Changes here apply right away.
      </p>

      <div className="mt-6 grid gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="font-semibold">On your page</p>
          <p className="text-gray-11">
            <b className="font-semibold text-gray-12">{featured.length}</b> of{" "}
            {max} spots used
          </p>
        </div>
        <ol className="grid grid-cols-2 @lg:grid-cols-4 gap-3">
          {Array.from({ length: max }, (_, i) => {
            const v = featured.at(i);
            return v ? (
              <li key={v.id} className="min-w-0">
                <Spot npo_id={npo_id} video={v} n={i + 1} />
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

      <div className="mt-6 grid gap-2">
        <p className="text-sm font-semibold">All videos</p>
        <AddVideo npo_id={npo_id} />
        {items.length + undoable.length === 0 ? (
          <p className="text-sm text-gray-11">No videos yet</p>
        ) : (
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
                on_restored={on_restored}
              />
            ))}
          </ul>
        )}
        {videos.has_more && <LoadMore limit={videos.limit} />}
      </div>
    </fieldset>
  );
}

interface ISpot {
  npo_id: number;
  video: IMedia;
  n: number;
}

function Spot({ npo_id, video, n }: ISpot) {
  const v = use_video(npo_id, video.id);
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
          onClick={unless(v.pending, () =>
            v.submit({ intent: "feature", featured: "1" })
          )}
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
}

function AddVideo({ npo_id }: IAddVideo) {
  const add = use_add_video(npo_id);
  const id = useId();
  const err_id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="label">
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
          aria-describedby={add.error ? err_id : undefined}
          className="field-input flex-1 min-w-0"
        />
        <button
          type="button"
          onClick={add.add}
          aria-disabled={add.pending}
          aria-busy={add.pending}
          className="btn btn-secondary btn-field shrink-0"
        >
          Add<span className="@max-lg:sr-only"> video</span>
        </button>
      </div>
      <p id={err_id} className="field-err empty:hidden">
        {add.error}
      </p>
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
  const v = use_video(npo_id, video.id);
  const url = disp(video.url);
  const err_id = useId();
  const link_ref = useRef<HTMLAnchorElement>(null);
  const edit_ref = useRef<HTMLButtonElement>(null);
  const [editing, set_editing] = useState(false);
  const closed = useRef(false);

  useEffect(() => {
    if (focus) link_ref.current?.focus();
  }, [focus]);
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
            {video.featured ? (
              <span className="flex items-center gap-1.5 text-sm font-semibold text-success-subtle-fg">
                <Check aria-hidden className="icon-md" />
                On page{spot ? ` · spot ${spot}` : ""}
              </span>
            ) : (
              <button
                type="button"
                aria-label={`Show ${url} on page`}
                aria-disabled={show_held}
                aria-busy={v.pending}
                aria-describedby={refusal ? err_id : full ? full_id : undefined}
                onClick={unless(show_held, () =>
                  v.submit({ intent: "feature", featured: "0" })
                )}
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
  removed: IRemoved;
  on_restored: (old_id: string, new_id?: string) => void;
}

function UndoRow({ npo_id, removed, on_restored }: IUndoRow) {
  const r = use_restore(npo_id, removed);
  const ref = useRef<HTMLButtonElement>(null);
  const url = disp(removed.url);

  // the row's own controls went with it; the way back takes the focus
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    if (r.answer && "ok" in r.answer) on_restored(removed.id, r.answer.id);
  }, [r.answer, removed.id, on_restored]);

  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm bg-gray-3">
      <span className="flex-1 min-w-0 break-all">Removed {url}</span>
      <button
        ref={ref}
        type="button"
        aria-label={`Undo removing ${url}`}
        aria-disabled={r.pending}
        aria-busy={r.pending}
        onClick={r.restore}
        className="btn btn-ghost btn-sm"
      >
        Undo
      </button>
    </li>
  );
}

interface ILoadMore {
  limit: number;
}

function LoadMore({ limit }: ILoadMore) {
  const [, set_search] = useSearchParams();
  const nav = useNavigation();
  const loading =
    nav.state !== "idle" && !!nav.location?.search.includes(VIDEOS_PAGE);
  return (
    <button
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
