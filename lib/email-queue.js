const { sb } = require('./shared');

// Insert an email job into pending_emails.
// The api/cron/email-queue cron drains it every 15 minutes with up to 3 retries.
// type values: 'ticket' | 'payment_confirm' | 'welcome' | 'verif_approved' | 'verif_rejected'
async function queueEmail(type, recipient_email, payload) {
  const { error } = await sb().from('pending_emails').insert({ type, recipient_email, payload });
  if (error) console.error('[email-queue] insert failed:', error.message);
}

module.exports = { queueEmail };
