import { beforeEach, describe, expect, test, vi } from "vitest";

const wise = vi.hoisted(() => ({ account_details: vi.fn() }));

vi.mock("../env", () => ({ wise: { profile_id: "45012460" } }));
vi.mock("../kit/wise", () => ({ wise }));

const OURS = [
  {
    id: 1,
    currency: { code: "USD", name: "US Dollar" },
    status: "ACTIVE",
    receiveOptions: [
      {
        type: "LOCAL",
        details: [
          { type: "ACCOUNT_NUMBER", title: "Account", body: "831357910024" },
        ],
      },
    ],
  },
];

const recipient = (accountNumber: string) =>
  ({
    id: 881063184,
    details: { accountNumber },
    displayFields: [],
  }) as never;

// the cache is per module instance: each test gets a fresh one
const load = async () => {
  vi.resetModules();
  return import("./own-accounts");
};

beforeEach(() => {
  wise.account_details.mockReset();
});

describe("is_own_recipient", () => {
  test("reads our profile's account details and matches against them", async () => {
    wise.account_details.mockResolvedValue(OURS);
    const { is_own_recipient } = await load();

    expect(await is_own_recipient(recipient("8313 5791 0024"))).toBe(true);
    expect(await is_own_recipient(recipient("555500001111"))).toBe(false);
    expect(wise.account_details).toHaveBeenCalledTimes(1);
    expect(wise.account_details).toHaveBeenCalledWith("45012460");
  });

  test("a failed lookup rejects, and the next call asks wise again", async () => {
    wise.account_details
      .mockRejectedValueOnce("account-details 503")
      .mockResolvedValue(OURS);
    const { is_own_recipient } = await load();

    await expect(is_own_recipient(recipient("831357910024"))).rejects.toBe(
      "account-details 503"
    );
    expect(await is_own_recipient(recipient("831357910024"))).toBe(true);
    expect(wise.account_details).toHaveBeenCalledTimes(2);
  });

  test("details older than an hour are read again", async () => {
    vi.useFakeTimers();
    try {
      wise.account_details.mockResolvedValue(OURS);
      const { is_own_recipient } = await load();

      await is_own_recipient(recipient("1"));
      vi.advanceTimersByTime(61 * 60 * 1000);
      await is_own_recipient(recipient("1"));

      expect(wise.account_details).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
