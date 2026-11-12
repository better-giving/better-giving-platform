import { country_code, country_names } from "../constants/countries";
import {
  connect_status,
  type IAccountMirror,
  type IMirrorRow,
  mirror_of,
} from "./readiness";

/**
 * hq countries a US platform can transfer to a full-agreement connected account
 * in, as ISO 3166-1 alpha-2: US, CA, GB, CH and the EEA, less IS (stripe opens
 * icelandic accounts on the recipient agreement only). read 2026-10-13 off
 * docs.stripe.com/connect/account-capabilities.md#cross-border-transfers ("a
 * transfer across unsupported borders returns an error") and
 * docs.stripe.com/payouts.md (the per-country recipient-only flags). from the
 * api, `GET /v1/country_specs/US` → `supported_transfer_countries` — but that
 * list also holds every recipient-agreement destination, so it is a superset
 * of this one and never a drop-in.
 */
export const TRANSFER_COUNTRIES: ReadonlySet<string> = new Set([
  "US",
  "CA",
  "GB",
  "CH",
  "AT",
  "BE",
  "BG",
  "HR",
  "CY",
  "CZ",
  "DK",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "HU",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PL",
  "PT",
  "RO",
  "SK",
  "SI",
  "ES",
  "SE",
  "LI",
  "NO",
]);

/** `TRANSFER_COUNTRIES` in words; eligibility.test.ts fails when the two drift */
export const TRANSFER_COUNTRIES_COPY =
  "the US, Canada, the UK, Switzerland, Liechtenstein, Norway and EU countries";

/** what routing decides on */
export interface IRoutingNpo {
  stripe_account_id: string | null;
  mirror: IAccountMirror;
  /** set once the npo disconnected us from its stripe dashboard */
  deauthorized_at: string | null;
  fiscal_sponsored: boolean;
  /** as `npos.hq_country` stores it: a country name */
  hq_country: string;
}

interface IRoutingRow extends IMirrorRow {
  stripe_account_id: string | null;
  stripe_deauthorized_at: string | null;
  fiscal_sponsored: boolean;
  hq_country: string;
}

export const routing_npo = (row: IRoutingRow): IRoutingNpo => ({
  stripe_account_id: row.stripe_account_id,
  mirror: mirror_of(row),
  deauthorized_at: row.stripe_deauthorized_at,
  fiscal_sponsored: row.fiscal_sponsored,
  hq_country: row.hq_country,
});

const is_ready = (npo: IRoutingNpo) =>
  npo.stripe_account_id !== null &&
  connect_status(npo.mirror, npo.deauthorized_at) === "ready";

/** an hq country as letters only, lowercased, so "United-States" and
 * "united  states" meet the list's spelling and "U.S." its alias */
const squash = (country: string) =>
  country.toLowerCase().replace(/[^\p{L}]/gu, "");

const CODE_BY_SQUASHED_NAME: ReadonlyMap<string, string | undefined> = new Map(
  country_names.map((name) => [squash(name), country_code(name)])
);

/** spellings an npo's stored `hq_country` takes besides the name `countries`
 * uses, keyed by `squash` */
const COUNTRY_ALIASES: Readonly<Record<string, string>> = {
  us: "US",
  usa: "US",
  unitedstatesofamerica: "US",
  uk: "GB",
  gb: "GB",
  britain: "GB",
  greatbritain: "GB",
  unitedkingdomofgreatbritainandnorthernireland: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  northernireland: "GB",
  czechrepublic: "CZ",
  thenetherlands: "NL",
  holland: "NL",
  republicofireland: "IE",
};

/** ISO 3166-1 alpha-2 for an hq country as an npo stored it: the list's name,
 * an alias, or the code itself; undefined when it names none */
export const hq_country_code = (country: string): string | undefined => {
  const squashed = squash(country);
  return (
    COUNTRY_ALIASES[squashed] ??
    CODE_BY_SQUASHED_NAME.get(squashed) ??
    (squashed.length === 2 ? squashed.toUpperCase() : undefined)
  );
};

const in_transfer_set = (country: string) => {
  const code = hq_country_code(country);
  return !!code && TRANSFER_COUNTRIES.has(code);
};

export type TConnectIneligibility =
  | { reason: "fiscal_sponsored" }
  | { reason: "country"; hq_country: string };

/** why `npo` can never route, whatever its stripe account's state; null when
 * nothing rules it out */
export const connect_ineligibility = (npo: {
  fiscal_sponsored: boolean;
  hq_country: string;
}): TConnectIneligibility | null => {
  if (npo.fiscal_sponsored) return { reason: "fiscal_sponsored" };
  if (!in_transfer_set(npo.hq_country)) {
    return { reason: "country", hq_country: npo.hq_country };
  }
  return null;
};

/** whether a card, bank or wallet donation to `npo` routes to its connected account
 * @param routing_on - the `STRIPE_CONNECT_ROUTING` switch */
export const is_routable = (npo: IRoutingNpo, routing_on: boolean) =>
  routing_on && connect_ineligibility(npo) === null && is_ready(npo);
