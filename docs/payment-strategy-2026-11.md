# Payment strategy — new approach (27 Nov 2026)

Researcher brief for PULSIFY_MISSION Phase 2. Nothing has been signed up for or changed in the
payment code. Provider sites were blocked from the research session, so every fee below comes
from search summaries of official pages — **confirm each one with the provider**.

## Why we keep getting declined
- **Paystack** (ref 1799393, 24 Jun 2026): outside their Acceptable Use Policy — "significant risk
  of chargebacks". The pitch was Pulsify collecting ticket money, holding it, and paying organisers
  after the event.
- **Payfast** (Oct 2026): "outside the parameters of our current aggregation model".

Both said no to the same thing: **Pulsify holding other people's ticket money** (an aggregator /
payment facilitator), for events delivered weeks later (high chargeback risk). Applying elsewhere
with the same pitch will likely get the same answer.

## The new approach — staged

**Stage 1 (now): subscriptions only.** Apply only for the R220 / R360 monthly software
subscriptions — a normal, low-risk category. No ticket money in the application.
1. Email Paystack support first: *"Will you review a new application for software subscriptions
   only (R220/R360 monthly) — no ticket funds?"* Existing Paystack subscription code works unchanged.
2. If no: Payfast subscriptions as a plain software merchant (ask whether the earlier decline blocks
   it), then Netcash debit orders, then Stitch.
3. Don't use the words ticketing, escrow, payouts or marketplace in this application.

**Stage 2 (next): stop holding ticket money.**
- **Option D — partner (fastest):** Pulsify already pulls Quicket events. Show "Buy tickets" as a
  link-out or Quicket's ticket widget; organisers sell through Quicket/Howler and get paid by them.
  Downside: Pulsify earns nothing per ticket until a referral/affiliate deal exists.
- **Option B — organiser is the merchant:** ask Netcash (split payments, advertised for "eventing";
  each organiser registers their own Netcash account), Stitch and Flutterwave whether *they* onboard
  and verify each organiser while Pulsify only takes its fee. Then Pulsify never holds the funds.
- Stop-gap only: organisers paste their own Yoco/SnapScan/Payfast link. Pulsify can't verify those
  payments automatically, so it's weak.

**Stage 3 (later, 6–12 months of clean subscription history): Option C** — Pulsify as platform with
a reserve and delayed payouts. A brand-new business can't offer a believable reserve yet.
TradeSafe escrow is not a good fit for R150 tickets (minimum fee, buyer must confirm "received").

## Comparison

| Provider | Fits | Takes new small business? | Fees (ex VAT) | Recurring? | Odds |
|---|---|---|---|---|---|
| Paystack (SaaS only) | A | Yes — sole proprietors as "Starter" (R1m limit) | 2.9% + R1 | Yes (already built) | Medium — ask first |
| Payfast (subscriptions) | A | Possibly | Not confirmed | Yes | Medium |
| Yoco | A, B | Yes | 2.55–2.95%, no monthly fee | Unclear | Medium (payments) / Low (billing) |
| iKhokha | B fallback | Yes, sole-proprietor path | 2.85% payment links | No | High for links, no billing |
| Netcash | A, B | Not confirmed | Not confirmed | Yes (debit orders) | Medium |
| Peach Payments | A | Targets ~R50k–R100k/month businesses | 2.95% + R1.50 | Yes | Low now |
| Stitch | A, B, C | Not confirmed | Card 2.95%; payouts R2/R10 | Yes | Unknown — one email |
| Ozow | A (EFT only) | Yes, incl. informal | 2.5% low volume | No | High for EFT |
| Flutterwave | B | Needs ID + SA tax number | Not confirmed | Not confirmed | Medium |
| TradeSafe | C | Not confirmed | From 1.5%, min R100 (2018 figures) | No | Low–Medium |
| Quicket / Howler | D | They onboard organisers | Booking fees on buyers | n/a | Medium |

## What Tubs must do to get approved
1. **Register Pulsify at CIPC** (cheap, quick). Every provider's checks run through it.
   Paystack lets sole proprietors apply, but terms.html says "Pulsefy (Pty) Ltd" with no
   registration number. If the company doesn't exist yet, that line looks like misrepresentation.
2. Open a business bank account and get a bank confirmation letter dated within the last 6 months.
   Keep your ID and a proof of address (under 3 months old) ready.
3. Site changes:
   - Add a **pricing page**: R220/R360, the 3 free months, the 8% ticket fee, and what happens
     after the trial.
   - Add the registered name, registration number, a **physical address** and a **phone number**.
   - Explain how to cancel a subscription.
   - Use one spelling everywhere ("Pulsefy" on the site vs "Pulsify" in code).
4. **Make the terms match the pitch.** terms.html says ticket money is held by "Pulsefy's
   licensed payment partner, not by Pulsefy". The current payout code (lib/payouts.js) has
   Pulsify holding it. Update the terms once the Stage 2 model is chosen.
5. Keep paid tickets switched off (the `paystack_live` flag) until a provider approves ticketing.

## Code impact
| Option | Existing code reused |
|---|---|
| A on Paystack | ~100% — no change |
| A on Payfast/Netcash/Stitch | Webhook flow, payments table, premium logic reused. Checkout script, verify call and signature check rewritten (`startOrgPayment`, `startBizPayment`, Paystack parts of `api/payments/index.js`). |
| B | `/ticket/init` + `/ticket/confirm` keep their shape; provider calls change; `lib/payouts.js` no longer needed; new per-organiser onboarding screen. |
| C | `lib/payouts.js` reused; provider calls replaced. |
| D | Almost none — an outbound link or widget. |

## Could not confirm
- Whether Paystack or Payfast will reconsider a subscriptions-only application after a decline.
  Only they can answer.
- Yoco online recurring billing.
- Whether Netcash, Stitch or Flutterwave split payments work for a new platform in ZAR.
- Current TradeSafe fees, and payout timing for most providers.
- Whether Quicket or Howler offer partner or revenue-share terms. Nothing found for Computicket,
  iTickets, TicketPro or Plankton.
- Which providers accept a sole proprietor before CIPC registration. Only Paystack and iKhokha
  are confirmed.

## Sources (search results, 27 Nov 2026)
Paystack: support.paystack.com/en/articles/2124418 · dr.paystack.com/za/pricing —
Yoco: yoco.com/za/pricing · smesouthafrica.co.za/brands/yoco-2 —
Payfast: payfast.io/subscriptions · payfast.kayako.com/article/13 —
Netcash: netcash.co.za/?p=10925 · help.netcash.co.za (debit order guide) —
Peach: developer.peachpayments.com/docs/dashboard-onboarding · peachpayments.com/fees —
Stitch: stitch.money/express · stitch.money/payouts —
iKhokha: help.ikhokha.com (pay-link FAQ, sole proprietor) —
Ozow: ozow.com/faq · ozow.com/pricing —
Flutterwave: developer.flutterwave.com/docs/collecting-payments/split-payments —
TradeSafe: fastcompany.co.za/?p=4087 · wordpress.org/plugins/tradesafe-payment-gateway —
Quicket: quicket.co.za/fees.aspx — Howler: help.howler.co.za (settlement reports)
</content>
</invoke>
