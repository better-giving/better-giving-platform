// home faq copy is final per design handoff — distinct from #/pages/@sections/faq data
const home_faq = (id: number, question: string, answer: string) => ({
  id,
  question,
  answer,
  paragraphs: [<p key={0}>{answer}</p>],
});

export const home_faqs = [
  home_faq(
    0,
    "Is Better Giving really free? How do you sustain operations?",
    "Yes, all features included. The optional donor contribution is on the form by default and is not pre-selected. There is no platform fee while that ask stays on. Turning the ask off is a 1.5% fee. Fiscal sponsorship is 2.9% of each sponsored gift. There are no gated features."
  ),
  home_faq(
    1,
    "What types of donations can I accept?",
    "Card, bank/ACH, PayPal, Apple Pay and Google Pay, stock, donor-advised funds (DAF), IRA/QCD, and crypto. All in one embeddable form."
  ),
  home_faq(
    2,
    "How quickly can I start fundraising?",
    "Register online. Embedding the form on your site is a copy-paste snippet. Grants and savings withdrawals are paid out every 3 days once your balance reaches your payout minimum."
  ),
  home_faq(
    3,
    "Do I keep my donor data (and my donors) if I leave?",
    "Yes. You receive full donor-level data, exportable anytime (CSV and API) at no charge. And under our Recurring-Donor Portability Guarantee, if you ever switch providers we actively help migrate your recurring donors. No exit fees, no fine print."
  ),
  home_faq(
    4,
    'What does "open source" mean for my nonprofit?',
    "Our code is public, so you can read exactly how donations are handled instead of taking our word for it. Nonprofits use the managed platform."
  ),
];
