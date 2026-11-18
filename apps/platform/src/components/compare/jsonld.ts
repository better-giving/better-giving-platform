import type { ICompareFaq } from "#/content/compare/types";

/** FAQPage structured data from the same items the page renders, so the
 * questions and answers match the visible text word for word */
export const faq_jsonld = (faq: ICompareFaq[]) => ({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faq.map(({ q, a }) => ({
    "@type": "Question",
    name: q,
    acceptedAnswer: { "@type": "Answer", text: a },
  })),
});
