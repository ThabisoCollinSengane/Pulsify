/* ─── Organiser payouts ─────────────────────────────────────────
   Paid tickets settle in full to Pulsify's Paystack balance (no split at
   checkout). Two business days after an event ends, the organiser's share —
   the ticket subtotal (unit_price × quantity); the buyer-paid commission and
   processing fee stay with Pulsify — is sent with Paystack Transfers.

   Runs daily from api/cron/event-cleanup.js. Gated by the `payouts_auto`
   feature flag: while it's off, nothing is written or sent and the cron just
   reports what's due. Weekends are skipped; SA public holidays are not. */
const { sb, flagEnabled } = require('./shared');

// SA bank name → Paystack clearing code
const SA_BANK_CODES = {
  'Absa':          '632005',
  'Capitec':       '470010',
  'FNB':           '250655',
  'Nedbank':       '198765',
  'Standard Bank': '051001',
  'Investec':      '580105',
  'TymeBank':      '678910',
  'African Bank':  '430000',
};

async function paystack(method, path, body) {
  const r = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY || ''}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw new Error(j.message || `Paystack ${r.status}`);
  return j.data;
}

// The date (YYYY-MM-DD) an event's money may be paid out: 2 weekdays after it ends.
function payoutDate(eventDay) {
  const d = new Date(`${eventDay}T00:00:00Z`);
  let added = 0;
  while (added < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) added++;
  }
  return d.toISOString().slice(0, 10);
}

async function recipientFor(org) {
  if (org.paystack_recipient_code) return org.paystack_recipient_code;
  const bank_code = SA_BANK_CODES[org.paystack_bank_name];
  if (!bank_code || !org.paystack_account_number) return null;
  const data = await paystack('POST', '/transferrecipient', {
    type: 'basa', currency: 'ZAR', bank_code,
    account_number: org.paystack_account_number,
    name: org.paystack_business_name || org.display_name || 'Pulsify organiser',
  });
  await sb().from('profiles').update({ paystack_recipient_code: data.recipient_code }).eq('id', org.id);
  return data.recipient_code;
}

// Settle transfers that Paystack hadn't finished when they were sent.
async function reconcileProcessing() {
  const { data: rows } = await sb().from('organiser_payouts').select('id,reference').eq('status', 'processing').limit(100);
  let settled = 0;
  for (const p of rows || []) {
    try {
      const t = await paystack('GET', `/transfer/verify/${encodeURIComponent(p.reference)}`);
      if (t.status === 'success' || t.status === 'failed' || t.status === 'reversed') {
        await sb().from('organiser_payouts').update({
          status: t.status === 'success' ? 'paid' : 'failed',
          error: t.status === 'success' ? null : `Transfer ${t.status}`,
          updated_at: new Date().toISOString(),
        }).eq('id', p.id);
        settled++;
      }
    } catch (e) { console.error('[payouts] verify', p.reference, e.message); }
  }
  return settled;
}

async function runPayouts() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: bookings, error } = await sb().from('bookings')
    .select('id,event_id,unit_price,quantity,events!inner(name,organiser_id,date_local,end_date_local)')
    .eq('status', 'confirmed').gt('unit_price', 0).is('payout_id', null)
    .lt('events.date_local', today)
    .limit(2000);
  if (error) return { error: error.message };

  // Group what's due by event (each event has one organiser).
  const due = {};
  for (const b of bookings || []) {
    const ev = b.events;
    if (!ev?.organiser_id || payoutDate(ev.end_date_local || ev.date_local) > today) continue;
    const g = due[b.event_id] ||= { event_id: b.event_id, event_name: ev.name, organiser_id: ev.organiser_id, amount: 0, booking_ids: [] };
    g.amount += (+b.unit_price || 0) * (b.quantity || 1);
    g.booking_ids.push(b.id);
  }
  const groups = Object.values(due).map(g => ({ ...g, amount: +g.amount.toFixed(2) })).filter(g => g.amount > 0);

  if (!await flagEnabled('payouts_auto') || !process.env.PAYSTACK_SECRET_KEY) {
    return { mode: 'report_only', due: groups.map(({ booking_ids, ...g }) => ({ ...g, bookings: booking_ids.length })) };
  }

  const reconciled = await reconcileProcessing();
  const orgIds = [...new Set(groups.map(g => g.organiser_id))];
  const { data: orgs } = orgIds.length
    ? await sb().from('profiles').select('id,display_name,paystack_recipient_code,paystack_bank_name,paystack_account_number,paystack_business_name').in('id', orgIds)
    : { data: [] };
  const orgById = Object.fromEntries((orgs || []).map(o => [o.id, o]));

  const result = { mode: 'live', sent: 0, failed: 0, no_bank_details: 0, reconciled };
  for (const g of groups) {
    let recipient;
    try { recipient = await recipientFor(orgById[g.organiser_id] || {}); }
    catch (e) { console.error('[payouts] recipient', g.organiser_id, e.message); }
    if (!recipient) { result.no_bank_details++; continue; }   // retried tomorrow once bank details exist

    // Record the payout and claim its bookings BEFORE sending money, so a crash
    // or a concurrent run can never pay the same bookings twice.
    const reference = `PO-${g.event_id}-${Date.now().toString(36)}`.slice(0, 100);
    const { data: payout, error: pErr } = await sb().from('organiser_payouts').insert({
      event_id: g.event_id, organiser_id: g.organiser_id, amount: g.amount, reference,
    }).select('id').single();
    if (pErr) { console.error('[payouts] insert', pErr.message); result.failed++; continue; }
    const { data: claimed } = await sb().from('bookings').update({ payout_id: payout.id })
      .in('id', g.booking_ids).is('payout_id', null).select('id');
    if ((claimed || []).length !== g.booking_ids.length) {
      // Another run got some of these first — release ours and let tomorrow recompute.
      await sb().from('bookings').update({ payout_id: null }).eq('payout_id', payout.id);
      await sb().from('organiser_payouts').delete().eq('id', payout.id);
      continue;
    }

    try {
      const t = await paystack('POST', '/transfer', {
        source: 'balance', currency: 'ZAR', recipient, reference,
        amount: Math.round(g.amount * 100),
        reason: `Pulsify ticket sales — ${g.event_name || g.event_id}`.slice(0, 100),
      });
      await sb().from('organiser_payouts').update({
        status: t.status === 'success' ? 'paid' : 'processing',
        transfer_code: t.transfer_code || null, updated_at: new Date().toISOString(),
      }).eq('id', payout.id);
      result.sent++;
    } catch (e) {
      // Bookings stay linked to the failed payout so nothing is re-sent automatically —
      // an admin checks Paystack, then clears payout_id on those bookings to retry.
      await sb().from('organiser_payouts').update({ status: 'failed', error: e.message, updated_at: new Date().toISOString() }).eq('id', payout.id);
      result.failed++;
    }
  }
  return result;
}

module.exports = { runPayouts, payoutDate, SA_BANK_CODES };
