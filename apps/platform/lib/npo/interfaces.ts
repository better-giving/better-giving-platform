import type { OrgDesignation, UnSdgNum } from "../schemas";
import type { IMediaUpdate, TMediaType } from "./schema";

export type {
  DonateMethodId,
  Environment,
  OrgDesignation as EndowDesignation,
  UnSdgNum,
} from "../schemas";

// marketplace card shape — subset of npo row + converted target + view-derived contributions
export interface INpoItem {
  id: number;
  name: string;
  card_img: string | null;
  logo: string | null;
  /** banner */
  image: string | null;
  tagline: string | null;
  hq_country: string;
  sdgs: UnSdgNum[];
  active_in_countries: string[];
  endow_designation: OrgDesignation;
  registration_number: string;
  kyc_donors_only: boolean;
  published: boolean;
  active: boolean;
  fund_opt_in: boolean;
  // converted from target_number/target_smart XOR columns
  target: "smart" | string | undefined;
  // from v_contributions view JOIN
  contributions_total: number;
  contributions_count: number;
}

export interface INpoWithRegNum {
  id: number;
  name: string;
  hq_country: string;
  registration_number: string;
}

export interface IMedia extends Required<IMediaUpdate> {
  id: string;
  type: Extract<TMediaType, "video">; // only video for now
  date_created: string;
}
export interface INposPage<T extends keyof INpoItem = keyof INpoItem> {
  items: Pick<INpoItem, T>[];
  page: number;
  pages: number;
}
