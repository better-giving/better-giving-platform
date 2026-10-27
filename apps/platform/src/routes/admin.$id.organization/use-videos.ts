import { useCallback, useEffect, useRef, useState } from "react";
import { href, useFetcher, useRevalidator } from "react-router";
import { safeParse } from "valibot";
import type { action } from "#/routes/admin.$id.organization.videos/route";
import { schema } from "#/routes/admin.$id.organization.videos/schema";
import type { IMedia } from "@/npo";

type VideoFields = Record<string, string>;

const videos_url = (npo_id: number) =>
  href("/admin/:id/organization/videos", { id: String(npo_id) });

/** the link's first problem, or undefined when the action would take it */
export const url_issue = (url: string) =>
  safeParse(schema, { url: url.trim() }).issues?.[0].message;

/** one control site's writes to a video. its spot on the page and its row in
 * the list hold separate requests, so a press on one never answers the
 * other's open link editor */
export function use_video(npo_id: number, mid: string, at: "spot" | "row") {
  const f = useFetcher<typeof action>({ key: `video-${at}-${mid}` });
  const { revalidate } = useRevalidator();
  const [refusal, set_refusal] = useState<string>();

  useEffect(() => {
    if (!f.data || !("error" in f.data)) return;
    set_refusal(f.data.error);
    // a refusal means this screen is behind the server: a 4xx answer skips
    // the revalidation a write gets, so ask for it
    revalidate();
  }, [f.data, revalidate]);

  const submit = (fields: VideoFields) => {
    set_refusal(undefined);
    return f.submit(
      { ...fields, mediaId: mid },
      { method: "POST", action: videos_url(npo_id) }
    );
  };

  return {
    pending: f.state !== "idle",
    answer: f.data,
    refusal,
    submit,
  };
}

/** a link typed into a box, checked by the action's own schema on submit and
 * on every change after a refused one */
export function use_link_input(init = "") {
  const [value, set_value] = useState(init);
  const [tried, set_tried] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const error = tried ? url_issue(value) : undefined;

  /** the link to send, or undefined after focusing the refused box */
  const take = () => {
    set_tried(true);
    if (url_issue(value)) {
      ref.current?.focus();
      return;
    }
    return value.trim();
  };
  const reset = useCallback(() => {
    set_value("");
    set_tried(false);
  }, []);
  return { value, set_value, error, take, reset, ref };
}

/** the inline add */
export function use_add_video(npo_id: number) {
  const f = useFetcher<typeof action>({ key: "video-add" });
  const input = use_link_input();
  const { reset } = input;

  useEffect(() => {
    if (f.data && "ok" in f.data) reset();
  }, [f.data, reset]);

  const add = () => {
    if (f.state !== "idle") return;
    const url = input.take();
    if (!url) return;
    f.submit(
      { intent: "add", url },
      { method: "POST", action: videos_url(npo_id) }
    );
  };
  const server_error =
    f.data && "errors" in f.data ? f.data.errors.url : undefined;
  return {
    ...input,
    error: input.error ?? server_error,
    pending: f.state !== "idle",
    add,
  };
}

export interface IRemoved
  extends Pick<IMedia, "id" | "url" | "featured" | "date_created"> {}

/** a deleted link sent back as it was */
export function use_restore(npo_id: number, removed: IRemoved) {
  const f = useFetcher<typeof action>({ key: `video-restore-${removed.id}` });
  const restore = () => {
    if (f.state !== "idle") return;
    f.submit(
      {
        intent: "restore",
        url: removed.url,
        featured: removed.featured ? "1" : "0",
        // a row stored without one sends ""
        date_created: removed.date_created ?? "",
      },
      { method: "POST", action: videos_url(npo_id) }
    );
  };
  return { pending: f.state !== "idle", answer: f.data, restore };
}
