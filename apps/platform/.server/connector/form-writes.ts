import { and, eq, sql } from "drizzle-orm";
import * as v from "valibot";
import { report_error } from "#/errors/report";
import type { IForm } from "@/forms/interfaces";
import { to_freq_bools, to_freqs } from "@/helpers/donation";
import {
  type DonateMethodId,
  donate_freq_opts,
  donate_method_id,
  frequency,
  type IIncrement,
  MAX_NUM_INCREMENTS,
  type TFrequency,
} from "@/schemas";
import { form_put } from "../pg/queries/form";
import type { DbOrTx } from "../pg/queries/helpers";
import { npo_get } from "../pg/queries/npo";
import { npo_program_get } from "../pg/queries/program";
import { forms } from "../pg/schema/form";
import { json, open_key } from "./http";
import { with_idempotency } from "./idempotency";
import { AMOUNT, AMOUNT_MSG, usd_amount } from "./money";
import { type FieldError, invalid, not_found, problem } from "./problem";
import { type ConnectorForm, read_form, read_form_state } from "./reads";
import { read_body, same_json, TITLE_MAX } from "./writes";

const WRITABLE = [
  "name",
  "status",
  "suggested_amounts",
  "frequencies",
  "donate_methods",
  "gifts_go_to",
] as const;
type Writable = (typeof WRITABLE)[number];

/** what get_form shows but this action can't move */
const ECHOES = [
  "id",
  "campaign_id",
  "updated_at",
  "minimum",
  "maximum",
  "allowed_origins",
] as const;
/** set by Better Giving, so a new form has none to echo */
const ASSIGNED = ["id", "campaign_id", "updated_at"] as const;

const NOT_SETTABLE = "can't be set through the connector";
// the form's look and where it sends donors after are the editor's alone
const DESIGN_KEY = /redirect|url|accent|color/i;

const missing = (id: string) =>
  not_found(`Form ${id} does not exist for this nonprofit.`);

type Patch = {
  tag?: string;
  status?: "active" | "inactive";
  increments?: IIncrement[];
  freq_opts?: TFrequency[];
  donate_methods?: DonateMethodId[];
  program?: { id: string; name: string } | null;
};

/** the form as it stands, which the body is measured against (`null` for a form not yet made) */
type Current = { form: ConnectorForm; increments: IIncrement[] } | null;

const stale_form = () =>
  problem(409, "stale_read", {
    detail:
      "This form changed after it was read. Read it again with get_form, then send the change against what it shows now.",
  });

function refuse_keys(
  body: Record<string, unknown>,
  allowed: readonly string[],
  issues: FieldError[]
) {
  for (const key of Object.keys(body)) {
    if (allowed.includes(key)) continue;
    issues.push({
      path: key,
      message: DESIGN_KEY.test(key)
        ? NOT_SETTABLE
        : "is not a field on this action",
    });
  }
}

/** true when the body echoes an `updated_at` the form has moved past */
function read_echoes(
  body: Record<string, unknown>,
  shown: ConnectorForm | null,
  issues: FieldError[]
): boolean {
  const blank = { minimum: null, maximum: null, allowed_origins: [] };
  let stale = false;
  for (const key of ECHOES) {
    if (!Object.hasOwn(body, key)) continue;
    if (shown && key === "updated_at" && typeof body[key] === "string") {
      stale = body[key] !== shown.updated_at;
      continue;
    }
    const ok = shown
      ? same_json(body[key], shown[key])
      : !(ASSIGNED as readonly string[]).includes(key) &&
        same_json(body[key], blank[key as keyof typeof blank]);
    if (!ok) issues.push({ path: key, message: NOT_SETTABLE });
  }
  return stale;
}

function read_name(value: unknown, issues: FieldError[]): string | undefined {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length >= 1 && name.length <= TITLE_MAX) return name;
  issues.push({
    path: "name",
    message: `is the form's label, 1 to ${TITLE_MAX} characters`,
  });
}

const STATUS_OF = { live: "active", draft: "inactive" } as const;

function read_status(value: unknown, issues: FieldError[]) {
  if (value === "live" || value === "draft") return STATUS_OF[value];
  issues.push({ path: "status", message: 'is "live" or "draft"' });
}

/** dollars as `increments` store them, keeping the label an amount already
 * carried */
function read_amounts(
  value: unknown,
  kept: IIncrement[],
  issues: FieldError[]
): IIncrement[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_NUM_INCREMENTS) {
    issues.push({
      path: "suggested_amounts",
      message: `is a list of up to ${MAX_NUM_INCREMENTS} amounts`,
    });
    return;
  }
  const before = issues.length;
  const seen = new Set<string>();
  const out: IIncrement[] = [];
  value.forEach((raw: unknown, i) => {
    const at = `suggested_amounts[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      issues.push({ path: at, message: 'is {amount, currency: "USD"}' });
      return;
    }
    const money = raw as Record<string, unknown>;
    for (const key of Object.keys(money)) {
      if (key !== "amount" && key !== "currency") {
        issues.push({
          path: `${at}.${key}`,
          message: "is not a field of an amount",
        });
      }
    }
    const { amount, currency } = money;
    const dollars =
      typeof amount === "string" && AMOUNT.test(amount) ? Number(amount) : 0;
    if (!(dollars > 0)) {
      issues.push({ path: `${at}.amount`, message: AMOUNT_MSG });
    } else if (seen.has(usd_amount(dollars))) {
      issues.push({ path: `${at}.amount`, message: "is listed once" });
    }
    seen.add(usd_amount(dollars));
    if (currency !== "USD") {
      issues.push({ path: `${at}.currency`, message: "is USD" });
    }
    const label = kept.find((k) => Number(k.value) === dollars)?.label ?? "";
    out.push({ value: String(dollars), label });
  });
  return issues.length > before ? undefined : out;
}

/** a non-empty list of `vocab` with no repeats */
function read_list<T extends string>(
  value: unknown,
  path: string,
  vocab: v.GenericSchema<unknown, T>,
  noun: string,
  issues: FieldError[]
): T[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push({ path, message: `is a list of at least one ${noun}` });
    return;
  }
  const before = issues.length;
  value.forEach((item: unknown, i) => {
    if (!v.is(vocab, item)) {
      issues.push({ path: `${path}[${i}]`, message: `is not a known ${noun}` });
    } else if (value.indexOf(item) !== i) {
      issues.push({ path: `${path}[${i}]`, message: "is listed once" });
    }
  });
  return issues.length > before ? undefined : (value as T[]);
}

function read_frequencies(value: unknown, issues: FieldError[]) {
  const list = read_list(value, "frequencies", frequency, "frequency", issues);
  if (!list) return;
  const checked = v.safeParse(donate_freq_opts, list);
  if (!checked.success) {
    issues.push({ path: "frequencies", message: checked.issues[0].message });
    return;
  }
  // stored in the editor's order, which is the order donors see
  return to_freqs(to_freq_bools(checked.output));
}

const PINNED_MSG = "is a program id of this nonprofit";

type GiftsTo = { program_id: string | null } | undefined;

function read_gifts_go_to(value: unknown, issues: FieldError[]): GiftsTo {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push({
      path: "gifts_go_to",
      message:
        'is {mode: "pinned", program_id}, or {mode: "none"} for the general fund',
    });
    return;
  }
  const to = value as Record<string, unknown>;
  const before = issues.length;
  for (const key of Object.keys(to)) {
    if (key !== "mode" && key !== "program_id") {
      issues.push({
        path: `gifts_go_to.${key}`,
        message: "is not a field of gifts_go_to",
      });
    }
  }
  let program_id: string | null = null;
  if (to.mode === "pinned") {
    if (typeof to.program_id === "string" && to.program_id) {
      program_id = to.program_id;
    } else {
      issues.push({ path: "gifts_go_to.program_id", message: PINNED_MSG });
    }
  } else if (to.mode === "none") {
    if (to.program_id != null) {
      issues.push({
        path: "gifts_go_to.program_id",
        message: 'is null or left out when mode is "none"',
      });
    }
  } else {
    issues.push({ path: "gifts_go_to.mode", message: 'is "pinned" or "none"' });
  }
  return issues.length > before ? undefined : { program_id };
}

/** the write the body asks for, leaving out every field that matches what
 * get_form shows; `changed` names those it kept */
async function read_fields(
  body: Record<string, unknown>,
  npo_id: number,
  current: Current,
  issues: FieldError[]
): Promise<{ patch: Patch; changed: Writable[] }> {
  const patch: Patch = {};
  const changed: Writable[] = [];
  const shown = current?.form;
  const has = (key: Writable) => Object.hasOwn(body, key);

  if (has("name")) {
    const name = read_name(body.name, issues);
    if (name !== undefined && name !== shown?.name) {
      patch.tag = name;
      changed.push("name");
    }
  }
  if (has("status")) {
    const status = read_status(body.status, issues);
    if (status && body.status !== shown?.status) {
      patch.status = status;
      changed.push("status");
    }
  }
  if (has("suggested_amounts")) {
    const increments = read_amounts(
      body.suggested_amounts,
      current?.increments ?? [],
      issues
    );
    const amounts = (list: { value: string }[]) =>
      list.map((x) => usd_amount(Number(x.value)));
    if (
      increments &&
      !same_json(
        amounts(increments),
        shown?.suggested_amounts.map((m) => m.amount)
      )
    ) {
      patch.increments = increments;
      changed.push("suggested_amounts");
    }
  }
  if (has("frequencies")) {
    const freqs = read_frequencies(body.frequencies, issues);
    if (
      freqs &&
      !same_json(freqs, shown && to_freqs(to_freq_bools(shown.frequencies)))
    ) {
      patch.freq_opts = freqs;
      changed.push("frequencies");
    }
  }
  if (has("donate_methods")) {
    const methods = read_list(
      body.donate_methods,
      "donate_methods",
      donate_method_id,
      "donate method",
      issues
    );
    if (methods && !same_json(methods, shown?.donate_methods)) {
      patch.donate_methods = methods;
      changed.push("donate_methods");
    }
  }
  if (has("gifts_go_to")) {
    const to = read_gifts_go_to(body.gifts_go_to, issues);
    if (to && to.program_id !== (shown?.gifts_go_to.program_id ?? null)) {
      if (to.program_id === null) patch.program = null;
      else {
        const found = await npo_program_get(to.program_id, npo_id);
        if (found) patch.program = { id: found.id, name: found.title };
        else
          issues.push({ path: "gifts_go_to.program_id", message: PINNED_MSG });
      }
      changed.push("gifts_go_to");
    }
  }
  return { patch, changed };
}

export async function create_form(
  db: DbOrTx,
  request: Request
): Promise<Response> {
  if (request.method !== "POST") return problem(404, "unknown_action");
  const live = await open_key(db, request);
  if (live instanceof Response) return live;
  const insert = () => insert_form(db, live.npo_id, request);
  // the connector sends no key for this action; a direct caller may
  if (!request.headers.has("Idempotency-Key")) return insert();
  return with_idempotency(db, live.id, request, insert);
}

async function insert_form(
  db: DbOrTx,
  npo_id: number,
  request: Request
): Promise<Response> {
  const parsed = await read_body(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;
  const issues: FieldError[] = [];
  refuse_keys(body, [...WRITABLE, ...ECHOES], issues);
  read_echoes(body, null, issues);
  if (!Object.hasOwn(body, "name")) read_name(undefined, issues);
  const { patch } = await read_fields(body, npo_id, null, issues);
  if (issues.length > 0) return invalid(issues);

  const npo = await npo_get(npo_id);
  if (!npo) {
    return problem(500, "write_failed", {
      detail: "The form could not be saved.",
    });
  }
  // the admin create's form, for the org that creates it: the label is the
  // form's own, the name is the recipient donors see
  const form: IForm = {
    id: crypto.randomUUID(),
    date_created: new Date().toISOString(),
    tag: patch.tag!,
    name: npo.name,
    target: "smart",
    owner: String(npo_id),
    recipient_npo_id: npo_id,
    recipient_fund_id: null,
    ltd: 0,
    ltd_count: 0,
    status: patch.status ?? "active",
    increments: patch.increments,
    freq_opts: patch.freq_opts,
    donate_methods: patch.donate_methods,
    program: patch.program ?? undefined,
  };
  try {
    await form_put(form);
  } catch (err) {
    report_error(err, { where: "connector: create_form" });
    return problem(500, "write_failed", {
      detail: "The form could not be saved. Try again.",
    });
  }
  const made = await read_form(db, npo_id, form.id);
  return made ? json(made, 201) : missing(form.id);
}

/** false when the form's status or stored `updated_at` is no longer what the
 * body was measured against: it has gone live or off, or been saved since */
async function write_patch(
  db: DbOrTx,
  npo_id: number,
  id: string,
  read: { status: string | null; updated_at: string | null },
  { program, ...cols }: Patch
): Promise<boolean> {
  const wrote = await db
    .update(forms)
    .set({
      ...cols,
      updated_at: new Date().toISOString(),
      ...(program !== undefined && {
        program_id: program?.id ?? null,
        program_name: program?.name ?? null,
      }),
    })
    .where(
      and(
        eq(forms.id, id),
        eq(forms.owner_npo_id, npo_id),
        sql`${forms.status} IS NOT DISTINCT FROM ${read.status}`,
        sql`${forms.updated_at} IS NOT DISTINCT FROM ${read.updated_at}::timestamptz`
      )
    )
    .returning({ id: forms.id });
  return wrote.length > 0;
}

/** the label is the admin's own; every other field reaches donors */
const DONOR_VISIBLE: readonly Writable[] = WRITABLE.filter((f) => f !== "name");

export async function update_form(
  db: DbOrTx,
  request: Request,
  id: string
): Promise<Response> {
  if (request.method !== "PATCH") return problem(404, "unknown_action");
  const live = await open_key(db, request);
  if (live instanceof Response) return live;
  const npo_id = live.npo_id;
  let current = await read_form_state(db, npo_id, id);
  if (!current) return missing(id);

  const parsed = await read_body(request);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;
  const shape: FieldError[] = [];
  refuse_keys(body, [...WRITABLE, ...ECHOES, "confirm"], shape);
  const confirmed = body.confirm === true;
  if (Object.hasOwn(body, "confirm") && !confirmed) {
    shape.push({ path: "confirm", message: "is true, or left out" });
  }

  // a second pass only when the status moved between the confirm check and the
  // write with no save stamping it; a save in between is a stale read
  for (let pass = 0; pass < 2; pass++) {
    const { shown } = current;
    const issues = [...shape];
    const stale = read_echoes(body, shown, issues);
    const { patch, changed } = await read_fields(
      body,
      npo_id,
      { form: shown, increments: current.increments ?? [] },
      issues
    );
    if (issues.length > 0) return invalid(issues);
    if (stale) return stale_form();
    if (changed.length === 0) return json(shown);

    const held = changed.filter((f) => DONOR_VISIBLE.includes(f));
    if (shown.status === "live" && held.length > 0 && !confirmed) {
      return problem(409, "confirm_required", {
        detail: `This form is live, so donors would see the change to ${held.join(", ")}. Send confirm: true to apply it.`,
      });
    }

    if (await write_patch(db, npo_id, id, current, patch)) {
      const after = await read_form(db, npo_id, id);
      return after ? json(after) : missing(id);
    }
    const measured = current.updated_at;
    current = await read_form_state(db, npo_id, id);
    if (!current) return missing(id);
    if (current.updated_at !== measured) return stale_form();
  }
  return problem(500, "write_failed", {
    detail: "The form kept changing while it was saved. Try again.",
  });
}
