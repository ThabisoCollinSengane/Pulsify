const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465');
const SMTP_USER = process.env.SMTP_USER || 'hello@pulsefy.co.za';
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_NAME = 'Pulsefy';
const FROM_ADDR = SMTP_USER;
const APP_URL   = process.env.APP_URL || 'https://pulsify.vercel.app';
const YEAR      = new Date().getFullYear();

function transport() {
  return nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth:   { user: SMTP_USER, pass: SMTP_PASS },
    tls:    { rejectUnauthorized: false },
  });
}

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

      <!-- FOOTER -->
      <tr><td style="padding-top:28px;text-align:center;font-size:12px;color:#4a4a4a;line-height:1.8">
        <p style="margin:0">© ${YEAR} Pulsefy · South Africa</p>
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
  if (!SMTP_HOST || !SMTP_PASS) {
    console.log('[email] SMTP not configured — skipping:', subject, '->', to);
    return;
  }
  try {
    await transport().sendMail({ from: `${FROM_NAME} <${FROM_ADDR}>`, to, subject, html });
    console.log('[email] sent:', subject, '->', to);
  } catch (e) {
    console.error('[email] failed:', e.message);
  }
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

module.exports = { sendWelcomeEmail, sendVerifApprovedEmail, sendVerifRejectedEmail, sendPaymentConfirmEmail };
