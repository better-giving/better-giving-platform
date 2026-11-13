import { socials } from "@better-giving/brand";
import { render } from "react-email";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { IReg } from "@/reg/schema";

const send_email = vi.hoisted(() =>
  vi.fn(async (_i: { node: any; to: string[]; subject: string }) => ({
    data: { id: "email-1" },
  }))
);
const report_error = vi.hoisted(() => vi.fn());
const send_alert = vi.hoisted(() => vi.fn());
const stripe_env = vi.hoisted(() => ({ connect_routing: true }));
const v2_account = vi.hoisted(() => vi.fn());

vi.mock("$/email", () => ({ send_email, send_email_or_throw: vi.fn() }));
vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("$/env", () => ({
  base_url: "http://x",
  hubspot: { owner_id: "1" },
  stripe: stripe_env,
}));
vi.mock("$/kit/slack", () => ({ bg_sales: { send_alert } }));
vi.mock("$/kit/wise", () => ({ wise: { v2_account } }));
vi.mock("#/.server/auth/auth", () => ({ auth: {} }));
vi.mock("#/.server/auth/resume-link", () => ({ mint_resume_link: vi.fn() }));
vi.mock("$/pg/queries/registration", () => ({ reg_get: vi.fn() }));
vi.mock("./hubspot", () => ({
  create_deal: vi.fn(),
  update_or_create_company: vi.fn(async () => ({ id: "c" })),
  update_or_create_contact: vi.fn(async () => ({ id: "c" })),
}));

const { handle_reg_updated } = await import(".");
const { create_deal, update_or_create_company, update_or_create_contact } =
  await import("./hubspot");

const reg = (o: Partial<IReg>) =>
  ({
    id: "reg-1",
    r_id: "ada@test.com",
    env: "test",
    r_first_name: "",
    o_name: "",
    ...o,
  }) as unknown as IReg;

const sent = async () => {
  const { node, subject } = send_email.mock.calls[0]![0];
  return { subject, text: await render(node, { plainText: true }) };
};

beforeEach(() => {
  vi.clearAllMocks();
  stripe_env.connect_routing = true;
});

/** a 501(c)(3) through contact, org and identity, with no bank: only a stripe
 * account can carry it to step 5 */
const stripe_only = (o: Partial<IReg> = {}) =>
  reg({
    r_first_name: "Ada",
    r_last_name: "Lovelace",
    o_name: "Analytical Engines",
    r_org_role: "ceo",
    rm: "other",
    o_website: "https://ae.org",
    o_hq_country: "United States",
    o_designation: "Charity",
    o_type: "501c3",
    o_ein: "12-3456789",
    o_stripe_account_id: "acct_1",
    ...o,
  });

describe("registration status mails", () => {
  test("an approval for a blank first and org name greets and names without a placeholder", async () => {
    await handle_reg_updated(reg({ status: "03", status_approved_npo_id: 42 }));

    const { subject, text } = await sent();
    expect(text).toMatch(/Hi there,/);
    expect(`${subject}\n${text}`).not.toMatch(/missing/);
    expect(text).toMatch(/\/profile\/42/);
  });

  test("an approval with a blank org name opens each sentence capitalized", async () => {
    await handle_reg_updated(reg({ status: "03", status_approved_npo_id: 42 }));

    const { subject, text } = await sent();
    expect(subject).toBe(
      "Good news: your organization's account has been created"
    );
    expect(text).toMatch(/approved\. Your organization's account is now live/);
    expect(text).toMatch(
      /You can see your organization's Better Giving page here/
    );
    // a sentence opening lowercase after terminal punctuation
    expect(`${subject}\n${text}`).not.toMatch(/[.!?]\s+your organization/);
  });

  test("an approval with an org name names it", async () => {
    await handle_reg_updated(
      reg({
        status: "03",
        status_approved_npo_id: 42,
        o_name: "Rainforest Fund",
      })
    );

    const { subject, text } = await sent();
    expect(subject).toBe(
      "Good news: the account for Rainforest Fund has been created"
    );
    expect(text).toMatch(/The account for Rainforest Fund is now live\./);
    expect(text).toMatch(
      /You can see the Better Giving page for Rainforest Fund here/
    );
  });

  test("an approval with no nonprofit id carries no profile link and is reported", async () => {
    await handle_reg_updated(reg({ status: "03", r_first_name: "Ada" }));

    const { text } = await sent();
    expect(text).toMatch(/Hi Ada,/);
    expect(text).not.toMatch(/\/profile\//);
    expect(text).not.toMatch(/your Better Giving page is where/);
    expect(text).toMatch(/Log in with your email at \S+\/login/);
    expect(report_error).toHaveBeenCalledOnce();
  });

  test("a rejection for a blank first name greets them as there", async () => {
    await handle_reg_updated(reg({ status: "04" }));

    const { text } = await sent();
    expect(text).toMatch(/Hi there,/);
  });

  test("a rejection links back to the application it asks them to resubmit", async () => {
    await handle_reg_updated(reg({ status: "04" }));

    const { text } = await sent();
    expect(text).toMatch(/http:\/\/x\/register\/reg-1\/1\b/);
  });

  test("a rejection tells them to fix the issues and resubmit, never to start a new application", async () => {
    await handle_reg_updated(reg({ status: "04" }));

    const { text } = await sent();
    expect(text).toMatch(/rectify these issues and resubmit this application/);
    expect(text).not.toMatch(/new application/i);
    expect(text).not.toMatch(/Stripe/);
  });

  test("a rejection with Stripe connected says the account stays on the application they resubmit", async () => {
    await handle_reg_updated(stripe_only({ status: "04" }));

    const { text } = await sent();
    expect(text).toMatch(/rectify these issues and resubmit this application/);
    expect(text).toMatch(
      /Stripe account is still connected to this application/
    );
    expect(text).not.toMatch(/new application/i);
  });

  test("a rejected stripe-only application links back to review while routing is on", async () => {
    await handle_reg_updated(stripe_only({ status: "04" }));

    const { text } = await sent();
    expect(text).toMatch(/http:\/\/x\/register\/reg-1\/5\b/);
  });

  test("a rejected stripe-only application links back to banking while routing is off", async () => {
    stripe_env.connect_routing = false;
    await handle_reg_updated(stripe_only({ status: "04" }));

    const { text } = await sent();
    expect(text).toMatch(/http:\/\/x\/register\/reg-1\/4\b/);
  });

  test("the footer's social links each keep their url whole in the text part", async () => {
    await handle_reg_updated(reg({ status: "04" }));

    const { text } = await sent();
    // a text-only client auto-links a url up to the next whitespace
    const words = text.split(/\s+/);
    for (const url of Object.values(socials)) expect(words).toContain(url);
  });
});

describe("submitted registration", () => {
  test("a refused sales alert still files the deal and updates the contact", async () => {
    const refusal = new Error("slack invalid_auth");
    send_alert.mockRejectedValueOnce(refusal);

    await expect(
      handle_reg_updated(
        reg({
          status: "02",
          r_first_name: "Ada",
          r_last_name: "Lovelace",
          o_name: "Analytical Engines",
          r_org_role: "ceo",
          rm: "other",
        })
      )
    ).resolves.toBeUndefined();

    expect(report_error).toHaveBeenCalledWith(refusal, { reg_id: "reg-1" });
    expect(create_deal).toHaveBeenCalledWith("Analytical Engines");
    expect(update_or_create_contact).toHaveBeenCalledWith(
      "ada@test.com",
      expect.objectContaining({ email: "ada@test.com" })
    );
  });
});

describe("hubspot bank fields", () => {
  const company_of = () =>
    vi.mocked(update_or_create_company).mock.calls[0]![1];

  test("a bank with a statement copies its wise details to the company", async () => {
    v2_account.mockResolvedValueOnce({
      address: { city: "Austin", country: "US" },
      accountNumber: "0012",
      name: { fullName: "Analytical Engines" },
      details: { abartn: "111000025" },
    });

    await handle_reg_updated(
      stripe_only({
        o_stripe_account_id: null,
        o_bank_id: "777",
        o_bank_statement: "https://s/statement.pdf",
      })
    );

    expect(v2_account).toHaveBeenCalledWith(777);
    expect(company_of()).toMatchObject({
      bank_account_number: "0012",
      // the app's link, which asks for sign-in, not the stored reference
      bank_statament: `http://x/api/docs?ref=${encodeURIComponent("https://s/statement.pdf")}`,
    });
  });

  test("a stripe-only application skips wise and syncs the company without bank fields", async () => {
    await handle_reg_updated(stripe_only());

    expect(v2_account).not.toHaveBeenCalled();
    expect(update_or_create_contact).toHaveBeenCalledOnce();
    expect(company_of()).not.toHaveProperty("bank_account_number");
    expect(company_of()).not.toHaveProperty("bank_statament");
  });

  test("a bank id without its statement counts as no bank", async () => {
    await handle_reg_updated(stripe_only({ o_bank_id: "777" }));

    expect(v2_account).not.toHaveBeenCalled();
    expect(company_of()).not.toHaveProperty("bank_statament");
  });
});
