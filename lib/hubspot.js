'use strict';

// HubSpot CRM sync — server-side only. Token stays in env, never in HTML.
// All calls are fire-and-forget (non-blocking) via the exported helpers below.

const HS_BASE   = 'https://api.hubapi.com';
const HS_TOKEN  = () => process.env.HUBSPOT_TOKEN || '';

async function hsRequest(method, path, body) {
  const token = HS_TOKEN();
  if (!token) return null;

  const https = require('https');
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'api.hubapi.com',
      path,
      method,
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
        try { resolve(JSON.parse(d)); } catch { resolve(null); }
      });
    });
    req.on('error', e => {
      console.error('[hubspot]', method, path, e.message);
      resolve(null);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// Find a contact by email; returns HubSpot contact id or null.
async function findContact(email) {
  const r = await hsRequest('POST', '/crm/v3/objects/contacts/search', {
    filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
    properties: ['email'],
    limit: 1,
  });
  return r?.results?.[0]?.id || null;
}

// Find a company by name; returns HubSpot company id or null.
async function findCompany(name) {
  const r = await hsRequest('POST', '/crm/v3/objects/companies/search', {
    filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: name }] }],
    properties: ['name'],
    limit: 1,
  });
  return r?.results?.[0]?.id || null;
}

// Upsert a contact; returns HubSpot contact id or null.
async function upsertContact({ email, name, phone }) {
  try {
    const existing = await findContact(email);
    const props = {
      email,
      ...(name  ? { firstname: name.split(' ')[0], lastname: name.split(' ').slice(1).join(' ') || '' } : {}),
      ...(phone ? { phone } : {}),
    };
    if (existing) {
      await hsRequest('PATCH', `/crm/v3/objects/contacts/${existing}`, { properties: props });
      return existing;
    }
    const r = await hsRequest('POST', '/crm/v3/objects/contacts', { properties: props });
    return r?.id || null;
  } catch (e) {
    console.error('[hubspot/upsertContact]', e.message);
    return null;
  }
}

// Upsert a company (organizer or venue); returns HubSpot company id or null.
async function upsertCompany({ name, city, province, email, phone, type }) {
  try {
    const existing = await findCompany(name);
    const props = {
      name,
      ...(city     ? { city }                      : {}),
      ...(province ? { state: province }            : {}),
      ...(email    ? { email }                      : {}),
      ...(phone    ? { phone }                      : {}),
      ...(type     ? { industry: type }             : {}),
      country: 'South Africa',
    };
    if (existing) {
      await hsRequest('PATCH', `/crm/v3/objects/companies/${existing}`, { properties: props });
      return existing;
    }
    const r = await hsRequest('POST', '/crm/v3/objects/companies', { properties: props });
    return r?.id || null;
  } catch (e) {
    console.error('[hubspot/upsertCompany]', e.message);
    return null;
  }
}

// Log a ticket sale as a Deal; associates the contact if contactId provided.
async function logTicketDeal({ contactId, buyerName, eventName, amount, bookingRef }) {
  try {
    const props = {
      dealname:    `${eventName} — ${buyerName} (${bookingRef})`,
      amount:      String(amount),
      dealstage:   'closedwon',
      closedate:   new Date().toISOString().split('T')[0],
      pipeline:    'default',
    };
    const r = await hsRequest('POST', '/crm/v3/objects/deals', { properties: props });
    const dealId = r?.id;
    if (dealId && contactId) {
      await hsRequest('PUT',
        `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`, {}
      );
    }
    return dealId || null;
  } catch (e) {
    console.error('[hubspot/logTicketDeal]', e.message);
    return null;
  }
}

// Fire-and-forget: sync a ticket purchase to HubSpot (contact + deal).
function syncTicketPurchase({ buyerName, buyerEmail, buyerPhone, eventName, totalPaid, bookingRef }) {
  if (!HS_TOKEN()) return;
  setImmediate(async () => {
    try {
      const contactId = await upsertContact({ email: buyerEmail, name: buyerName, phone: buyerPhone });
      await logTicketDeal({ contactId, buyerName, eventName, amount: totalPaid, bookingRef });
    } catch (e) {
      console.error('[hubspot/syncTicketPurchase]', e.message);
    }
  });
}

// Fire-and-forget: sync a new business/organizer registration to HubSpot (company).
function syncBusinessRegistration({ name, email, phone, city, province, category, role }) {
  if (!HS_TOKEN()) return;
  setImmediate(async () => {
    try {
      await upsertCompany({ name, city, province, email, phone, type: category || role });
    } catch (e) {
      console.error('[hubspot/syncBusinessRegistration]', e.message);
    }
  });
}

module.exports = { syncTicketPurchase, syncBusinessRegistration, upsertContact };
