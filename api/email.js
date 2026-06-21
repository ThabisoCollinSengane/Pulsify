const nodemailer = require('nodemailer');
const crypto     = require('crypto');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || 'hello@pulsefy.co.za';
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = 'Pulsefy';
const FROM_ADDR = SMTP_USER;
const APP_URL   = process.env.APP_URL || 'https://pulsify.vercel.app';
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://pulsefy.co.za';
const REPLY_TO   = process.env.REPLY_TO || 'hello@pulsefy.co.za';
const YEAR      = new Date().getFullYear();

// Resend is preferred when configured — cPanel/shared-host SMTP silently drops
// mail (accepts the handshake, never delivers). Resend with a verified domain
// delivers reliably. Falls back to SMTP only if RESEND_API_KEY is absent.
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM    = process.env.RESEND_FROM || `${FROM_NAME} <${FROM_ADDR}>`;

// One-click unsubscribe token — HMAC of the lowercased email so the unsubscribe
// endpoint can verify the link without a DB lookup. Shared with api/admin.
const UNSUB_SECRET = process.env.UNSUB_SECRET || RESEND_API_KEY || 'pulsefy-unsub-fallback';
function unsubToken(email) {
  return crypto.createHmac('sha256', UNSUB_SECRET).update(String(email || '').toLowerCase()).digest('hex').slice(0, 24);
}
function unsubUrl(email) {
  return `${PUBLIC_URL}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubToken(email)}`;
}
// List-Unsubscribe headers — marketing email ONLY. Gmail/Outlook surface a
// native "Unsubscribe" link and trust the sender far more, which keeps mail
// out of spam. Never add these to transactional mail (tickets/password/orders).
function marketingHeaders(email) {
  const url = unsubUrl(email);
  return {
    'List-Unsubscribe': `<${url}>, <mailto:unsubscribe@pulsefy.co.za?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

function transport() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

// Single delivery path for every email. Returns true only if the provider
// actually accepted the message (Resend 2xx, or SMTP without throwing).
// opts: { headers?: object, replyTo?: string }
async function deliver(to, subject, html, opts = {}) {
  const { headers, replyTo = REPLY_TO } = opts;
  if (RESEND_API_KEY) {
    try {
      const payload = { from: RESEND_FROM, to: [to], subject, html, reply_to: replyTo };
      if (headers && Object.keys(headers).length) payload.headers = headers;
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (r.ok) { console.log('[email] resend sent:', subject, '->', to); return true; }
      console.error('[email] resend rejected:', r.status, await r.text());
      return false;
    } catch (e) {
      console.error('[email] resend error:', e.message);
      return false;
    }
  }
  if (SMTP_HOST && SMTP_PASS) {
    try {
      await transport().sendMail({ from: `${FROM_NAME} <${FROM_ADDR}>`, to, subject, html, replyTo, headers });
      console.log('[email] smtp sent:', subject, '->', to);
      return true;
    } catch (e) {
      console.error('[email] smtp failed:', e.message);
      return false;
    }
  }
  console.log('[email] no provider configured — skipping:', subject, '->', to);
  return false;
}

const EMAIL_CONFIGURED = !!(RESEND_API_KEY || (SMTP_HOST && SMTP_PASS));

// ─── Base layout ──────────────────────────────────────────────────────────────
function layout(body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<title>Pulsefy</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;color:#ffffff;-webkit-font-smoothing:antialiased">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d0d0d;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

      <!-- LOGO -->
      <tr><td style="padding-bottom:28px">
        <span style="font-size:26px;font-weight:900;letter-spacing:-1px;color:#B026FF">◉</span>
        <span style="font-size:26px;font-weight:900;letter-spacing:-1px;color:#ffffff"> PULSEFY</span>
      </td></tr>

      ${body}

      <!-- FOOTER + SIGNATURE -->
      <tr><td style="padding-top:32px;text-align:center;font-size:12px;color:#4a4a4a;line-height:1.8">
        <img src="https://pulsefy.co.za/logo.png" alt="Pulsefy — Feel the Vibe" width="130" style="display:inline-block;width:130px;max-width:130px;height:auto;border:0;outline:none;text-decoration:none"/>
        <p style="margin:14px 0 0">© ${YEAR} Pulsefy · South Africa 🇿🇦</p>
        <p style="margin:4px 0 0">This email was sent because you have a Pulsefy account.
        <a href="${APP_URL}" style="color:#4a4a4a;text-decoration:underline">Visit Pulsefy</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function card(content) {
  return `<tr><td style="background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:32px;margin-bottom:20px">${content}</td></tr>`;
}

function btn(href, label) {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:20px">
    <tr><td style="background:#B026FF;border-radius:50px;padding:0">
      <a href="${href}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:50px;font-family:Arial,Helvetica,sans-serif">${label}</a>
    </td></tr>
  </table>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────
function welcomeHtml(displayName) {
  const name = (displayName || 'there').split(' ')[0];
  return layout(`
    ${card(`
      <p style="font-size:36px;margin:0 0 16px">🎉</p>
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff;line-height:1.3">Welcome to Pulsefy, ${name}!</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#a0a0a0;line-height:1.7">You're in. Pulsefy is South Africa's go-to platform for discovering events, connecting with friends, and keeping up with what's happening near you.</p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
        <tr>
          <td style="padding:10px 12px;background:rgba(176,38,255,.1);border:1px solid rgba(176,38,255,.2);border-radius:10px;font-size:14px;color:#c060ff;font-weight:700">🎟 Discover Events</td>
          <td width="10"></td>
          <td style="padding:10px 12px;background:rgba(255,92,0,.1);border:1px solid rgba(255,92,0,.2);border-radius:10px;font-size:14px;color:#ff7020;font-weight:700">🗺 Explore the Map</td>
        </tr>
        <tr><td colspan="3" height="10"></td></tr>
        <tr>
          <td style="padding:10px 12px;background:rgba(0,229,255,.07);border:1px solid rgba(0,229,255,.18);border-radius:10px;font-size:14px;color:#00e5ff;font-weight:700">👥 Join a Squad</td>
          <td width="10"></td>
          <td style="padding:10px 12px;background:rgba(255,45,120,.08);border:1px solid rgba(255,45,120,.2);border-radius:10px;font-size:14px;color:#ff2d78;font-weight:700">📸 Follow Organisers</td>
        </tr>
      </table>
      <hr style="border:none;border-top:1px solid #2a2a2a;margin:20px 0"/>
      <p style="margin:0 0 4px;font-size:14px;color:#a0a0a0">Ready to explore?</p>
      ${btn(APP_URL, 'Open Pulsefy →')}
    `)}
    <tr><td height="16"></td></tr>
    ${card(`
      <p style="margin:0;font-size:13px;color:#606060;line-height:1.7">
        <strong style="color:#888">💡 Pro tip:</strong> Complete your profile and add your city to get personalised event recommendations near you.<br/><br/>
        Questions? Just reply to this email — we read every one.
      </p>
    `)}
  `);
}

function verifApprovedHtml(displayName) {
  const name = (displayName || 'there').split(' ')[0];
  return layout(`
    ${card(`
      <p style="font-size:48px;margin:0 0 16px">✅</p>
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff">You're Verified, ${name}!</h1>
      <p style="margin:0 0 16px;font-size:15px;color:#a0a0a0;line-height:1.7">
        Your Pulsefy identity has been reviewed and <strong style="color:#00e5a0">approved</strong>. A verified badge now appears on your profile, visible to everyone on Pulsefy.
      </p>
      <table cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="padding:12px 20px;background:rgba(0,229,160,.08);border:1px solid rgba(0,229,160,.2);border-radius:12px;font-size:14px;color:#00e5a0;line-height:1.6">
            ◉ Your events and posts now receive <strong>boosted visibility</strong> across the platform.
          </td>
        </tr>
      </table>
      ${btn(APP_URL, 'View Your Profile →')}
    `)}
  `);
}

function verifRejectedHtml(displayName, notes) {
  const name = (displayName || 'there').split(' ')[0];
  const reasonBlock = notes
    ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
        <tr><td style="background:rgba(255,45,120,.08);border:1px solid rgba(255,45,120,.2);border-radius:10px;padding:14px 16px;font-size:14px;color:#ff6090;line-height:1.6">
          <strong>Reason:</strong> ${notes}
        </td></tr>
      </table>`
    : '';
  return layout(`
    ${card(`
      <h1 style="margin:0 0 12px;font-size:22px;font-weight:800;color:#ffffff">Verification Update, ${name}</h1>
      <p style="margin:0 0 12px;font-size:15px;color:#a0a0a0;line-height:1.7">
        Thank you for applying for verification on Pulsefy. Unfortunately, your application was not approved at this time.
      </p>
      ${reasonBlock}
      <p style="margin:0 0 4px;font-size:14px;color:#707070;line-height:1.7">
        You're welcome to reapply after updating your profile and documentation. If you have any questions, just reply to this email.
      </p>
      ${btn(`${APP_URL}/?tab=settings`, 'Reapply for Verification →')}
    `)}
  `);
}

// ─── Send helper ──────────────────────────────────────────────────────────────
async function send(to, subject, html) {
  await deliver(to, subject, html);
}

// ─── Public API ───────────────────────────────────────────────────────────────
async function sendWelcomeEmail(to, displayName) {
  await send(to, 'Welcome to Pulsefy 🎉', welcomeHtml(displayName));
}

async function sendVerifApprovedEmail(to, displayName) {
  await send(to, "You're Verified on Pulsefy ✓", verifApprovedHtml(displayName));
}

async function sendVerifRejectedEmail(to, displayName, notes) {
  await send(to, 'Your Pulsefy Verification Update', verifRejectedHtml(displayName, notes));
}

function paymentConfirmHtml(displayName, amountCents, type) {
  const name = (displayName || 'there').split(' ')[0];
  const labels = {
    ticket:                   'Ticket Purchase',
    subscription_organizer:   'Organizer Premium Plan',
    subscription_business:    'Business Premium Plan',
    promotion:                'Event Promotion',
  };
  const label = labels[type] || 'Payment';
  const amt   = `R${(amountCents / 100).toFixed(2)}`;
  return layout(`
    ${card(`
      <p style="font-size:36px;margin:0 0 16px">✅</p>
      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#ffffff">Payment Confirmed!</h1>
      <p style="margin:0 0 20px;font-size:15px;color:#a0a0a0;line-height:1.7">
        Hi ${name}, your payment has been received. Here's your summary:
      </p>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px">
        <tr>
          <td style="padding:12px 16px;background:rgba(0,229,160,.07);border:1px solid rgba(0,229,160,.18);border-radius:12px">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-size:13px;color:#707070">Description</td>
                <td align="right" style="font-size:13px;color:#707070">Amount</td>
              </tr>
              <tr>
                <td style="font-size:15px;font-weight:700;color:#ffffff;padding-top:4px">${label}</td>
                <td align="right" style="font-size:18px;font-weight:800;color:#00e5a0;padding-top:4px">${amt}</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      ${btn(APP_URL, 'Open Pulsefy →')}
    `)}
  `);
}

async function sendPaymentConfirmEmail(to, displayName, amountCents, type) {
  await send(to, `Payment Confirmed — R${(amountCents / 100).toFixed(2)}`, paymentConfirmHtml(displayName, amountCents, type));
}

// ─── Ticket email ─────────────────────────────────────────────────────────────
function ticketHtml(buyerName, eventName, eventDate, venueName, venueCity, bookingRef, tierName, quantity, totalPaid, isFree, qrData) {
  const priceLabel = isFree ? 'FREE' : `R${Number(totalPaid).toFixed(2)}`;
  const dateLabel  = eventDate ? new Date(eventDate).toLocaleDateString('en-ZA', { weekday:'long', year:'numeric', month:'long', day:'numeric' }) : '';
  const qrUrl      = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(qrData)}&bgcolor=0d0d0d&color=FF5C00&margin=2`;
  return layout(`
    ${card(`
      <p style="font-size:36px;margin:0 0 12px">🎟️</p>
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#ffffff">Your ticket is confirmed!</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#a0a0a0">Hi ${buyerName || 'there'}, you're going to <strong style="color:#fff">${eventName}</strong>.</p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;background:rgba(255,92,0,.07);border:1px solid rgba(255,92,0,.25);border-radius:12px;padding:16px">
        <tr><td style="padding:4px 0">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${eventDate ? `<tr><td style="font-size:12px;color:#707070;padding-bottom:8px">📅 Date</td><td align="right" style="font-size:13px;font-weight:700;color:#fff;padding-bottom:8px">${dateLabel}</td></tr>` : ''}
            ${venueName || venueCity ? `<tr><td style="font-size:12px;color:#707070;padding-bottom:8px">📍 Venue</td><td align="right" style="font-size:13px;font-weight:700;color:#fff;padding-bottom:8px">${[venueName,venueCity].filter(Boolean).join(', ')}</td></tr>` : ''}
            ${tierName ? `<tr><td style="font-size:12px;color:#707070;padding-bottom:8px">🎫 Ticket</td><td align="right" style="font-size:13px;font-weight:700;color:#fff;padding-bottom:8px">${tierName} × ${quantity}</td></tr>` : `<tr><td style="font-size:12px;color:#707070;padding-bottom:8px">🎫 Qty</td><td align="right" style="font-size:13px;font-weight:700;color:#fff;padding-bottom:8px">${quantity} ticket${quantity>1?'s':''}</td></tr>`}
            <tr><td style="font-size:12px;color:#707070;padding-bottom:8px">💳 Total</td><td align="right" style="font-size:15px;font-weight:800;color:#C6FF4A;padding-bottom:8px">${priceLabel}</td></tr>
            <tr><td style="font-size:12px;color:#707070">🔖 Ref</td><td align="right" style="font-size:13px;font-weight:700;color:#FF5C00;font-family:monospace">${bookingRef}</td></tr>
          </table>
        </td></tr>
      </table>

      <p style="font-size:13px;color:#a0a0a0;margin:0 0 12px;text-align:center">Show this QR code at the entrance:</p>
      <div style="text-align:center;margin-bottom:16px">
        <img src="${qrUrl}" width="180" height="180" alt="QR Code" style="border-radius:12px;background:#1a1a1a"/>
      </div>
      <p style="font-size:11px;color:#555;text-align:center;margin:0 0 16px">QR ref: ${bookingRef}</p>
      ${btn(APP_URL + '/tickets', 'View My Tickets →')}
    `)}
  `);
}

async function sendTicketEmail(to, buyerName, eventName, eventDate, venueName, venueCity, bookingRef, tierName, quantity, totalPaid, isFree, qrData) {
  await send(to, `🎟 Your ticket for ${eventName}`, ticketHtml(buyerName, eventName, eventDate, venueName, venueCity, bookingRef, tierName, quantity, totalPaid, isFree, qrData));
}

// ─── Lead outreach email (CRM bulk send) ──────────────────────────────────────
function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function leadHtml(bodyText) {
  const safe = escapeHtml(bodyText).replace(/\n/g, '<br/>');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Pulsefy</title>
</head>
<body style="margin:0;padding:0;background:#0d0d0d;font-family:Arial,Helvetica,sans-serif;color:#ffffff">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0d0d0d;padding:40px 16px">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">

      <!-- GRADIENT HEADER BANNER -->
      <tr><td style="background:linear-gradient(135deg,#B026FF 0%,#FF5C00 100%);border-radius:20px 20px 0 0;padding:26px 32px 24px">
        <span style="font-size:28px;font-weight:900;letter-spacing:-1px;color:#fff">◉ PULSEFY</span><br/>
        <span style="font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.78)">South Africa's Event &amp; Entertainment Platform</span>
      </td></tr>

      <!-- BODY CARD -->
      <tr><td style="background:#1a1a1a;border-left:1px solid #2a2a2a;border-right:1px solid #2a2a2a;border-bottom:1px solid #2a2a2a;border-radius:0 0 20px 20px;padding:28px 32px 32px">
        <p style="margin:0 0 24px;font-size:15px;color:#d0d0d0;line-height:1.8">${safe}</p>

        <!-- 3 benefit cards -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px">
          <tr>
            <td width="33%" style="padding:14px 12px;background:rgba(176,38,255,.12);border:1px solid rgba(176,38,255,.3);border-radius:12px;text-align:center">
              <div style="font-size:22px;line-height:1;margin-bottom:6px">🆓</div>
              <div style="font-size:11px;font-weight:700;color:#c060ff;text-transform:uppercase;letter-spacing:.08em">List Free</div>
            </td>
            <td width="6" style="min-width:6px"></td>
            <td width="33%" style="padding:14px 12px;background:rgba(255,92,0,.1);border:1px solid rgba(255,92,0,.25);border-radius:12px;text-align:center">
              <div style="font-size:22px;line-height:1;margin-bottom:6px">📍</div>
              <div style="font-size:11px;font-weight:700;color:#ff7020;text-transform:uppercase;letter-spacing:.08em">Reach KZN</div>
            </td>
            <td width="6" style="min-width:6px"></td>
            <td width="33%" style="padding:14px 12px;background:rgba(198,255,74,.07);border:1px solid rgba(198,255,74,.2);border-radius:12px;text-align:center">
              <div style="font-size:22px;line-height:1;margin-bottom:6px">🎟️</div>
              <div style="font-size:11px;font-weight:700;color:#c6ff4a;text-transform:uppercase;letter-spacing:.08em">Sell Tickets</div>
            </td>
          </tr>
        </table>

        <table cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:linear-gradient(135deg,#B026FF,#FF5C00);border-radius:50px;padding:0">
            <a href="${APP_URL}/?utm_source=crm&utm_medium=email" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:50px;font-family:Arial,Helvetica,sans-serif">Join Pulsefy Free →</a>
          </td></tr>
        </table>
      </td></tr>

      <tr><td height="20"></td></tr>
      <!-- FOOTER -->
      <tr><td style="text-align:center;font-size:11px;color:#4a4a4a;line-height:1.8">
        <p style="margin:0">© ${YEAR} Pulsefy · South Africa 🇿🇦</p>
        <p style="margin:4px 0 0"><a href="${APP_URL}" style="color:#4a4a4a;text-decoration:underline">pulsefy.co.za</a></p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// Returns true only if the provider accepted the message, false otherwise.
async function sendLeadEmail(to, subject, bodyText) {
  // Lead/CRM outreach is marketing — include one-click unsubscribe.
  return deliver(to, subject, leadHtml(bodyText), { headers: marketingHeaders(to) });
}

// ─── Food / pickup order confirmation ─────────────────────────────────────────
function orderHtml(customerName, businessName, orderRef, items, total, pickupTime) {
  const rows = (Array.isArray(items) ? items : []).map(it => {
    const name = escapeHtml(it.name || it.title || 'Item');
    const qty  = it.qty || it.quantity || 1;
    const price = it.price != null ? `R${Number(it.price).toFixed(2)}` : '';
    return `<tr>
      <td style="font-size:13px;color:#fff;padding:6px 0">${name} × ${qty}</td>
      <td align="right" style="font-size:13px;color:#a0a0a0;padding:6px 0">${price}</td>
    </tr>`;
  }).join('');
  return layout(`
    ${card(`
      <p style="font-size:36px;margin:0 0 12px">🍔</p>
      <h1 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#ffffff">Order confirmed!</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#a0a0a0">Hi ${escapeHtml(customerName) || 'there'}, your order at <strong style="color:#fff">${escapeHtml(businessName) || 'the venue'}</strong> is in.</p>

      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:20px;background:rgba(255,92,0,.07);border:1px solid rgba(255,92,0,.25);border-radius:12px;padding:16px">
        <tr><td style="padding:4px 0">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            ${rows}
            <tr><td colspan="2" style="border-top:1px solid #2a2a2a;padding-top:10px"></td></tr>
            <tr>
              <td style="font-size:14px;font-weight:700;color:#fff;padding-top:6px">Total</td>
              <td align="right" style="font-size:16px;font-weight:800;color:#C6FF4A;padding-top:6px">R${Number(total || 0).toFixed(2)}</td>
            </tr>
            ${pickupTime ? `<tr><td style="font-size:12px;color:#707070;padding-top:8px">⏰ Pickup</td><td align="right" style="font-size:13px;font-weight:700;color:#fff;padding-top:8px">${escapeHtml(pickupTime)}</td></tr>` : ''}
            <tr><td style="font-size:12px;color:#707070;padding-top:8px">🔖 Ref</td><td align="right" style="font-size:13px;font-weight:700;color:#FF5C00;font-family:monospace;padding-top:8px">${escapeHtml(orderRef)}</td></tr>
          </table>
        </td></tr>
      </table>
      <p style="font-size:13px;color:#a0a0a0;margin:0 0 4px;text-align:center">Show this reference when you collect your order.</p>
      ${btn(APP_URL + '/?tab=tickets', 'View My Orders →')}
    `)}
  `);
}

async function sendOrderEmail(to, customerName, businessName, orderRef, items, total, pickupTime) {
  return deliver(to, `🍔 Order confirmed — ${businessName || 'Pulsefy'} (${orderRef})`,
    orderHtml(customerName, businessName, orderRef, items, total, pickupTime));
}

// ─── Marketing blast (promotions / trending events) ───────────────────────────
function marketingBodyHtml(headline, bodyText, ctaLabel, ctaUrl, unsub) {
  const safe = escapeHtml(bodyText).replace(/\n/g, '<br/>');
  return layout(`
    ${card(`
      ${headline ? `<h1 style="margin:0 0 14px;font-size:22px;font-weight:800;color:#ffffff;line-height:1.3">${escapeHtml(headline)}</h1>` : ''}
      <p style="margin:0;font-size:15px;color:#d0d0d0;line-height:1.7">${safe}</p>
      ${ctaUrl ? btn(ctaUrl, ctaLabel || 'Open Pulsefy →') : btn(APP_URL, 'Open Pulsefy →')}
    `)}
    <tr><td style="padding-top:16px;text-align:center;font-size:11px;color:#4a4a4a">
      <a href="${unsub}" style="color:#707070;text-decoration:underline">Unsubscribe from Pulsefy promotional emails</a>
    </td></tr>
  `);
}

// Marketing email — always carries one-click unsubscribe headers + an in-body
// unsubscribe link (POPIA). Returns true only if the provider accepted it.
async function sendMarketingEmail(to, subject, headline, bodyText, ctaLabel, ctaUrl) {
  const html = marketingBodyHtml(headline, bodyText, ctaLabel, ctaUrl, unsubUrl(to));
  return deliver(to, subject, html, { headers: marketingHeaders(to) });
}

module.exports = {
  sendWelcomeEmail, sendVerifApprovedEmail, sendVerifRejectedEmail,
  sendPaymentConfirmEmail, sendTicketEmail, sendLeadEmail,
  sendOrderEmail, sendMarketingEmail, unsubToken, EMAIL_CONFIGURED,
};
