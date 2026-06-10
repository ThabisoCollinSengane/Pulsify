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
- `{{ .Data }}` — the user's `user_metadata` (e.g. `{{ .Data.role }}`)
- `{{ .SiteURL }}` — your site URL

## PNG signature image

Every template ends with a footer signature that embeds the Pulsefy logo:

```html
<img src="https://pulsefy.co.za/logo.png" alt="Pulsefy — Feel the Vibe" width="130" .../>
```

The image is referenced by **absolute URL** — emails can't use local file paths.
It resolves to `apps/landing-page/logo.png`, which deploys to
`https://pulsefy.co.za/logo.png`. If you ever move or rename that file, update
the `src` in all six templates. The text wordmark at the top still renders even
when a mail client blocks images, so the email is always readable.

## Role-aware signup confirmation

`confirm-signup.html` adapts its welcome block to the account type chosen on the
signup page. The signup flow (`apps/landing-page/create-account.html`) stores the
chosen `role` in `user_metadata`, which GoTrue exposes as `{{ .Data.role }}`:

| `role` value | Welcome shown |
|--------------|---------------|
| `organizer`  | 🎪 Organizer — create events, sell tickets, track sales |
| `business`   | 🏪 Business — list your venue, post your menu, take orders |
| anything else (`user`) | 🎟 Discover events, book tickets, roll with your squad |

This is a single Supabase template — Supabase has only one "Confirm signup" slot,
so the per-type copy is handled with the `{{ if eq .Data.role ... }}` conditional
inside the one file. Paste it as-is; the branching happens server-side at send time.

## Email delivery — Resend (this project's provider)

Pulsefy sends email through **[Resend](https://resend.com)** via its SMTP relay.
There are **two independent email systems**, and both point at Resend:

| System | What it sends | Where it's configured |
|--------|---------------|-----------------------|
| **Supabase Auth** | The 6 templates in this folder (signup, reset, magic link, etc.) | Supabase Dashboard → SMTP Settings |
| **App transactional** (`api/email.js`) | Welcome, ticket, payment confirm, verification result | Vercel env vars (nodemailer SMTP) |

### Resend SMTP credentials (same for both systems)

| Field | Value |
|-------|-------|
| Host | `smtp.resend.com` |
| Port | `465` (SSL) or `587` (TLS) |
| Username | `resend` (literally the word `resend`) |
| Password | your Resend API key (`re_...`) |
| Sender | `hello@pulsefy.co.za` (must be a **verified domain** in Resend) |
| Sender name | `Pulsefy` |

Before anything sends, verify the `pulsefy.co.za` domain in Resend
(**Resend Dashboard → Domains → Add Domain**) and add the DKIM/SPF DNS records
it gives you. Until the domain shows **Verified**, Resend rejects the sends.

### 1. Supabase Auth emails

Dashboard → **Project Settings → Auth → SMTP Settings**

- Turn **Enable Custom SMTP** ON (it sometimes silently flips off after saving).
- Fill in the Resend credentials from the table above.
- Click **Send test email**. If it fails, the same error hits `forgot password`
  and `signup` — fix SMTP before debugging anything else.

Then under **Auth → Rate Limits**, raise the email send limit (Supabase's
built-in sender defaults to ~4/hr; with Resend you can safely go to 30/hr+).

### 2. App transactional emails (`api/email.js`)

`api/email.js` uses `nodemailer` and reads these **Vercel environment variables**
(Project → Settings → Environment Variables):

| Env var | Value |
|---------|-------|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | your Resend API key (`re_...`) |
| `APP_URL`   | `https://pulsefy.co.za` |

If `SMTP_HOST` / `SMTP_PASS` are unset, `api/email.js` silently skips sending
(it logs `[email] SMTP not configured — skipping`) — so missing env vars look
like "emails just don't arrive" with no error. Set them and redeploy.

> The same Resend API key works as both the SMTP password here **and** the
> Supabase SMTP password — one key covers both systems.

## Local preview

To preview a template in your browser:

```bash
open email-templates/reset-password.html
```

Supabase template variables won't be replaced (they'll appear literally) — that's expected.
