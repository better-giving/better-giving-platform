export interface DisplayField {
  key: string;
  label: string;
  value: string;
}

export interface Name {
  fullName: string;
}

/** https://docs.wise.com/api-reference/recipient/recipientget */
export interface V2RecipientAccount {
  id: number;
  /** `fullName` is the account holder: v1's `accountHolderName` */
  name: Name;
  accountNumber?: number;
  longAccountSummary: string;
  displayFields: DisplayField[];
  address?: Record<string, any>;
  details: Record<string, any>;
  currency: string;
  country: string; //country code
  type: string;
  legalEntityType: "PERSON" | "BUSINESS";
  /** which `details` keys hold the account number and the bank code */
  commonFieldMap?: { accountNumberField?: string; bankCodeField?: string };
  /** the recipient is the profile owner's own account */
  ownedByCustomer?: boolean;
}

/** one currency's account details on our own profile
 * @link https://docs.wise.com/api-reference/bank-account-details/bankaccountdetailsget */
export interface AccountDetails {
  /** null for preview details not yet issued */
  id: number | null;
  currency: { code: string; name: string };
  status: "AVAILABLE" | "ACTIVE";
  receiveOptions: {
    type: "LOCAL" | "INTERNATIONAL";
    /** varies by currency: ACCOUNT_NUMBER, IBAN, ROUTING_NUMBER, SWIFT_CODE, ... */
    details: { type: string; title: string; body: string }[];
  }[];
}

export interface Config {
  apiToken: string;
  /** `WISE_API_URL` — the same host the browser proxy resolves; never derive
   * it from stage, or the two ends of the app pair one token with different
   * wise environments. */
  base_url: string;
}

/** https://docs.wise.com/api-docs/api-reference/balance#get */
export interface Balance {
  id: number;
  /** 3 letter iso - uppercase */
  currency: string;
  totalWorth: { value: number };
}

namespace Req {
  /** @link https://docs.wise.com/api-docs/api-reference/quote#create */
  export interface Quote {
    sourceCurrency: "USD";
    targetCurrency: string;
    sourceAmount: number;
    targetAmount: null;
    payOut: null;
    /** without it wise prices the fee for a bank transfer, and funding from
     * the balance then debits a different total than the quote */
    preferredPayIn: "BALANCE";
    targetAccount: string;
  }

  /** @link https://docs.wise.com/api-docs/api-reference/transfer#create */
  export interface Transfer {
    targetAccount: string;
    quoteUuid: string;
    /** in uuid format */
    customerTransactionId: string;
    details: {
      transferPurpose: "verification.transfers.purpose.other";
      sourceOfFunds: "verification.source.of.funds.other";
    };
  }

  /** @link https://docs.wise.com/api-docs/api-reference/transfer#fund */
  export interface Fund {
    type: "BALANCE";
  }
}

namespace Res {
  /**
   * Quote.id is in UUID format
   * @link https://docs.wise.com/api-docs/api-reference/quote#object
   */
  export interface Quote {
    id: string;
    /** for a quote fixed on the source side: what is debited, fee included */
    sourceAmount: number;
    sourceCurrency: string;
    payOut: string;
    paymentOptions: PaymentOption[];
  }

  /** @link https://docs.wise.com/api-reference/quote/quoteget */
  export interface PaymentOption {
    disabled: boolean;
    payIn: string;
    payOut: string;
    sourceAmount: number;
    fee: { total: number };
  }

  /**
   * Transfer.id is an integer
   * @link https://docs.wise.com/api-docs/api-reference/transfer#object
   */
  export interface Transfer {
    id: number;
    /**
     * `incoming_payment_waiting` until funded; then `incoming_payment_initiated`,
     * `processing`, `funds_converted`, `outgoing_payment_sent`, or one of
     * `cancelled`, `funds_refunded`, `bounced_back`, `charged_back`, `unknown`
     * @link https://docs.wise.com/api-docs/api-reference/transfer#object
     */
    status?: string;
    /** the amount sent: the quote's source amount less its fee */
    sourceValue?: number;
    sourceCurrency?: string;
    /** Optional but present when a transfer error occurs */
    errors?: any;
  }

  /** @link https://docs.wise.com/api-docs/api-reference/transfer#fund */
  export interface Fund {
    status: "COMPLETED" | "REJECTED";
    errorCode?: string;
  }
}

// bounds every call: a hung one otherwise holds its caller until the function is killed
const TIMEOUT_MS = 30_000;

export class Wise {
  headers: Record<string, string>;
  base_url: string;
  config: Config;

  constructor(config: Config) {
    this.config = config;
    this.headers = {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiToken}`,
    };
    this.base_url = config.base_url;
  }

  private async to_json<T = unknown>(res: Response): Promise<T> {
    if (!res.ok) throw await res.text();
    return res.json() as T;
  }

  async v2_account(id: number): Promise<V2RecipientAccount> {
    const res = await fetch(`${this.base_url}/v2/accounts/${id}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.to_json(res);
  }

  async balance(id: number, profile_id: number): Promise<Balance> {
    const res = await fetch(
      `${this.base_url}/v4/profiles/${profile_id}/balances/${id}`,
      { headers: this.headers, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    return this.to_json(res);
  }

  async quote(profile_id: string, payload: Req.Quote): Promise<Res.Quote> {
    const url = `${this.base_url}/v3/profiles/${profile_id}/quotes`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await res.text();
    return this.to_json(res);
  }

  async transfer(payload: Req.Transfer): Promise<Res.Transfer> {
    const url = `${this.base_url}/v1/transfers`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await res.text();
    return this.to_json(res);
  }

  /** only an `incoming_payment_waiting` transfer can be cancelled
   * @link https://docs.wise.com/api-reference/transfer/transfercancel */
  async cancel_transfer(transfer_id: number): Promise<Res.Transfer> {
    const url = `${this.base_url}/v1/transfers/${transfer_id}/cancel`;
    const res = await fetch(url, {
      method: "PUT",
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.to_json(res);
  }

  /** the receiving details of the profile's own balances */
  async account_details(profile_id: string): Promise<AccountDetails[]> {
    const url = `${this.base_url}/v1/profiles/${profile_id}/account-details`;
    const res = await fetch(url, {
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.to_json(res);
  }

  async fund_transfer(
    transfer_id: number,
    profile_id: number,
    payload: Req.Fund
  ): Promise<Res.Fund> {
    const url = `${this.base_url}/v3/profiles/${profile_id}/transfers/${transfer_id}/payments`;
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await res.text();
    return this.to_json(res);
  }

  /** @link https://docs.wise.com/api-reference/transfer (get by id) */
  async transfer_get(id: number): Promise<Res.Transfer> {
    const res = await fetch(`${this.base_url}/v1/transfers/${id}`, {
      headers: this.headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return this.to_json(res);
  }
}
