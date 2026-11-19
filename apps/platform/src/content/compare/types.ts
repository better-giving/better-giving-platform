export interface ICompareSource {
  id: string;
  url: string;
  title: string;
}

export interface ICompareRow {
  feature: string;
  better_giving: string;
  better_giving_sources: string[];
  competitor: string;
  competitor_sources: string[];
  /** the twelve rows every page shows first; the rest sit under "More on" */
  core: boolean;
}

export interface ICompareFaq {
  q: string;
  a: string;
}

export interface ICompareSection {
  h2: string;
  text: string;
}

export interface IComparePage {
  slug: string;
  competitor: string;
  seo_title: string;
  meta_description: string;
  eyebrow: string;
  h1: string;
  intro_p1: string;
  intro_p2: string;
  rows: ICompareRow[];
  who_each_suits: string;
  h2: { table: string; suits: string; faq: string; cta: string };
  sections: ICompareSection[];
  faq: ICompareFaq[];
  cta: { label: string; href: string };
  sources: ICompareSource[];
  /** YYYY-MM-DD */
  last_verified: string;
}

export interface ICompareIncludeItem {
  h3: string;
  text: string;
  sources: ICompareSource[];
}

export interface ICompareIndex {
  seo_title: string;
  meta_description: string;
  includes: ICompareIncludeItem[];
  switching_steps: ICompareIncludeItem[];
  faq: ICompareFaq[];
  cards: { slug: string; competitor: string; blurb: string }[];
}

export interface IComparisons {
  /** YYYY-MM-DD */
  generated: string;
  index: ICompareIndex;
  pages: IComparePage[];
}

export interface ICompareChip {
  slug: string;
  competitor: string;
}
