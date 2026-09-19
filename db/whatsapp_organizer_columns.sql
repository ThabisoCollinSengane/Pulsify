-- Phase 2b: Per-organizer WhatsApp columns on profiles
-- Each premium organizer can register a dedicated WhatsApp number under Pulsify's Meta Business Account.
-- Routing: webhook reads phone_number_id → looks up organizer → scopes events to their own.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_phone_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_display_number TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS whatsapp_verified BOOL DEFAULT false;
