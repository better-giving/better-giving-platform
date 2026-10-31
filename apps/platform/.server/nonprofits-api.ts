import { report_error } from "#/errors/report";
import { app } from "./env";

/** public IRS directory. not configurable: every caller shares this host. */
export const NONPROFITS_API_ORIGIN = "https://nonprofits.better.giving";

const SEARCH_TTL_MS = 6 * 60 * 60 * 1000;
const ORG_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_CACHE = 500;
const TIMEOUT_MS = 2500;
const DEFAULT_RETRY_S = 60;

export type TFlag = true | false | null;

export interface INonprofitOrg {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  is501c3: TFlag;
  deductible: TFlag;
  revoked: TFlag;
}

export type TNonprofitsFailure =
  | "not_found"
  | "invalid_query"
  | "rate_limited"
  | "unavailable"
  | "disabled";

export type TNonprofitsSearch =
  | { status: "ok"; orgs: INonprofitOrg[] }
  | { status: TNonprofitsFailure };

export type TNonprofitsOrg =
  | { status: "ok"; org: INonprofitOrg }
  | { status: TNonprofitsFailure };

interface ICacheEntry {
  status: "ok" | "not_found";
  orgs?: INonprofitOrg[];
  org?: INonprofitOrg;
  exp: number;
}

const cache = new Map<string, ICacheEntry>();
let cooldown_until = 0;
let auth_reported = false;

const ABORTED = Symbol("nonprofits-flight-aborted");

interface IFlight {
  promise: Promise<unknown>;
  resolve: (value: unknown) => void;
  started: boolean;
}

/** one shared request per cache key. the caller that claims it is the only one that fetches. */
const flights = new Map<string, IFlight>();

/** tests drop the process-local cache, cooldown, and the one-time auth report */
export function reset_nonprofits_client(): void {
  for (const flight of flights.values()) {
    if (!flight.started) flight.resolve(ABORTED);
  }
  flights.clear();
  cache.clear();
  cooldown_until = 0;
  auth_reported = false;
}

function api_key(): string | undefined {
  const key = app.nonprofits_api_key?.trim();
  return key || undefined;
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

export function nonprofits_query_key(q: string): string {
  return `q:${q.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function org_cache_key(ein: string): string {
  return `e:${digits(ein)}`;
}

function cache_key(kind: "search" | "org", raw: string): string {
  return kind === "search" ? nonprofits_query_key(raw) : org_cache_key(raw);
}

function claim_flight(key: string): IFlight {
  const existing = flights.get(key);
  if (existing) return existing;
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((res) => {
    resolve = res;
  });
  const flight: IFlight = { promise, resolve, started: false };
  flights.set(key, flight);
  return flight;
}

function in_cooldown(): boolean {
  return Date.now() < cooldown_until;
}

function cache_get(key: string): ICacheEntry | undefined {
  const hit = cache.get(key);
  if (!hit) return;
  if (Date.now() >= hit.exp) {
    cache.delete(key);
    return;
  }
  return hit;
}

function cache_set(key: string, entry: Omit<ICacheEntry, "exp">, ttl: number) {
  if (cache.has(key)) cache.delete(key);
  if (cache.size >= MAX_CACHE) {
    const now = Date.now();
    for (const [cached, value] of cache) {
      if (now >= value.exp) cache.delete(cached);
    }
  }
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { ...entry, exp: Date.now() + ttl });
}

/** whether a lookup now would reach the api, claiming nothing. cache hits, an
 * in-flight request, an active cooldown, and a missing api key would not. */
export function nonprofits_needs_fetch(
  kind: "search" | "org",
  raw: string
): boolean {
  if (!api_key() || in_cooldown()) return false;
  const key = cache_key(kind, raw);
  return !cache_get(key) && !flights.has(key);
}

/** true only when this caller claims the fetch, which holds the key until the
 * lookup runs. check and claim are one synchronous step, so a caller that has
 * awaited since `nonprofits_needs_fetch` claims here rather than trusting that
 * answer. */
export function nonprofits_will_fetch(
  kind: "search" | "org",
  raw: string
): boolean {
  if (!nonprofits_needs_fetch(kind, raw)) return false;
  claim_flight(cache_key(kind, raw));
  return true;
}

async function share<T>(
  key: string,
  run: () => Promise<T>,
  aborted: T
): Promise<T> {
  const flight = claim_flight(key);
  if (flight.started) {
    const result = await flight.promise;
    return result === ABORTED ? aborted : (result as T);
  }
  flight.started = true;
  try {
    const result = await run();
    flight.resolve(result);
    return result;
  } catch {
    flight.resolve(ABORTED);
    return aborted;
  } finally {
    if (flights.get(key) === flight) flights.delete(key);
  }
}

function next_utc_midnight(now = Date.now()): number {
  const day = new Date(now);
  return Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate() + 1
  );
}

function retry_after_ms(res: Response): number {
  const raw = res.headers.get("retry-after");
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return DEFAULT_RETRY_S * 1000;
  return seconds * 1000;
}

function problem_code(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

async function read_json(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return undefined;
  }
}

function note_auth(code: string): void {
  if (auth_reported) return;
  auth_reported = true;
  report_error(new Error("nonprofits api rejected the key"), { code });
}

function arm_cooldown(res: Response, body: unknown): void {
  const code = problem_code(body);
  const until =
    code === "daily_quota_exceeded" || code === "service_daily_limit_reached"
      ? next_utc_midnight()
      : Date.now() + retry_after_ms(res);
  if (until > cooldown_until) cooldown_until = until;
}

const flag = (value: unknown): TFlag | undefined =>
  value === true || value === false || value === null ? value : undefined;

function org_from(
  row: Record<string, unknown>,
  city: string | null,
  state: string | null
): INonprofitOrg | undefined {
  const ein = typeof row.ein === "string" ? digits(row.ein) : "";
  if (ein.length !== 9) return;
  if (typeof row.name !== "string" || row.name.length === 0) return;
  const is501c3 = flag(row.is501c3);
  const deductible = flag(row.deductible);
  const revoked = flag(row.revoked);
  if (
    is501c3 === undefined ||
    deductible === undefined ||
    revoked === undefined
  ) {
    return;
  }
  return { ein, name: row.name, city, state, is501c3, deductible, revoked };
}

function as_record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return;
  return value as Record<string, unknown>;
}

function parse_search_org(value: unknown): INonprofitOrg | undefined {
  const row = as_record(value);
  if (!row) return;
  const city = typeof row.city === "string" ? row.city : null;
  const state = typeof row.state === "string" ? row.state : null;
  return org_from(row, city, state);
}

function parse_detail(value: unknown): INonprofitOrg | undefined {
  const row = as_record(value);
  if (!row) return;
  const address = as_record(row.address);
  const city =
    address && typeof address.city === "string" ? address.city : null;
  const state =
    address && typeof address.state === "string" ? address.state : null;
  return org_from(row, city, state);
}

function parse_search(body: unknown): INonprofitOrg[] | undefined {
  const row = as_record(body);
  if (!row || !Array.isArray(row.results)) return;
  const orgs: INonprofitOrg[] = [];
  for (const item of row.results) {
    const org = parse_search_org(item);
    if (!org) return;
    orgs.push(org);
  }
  return orgs;
}

type TFetched =
  | { kind: "json"; body: unknown }
  | { kind: "not_found" }
  | { kind: "invalid_query" }
  | { kind: "rate_limited" }
  | { kind: "unavailable" }
  | { kind: "disabled" };

async function call_api(path: string): Promise<TFetched> {
  const key = api_key();
  if (!key) return { kind: "disabled" };
  if (in_cooldown()) return { kind: "rate_limited" };
  let res: Response;
  try {
    // manual: a redirect must not carry the bearer token to another host
    res = await fetch(`${NONPROFITS_API_ORIGIN}${path}`, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${key}`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (res.status >= 300 && res.status < 400) return { kind: "unavailable" };
  if (res.status === 429) {
    arm_cooldown(res, await read_json(res));
    return { kind: "rate_limited" };
  }
  if (res.status === 401) {
    note_auth(problem_code(await read_json(res)) ?? "invalid_api_key");
    return { kind: "unavailable" };
  }
  if (res.status === 404) return { kind: "not_found" };
  if (res.status === 400) {
    const code = problem_code(await read_json(res));
    if (
      code === "invalid_query" ||
      code === "invalid_ein" ||
      code === "invalid_limit"
    ) {
      return { kind: "invalid_query" };
    }
    return { kind: "unavailable" };
  }
  if (res.status !== 200) return { kind: "unavailable" };
  const body = await read_json(res);
  if (body === undefined) return { kind: "unavailable" };
  return { kind: "json", body };
}

function cached_search(key: string): TNonprofitsSearch | undefined {
  const hit = cache_get(key);
  if (!hit) return;
  if (hit.status === "not_found") return { status: "not_found" };
  return { status: "ok", orgs: hit.orgs ?? [] };
}

function cached_org(key: string): TNonprofitsOrg | undefined {
  const hit = cache_get(key);
  if (!hit) return;
  if (hit.status === "not_found" || !hit.org) return { status: "not_found" };
  return { status: "ok", org: hit.org };
}

async function fetch_search(
  q: string,
  key: string
): Promise<TNonprofitsSearch> {
  const params = new URLSearchParams({ q, limit: "10" });
  const fetched = await call_api(`/v1/search?${params}`);
  if (fetched.kind === "json") {
    const orgs = parse_search(fetched.body);
    if (!orgs) return { status: "unavailable" };
    cache_set(key, { status: "ok", orgs }, SEARCH_TTL_MS);
    return { status: "ok", orgs };
  }
  if (fetched.kind === "not_found") {
    cache_set(key, { status: "not_found" }, SEARCH_TTL_MS);
    return { status: "not_found" };
  }
  return { status: fetched.kind };
}

async function fetch_org(
  normalized: string,
  key: string
): Promise<TNonprofitsOrg> {
  const fetched = await call_api(`/v1/orgs/${normalized}`);
  if (fetched.kind === "json") {
    const org = parse_detail(fetched.body);
    if (!org) return { status: "unavailable" };
    cache_set(key, { status: "ok", org }, ORG_TTL_MS);
    return { status: "ok", org };
  }
  if (fetched.kind === "not_found") {
    cache_set(key, { status: "not_found" }, ORG_TTL_MS);
    return { status: "not_found" };
  }
  return { status: fetched.kind };
}

export async function nonprofits_search(q: string): Promise<TNonprofitsSearch> {
  if (!api_key()) return { status: "disabled" };
  const key = nonprofits_query_key(q);
  const cached = cached_search(key);
  if (cached) return cached;
  if (!flights.has(key) && in_cooldown()) return { status: "rate_limited" };
  return share(key, () => fetch_search(q, key), { status: "unavailable" });
}

export async function nonprofits_org(ein: string): Promise<TNonprofitsOrg> {
  if (!api_key()) return { status: "disabled" };
  const normalized = digits(ein);
  const key = org_cache_key(normalized);
  const cached = cached_org(key);
  if (cached) return cached;
  if (!flights.has(key) && in_cooldown()) return { status: "rate_limited" };
  return share(key, () => fetch_org(normalized, key), {
    status: "unavailable",
  });
}
