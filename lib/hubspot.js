'use strict';

// HubSpot CRM sync — server-side only. Token stays in env, never in HTML.
// Every helper is awaited by its caller: Vercel freezes a function once the response
// is sent, so fire-and-forget (setImmediate) calls never actually reached HubSpot.

const HS_TOKEN = () => process.env.HUBSPOT_TOKEN || '';

// Returns { status, data }. Non-2xx responses are logged with HubSpot's message
// instead of being swallowed, so a bad token or missing scope shows up in the logs.
async function hsRequest(method, path, body) {
  const token = HS_TOKEN();
  if (!token) return { status: 0, data: { message: 'HUBSPOT_TOKEN not set' } };

  const https = require('https');
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.hubapi.com',
      path,
      method,
      timeout: 8000,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        let data = null;
        try { data = d ? JSON.parse(d) : null; } catch { data = { message: d.slice(0, 200) }; }
        if (res.statusCode >= 300) console.error('[hubspot]', method, path, res.statusCode, data?.message || '');
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', e => {
      console.error('[hubspot]', method, path, e.message);
      resolve({ status: 0, data: { message: e.message } });
    });
    if (payload) req.write(payload);
    req.end();
  });
}

const ok = r => r.status >= 200 && r.status < 300;
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null && v !== ''));

async function findOne(objectType, propertyName, value) {
  const r = await hsRequest('POST', `/crm/v3/objects/${objectType}/search`, {
    filterGroups: [{ filters: [{ propertyName, operator: 'EQ', value }] }],
    properties: [propertyName],
    limit: 1,
  });
  return ok(r) ? r.data?.results?.[0]?.id || null : null;
}

// Create or update a record. Lifecycle stage is only set on create: HubSpot rejects
// moving an existing record backwards (e.g. customer → lead).
async function upsert(objectType, idProp, idValue, props, lifecycle) {
  const existing = idValue ? await findOne(objectType, idProp, idValue) : null;
  if (existing) {
    const r = await hsRequest('PATCH', `/crm/v3/objects/${objectType}/${existing}`, { properties: clean(props) });
    if (!ok(r)) throw new Error(`HubSpot ${r.status}: ${r.data?.message || 'update failed'}`);
    return existing;
  }
  const r = await hsRequest('POST', `/crm/v3/objects/${objectType}`, {
    properties: clean({ ...props, lifecyclestage: lifecycle }),
  });
  if (!ok(r)) throw new Error(`HubSpot ${r.status}: ${r.data?.message || 'create failed'}`);
  return r.data?.id || null;
}

// Upsert a contact (by email); returns the HubSpot contact id. Throws with HubSpot's message on failure.
async function upsertContact({ email, name, phone, city, lifecycle = 'lead' }) {
  if (!email) throw new Error('Contact has no email address');
  const [first, ...rest] = String(name || '').trim().split(/\s+/);
  return upsert('contacts', 'email', email, {
    email,
    firstname: first || null,
    lastname: rest.join(' ') || null,
    phone,
    city,
    ...(lifecycle === 'lead' ? { hs_lead_status: 'NEW' } : {}),
  }, lifecycle);
}

// Upsert a company (by name); returns the HubSpot company id.
async function upsertCompany({ name, city, province, phone, website, type, lifecycle = 'lead' }) {
  if (!name) throw new Error('Company has no name');
  return upsert('companies', 'name', name, {
    name,
    city,
    state: province,
    phone,
    website: website ? String(website).replace(/^https?:\/\//, '').replace(/\/$/, '') : null,
    description: type ? `Pulsify: ${type}` : null,
    country: 'South Africa',
  }, lifecycle);
}

async function associate(fromType, fromId, toType, toId) {
  if (!fromId || !toId) return;
  await hsRequest('PUT', `/crm/v4/objects/${fromType}/${fromId}/associations/default/${toType}/${toId}`);
}

// Push one Pulsify lead (scraped organizer/venue, or a new registration) into HubSpot:
// a company always, plus a contact when there's an email. Returns { companyId, contactId }.
async function pushLead({ name, email, phone, city, province, website, category }) {
  const companyId = await upsertCompany({ name, city, province, phone, website, type: category });
  let contactId = null;
  if (email) {
    contactId = await upsertContact({ email, name, phone, city });
    await associate('contacts', contactId, 'companies', companyId);
  }
  return { companyId, contactId };
}

// Log a ticket sale: buyer contact (lifecycle customer) + closed-won deal.
async function syncTicketPurchase({ buyerName, buyerEmail, buyerPhone, eventName, totalPaid, bookingRef }) {
  if (!HS_TOKEN() || !buyerEmail) return;
  try {
    const contactId = await upsertContact({ email: buyerEmail, name: buyerName, phone: buyerPhone, lifecycle: 'customer' });
    const r = await hsRequest('POST', '/crm/v3/objects/deals', {
      properties: {
        dealname:  `${eventName} — ${buyerName} (${bookingRef})`,
        amount:    String(totalPaid ?? 0),
        dealstage: 'closedwon',
        closedate: new Date().toISOString().split('T')[0],
        pipeline:  'default',
      },
    });
    if (ok(r)) await associate('deals', r.data.id, 'contacts', contactId);
  } catch (e) {
    console.error('[hubspot/syncTicketPurchase]', e.message);
  }
}

// Sync a new business/organizer registration (company + contact, lifecycle lead).
async function syncBusinessRegistration({ name, email, phone, city, province, category, role }) {
  if (!HS_TOKEN()) return;
  try {
    await pushLead({ name, email, phone, city, province, category: category || role });
  } catch (e) {
    console.error('[hubspot/syncBusinessRegistration]', e.message);
  }
}

// Cheap connectivity check: is a token set, and does HubSpot accept it for contacts + companies?
async function hubspotStatus() {
  if (!HS_TOKEN()) return { configured: false };
  const [c, co] = await Promise.all([
    hsRequest('GET', '/crm/v3/objects/contacts?limit=1'),
    hsRequest('GET', '/crm/v3/objects/companies?limit=1'),
  ]);
  return { configured: true, contacts: c.status, companies: co.status, ok: ok(c) && ok(co) };
}

module.exports = { syncTicketPurchase, syncBusinessRegistration, upsertContact, pushLead, hubspotStatus };
