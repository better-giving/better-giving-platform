import { beforeEach, describe, expect, test, vi } from "vitest";
import type { AccountDetails, V2RecipientAccount } from "@/wise";

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

const { is_own_account } = await import("./own-accounts");

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

/** a profile's USD and EUR account details, shaped as wise lists them */
const OWN: AccountDetails[] = [
  {
    id: 1,
    currency: { code: "USD", name: "US Dollar" },
    status: "ACTIVE",
    receiveOptions: [
      {
        type: "LOCAL",
        details: [
          {
            type: "ACCOUNT_HOLDER",
            title: "Name",
            body: "Altruistic Partners",
          },
          { type: "ROUTING_NUMBER", title: "Routing", body: "026073150" },
          { type: "ACCOUNT_NUMBER", title: "Account", body: "8313 5791 0024" },
          { type: "ACCOUNT_TYPE", title: "Type", body: "Checking" },
        ],
      },
    ],
  },
  {
    id: 2,
    currency: { code: "EUR", name: "Euro" },
    status: "ACTIVE",
    receiveOptions: [
      {
        type: "LOCAL",
        details: [
          { type: "IBAN", title: "IBAN", body: "BE12 3456 7890 1234" },
          { type: "SWIFT_CODE", title: "BIC", body: "TRWIBEB1XXX" },
        ],
      },
    ],
  },
];

const v2_recipient = (
  details: Record<string, unknown>,
  o: Partial<V2RecipientAccount> = {}
): V2RecipientAccount => ({
  id: 881063184,
  name: { fullName: "Some Org" },
  longAccountSummary: "",
  displayFields: [],
  details,
  currency: "USD",
  country: "US",
  type: "Aba",
  legalEntityType: "BUSINESS",
  ...o,
});

describe("is_own_account", () => {
  test("a USD recipient carrying our account number is ours", () => {
    const r = v2_recipient({
      abartn: "026073150",
      accountNumber: "831357910024",
    });
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("a recipient whose account number is someone else's is not ours", () => {
    const r = v2_recipient({
      abartn: "026073150",
      accountNumber: "555500001111",
    });
    expect(is_own_account(r, OWN)).toBe(false);
  });

  test("an IBAN compares ignoring spaces and case", () => {
    const r = v2_recipient(
      { iban: "be12345678901234" },
      { currency: "EUR", type: "Iban" }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("the account number field wise names in commonFieldMap is compared", () => {
    const r = v2_recipient(
      { bankgiroNumber: "8313-5791-0024" },
      { commonFieldMap: { accountNumberField: "bankgiroNumber" } }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("an account number shown only in displayFields is compared", () => {
    const r = v2_recipient(
      {},
      {
        displayFields: [
          {
            key: "details/accountNumber",
            label: "Account number",
            value: "831357910024",
          },
        ],
      }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("a recipient wise marks as owned by the profile owner is ours", () => {
    const r = v2_recipient(
      { accountNumber: "555500001111" },
      { ownedByCustomer: true }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("a routing number shared with our bank alone does not make it ours", () => {
    const r = v2_recipient({ abartn: "026073150", accountNumber: "1" });
    expect(is_own_account(r, OWN)).toBe(false);
  });
});
