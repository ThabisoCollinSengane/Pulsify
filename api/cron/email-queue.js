const { sbAs, corsHeaders, rateLimited } = require('../../lib/shared');
const {
  sendTicketEmail, sendPaymentConfirmEmail, sendWelcomeEmail,
  sendVerifApprovedEmail, sendVerifRejectedEmail,
} = require('../../lib/email');

const MAX_ATTEMPTS = 3;
const BATCH_SIZE   = 50;

async function dispatch(row) {
  const p = row.payload || {};
  switch (row.type) {
    case 'ticket':
      return sendTicketEmail(
        row.recipient_email, p.buyer_name, p.event_name, p.event_date,
        p.venue_name, p.venue_city, p.booking_ref, p.tier_name,
        p.quantity, p.total_paid, p.is_free, p.qr_data
      );
    case 'payment_confirm':
      return sendPaymentConfirmEmail(row.recipient_email, p.display_name, p.amount, p.payment_type);
    case 'welcome':
      return sendWelcomeEmail(row.recipient_email, p.display_name);
    case 'verif_approved':
      return sendVerifApprovedEmail(row.recipient_email, p.display_name);
    case 'verif_rejected':
      return sendVerifRejectedEmail(row.recipient_email, p.display_name, p.notes);
    default:
      throw new Error(`unknown email type: ${row.type}`);
  }
}

module.exports = async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Vercel Cron sends a header; also allow direct call with CRON_SECRET for testing
  const auth = req.headers.authorization || '';
  if (auth !== `Bearer ${process.env.CRON_SECRET}` && process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const sba = sbAs();
  const { data: rows, error } = await sba
    .from('pending_emails')
    .select('*')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    console.error('[email-queue] fetch failed:', error.message);
    return res.status(500).json({ error: error.message });
  }

  let sent = 0, failed = 0;
  for (const row of rows || []) {
    try {
      await dispatch(row);
      await sba.from('pending_emails')
        .update({ status: 'sent', sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id);
      sent++;
    } catch (e) {
      const attempts = row.attempts + 1;
      await sba.from('pending_emails')
        .update({
          attempts,
          last_error: e.message,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
        })
        .eq('id', row.id);
      console.error(`[email-queue] send failed (attempt ${attempts}):`, row.type, row.recipient_email, e.message);
      failed++;
    }
  }

  return res.status(200).json({ processed: rows?.length || 0, sent, failed });
};
