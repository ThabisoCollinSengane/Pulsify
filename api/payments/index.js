const crypto = require('crypto');
const { sb, sbAs, authUser, tokenFrom, CORS, verifyToken, logAdminAction } = require('../shared');
const { sendPaymentConfirmEmail } = require('../email');

module.exports = async (req, res) => {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';
  const q   = Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  try {

    /* ─── POST /ticket/purchase ───────────────────────────── */
    if (url === '/ticket/purchase' && req.method === 'POST') {
      const body = req.body || {};
      const { event_id, tier_id, quantity = 1, buyer_name, buyer_email, buyer_phone } = body;

      if (!event_id || !buyer_name || !buyer_email)
        return res.status(400).json({ error: 'event_id, buyer_name and buyer_email required' });

      const [{ data: ev }, { data: tier }] = await Promise.all([
        sb().from('events').select('name,commission_rate').eq('id', event_id).single(),
        tier_id ? sb().from('ticket_tiers').select('*').eq('id', tier_id).single() : { data: null },
      ]);

      if (!ev) return res.status(404).json({ error: 'Event not found' });

      const qty         = Math.max(1, parseInt(quantity));
      const unit_price  = tier?.price || 0;
      const subtotal    = unit_price * qty;
      const commission  = unit_price > 0 ? +(subtotal * 0.08).toFixed(2) : 0;
      const psf         = unit_price > 0 ? +(subtotal * 0.015 + 1.5).toFixed(2) : 0;
      const total_paid  = +(subtotal + commission + psf).toFixed(2);
      const booking_ref = `PKF-${Date.now()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

      const { data: booking, error: bErr } = await sb().from('bookings').insert({
        booking_ref, event_id,
        tier_id:     tier_id || null,
        buyer_name,  buyer_email,
        buyer_phone: buyer_phone || null,
        quantity:    qty, unit_price, commission, total_paid,
        status:      'confirmed', // Paystack disabled — auto-confirm all
        qr_data:     `PULSIFY:${booking_ref}:${event_id}:VALID`,
      }).select().single();

      if (bErr) return res.status(400).json({ error: bErr.message });

      // Notify the buyer if they're a registered user
      const { user_id } = body;
      if (user_id) {
        await sb().from('notifications').insert({
          user_id, type: 'ticket',
          from_display_name: 'Pulsefy',
          entity_id: event_id, entity_type: 'events',
          message: `Your ticket for ${ev.name} is confirmed! Ref: ${booking_ref}${unit_price > 0 ? ` · R${total_paid.toFixed(2)}` : ' · FREE'}`,
          data: { booking_ref, tier_name: tier?.name || null },
        }).catch(() => {});
      }

      return res.status(200).json({
        success:     true,
        booking_ref,
        total_paid,
        buyer_email,
        buyer_name,
        is_free:     unit_price === 0,
        qr_data:     booking.qr_data,
        event_name:  ev.name,
        tier_name:   tier?.name || null,
        quantity:    qty,
      });
    }

    /* ─── GET /booking/:ref ───────────────────────────────── */
    const bookRef = url.match(/^\/booking\/([^/]+)$/)?.[1];
    if (bookRef && req.method === 'GET') {
      const { data } = await sb().from('bookings')
        .select('*,events(name,date_local,time_local,venue_name,venue_city)')
        .eq('booking_ref', bookRef).single();
      if (!data) return res.status(404).json({ error: 'Booking not found' });
      return res.status(200).json({ booking: data });
    }

    /* ─── POST /validate-ticket ──────────────────────────── */
    if (url === '/validate-ticket' && req.method === 'POST') {
      const auth = await authUser(req);
      if (!auth) return res.status(401).json({ error: 'Unauthorized' });
      const { user, profile } = auth;

      const { qr_data } = req.body || {};
      if (!qr_data) return res.status(400).json({ error: 'qr_data required' });

      const parts = String(qr_data).split(':');
      if (parts.length < 4 || parts[0] !== 'PULSEFY' || parts[3] !== 'VALID')
        return res.status(400).json({ error: 'Invalid QR code' });

      const booking_ref = parts[1];
      const event_id    = parts[2];

      const { data: booking } = await sb().from('bookings')
        .select('*,events(name,date_local,venue_name,organiser_id),ticket_tiers(name)')
        .eq('booking_ref', booking_ref).maybeSingle();

      if (!booking)                         return res.status(404).json({ error: 'Ticket not found' });
      if (booking.status !== 'confirmed')   return res.status(400).json({ error: 'Ticket is not confirmed' });
      if (booking.event_id !== event_id)    return res.status(400).json({ error: 'QR data mismatch' });
      if (profile.role === 'organizer' && booking.events?.organiser_id !== user.id)
        return res.status(403).json({ error: "This ticket is for a different organizer's event" });

      if (booking.checked_in)
        return res.status(409).json({
          error: 'Already checked in',
          checked_in_at: booking.checked_in_at,
          booking: { buyer_name: booking.buyer_name, booking_ref: booking.booking_ref },
        });

      await sb().from('bookings')
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .eq('id', booking.id);

      return res.status(200).json({
        success:     true,
        booking_ref: booking.booking_ref,
        buyer_name:  booking.buyer_name,
        buyer_email: booking.buyer_email,
        quantity:    booking.quantity,
        tier_name:   booking.ticket_tiers?.name  || null,
        event_name:  booking.events?.name        || null,
        event_date:  booking.events?.date_local  || null,
      });
    }

    /* ─── POST /paystack/webhook ──────────────────────────── */
    if (url === '/paystack/webhook' && req.method === 'POST') {
      const sig  = req.headers['x-paystack-signature'] || '';
      const hash = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || '')
        .update(JSON.stringify(req.body)).digest('hex');
      if (sig !== hash) return res.status(401).json({ error: 'Invalid signature' });

      if (req.body?.event === 'charge.success') {
        const ref    = req.body.data?.reference;
        const meta   = req.body.data?.metadata || {};
        const userId = meta.user_id || null;
        if (meta.booking_id) {
          await sb().from('bookings').update({ status: 'confirmed' }).eq('id', meta.booking_id);
        }
        if (userId && ref) {
          await sb().from('payments').upsert({
            user_id: userId, reference: ref, type: meta.type || 'ticket',
            entity_id: meta.booking_id || meta.entity_id || null,
            amount: req.body.data?.amount || 0, status: 'success',
            completed_at: new Date().toISOString(),
            metadata: { paystack: req.body.data },
          }, { onConflict: 'reference' });
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

      if (error) console.warn('[verify-request] profiles update failed:', error.message);
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
          await sb().from('profiles').update({ subscription_type: 'premium' }).eq('id', user.id);
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
          await sb().from('profiles').update({ subscription_type: 'premium' }).eq('id', payment.user_id);
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
    return res.status(500).json({ error: e.message });
  }
};
