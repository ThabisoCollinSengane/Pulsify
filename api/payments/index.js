const crypto = require('crypto');
const { sb, sbAs, authUser, tokenFrom, corsHeaders, verifyToken, logAdminAction, rateLimited, captureError } = require('../shared');
const { sendPaymentConfirmEmail, sendTicketEmail } = require('../email');

module.exports = async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (rateLimited(req, res, { limit: 30, windowMs: 60000 })) return;

  const url = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q   = Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {

    /* /ticket/purchase lives in api/index.js (see vercel.json rewrite:
       /api/ticket/* → /api). Don't re-add it here. */

    /* ─── GET /booking/:ref ───────────────────────────────── */
    const bookRef = url.match(/^\/booking\/([^/]+)$/)?.[1];
    if (bookRef && req.method === 'GET') {
      const { data } = await sb().from('bookings')
        .select('*,events(name,date_local,time_local,venue_name,venue_city)')
        .eq('booking_ref', bookRef).single();
      if (!data) return res.status(404).json({ error: 'Booking not found' });
      return res.status(200).json({ booking: data });
    }

    /* /validate-ticket lives in api/index.js (see vercel.json rewrite:
       /api/validate-ticket → /api). Don't re-add it here. */

    /* ─── POST /paystack/webhook ──────────────────────────────
       Async source of truth for paid tickets. Before flipping a
       booking to confirmed we re-verify the amount Paystack actually
       charged (currency ZAR + amount ≥ expected kobo) so a tampered
       client amount can't confirm a booking. Idempotent on
       status='pending'. */
    if (url === '/paystack/webhook' && req.method === 'POST') {
      const sig  = req.headers['x-paystack-signature'] || '';
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });

      if (req.body?.event === 'charge.success') {
        const pdata  = req.body.data || {};
        const ref    = pdata.reference;
        const meta   = pdata.metadata || {};
        const userId = meta.user_id || null;

        // Load the pending booking (by id or ref) to verify the charged amount.
        let pq = sb().from('bookings')
          .select('*,events(name,date_local,venue_name,venue_city),ticket_tiers(name)');
        pq = meta.booking_id ? pq.eq('id', meta.booking_id) : pq.eq('booking_ref', ref);
        const { data: pend } = await pq.maybeSingle();

        let confirmedBooking = null;
        if (pend && pend.status === 'pending') {
          const expectedKobo = Math.round((pend.total_paid || 0) * 100);
          if (pdata.currency === 'ZAR' && (pdata.amount || 0) >= expectedKobo) {
            const { data: b, error: cErr } = await sb().from('bookings')
              .update({ status: 'confirmed', paystack_ref: ref })
              .eq('id', pend.id).eq('status', 'pending')
              .select('*,events(name,date_local,venue_name,venue_city),ticket_tiers(name)').single();
            if (cErr) console.error('[paystack/webhook] confirm write failed:', cErr.message);
            confirmedBooking = b;
          } else {
            console.error('[paystack/webhook] amount mismatch', ref, pdata.amount, expectedKobo, pdata.currency);
          }
        }

        if (confirmedBooking) {
          sendTicketEmail(confirmedBooking.buyer_email, confirmedBooking.buyer_name, confirmedBooking.events?.name, confirmedBooking.events?.date_local, confirmedBooking.events?.venue_name, confirmedBooking.events?.venue_city, confirmedBooking.booking_ref, confirmedBooking.ticket_tiers?.name, confirmedBooking.quantity, confirmedBooking.total_paid, confirmedBooking.unit_price === 0, confirmedBooking.qr_data)
            .catch(e => console.error('[email/ticket/webhook]', e.message));
          if (userId) {
            await sb().from('notifications').insert({
              user_id: userId, type: 'ticket', from_display_name: 'Pulsefy',
              entity_id: confirmedBooking.event_id, entity_type: 'events',
              message: `Your ticket for ${confirmedBooking.events?.name} is confirmed! Ref: ${confirmedBooking.booking_ref}`,
              data: { booking_ref: confirmedBooking.booking_ref },
            }).catch(() => {});
          }
        }

        if (userId && ref) {
          await sb().from('payments').upsert({
            user_id: userId, reference: ref, type: meta.type || 'ticket',
            entity_id: meta.booking_id || meta.entity_id || null,
            amount: pdata.amount || 0, status: 'success',
            completed_at: new Date().toISOString(),
            metadata: { paystack: pdata },
          }, { onConflict: 'reference' }).catch(() => {});
        }
      }
      return res.status(200).json({ received: true });
    }

    /* ─── POST /verify-request ────────────────────────────── */
    if (url === '/verify-request' && req.method === 'POST') {
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user  = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const body = req.body || {};
      const { face_scan_url, id_doc_url, ...rest } = body;
      const updatePayload = {
        verif_status:  'pending',
        verif_request: JSON.stringify({
          ...rest,
          user_id: user.id,
          submitted_at: new Date().toISOString(),
        }),
      };
      if (face_scan_url) updatePayload.face_scan_url = face_scan_url;
      if (id_doc_url)    updatePayload.id_doc_url    = id_doc_url;

      const { error } = await sb().from('profiles').update(updatePayload).eq('id', user.id);
      if (error) {
        console.error('[verify-request] profiles update failed:', error.message);
        return res.status(500).json({ error: 'Could not submit verification — please try again.' });
      }

      // Audit trail: upsert KYC document records
      const kycRows = [];
      const extractPath = (u) => { try { return u.split('/verification-docs/')[1].split('?')[0]; } catch { return u; } };
      if (face_scan_url) kycRows.push({ user_id: user.id, file_type: 'face_scan', storage_path: extractPath(face_scan_url), mime_type: 'image/jpeg' });
      if (id_doc_url)    kycRows.push({ user_id: user.id, file_type: 'id_doc',    storage_path: extractPath(id_doc_url)    });
      if (kycRows.length) await sb().from('kyc_documents').upsert(kycRows, { onConflict: 'user_id,file_type,storage_path' }).catch(() => {});

      // Notify admin about new verification request
      const { data: admins } = await sb().from('profiles').select('id').eq('role', 'admin');
      for (const admin of admins || []) {
        await sb().from('notifications').insert({
          user_id:           admin.id,
          type:              'system',
          from_display_name: 'Pulsefy System',
          message:           `New verification request from ${user.email || 'a user'}.`,
          entity_type:       'verification',
          entity_id:         user.id,
          read:              false,
        });
      }

      return res.status(200).json({ success: true, status: 'pending' });
    }

    /* ─── POST /payments/initiate ─────────────────────────── */
    if (url === '/payments/initiate' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { user, profile } = auth;
      const { type, entity_id, amount, email } = req.body || {};
      if (!type || !amount || !email) return res.status(400).json({ error: 'type, amount, and email required' });
      if (!['ticket','subscription_organizer','subscription_business','promotion'].includes(type))
        return res.status(400).json({ error: 'Invalid payment type' });
      if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ error: 'amount must be a positive integer in cents' });

      const psRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, amount, currency: 'ZAR', metadata: { user_id: user.id, type, entity_id: entity_id || null, display_name: profile.display_name } }),
      });
      if (!psRes.ok) { const b = await psRes.json().catch(() => ({})); return res.status(502).json({ error: b.message || 'Paystack error' }); }
      const psData = await psRes.json();
      if (!psData.status) return res.status(502).json({ error: psData.message || 'Paystack error' });

      const { reference, authorization_url } = psData.data;
      const { error: dbErr } = await sb().from('payments').insert({
        user_id: user.id, reference, amount, currency: 'ZAR', type,
        entity_id: entity_id || null, status: 'pending', metadata: { email },
      });
      if (dbErr) return res.status(400).json({ error: dbErr.message });
      return res.status(200).json({ reference, authorization_url, access_code: psData.data.access_code });
    }

    /* ─── GET /payments/verify ────────────────────────────── */
    if (url === '/payments/verify' && req.method === 'GET') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { user, profile } = auth;
      const ref = q.ref || '';
      if (!ref) return res.status(400).json({ error: 'ref query parameter required' });

      const { data: payment } = await sb().from('payments').select('*').eq('reference', ref).eq('user_id', user.id).single();
      if (!payment) return res.status(404).json({ error: 'Payment not found' });
      if (payment.status === 'success') return res.status(200).json({ success: true, payment });

      const psRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(ref)}`, {
        headers: { 'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
      });
      if (!psRes.ok) { const b = await psRes.json().catch(() => ({})); return res.status(502).json({ error: b.message || 'Paystack verify error' }); }
      const psData = await psRes.json();
      const newStatus = psData.data?.status === 'success' ? 'success' : 'failed';
      const now = new Date().toISOString();

      const { data: updated } = await sb().from('payments')
        .update({ status: newStatus, completed_at: now, metadata: { ...payment.metadata, paystack: psData.data } })
        .eq('id', payment.id).select().single();

      if (newStatus === 'success') {
        if (['subscription_organizer','subscription_business'].includes(payment.type)) {
          const { error: subErr } = await sb().from('profiles').update({ subscription_type: 'premium' }).eq('id', user.id);
          if (subErr) console.error('[payments/verify] subscription upgrade failed:', user.id, subErr.message);
        }
        await sb().from('notifications').insert({
          user_id: user.id, type: 'payment', from_user_id: user.id, from_display_name: 'Pulsefy',
          entity_id: payment.id, entity_type: 'payment',
          message: `Payment of R${(payment.amount / 100).toFixed(2)} confirmed ✅`,
        });
        await logAdminAction(user.id, profile.display_name || user.email, 'payment_success', payment.id,
          `${payment.type} — R${(payment.amount / 100).toFixed(2)}`, { reference: ref });
        const userEmail = profile.email || user.email;
        if (userEmail) sendPaymentConfirmEmail(userEmail, profile.display_name, payment.amount, payment.type).catch(() => {});
      }
      return res.status(200).json({ success: newStatus === 'success', payment: updated });
    }

    /* ─── POST /payments/webhook ──────────────────────────── */
    if (url === '/payments/webhook' && req.method === 'POST') {
      const sig  = req.headers['x-paystack-signature'] || '';
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });
      res.status(200).json({ received: true });

      if (req.body?.event === 'charge.success') {
        const ref  = req.body.data?.reference;
        const meta = req.body.data?.metadata || {};
        if (!ref) return;
        const { data: payment } = await sb().from('payments').select('*').eq('reference', ref).maybeSingle();
        if (!payment || payment.status === 'success') return;
        const now = new Date().toISOString();
        await sb().from('payments').update({
          status: 'success', completed_at: now, metadata: { ...payment.metadata, paystack: req.body.data },
        }).eq('id', payment.id);

        if (['subscription_organizer','subscription_business'].includes(payment.type)) {
          const { error: subErr } = await sb().from('profiles').update({ subscription_type: 'premium' }).eq('id', payment.user_id);
          if (subErr) console.error('[payments/webhook] subscription upgrade failed:', payment.user_id, subErr.message);
        }
        await sb().from('notifications').insert({
          user_id: payment.user_id, type: 'payment', from_user_id: payment.user_id, from_display_name: 'Pulsefy',
          entity_id: payment.id, entity_type: 'payment',
          message: `Payment of R${(payment.amount / 100).toFixed(2)} confirmed ✅`,
        });
        await logAdminAction(payment.user_id, meta.display_name || 'User', 'payment_success', payment.id,
          `${payment.type} — R${(payment.amount / 100).toFixed(2)}`, { reference: ref });
        const { data: prof } = await sb().from('profiles').select('email,display_name').eq('id', payment.user_id).single();
        if (prof?.email) sendPaymentConfirmEmail(prof.email, prof.display_name, payment.amount, payment.type).catch(() => {});
      }
      return;
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (e) {
    captureError(e, { url });
    return res.status(500).json({ error: e.message });
  }
};
