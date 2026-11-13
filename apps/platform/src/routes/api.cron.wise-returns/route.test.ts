import { beforeEach, describe, expect, test, vi } from "vitest";
import type { TransferState } from "$/payouts/wise-return";

const verify_qstash = vi.hoisted(() => vi.fn());
const poll = vi.hoisted(() => vi.fn(async (_: TransferState) => {}));
const transfer_get = vi.hoisted(() =>
  vi.fn(async (id: number) => ({ id, status: "funds_refunded" }))
);

vi.mock("$/kit/queue", () => ({ verify_qstash }));
vi.mock("$/kit/wise", () => ({ wise: { transfer_get } }));
vi.mock("$/payouts/wise-return", () => ({ poll_wise_returns: poll }));

const { action } = await import("./route");

const deliver = async () =>
  (await action({
    request: new Request("https://bg.test/api/cron/wise-returns", {
      method: "POST",
    }),
  } as any)) as Response;

beforeEach(() => {
  verify_qstash.mockReset();
  poll.mockClear();
  transfer_get.mockClear();
});

describe("api.cron.wise-returns", () => {
  test("a verified tick polls every transfer's state from wise", async () => {
    const res = await deliver();

    expect(res.status).toBe(200);
    expect(verify_qstash).toHaveBeenCalledOnce();
    const [state_of] = poll.mock.calls[0]!;
    expect(await state_of(2449407370)).toBe("funds_refunded");
    expect(transfer_get).toHaveBeenCalledWith(2449407370);
  });

  test("a tick qstash did not sign polls nothing", async () => {
    verify_qstash.mockRejectedValueOnce(new Response(null, { status: 401 }));

    await expect(deliver()).rejects.toBeInstanceOf(Response);
    expect(poll).not.toHaveBeenCalled();
  });

  test("a transfer wise answers without a state is not taken for a change", async () => {
    transfer_get.mockResolvedValueOnce({ id: 1 } as never);
    await deliver();
    const [state_of] = poll.mock.calls[0]!;

    await expect(state_of(1)).rejects.toThrow(/no status/);
  });
});
