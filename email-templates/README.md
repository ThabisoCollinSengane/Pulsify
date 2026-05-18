# Pulsefy Email Templates

HTML templates for Supabase Auth emails, branded for Pulsefy.

## Templates

| File | Supabase Template | Subject (suggested) |
|------|-------------------|---------------------|
| `confirm-signup.html` | Confirm signup | Confirm your Pulsefy account |
| `reset-password.html` | Reset Password | Reset your Pulsefy password |
| `magic-link.html` | Magic Link | Your Pulsefy sign-in link |
| `invite-user.html` | Invite user | You're invited to Pulsefy |
| `change-email.html` | Change Email Address | Confirm your new Pulsefy email |
| `reauthentication.html` | Reauthentication | Confirm it's you — Pulsefy |

## How to apply them

Email templates have to be pasted into the Supabase Dashboard — they cannot be set via API.

1. Open https://supabase.com/dashboard/project/cjzewfvtdayjgjdpdmln/auth/templates
2. Click each template (Confirm signup, Magic Link, Invite user, Reset Password, Change Email Address, Reauthentication).
3. Open the matching `.html` file in this folder, copy its contents.
4. Paste into the **Source** tab of the Supabase template editor.
5. Set the **Subject** field using the suggestions in the table above.
6. Save.

## Template variables Supabase exposes

- `{{ .ConfirmationURL }}` — the action link (used everywhere except reauthentication)
- `{{ .Token }}` — the 6-digit OTP code (used in `reauthentication.html`)
- `{{ .TokenHash }}` — hashed token
- `{{ .Email }}` — current account email
- `{{ .NewEmail }}` — new email being switched to (`change-email.html` only)
- `{{ .SiteURL }}` — your site URL

## SMTP troubleshooting — "Request rate limit reached"

By default Supabase uses its built-in email sender, which is **strictly rate-limited**:

| Endpoint | Default limit | After custom SMTP |
|----------|--------------|-------------------|
| `auth/v1/recover` (forgot password) | 4 per hour per IP | Configurable (default 30/hr) |
| `auth/v1/signup` / verification | 4 per hour per IP | Configurable (default 30/hr) |

If you're hitting "Request rate limit reached" even after configuring cPanel SMTP, work through the checklist below in order:

### 1. Verify custom SMTP is actually saved

Dashboard → **Project Settings → Auth → SMTP Settings**

- **Enable Custom SMTP** toggle must be **ON** (it sometimes silently flips off after saving).
- Host: your cPanel mail host (usually `mail.pulsefy.co.za` or `pulsefy.co.za`).
- Port: `465` (SSL) or `587` (TLS). cPanel usually wants 465.
- Username: full email address (e.g. `noreply@pulsefy.co.za`), not just `noreply`.
- Password: the mailbox password (NOT your cPanel login password — the one for that specific mailbox).
- Sender email: same as username.
- Sender name: `Pulsefy`.

After saving, click **Send test email** at the bottom of the page. If the test email fails, SMTP is misconfigured and the same error will happen for `forgot password`.

### 2. Bump the rate limits

Dashboard → **Project Settings → Auth → Rate Limits**

After custom SMTP is verified, you can raise the limits:

- Token verifications: 30/hr → 150/hr
- Email sends: 4/hr → 30/hr (or higher)

These limits apply per IP, so each user still gets their own bucket — bumping them mainly helps the same user retry after a typo.

### 3. cPanel-side checks

If the test email in step 1 fails:

- In cPanel → **Email Accounts**, confirm the mailbox exists and the password works (try logging in to webmail with the same credentials).
- In cPanel → **Email Deliverability**, make sure SPF, DKIM and DMARC are green for `pulsefy.co.za`.
- Ask the cPanel admin to check if outbound SMTP is blocked at the firewall (some shared hosts block port 25/465/587 for non-cPanel apps).

### 4. Last resort: switch to a transactional provider

If cPanel SMTP can't be made reliable, swap to a dedicated transactional email provider — they're free up to ~3k emails/month and have much higher rate limits:

- **Resend** — easiest, modern dev UX, [resend.com](https://resend.com)
- **Postmark** — best deliverability, [postmarkapp.com](https://postmarkapp.com)
- **SendGrid** — most ubiquitous, [sendgrid.com](https://sendgrid.com)

The Supabase SMTP fields are the same for all of them — only the host/port/credentials change.

## Local preview

To preview a template in your browser:

```bash
open email-templates/reset-password.html
```

Supabase template variables won't be replaced (they'll appear literally) — that's expected.
