import { beforeEach, describe, expect, test, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);
const resend = vi.hoisted(() => ({
  result: { status: "none" } as
    | { status: "none" }
    | { status: "resent"; ids: string[] }
    | { status: "held"; reason: string },
}));
const send_alert = vi.hoisted(() => vi.fn());

vi.mock("$/env", () => ({ base_url: "https://bg.test", stage: "test" }));
vi.mock("$/email", () => ({
  send_email_or_throw: vi.fn(async () => {
    calls.push("email");
  }),
}));
vi.mock("$/pg/queries/user", () => ({
  npo_admins: async () => [{ email: "a@bg.test" }],
}));
vi.mock("$/payouts/resend-returned", () => ({
  resend_returned: vi.fn(async (npo_id: number) => {
    calls.push(`resend:${npo_id}`);
    return resend.result;
  }),
}));
vi.mock("$/kit/slack", () => ({ aws_monitor: { send_alert } }));
vi.mock("#/errors/report", () => ({ report_error: vi.fn() }));

const { handle_banking_approved, handle_banking_set_default } = await import(
  "./handle-banking"
);

beforeEach(() => {
  calls.length = 0;
  send_alert.mockReset();
  resend.result = { status: "none" };
});

describe.each([
  ["an approval", handle_banking_approved],
  ["a new default", handle_banking_set_default],
])("%s", (_, handle) => {
  test("sends the npo's returned payouts out again before the email, and tells ops", async () => {
    resend.result = { status: "resent", ids: ["p-1", "p-2"] };

    await handle({ npo_id: 7 });

    expect(calls).toEqual(["resend:7", "email"]);
    expect(send_alert).toHaveBeenCalledOnce();
    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe("Returned payouts re-sent for npo:7");
    expect(alert.fields).toContainEqual({
      name: "payout_ids",
      value: "p-1, p-2",
    });
  });

  test("tells ops when returned payouts stay held", async () => {
    resend.result = {
      status: "held",
      reason: "the default account predates the returned transfer",
    };

    await handle({ npo_id: 7 });

    const [alert] = send_alert.mock.calls[0]!;
    expect(alert.title).toBe("Returned payouts still held for npo:7");
    expect(alert.body).toMatch(/predates the returned transfer/);
  });

  test("an npo with nothing returned is only emailed", async () => {
    await handle({ npo_id: 7 });

    expect(calls).toEqual(["resend:7", "email"]);
    expect(send_alert).not.toHaveBeenCalled();
  });
});
