import { describe, expect, test } from "vitest";
import type { AccountDetails, V2RecipientAccount } from "@/wise";
import { is_own_account } from "./own-account";

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

const recipient = (
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
    const r = recipient({ abartn: "026073150", accountNumber: "831357910024" });
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("a recipient whose account number is someone else's is not ours", () => {
    const r = recipient({ abartn: "026073150", accountNumber: "555500001111" });
    expect(is_own_account(r, OWN)).toBe(false);
  });

  test("an IBAN compares ignoring spaces and case", () => {
    const r = recipient(
      { iban: "be12345678901234" },
      { currency: "EUR", type: "Iban" }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("the account number field wise names in commonFieldMap is compared", () => {
    const r = recipient(
      { bankgiroNumber: "8313-5791-0024" },
      { commonFieldMap: { accountNumberField: "bankgiroNumber" } }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("an account number shown only in displayFields is compared", () => {
    const r = recipient(
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
    const r = recipient(
      { accountNumber: "555500001111" },
      { ownedByCustomer: true }
    );
    expect(is_own_account(r, OWN)).toBe(true);
  });

  test("a routing number shared with our bank alone does not make it ours", () => {
    const r = recipient({ abartn: "026073150", accountNumber: "1" });
    expect(is_own_account(r, OWN)).toBe(false);
  });
});
