import type { IPrompt } from "@better-giving/ui";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { error_prompt } from "#/helpers/error-prompt";
import type { EndowmentProfileUpdate } from "#/types/npo";

export type Update = Partial<EndowmentProfileUpdate>;

/** `endowUpdate`'s answer: a refusal the toast already reports carries no
 * `error`; a schema refusal does */
type Result = { ok: true } | { ok: false; error?: string };

interface Flight {
  /** the fetcher's data when this save began — any other object is its answer */
  before: unknown;
  on_saved?: () => void;
}

/** one group's save over its own fetcher. `work` builds the PATCH, or returns
 * undefined to call the save off; `on_saved` runs only on a confirmed write */
export function use_save(
  set_prompt: (p: IPrompt) => void,
  context = "applying Better Giving page changes"
) {
  const fetcher = useFetcher<Result>();
  const flight = useRef<Flight>(undefined);
  // covers the gap before `fetcher.state` leaves idle: `work` can await, and
  // the router commits its state in a transition
  const [held, set_held] = useState(false);

  // settles on the committed render whose data is a new object: submitting and
  // loading renders can batch away, but every action answer decodes to a fresh
  // object, so a repeat of the last refusal still settles
  useEffect(() => {
    const f = flight.current;
    if (!f || fetcher.state !== "idle" || fetcher.data === f.before) return;
    flight.current = undefined;
    set_held(false);
    if (fetcher.data?.ok) return f.on_saved?.();
    if (fetcher.data?.error) {
      set_prompt({ type: "error", children: fetcher.data.error });
    }
  }, [fetcher.state, fetcher.data, set_prompt]);

  const release = () => {
    flight.current = undefined;
    set_held(false);
  };

  const save = async (
    work: () => Update | undefined | Promise<Update | undefined>,
    on_saved?: () => void
  ) => {
    if (flight.current) return;
    flight.current = { before: fetcher.data, on_saved };
    set_held(true);
    try {
      const update = await work();
      if (!update) return release();
      await fetcher.submit(update, {
        method: "PATCH",
        action: ".",
        encType: "application/json",
      });
    } catch (err) {
      release();
      set_prompt(error_prompt(err, { context }));
    }
  };

  return { save, busy: held || fetcher.state !== "idle" };
}
