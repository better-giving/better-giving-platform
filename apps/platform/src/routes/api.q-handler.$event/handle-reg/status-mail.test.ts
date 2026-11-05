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

vi.mock("$/email", () => ({ send_email, send_email_or_throw: vi.fn() }));
vi.mock("#/errors/report", () => ({ report_error }));
vi.mock("$/env", () => ({
  base_url: "http://x",
  hubspot: { owner_id: "1" },
  stripe: { connect_routing: true },
}));
vi.mock("$/kit/slack", () => ({ bg_sales: { send_alert } }));
vi.mock("$/kit/wise", () => ({ wise: { v2_account: vi.fn() } }));
vi.mock("#/.server/auth/auth", () => ({ auth: {} }));
vi.mock("#/.server/auth/resume-link", () => ({ mint_resume_link: vi.fn() }));
vi.mock("$/pg/queries/registration", () => ({ reg_get: vi.fn() }));
vi.mock("./hubspot", () => ({
  create_deal: vi.fn(),
  update_or_create_company: vi.fn(async () => ({ id: "c" })),
  update_or_create_contact: vi.fn(async () => ({ id: "c" })),
}));

const { handle_reg_updated } = await import(".");
const { create_deal, update_or_create_contact } = await import("./hubspot");

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
    expect(text).toMatch(/You can see your organization's profile here/);
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
    expect(text).toMatch(/You can see the profile for Rainforest Fund here/);
  });

  test("an approval with no nonprofit id carries no profile link and is reported", async () => {
    await handle_reg_updated(reg({ status: "03", r_first_name: "Ada" }));

    const { text } = await sent();
    expect(text).toMatch(/Hi Ada,/);
    expect(text).not.toMatch(/\/profile\//);
    expect(text).not.toMatch(/your profile page/);
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
