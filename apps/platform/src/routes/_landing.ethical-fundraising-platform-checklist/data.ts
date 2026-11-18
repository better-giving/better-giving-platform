export interface IItem {
  /* persisted in localStorage under the page's `storage_key`; renaming an id silently drops a
     visitor's tick. bump the key's version suffix instead. */
  id: string;
  text: string;
  /** a flag: named in a 2025-26 enforcement action, not merely a principle on paper (the page words it "flashpoint") */
  flag?: boolean;
  /** which action, and what it cost — only where the case is specific */
  note?: string;
}

export interface ISection {
  id: string;
  title: string;
  sub: string;
  items: IItem[];
}

export const sections: ISection[] = [
  {
    id: "consent",
    title: "Nonprofit consent",
    sub: "You, not the platform, decide whether and how your organization appears.",
    items: [
      {
        id: "consent-solicit",
        text: "The platform gets written consent from an authorized representative before soliciting or collecting donations in our name.",
        flag: true,
        note: "This is the exact failure at the center of Alaska's six lawsuits and the 21-state GoFundMe letter.",
      },
      {
        id: "consent-branding",
        text: "It gets written consent before using our logo, branding, images, or messaging, including in ads and promotions.",
        flag: true,
      },
      {
        id: "consent-provided-assets",
        text: "It only uses logos, images, and copy we affirmatively provided, nothing scraped from public sources.",
      },
      {
        id: "consent-removal",
        text: "We can find and remove our organization for free, without registering or agreeing to any terms and conditions first.",
        flag: true,
      },
    ],
  },
  {
    id: "transparency",
    title: "Transparency to donors",
    sub: "A donor can tell, at the moment of giving, where their money goes and what's skimmed off it.",
    items: [
      {
        id: "transparency-legible",
        text: "Key information is clear, legible, and not buried in small print or terms and conditions.",
      },
      {
        id: "transparency-recipient",
        text: "At the point of donation, donors see whether the gift is tax-deductible and the exact name of the receiving organization.",
      },
      {
        id: "transparency-receipt-notice",
        text: "Donors are told when we actually receive the donation.",
      },
      {
        id: "transparency-fees",
        text: "All fees, charges, and “tips” are disclosed at the donation point, in a font at least as large as the rest of the page, so donors see the net amount we receive.",
        flag: true,
        note: "A default “tip” routed to the platform was one of the four harms cited in the multi-state GoFundMe letter.",
      },
      {
        id: "transparency-tip-destination",
        text: "It's clear whether a tip goes to the platform or to us, processing-fee coverage is separated from tips, and tips are never the pre-selected default.",
        flag: true,
      },
      {
        id: "transparency-business-model",
        text: "The platform's business model, including how it earns revenue from fees and tips, is easy for the public to find.",
      },
      {
        id: "transparency-daf",
        text: "It discloses whether it's for-profit or nonprofit, and whether donations pass through a donor-advised fund (DAF), including DAF fees, timing, and any power to redirect gifts.",
        flag: true,
        note: "Undisclosed DAF structure was a specific harm regulators flagged against GoFundMe.",
      },
      {
        id: "transparency-marketing-optout",
        text: "Donors get an easy way to opt out of future marketing.",
      },
    ],
  },
  {
    id: "partnership",
    title: "Partnership",
    sub: "The platform treats you as an equal partner, not a data source.",
    items: [
      {
        id: "partnership-campaign-notice",
        text: "We're told within 7 days of any new campaign raising funds in our name.",
        flag: true,
      },
      {
        id: "partnership-links-out",
        text: "Campaign pages link to our own website.",
      },
      {
        id: "partnership-remittance",
        text: "Donations are transferred within 30 days, and within 5 business days if any donor is in California.",
        flag: true,
        note: "Withholding roughly $500,000 past this window is what drew California's cease-and-desist against Flipcause.",
      },
      {
        id: "partnership-paid-search",
        text: "It does not buy paid search on our name without our consent.",
        flag: true,
        note: "GoFundMe was accused of using search placement to rank its pages above nonprofits' own sites.",
      },
      {
        id: "partnership-donor-data",
        text: "By default it shares donor information with us so we can build long-term relationships, while still allowing donors to give anonymously.",
      },
      {
        id: "partnership-records",
        text: "Campaign records, including donation status, stay available for at least a year, and checks carry a unique campaign ID we can look up.",
      },
      {
        id: "partnership-page-removal",
        text: "We can remove pages without agreeing to terms or handing over sensitive banking details, and unauthorized people can't claim our donations.",
      },
      {
        id: "partnership-profile-control",
        text: "If we register, we can add, edit, and delete our own logo and profile information.",
      },
      {
        id: "partnership-campaign-optout",
        text: "We can opt out of specific platform-led campaigns or individual donations.",
      },
      {
        id: "partnership-public-policies",
        text: "All policies are posted publicly, and we aren't required to waive any of these rights to register.",
      },
      {
        id: "partnership-fraud-reporting",
        text: "There's an easy way to report fraudulent or misleading campaigns, with timely review, a decision, notice to us, and the campaign frozen until it's resolved.",
      },
    ],
  },
  {
    id: "accountability",
    title: "Accountability",
    sub: "The platform answers to nonprofits, donors, the public, and regulators.",
    items: [
      {
        id: "accountability-registration",
        text: "It's registered and in good standing everywhere required, such as California (AB 488) and Hawaii.",
        flag: true,
        note: "Operating unregistered was a core finding in California's action against Flipcause.",
      },
      {
        id: "accountability-solicitation-law",
        text: "It complies with all applicable state charitable-solicitation laws.",
      },
      {
        id: "accountability-liability",
        text: "It supports reasonable accountability measures so bad actors can be held liable under state and federal law.",
      },
      {
        id: "accountability-annual-report",
        text: "It publishes an annual report to donors, nonprofits, and regulators: donations received, amounts redirected or refunded, net dollars to each nonprofit, and all fees collected.",
      },
      {
        id: "accountability-engagement",
        text: "It engages regularly with the nonprofit community and state charity officials.",
      },
    ],
  },
];
