---
name: wise
description: Wise (TransferWise) money movement. Sandbox V2 hosts and credentials, the single `WISE_API_URL` host source, recipient-account lookups behind /api/wise/*, the own-account guard, the payout quote → transfer → fund chain the grants and referrer-commission crons share, and the returns poll that takes a bounced grants run back.
---

# Wise

**Jurisdiction: `apps/platform/`.** Paths below are relative to it.

## Environments

| | host | portal |
|---|---|---|
| production | `api.wise.com` | `wise.com` |
| sandbox **V2** | `api.wise-sandbox.com` | `wise-sandbox.com` |
| sandbox V1 (shut down June 30, 2026) | `api.sandbox.transferwise.tech` | `sandbox.transferwise.tech` |

A V1 sandbox token does not authenticate against V2, and sandbox data created after April 1, 2025 was not migrated: reseed recipients and transfers in V2 by hand. New V2 credentials come from api@wise.com or the delivery contact ([migration guide](https://docs.wise.com/guides/developer/environments/sandbox-v2-migration)).

## One base URL

`WISE_API_URL` is the only source of the host, on both ends:

1. `.server/kit/wise.ts` passes it to `Wise` as `base_url`.
2. `src/routes/api.wise.$.ts:72`, the browser-facing proxy, fetches `${WISE_API_URL}/${path}`.

Moving an environment between sandbox and production is therefore an env-var edit and nothing else, and the token can't end up paired with a host the other end isn't using.

## Env

`WISE_API_TOKEN`, `WISE_API_URL`, `WISE_PROFILE_ID`, `WISE_BALANCE_ID_USD`: declared in `.server/env.ts:191-196`, allowlisted in root `turbo.json:42-45`, documented in `.env.example:55-64`. `.env` holds sandbox credentials; production lives in Vercel (`vercel env pull`). Never pair a token with the other environment's host.

Re-derive the ids after a credential swap:

```bash
curl -s "$WISE_API_URL/v2/profiles" -H "authorization: Bearer $WISE_API_TOKEN" | python3 -m json.tool
curl -s "$WISE_API_URL/v4/profiles/$WISE_PROFILE_ID/balances?types=STANDARD" \
  -H "authorization: Bearer $WISE_API_TOKEN" | python3 -m json.tool
```

## Server surface

`lib/wise.ts` is the whole client: 8 methods over `fetch`. Errors throw the raw response **text**, not a parsed body. Every call rejects with a `TimeoutError` after `TIMEOUT_MS` (30s).

| method | endpoint | called from |
|---|---|---|
| `v2_account(id)` | `GET /v2/accounts/{id}` | `.server/payouts/wise-pay.ts`, `src/pages/platform-admin/banking-applications/api.ts`, `src/routes/admin.$id.banking.new/api.ts`, `src/routes/admin.$id.banking.$bank_id/api.ts`, `src/routes/platform.applications_.$id/api.ts`, `src/routes/platform.applications_.$id.$verdict/npo-new.ts`, `src/routes/api.q-handler.$event/handle-reg/index.ts`, `src/routes/dashboard.referrals/api.ts` |
| `balance(id, profile_id)` | `GET /v4/profiles/{p}/balances/{id}` | `src/routes/api.cron.grants/notif.ts` |
| `quote(profile_id, …)` | `POST /v3/profiles/{p}/quotes` | `.server/payouts/wise-pay.ts` |
| `transfer(…)` | `POST /v1/transfers` | `.server/payouts/wise-pay.ts` |
| `fund_transfer(…)` | `POST /v3/profiles/{p}/transfers/{t}/payments` | `.server/payouts/wise-pay.ts` |
| `cancel_transfer(id)` | `PUT /v1/transfers/{t}/cancel` (only `incoming_payment_waiting`) | `.server/payouts/wise-pay.ts` |
| `transfer_get(id)` | `GET /v1/transfers/{t}` | `src/routes/api.cron.wise-returns/route.ts` |
| `account_details(profile_id)` | `GET /v1/profiles/{p}/account-details` | `.server/payouts/own-accounts.ts` |

`v2_account` returns any recipient under our one profile to whoever asks, so a recipient id proves nothing about who created it. The referral payout form (`src/routes/dashboard.referrals_.payout/api.ts`) only stores an id that arrives with the proxy's `bg_grant` (`src/.server/wise-grant.ts`).

**Own-account guard**: `is_own_recipient` (`.server/payouts/own-accounts.ts`) says a recipient is one of our own Wise balances when Wise marks it `ownedByCustomer`, or when its account number or IBAN matches a detail of our `account_details` (a bank code alone never counts). Our details are cached per instance for an hour; a failed lookup is not cached and rejects. Where it gates, and what a failed lookup does:

| site | own account | failed lookup |
|---|---|---|
| `wise_pay` (both payout crons) | refused, `PayRefused` | refused |
| banking-application approve (`src/pages/platform-admin/banking-applications/api.ts` action) | 409 `OWN_ACCOUNT_REFUSAL` | 409 `OWN_LOOKUP_REFUSAL` |
| registration approval (`src/routes/platform.applications_.$id.$verdict/npo-new.ts`) | 409 `OWN_ACCOUNT_REFUSAL` | 409 `OWN_LOOKUP_REFUSAL` |
| new bank application (`src/routes/admin.$id.banking.new/api.ts`) | 409 | filed anyway; approval and payout check again |
| banking-application review loader | flags `own_account` | flags nothing |

**Payout chain**: `.server/payouts/wise-pay.ts` (`wise_pay`), the one chain both payout crons (grants, referrer commissions) call: `v2_account` → `quote` → `transfer` → `fund_transfer`. Before the quote it refuses a recipient the own-account guard flags. The quote is priced for balance funding (`preferredPayIn: "BALANCE"`; without it Wise prices the fee for a bank transfer and funding from the balance debits a different total than the quote). Its `sourceAmount` must equal the total to the cent, and it must carry an enabled `BALANCE` payment option for its `payOut`; both are checked before any transfer exists. After the transfer, its `sourceValue` plus that option's `fee.total` must equal the total too, or the transfer is `cancel_transfer`ed before funding (a failed cancel is in the refusal's message: cancel it by hand in Wise). Each refusal is a `NotFundedError` whose cause is a `PayRefused`, and the cron alerts ops with its message. `customerTransactionId` is the caller's `ref` and is Wise's idempotency key: reusing a ref returns the original transfer instead of creating a second one, so `wise_pay` reads the returned `status`: it funds only `incoming_payment_waiting`, returns an already-funded transfer as paid without funding it again, throws `NotFundedError` for a `cancelled` one and a plain error (money may have moved) for anything else. `transfer()` resolves with HTTP 200 while carrying `errors`; the call site throws on it. `fund_transfer` returning `status: "REJECTED"` is the insufficient-balance case (`errorCode`), not an exception. `wise_pay` throws `NotFundedError` (`.server/payouts/transfer.ts`) for a failure before `fund_transfer` or a `REJECTED` funding; any other throw means money may have moved. Each cron claims its rows `pending → processing` with the ref stored before paying (`.server/payouts/settle.ts` for grant payouts, `.server/payouts/settle-commissions.ts` for commissions), releases them to `pending` on `NotFundedError`, and leaves any other failure `processing` with an alert for manual reconcile by ref. The ref is `transfer_ref` in `.server/payouts/transfer.ts`, over the amount sent: `payout_total` of the claimed rows, less what the party owes when owed netting is on. A claim the owed balance covers entirely settles with no transfer (`recovered`). The grants notice and eligibility judge the minimum on that same `payout_total`. The ref carries a nonce drawn per claim, so a released set claimed again never meets its earlier, possibly cancelled, transfer.

**Returns**: `src/routes/api.cron.wise-returns/route.ts` (QStash-signed) runs `poll_wise_returns` (`.server/payouts/wise-return.ts`), which reads `transfer_get` for every grants-run settlement whose stored status isn't final (`returned`, `charged_back`) and stores the new state. An open one is read whatever its age (on its way, bounced, awaiting repair; a `cancelled` one for 90 days, or while a payout of it is `processing` or `bounced`), a delivered one (`outgoing_payment_sent`, or the older `settled`) for 90 days. A grants-run payout counts as `settled` only once Wise reports its transfer `outgoing_payment_sent` (`@/payouts/wise-path` holds the state sets). Funding leaves the payouts `processing`, stamped with the transfer in `settled_id` (shown as Sending); the poll moves them `processing` → `settled` on `outgoing_payment_sent`, and `processing`/`settled` → `bounced` on any state off the ordinary path (`bounced_back`, `cancelled`, `charged_back`, unknown), in one transaction with the stored state (`record_state`). `charged_back` is final: its payouts stay `bounced` and the npo held, nothing is credited, and the alert tells ops to resolve it by hand. The backfill job (`jobs/payout-delivery-backfill.ts`) runs after the deploy that migrates, and refuses `--commit` until `type_check` admits `bounced`. A bounced settlement holds the npo (the hold, below); a late `outgoing_payment_sent` moves its payouts back to `settled` and lifts it. Commission payouts keep their own states. Only `funds_refunded` is money back: `return_settlement` moves the run's `processing`, `settled` and `bounced` payouts to `returned`, credits the npo's cash, undoes the run's owed deductions and redoes in-flight loss refunds, all in one transaction under the npo's run lock. It writes nothing and alerts when the recomputed gross disagrees with the ledger, and marks the settlement `awaiting_repair` when which payouts it owns can't be told. Every change of a transfer's state off the ordinary path alerts once; for `bounced_back` and `cancelled` it tells ops to change nothing by hand, since a funded transfer passes through them on the way to `funds_refunded`. The same poll reads commission transfers (`referrer_payouts` with a transfer id; `poll_commission_returns`, `.server/payouts/wise-return-commission.ts`) and stores their state on the row: `funds_refunded` moves the run's `paid` commissions to `returned` (the referrer is owed them again; one whose gift was refunded since goes `refunded_loss` instead, and what the referrer owed for it is credited back), undoes the run's owed deductions and credits back commissions refunded in flight, all under the referrer's `commission_run` lock, and tells ops; `bounced_back` and `cancelled` only alert. The commissions cron re-sends returned commissions (to `pending`), and its claim pays a referrer, on the nonprofit hold's rule (`return_hold_cause`, `.server/payouts/return-hold.ts`, shared with `npo_return_hold`): the payout account is a different recipient from the latest returned payout's `recipient_id` and, for a nonprofit referrer, was approved or made default after it. A held run (`settle_referrer_commissions` answers `held`) claims nothing: commissions earned since stay `pending`, with no error and no alert.

A return **holds** the npo (`npo_return_hold`, `.server/payouts/resend-returned.ts`): its grants don't run while its latest settlement is `returned`, `awaiting_repair` or bounced (a state off the ordinary path with a payout wise bounced, so history such as a manual cancel holds no one, however old the run) unless its default account is a different Wise recipient from the one that transfer paid (`settlements.recipient_id`, stored by the claim, or read off the transfer's `targetAccount` by the poll for older runs, of any age, returned or awaiting repair, and for returned commission payouts) and was approved or made default after the settlement was sent (the hold lifts relative to its send date, `last.date`, not the return: an account approved between send and return lifts it). An edit to the account that bounced lifts nothing, and a returned run whose recipient is not on record holds. The hold keys on the settlement, so refunding or cancelling the returned payouts leaves it held. Grants eligibility skips a held npo (`held`), and `settle_npo_payouts` checks again under the run lock. It returns `recipient_changed` without claiming when a return is on record and the default account is no longer the recipient eligibility resolved; the next run pays the current one. `resend_returned` moves `returned` payouts back to `pending` once the hold clears. It runs on the banking queue event (`src/routes/api.q-handler.$event/handle-banking.ts`) when an account is approved or made default, right after a return commits, and on every poll for each npo still holding `returned` payouts. Approving a held npo's application makes it the default (`as_default: held`), so the run pays the new account.

## Browser surface

`/api/wise/*` (`src/routes/api.wise.$.ts`) proxies the client to Wise under our token so recipient-form requirements stay dynamic. It needs a session (401 otherwise) and forwards only the method and path pairs in its `ALLOWED` list (403 otherwise), because an unlisted path would let any signed-in user drive our whole Wise account. It substitutes `{{profileId}}` in the path and `"{{profileId}}"` in the body, injects the bearer token, and forwards only `accept-minor-version` and `content-type`. On a created recipient (`POST v1/accounts`) it adds `bg_grant`, an HMAC of user and recipient id. The client never sees a token or a profile id.

Consumers: `src/components/bank-details/use-currencies.ts` (`/v1/currencies`), `.../recipient-details/use-requirements.ts` (`/v3/profiles/{{profileId}}/quotes`, `GET` and `POST /v1/quotes/{id}/account-requirements`), `.../recipient-details-form.tsx` (`POST /v1/accounts`, and the `/v1/validators/*` checks Wise names in `validationAsync.url`).

Tests never reach Wise. Every suite whose code imports the kit `vi.mock`s it (`$/kit/wise`, or `../kit/wise` under `.server/payouts/`); the browser suites declare their own MSW handlers for the proxy paths inline. `src/__tests__/wise-handlers.ts` (`wise_handlers`) is imported by nothing. `src/__tests__/wise-proxy-guard.test.ts` covers the proxy's allowlist.

## Rules

1. Confirm which environment a token belongs to before running a write (`transfer`, `fund_transfer`, `POST /v1/accounts`): a production token funds a real payout.
2. Read a balance before initiating a funded transfer; `REJECTED` with no balance is the common sandbox failure.
