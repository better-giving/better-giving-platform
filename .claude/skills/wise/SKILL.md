---
name: wise
description: Wise (TransferWise) money movement — sandbox V2 hosts and credentials (V1 dies June 30 2026), the single `WISE_API_URL` host source, recipient-account lookups behind /api/wise/*, and the payout quote → transfer → fund chain the grants and referrer-commission crons share.
---

# Wise

**Jurisdiction: `apps/platform/`.** Paths below are relative to it.

## Environments

| | host | portal |
|---|---|---|
| production | `api.wise.com` | `wise.com` |
| sandbox **V2** | `api.wise-sandbox.com` | `wise-sandbox.com` |
| sandbox V1 (dead) | `api.sandbox.transferwise.tech` | `sandbox.transferwise.tech` |

V1 is deprecated **June 30, 2026** — [migration guide](https://docs.wise.com/guides/developer/environments/sandbox-v2-migration). Endpoints, payloads and webhooks are identical across V1/V2; only hosts and credentials move.

- A V1 token issued after **April 1, 2025** does not authenticate against V2. New V2 credentials come from api@wise.com or the delivery contact.
- Ids created before that cutoff (profile, balance, account, transfer) carry over unchanged; test data created after it was **not** migrated — reseed recipients and transfers in V2 by hand.
- mTLS certs and JWE/JWS public keys are per-environment: regenerate for V2. Webhook signature public keys are shared, no change.

## One base URL

`WISE_API_URL` is the only source of the host, on both ends:

1. `.server/kit/wise.ts` passes it to `Wise` as `base_url`.
2. `src/routes/api.wise.$.ts:41` — the browser-facing proxy — fetches `${WISE_API_URL}/${path}`.

Moving an environment between V1, V2 and production is therefore an env-var edit and nothing else, and the token can't end up paired with a host the other end isn't using.

## Env

`WISE_API_TOKEN`, `WISE_API_URL`, `WISE_PROFILE_ID`, `WISE_BALANCE_ID_USD` — declared in `.server/env.ts:121-126`, allowlisted in root `turbo.json:42-45`, documented in `.env.example:41-50`. `.env` holds sandbox credentials; production lives in Vercel (`vercel env pull`). Never pair a token with the other environment's host.

Re-derive the ids after a credential swap:

```bash
curl -s "$WISE_API_URL/v2/profiles" -H "authorization: Bearer $WISE_API_TOKEN" | python3 -m json.tool
curl -s "$WISE_API_URL/v4/profiles/$WISE_PROFILE_ID/balances?types=STANDARD" \
  -H "authorization: Bearer $WISE_API_TOKEN" | python3 -m json.tool
```

## Server surface

`lib/wise.ts` is the whole client — 5 methods, no SDK. Errors throw the raw response **text**, not a parsed body. Every call rejects with a `TimeoutError` after `TIMEOUT_MS` (30s).

| method | endpoint | called from |
|---|---|---|
| `v2_account(id)` | `GET /v2/accounts/{id}` | `src/pages/platform-admin/banking-applications/api.ts`, `src/routes/dashboard.referrals/api.ts`, `.server/payouts/wise-pay.ts` |
| `balance(id, profile_id)` | `GET /v4/profiles/{p}/balances/{id}` | `src/routes/api.cron.grants/notif.ts` |
| `quote(profile_id, …)` | `POST /v3/profiles/{p}/quotes` | `.server/payouts/wise-pay.ts` |
| `transfer(…)` | `POST /v1/transfers` | `.server/payouts/wise-pay.ts` |
| `fund_transfer(…)` | `POST /v3/profiles/{p}/transfers/{t}/payments` | `.server/payouts/wise-pay.ts` |

**Payout chain** — `.server/payouts/wise-pay.ts` (`wise_pay`), the one chain both payout crons (grants, referrer commissions) call: `v2_account` → `quote` → `transfer` → `fund_transfer`. `customerTransactionId` is the caller's `ref` and is Wise's idempotency key: reusing a ref returns the original transfer instead of creating a second one, so `wise_pay` reads the returned `status`: it funds only `incoming_payment_waiting`, returns an already-funded transfer as paid without funding it again, and throws on anything else (`NotFundedError` for a `cancelled` one). `transfer()` resolves with HTTP 200 while carrying `errors` — the call site throws on it. `fund_transfer` returning `status: "REJECTED"` is the insufficient-balance case (`errorCode`), not an exception. `wise_pay` throws `NotFundedError` (`.server/payouts/transfer.ts`) for a failure before `fund_transfer` or a `REJECTED` funding; any other throw means money may have moved. Each cron claims its rows `pending → processing` with the ref stored before paying — `.server/payouts/settle.ts` for grant payouts, `.server/payouts/settle-commissions.ts` for commissions — releases them to `pending` on `NotFundedError`, and leaves any other failure `processing` with an alert for manual reconcile by ref. The ref is `transfer_ref` and the total `payout_total`, both in `.server/payouts/transfer.ts`; the grants notice and eligibility judge the minimum on that same total. The ref carries a nonce drawn per claim, so a released set claimed again never meets its earlier, possibly cancelled, transfer.

## Browser surface

`/api/wise/*` (`src/routes/api.wise.$.ts`) proxies the client straight to Wise so recipient-form requirements stay dynamic. It substitutes `{{profileId}}` in both path and body, injects the bearer token, and forwards only `accept-minor-version` and `content-type`. The client never sees a token or a profile id.

Consumers: `src/components/bank-details/use-currencies.ts` (`/v1/currencies`), `.../recipient-details/use-requirements.ts` (`/v3/profiles/{{profileId}}/quotes`, `/v1/quotes/{id}/account-requirements`), `.../recipient-details-form.tsx` (`POST /v1/accounts`).

Tests never reach Wise: `src/__tests__/wise-handlers.ts` holds the MSW handlers for the proxy paths, and `$/kit/wise` is `vi.mock`ed in the banking and application-review suites.

## Rules

1. Confirm which environment a token belongs to before running a write (`transfer`, `fund_transfer`, `POST /v1/accounts`) — a production token funds a real payout.
2. Read a balance before initiating a funded transfer; `REJECTED` with no balance is the common sandbox failure.
