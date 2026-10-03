const crypto = require('crypto');
const { sb, sbAs, corsHeaders, verifyToken, rateLimited, captureError, validate } = require('../../lib/shared');
const { groqChat, groqEmbed, buildLumiSystemPrompt, lastGroqModel } = require('../../lib/groq');

/* ─── Lumi context helpers ─────────────────────────────────── */
// Dates are handled as SA-local YYYY-MM-DD strings (events.date_local is too).
const saToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dowOf   = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
const fmtDay  = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const todayLine = () => {
  const t = saToday();
  const long = new Date(t + 'T12:00:00Z').toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `\n\nTODAY IS ${long} (South Africa). Use it to interpret "tonight", "this weekend", "next week", and say dates naturally ("this Saturday", "tomorrow night") instead of raw dates.`;
};

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function detectDateRange(text) {
  const t = saToday(), dow = dowOf(t);
  if (/\b(tonight|today|this evening|right now|vanaand|vandag|namhlanje|namuhla|kusihlwa|kajeno|bosiu)\b/.test(text)) return { from: t, to: t, label: 'tonight' };
  if (/\b(tomorrow|kusasa|ngomso|hosane)\b/.test(text) || /(^|\s)môre(\s|$)/.test(text)) { const d = addDays(t, 1); return { from: d, to: d, label: 'tomorrow' }; }
  if (/\b(next weekend|volgende naweek)\b/.test(text)) { const fri = addDays(t, ((5 - dow + 7) % 7) + 7); return { from: fri, to: addDays(fri, 2), label: 'next weekend' }; }
  if (/\bnext week\b/.test(text)) { const mon = addDays(t, ((1 - dow + 7) % 7) || 7); return { from: mon, to: addDays(mon, 6), label: 'next week' }; }
  if (/\b(weekend|naweek|mpelasonto|impelaveki)\b/.test(text)) {
    const from = (dow === 6 || dow === 0) ? t : addDays(t, (5 - dow + 7) % 7);
    return { from, to: addDays(t, (7 - dow) % 7), label: 'this weekend' };
  }
  if (/\bthis week\b/.test(text)) return { from: t, to: addDays(t, (7 - dow) % 7), label: 'this week' };
  for (let i = 0; i < 7; i++) {
    if (new RegExp('\\b' + WEEKDAYS[i] + '\\b').test(text)) { const d = addDays(t, (i - dow + 7) % 7); return { from: d, to: d, label: WEEKDAYS[i] }; }
  }
  if (/\b(this month|next few weeks)\b/.test(text)) return { from: t, to: addDays(t, 30), label: 'the next month' };
  return null;
}

const CITY_ALIASES = [
  [/\b(durban|dbn|durbs|ethekwini|umhlanga|ballito|berea|glenwood|morningside|kzn|kwazulu)\b/, 'Durban'],
  [/\b(pietermaritzburg|pmb|maritzburg)\b/, 'Pietermaritzburg'],
  [/\b(johannesburg|joburg|jozi|jhb|egoli|sandton|rosebank|soweto|braamfontein|maboneng|midrand|fourways|randburg|melville|parkhurst)\b/, 'Johannesburg'],
  [/\b(pretoria|pta|tshwane|centurion|hatfield|menlyn|brooklyn)\b/, 'Pretoria'],
  [/\b(cape town|cpt|kaapstad|ikapa|camps bay|woodstock|sea point|green point|observatory|long street)\b/, 'Cape Town'],
  [/\b(stellenbosch|stellies)\b/, 'Stellenbosch'],
  [/\b(gqeberha|port elizabeth|nelson mandela bay)\b/, 'Gqeberha'],
  [/\b(east london|buffalo city)\b/, 'East London'],
  [/\b(bloemfontein|bloem|mangaung)\b/, 'Bloemfontein'],
  [/\b(polokwane)\b/, 'Polokwane'],
  [/\b(mbombela|nelspruit)\b/, 'Mbombela'],
];
const CITY_CENTERS = {
  Durban: [-29.86, 31.03], Johannesburg: [-26.20, 28.05], Pretoria: [-25.75, 28.19], 'Cape Town': [-33.92, 18.42],
  Gqeberha: [-33.96, 25.60], 'East London': [-33.02, 27.91], Bloemfontein: [-29.12, 26.21],
  Pietermaritzburg: [-29.60, 30.38], Polokwane: [-23.90, 29.45], Mbombela: [-25.47, 30.97], Stellenbosch: [-33.93, 18.86],
};
function nearestCity(lat, lon) {
  if (!(lat >= -35 && lat <= -22 && lon >= 16 && lon <= 33)) return null; // SA bounds
  let best = null, bestKm = 80;
  for (const [city, [clat, clon]] of Object.entries(CITY_CENTERS)) {
    const km = Math.hypot((lat - clat) * 111, (lon - clon) * 111 * Math.cos(lat * Math.PI / 180));
    if (km < bestKm) { best = city; bestKm = km; }
  }
  return best;
}

// Same vibe → genre mapping as the home-feed vibe chips (VIBE_MAP in index.html).
const VIBES = [
  [/\b(party|turn ?up|jol|dance|dancing|lit|rave|club(bing)?|groove)\b/, 'party', ['nightlife', 'gqom', 'amapiano', 'house', 'club', 'festival', 'student']],
  [/\b(chill|relax(ed|ing)?|laid ?back|calm|mellow|low[- ]key)\b/, 'chill', ['jazz', 'wellness', 'outdoor', 'comedy', 'art']],
  [/\b(luxury|upmarket|classy|fancy|vip|bougie|exclusive|premium)\b/, 'luxury', ['nightlife', 'festival', 'food']],
  [/\b(social|meet (new )?people|date night|with friends|squad)\b/, 'social', ['food', 'market', 'sport', 'comedy', 'social']],
  [/\b(cultur(e|al)|heritage|traditional)\b/, 'cultural', ['cultural', 'gospel', 'art']],
];
const GENRES = [
  [/\bamapiano|\bpiano\b/, 'amapiano'], [/\bgqom\b/, 'gqom'], [/\bafro ?beats?\b/, 'afrobeats'],
  [/\b(deep |afro |soulful )?house\b/, 'house'], [/\bhip[- ]?hop|\btrap\b|\brap\b/, 'hip-hop'], [/\bjazz\b/, 'jazz'],
  [/\bgospel|\bworship\b/, 'gospel'], [/\bkwaito\b/, 'kwaito'], [/\br ?(&|n) ?b\b|\brnb\b|\bneo ?soul\b/, 'r&b'],
  [/\bfestival/, 'festival'], [/\bconcert|\blive music\b|\bgig\b/, 'concert'], [/\bcomedy|stand[- ]?up\b/, 'comedy'],
  [/\bmarket\b/, 'market'], [/\b(art|exhibition|gallery)\b/, 'art'], [/\btheat(re|er)|\bplay\b/, 'theatre'],
  [/\bsport|\bmarathon|\brugby|\bsoccer|\bfootball/, 'sport'], [/\bwellness|\byoga\b/, 'wellness'],
  [/\bfamily|\bkids\b/, 'family'], [/\bstudent/, 'student'], [/\bnightlife\b/, 'nightlife'],
];

// First match wins, scanning the newest user message first, then older ones.
function firstHit(texts, fn) { for (const t of texts) { const v = fn(t); if (v) return v; } return null; }

// A city means its metro — same idea as the events API's province lists.
const METROS = {
  Durban: ['Durban', 'Umhlanga', 'Ballito', 'Pinetown', 'Westville', 'Hillcrest', 'La Lucia', 'Umdloti', 'Tongaat', 'Salt Rock', 'Amanzimtoti'],
  Johannesburg: ['Johannesburg', 'Joburg', 'Sandton', 'Midrand', 'Soweto', 'Randburg', 'Roodepoort', 'Fourways', 'Rosebank', 'Germiston', 'Benoni', 'Boksburg', 'Tembisa'],
  'Cape Town': ['Cape Town', 'Bellville', 'Tygervalley', 'Somerset West', 'Mitchells Plain', 'Sea Point', 'Camps Bay', 'Woodstock', 'Paarl'],
  Pretoria: ['Pretoria', 'Centurion', 'Hatfield', 'Menlyn'],
  Gqeberha: ['Gqeberha', 'Port Elizabeth'],
};

async function findEvents({ city, genres, range, free }, limit = 10) {
  let q = sb().from('events')
    .select('id,name,genre,venue_name,venue_city,date_local,time_local,is_free,price_min,description,lineup,attendance_count,hype_score')
    .eq('is_active', true).eq('approved', true)
    .gte('date_local', range?.from || saToday())
    .order('date_local', { ascending: true })
    .limit(genres?.length ? 60 : limit); // genre is filtered below, so over-fetch
  if (range?.to) q = q.lte('date_local', range.to);
  if (city) q = q.or((METROS[city] || [city]).map(n => `venue_city.ilike.%${n}%`).join(','));
  if (free) q = q.eq('is_free', true);
  const { data, error } = await q;
  if (error) console.error('[lumi] events query:', error.message);
  let rows = data || [];
  if (genres?.length) rows = rows.filter(e => genres.some(g => String(e.genre || '').toLowerCase().includes(g)));
  return rows.slice(0, limit);
}

// events.lineup is jsonb — usually an array of names or {name} objects
function lineupText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(x => (x && typeof x === 'object') ? (x.name || x.artist || x.title || '') : String(x)).filter(Boolean).join(', ');
  if (typeof v === 'object') return Object.values(v).map(lineupText).filter(Boolean).join(', ');
  return String(v);
}

// Reply-language detection for SA languages (needs 2+ hits to avoid false positives
// from slang like "lekker" in English sentences).
const LANGS = [
  ['isiZulu', /\b(ngifuna|ngicela|ngiyacela|ukujaiva|ukuzijabulisa|kule|lena|mpelasonto|sawubona|yebo|kanjani|ngiyabonga|kusasa|namuhla|namhlanje|kusihlwa|kuphi|uphi|umcimbi|imicimbi|ngiyafuna|ethekwini|egoli|ngakhona|kukhona|yini)\b/gi],
  ['isiXhosa', /\b(ndifuna|ndicela|molo|molweni|enkosi|impelaveki|ngomso|phi|ndingathanda|kukho|umsitho|imisitho|ekapa|ndiyafuna)\b/gi],
  ['Afrikaans', /\b(waar|hierdie|naweek|vanaand|asseblief|dankie|ek|jy|wat|gaan|uitgaan|wil|kan|daar|iets|geleenthede|vir|met|kaapstad|die)\b/gi],
  ['Sesotho', /\b(ke batla|kae|dumela|kea leboha|ke a leboha|beke|bosiu|hosane|kajeno|mokete|mekete)\b/gi],
];
function detectLanguage(text) {
  let best = null, bestHits = 1;
  for (const [lang, re] of LANGS) {
    const hits = (String(text).match(re) || []).length;
    if (hits > bestHits) { best = lang; bestHits = hits; }
  }
  return best;
}

// Removes any event the model mentions that isn't backed by the data it was given.
// A line with a Pulsify event link must point at an event we supplied and name it
// (on that line or the line above); a sentence that bolds an unknown name next to a
// date/time is an invented event. The current event page's own link is always fine.
const NAME_STOP = new Set(['live', 'tour', 'world', 'festival', 'concert', 'night', 'party', 'show', 'event', 'with', 'from', 'summer', 'edition', 'presents', 'sessions', 'session', '2025', '2026', '2027', 'the', 'and']);
const nameWords = n => String(n).toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !NAME_STOP.has(w));
const EV_LINK = /https?:\/\/(?:www\.)?pulsefy\.co\.za\/\?[^\s)]*?\bev=([A-Za-z0-9_\-]+)/g;
const DATEISH = /\b\d{1,2}[:h]\d{2}\b|\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*,? \d{1,2}\b|\b\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b|\btonight\b/i;
function guardReply(reply, allowed, currentId) {
  const known = new Set([...allowed.values()].flatMap(nameWords));
  const out = [];
  let removed = 0;
  for (const line of String(reply).split('\n')) {
    const lineN = line.toLowerCase().normalize('NFKD');
    const prevN = line.includes('**') ? '' : out.slice(-2).join(' ').toLowerCase().normalize('NFKD');
    const links = [...line.matchAll(EV_LINK)];
    const isFake = sn => [...sn.matchAll(/\*\*([^*]+)\*\*/g)].find(([, b]) => {
      const w = nameWords(b);
      return w.length && !w.some(x => known.has(x)) && DATEISH.test(sn);
    });
    const badLink = links.find(([, id]) => {
      if (id === currentId && allowed.has(id)) return false;
      if (!allowed.has(id)) return true;
      const w = nameWords(allowed.get(id));
      return w.length && !w.some(x => lineN.includes(x) || prevN.includes(x));
    });
    if (badLink || (links.length && isFake(line))) {
      removed++; console.warn('[lumi] removed unverified event line', badLink ? badLink[1] : '(invented name)');
      if (/^\s*\*\*[^*]+\*\*\s*$/.test(out[out.length - 1] || '')) out.pop();
      continue;
    }
    const sents = line.split(/(?<=[.!?])\s+(?=\S)/).filter(sn => {
      const fake = isFake(sn);
      if (fake) { removed++; console.warn('[lumi] removed invented event', fake[1]); }
      return !fake;
    });
    if (sents.length || !line.trim()) out.push(sents.join(' '));
  }
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
}

const clip = (s, n) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };


module.exports = async (req, res) => {
  Object.entries(corsHeaders(req)).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (rateLimited(req, res, { limit: 30, windowMs: 60000 })) return;

  const url = (req.url || '/').split('?')[0].replace(/^\/api/, '') || '/';

  try {

    /* ─── GET /siza/health ───────────────────────────────────── */
    if (url === '/siza/health' && req.method === 'GET') {
      const groqKey = process.env.GROQ_API_KEY || '';
      const results = {};

      // Test Groq chat
      if (!groqKey) {
        results.groq_chat = 'GROQ_API_KEY not set';
      } else {
        try {
          await groqChat([{ role: 'user', content: 'Reply with exactly: pong' }], 'You are a test assistant. Reply with exactly: pong');
          results.groq_chat = 'OK';
        } catch (e) {
          results.groq_chat = `ERR: ${(e.message || '').slice(0, 100)}`;
        }
      }

      // Test Groq embeddings
      if (!groqKey) {
        results.groq_embed = 'GROQ_API_KEY not set';
      } else {
        try {
          const r = await fetch('https://api.groq.com/openai/v1/embeddings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
            body: JSON.stringify({ model: 'nomic-embed-text-v1.5', input: 'test' }),
          });
          results.groq_embed = r.ok ? 'OK' : `${r.status}`;
        } catch (e) {
          results.groq_embed = `ERR: ${(e.message || '').slice(0, 80)}`;
        }
      }

      const ok = results.groq_chat === 'OK';
      return res.status(200).json({ ok, model: lastGroqModel() || null, results });
    }

    /* ─── GET /siza/whatsapp/webhook — Meta verification ─────── */
    if (url === '/siza/whatsapp/webhook' && req.method === 'GET') {
      const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
      if (q['hub.verify_token'] !== (process.env.WHATSAPP_VERIFY_TOKEN || '')) {
        return res.status(403).send('Forbidden');
      }
      return res.status(200).send(q['hub.challenge']);
    }

    /* ─── POST /siza/ingest/:eventId ─────────────────────────── */
    const ingestMatch = url.match(/^\/siza\/ingest\/([^/]+)$/);
    if (ingestMatch && req.method === 'POST') {
      const eventId = ingestMatch[1];
      const token = (req.headers.authorization || '').replace('Bearer ', '');
      const user = await verifyToken(token);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      // Verify organizer owns this event
      const { data: event } = await sb().from('events')
        .select('id,name,genre,organiser_id')
        .eq('id', eventId).single();
      if (!event) return res.status(404).json({ error: 'Event not found' });
      if (event.organiser_id !== user.id) return res.status(403).json({ error: 'Forbidden' });

      if (!validate(req, res, { text: { required: true, type: 'string', minLength: 20 } })) return;
      const { text } = req.body || {};

      // Ask Groq to extract structured knowledge + FAQ from free-text
      const extractPrompt = `You are an event data extractor. Given the following event description, extract all useful information and return it as a JSON array of knowledge items.

Each item must have:
- kind: one of "product" (tickets/pricing), "faq" (question & answer), "policy" (rules/restrictions), "hours" (schedule/timing)
- title: short label (e.g. "General Admission", "Dress Code", "Gates Open", "Is parking available?")
- body: full answer or description
- price_cents: integer in cents (e.g. 15000 for R150) if this item is about a ticket price; null otherwise

Extract EVERY piece of useful information: prices, date, time, venue, address, lineup, dress code, age limit, parking, capacity, gates open/close, FAQs, contact info, etc. Also generate 3–5 likely customer FAQ items based on the event.

Return ONLY valid JSON — an array of objects. No explanation, no markdown, no code block.

Event description:
${text.slice(0, 4000)}`;

      let items;
      try {
        const raw = await groqChat([{ role: 'user', content: extractPrompt }], 'You are a structured data extractor. Return only valid JSON.');
        const cleaned = raw.replace(/```json|```/g, '').trim();
        items = JSON.parse(cleaned);
        if (!Array.isArray(items)) throw new Error('Not an array');
      } catch (e) {
        return res.status(422).json({ error: 'Could not parse event details. Please try rephrasing or adding more information.', detail: e.message });
      }

      // Delete old knowledge for this event (re-ingest replaces)
      await sb().from('event_siza_knowledge').delete().eq('event_id', eventId);

      // Embed + store each item
      const stored = [];
      for (const item of items.slice(0, 40)) {
        if (!item.title || !item.body || !item.kind) continue;
        const embeddingText = `${item.title}: ${item.body}`;
        const embedding = await groqEmbed(embeddingText).catch(() => null);

        const { data: row, error: insErr } = await sb().from('event_siza_knowledge').insert({
          event_id: eventId,
          organizer_id: user.id,
          kind: ['product','faq','policy','hours'].includes(item.kind) ? item.kind : 'faq',
          title: item.title,
          body: item.body,
          price_cents: item.price_cents || null,
          in_stock: true,
          embedding: embedding ? `[${embedding.join(',')}]` : null,
        }).select().single();

        if (!insErr && row) stored.push(row);
      }

      return res.status(200).json({ items: stored });
    }

    /* ─── POST /siza/chat ─────────────────────────────────────── */
    if (url === '/siza/chat' && req.method === 'POST') {
      const { eventId, conversationId, message, channel = 'web', sessionId } = req.body || {};
      if (!message) return res.status(400).json({ error: 'message required' });

      // Load event (optional — null for discovery mode)
      let event = null;
      if (eventId) {
        const { data: ev } = await sb().from('events')
          .select('id,name,genre,organiser_id,organiser_name,description,date_local,time_local,end_date_local,end_time_local,venue_name,venue_address,venue_city,is_free,lineup,dress_code,age_restriction,attendance_count')
          .eq('id', eventId).single();
        if (!ev) return res.status(404).json({ error: 'Event not found' });
        event = ev;
      }

      // Get or create conversation (non-fatal — Lumi responds even without DB tracking)
      let convId = conversationId;
      if (!convId) {
        const { data: conv, error: convErr } = await sb().from('siza_conversations').insert({
          event_id: eventId || null,
          customer_session_id: sessionId || null,
          channel,
          state: 'bot',
          last_message_at: new Date().toISOString(),
        }).select('id').single();
        if (convErr) console.error('[siza/chat] conv insert error', convErr.code, convErr.message);
        convId = conv?.id || null;
      } else {
        await sb().from('siza_conversations')
          .update({ last_message_at: new Date().toISOString() })
          .eq('id', convId);
      }

      // Store inbound message (only when conversation tracking is working)
      if (convId) {
        await sb().from('siza_messages').insert({
          conversation_id: convId,
          direction: 'in',
          body: message,
          is_ai: false,
        });
      }

      // Retrieve top-3 knowledge items by semantic similarity (event mode only)
      let knowledgeContext = '';
      if (eventId) {
        const queryEmbedding = await groqEmbed(message).catch(() => null);
        if (queryEmbedding) {
          const { data: items } = await sb().rpc('siza_match_knowledge', {
            p_event_id: eventId,
            p_embedding: `[${queryEmbedding.join(',')}]`,
            p_limit: 3,
          });
          if (items && items.length > 0) {
            knowledgeContext = '\n\nKNOWLEDGE BASE:\n' + items.map(i =>
              `[${i.kind.toUpperCase()}] ${i.title}: ${i.body}` +
              (i.price_cents ? ` (Price: R${(i.price_cents / 100).toFixed(2)})` : '')
            ).join('\n');
          }
        } else {
          // Fallback: fetch all knowledge for this event (no vector search)
          const { data: items } = await sb().from('event_siza_knowledge')
            .select('kind,title,body,price_cents')
            .eq('event_id', eventId)
            .eq('in_stock', true)
            .limit(10);
          if (items && items.length > 0) {
            knowledgeContext = '\n\nKNOWLEDGE BASE:\n' + items.map(i =>
              `[${i.kind.toUpperCase()}] ${i.title}: ${i.body}` +
              (i.price_cents ? ` (Price: R${(i.price_cents / 100).toFixed(2)})` : '')
            ).join('\n');
          }
        }
      }

      // Load last 6 messages for context
      let recentMsgs = [];
      if (convId) {
        const { data: history } = await sb().from('siza_messages')
          .select('direction,body')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: false })
          .limit(7);
        recentMsgs = (history || []).reverse().slice(0, -1); // exclude the message we just inserted
      }
      // Fallback memory: the widget also sends its recent transcript, used when the
      // DB has no history for this conversation (new/failed conversation record).
      if (!recentMsgs.length && Array.isArray(req.body?.history)) {
        recentMsgs = req.body.history.slice(-10)
          .filter(m => m && (m.dir === 'in' || m.dir === 'out') && typeof m.text === 'string' && m.text.trim())
          .map(m => ({ direction: m.dir, body: m.text.slice(0, 1500) }));
      }
      const userTextsAll = [message, ...recentMsgs.filter(m => m.direction === 'in').map(m => m.body).reverse()].map(t => String(t || '').toLowerCase());
      const topics = {
        app: /\b(pulsi?fy|pulsefy|the app|website|account|sign ?up|log ?in|register\w*|list(ing)? (my|an?) events?|organi[sz]\w*|sell\w* tickets?|refund\w*|cancel\w*|reschedul\w*|my tickets?|tickets? (didn'?t|not|never|missing)|didn'?t (get|receive)|qr( code)?|payment\w*|pay(ing)?|card|eft|fees?|commission|support|help ?desk|contact (you|pulsi?fy|pulsefy)|resell\w*|transfer\w*|lumi|who are you|what are you|how (does|do|can) (it|this|i|you))\b/.test(userTextsAll[0]),
        food: /\b(eat|drink|restaurant|food|bar|spot|place to go|where to go|pub|cafe|coffee|lunch|dinner|breakfast|brunch|sushi|braai|cocktail|shisa ?nyama|lounge|before|after ?party)\b/.test(userTextsAll[0]),
      };

      const { customer_name, lat, lon, city: feedCity } = req.body || {};
      const firstName = clip(String(customer_name || '').split(' ')[0], 30);
      const personLine = firstName ? `\n\nYou're chatting with ${firstName} — use their name now and then, not every message.` : '';

      let systemPrompt;
      const allowedEvents = new Map(); // id -> name of events Lumi may link to
      const altLines = []; // real events to fall back on if the guard strips invented ones
      let nearCity = null;  // city we inferred (not typed) and found nothing in
      let ageUnknown = false;
      if (eventId) {
        allowedEvents.set(event.id, event.name);
        ageUnknown = !event.age_restriction;
        // Event mode — ground Lumi in the event's real data, so it can answer the basics
        // (when/where/how much/who's playing) even if the organiser never pasted a knowledge doc.
        const { data: tiers } = await sb().from('ticket_tiers')
          .select('name,price,sold_out,description').eq('event_id', eventId).order('sort_order', { ascending: true });
        const e = event;
        const facts = [
          e.date_local && `When: ${fmtDay(e.date_local)} ${e.date_local}${e.time_local ? ' from ' + String(e.time_local).slice(0, 5) : ''}${e.end_date_local && e.end_date_local !== e.date_local ? ' until ' + fmtDay(e.end_date_local) : ''}${e.end_time_local ? ' (ends ' + String(e.end_time_local).slice(0, 5) + ')' : ''}`,
          (e.venue_name || e.venue_city) && `Where: ${[e.venue_name, e.venue_address, e.venue_city].filter(Boolean).join(', ')}`,
          e.genre && `Genre: ${e.genre}`,
          e.organiser_name && `Organiser: ${e.organiser_name}`,
          lineupText(e.lineup) && `Lineup: ${clip(lineupText(e.lineup), 300)}`,
          e.dress_code ? `Dress code: ${e.dress_code}` : 'Dress code: not listed — say so; do not guess typical dress codes',
          e.age_restriction ? `Age restriction: ${e.age_restriction}` : 'Age restriction: not listed — say so; do not guess (no "usually 18+")',
          tiers?.length ? `Tickets: ${tiers.map(t => `${t.name || 'Ticket'} ${Number(t.price) > 0 ? 'R' + t.price : 'FREE'}${t.sold_out ? ' (SOLD OUT)' : ''}`).join('; ')} — buy at https://pulsefy.co.za/?ev=${e.id}&buy=1`
            : (e.is_free ? 'Tickets: FREE entry' : 'Tickets: price not listed on Pulsify yet — tell them to check the event page, where tickets will go on sale'),
          e.attendance_count > 0 && `${e.attendance_count} people on Pulsify are going`,
          e.description && `About: ${clip(e.description, 600)}`,
        ].filter(Boolean);
        systemPrompt = buildLumiSystemPrompt(event, channel, { city: e.venue_city, genres: [e.genre], topics })
          + '\nEVENT FACTS (from Pulsify — reliable):\n' + facts.join('\n')
          + knowledgeContext + todayLine() + personLine
          + (channel === 'web' ? `\nBUYING: tickets are sold on Pulsify itself — tell them to tap "Get Tickets" on this page or use https://pulsefy.co.za/?ev=${e.id}&buy=1. Never say to buy from the organiser, and never ask for their name, email or phone in chat (checkout collects that).` : '');
      } else {
        // Discovery mode — work out what the person wants, then query real events.
        const userTexts = userTextsAll;
        const allText = userTexts.join(' ');

        let city = firstHit(userTexts, t => { for (const [re, c] of CITY_ALIASES) if (re.test(t)) return c; return null; });
        let citySource = city ? 'what they said' : null;
        if (!city && lat != null && lon != null) { city = nearestCity(Number(lat), Number(lon)); if (city) citySource = 'their location'; }
        if (!city && feedCity && feedCity !== 'all') { city = String(feedCity); citySource = 'their feed filter'; }

        const vibe = firstHit(userTexts, t => { for (const [re, name, genres] of VIBES) if (re.test(t)) return { name, genres }; return null; });
        const genre = firstHit(userTexts, t => { for (const [re, g] of GENRES) if (re.test(t)) return g; return null; });
        const genres = genre ? [genre] : (vibe ? vibe.genres : null);
        const range = firstHit(userTexts, detectDateRange);
        const free = /\bfree\b/.test(userTexts[0]);
        const isPriceQuery = /cheap|affordable|budget|price|how much|cost|free/.test(allText);
        const isFoodQuery = topics.food;

        // Try the full ask, then relax one constraint at a time so Lumi always has
        // something real to offer — and is told honestly when it's not an exact match.
        const attempts = [
          { f: { city, genres, range, free }, note: null },
          genres && { f: { city, range, free }, note: `nothing matching the ${genre || vibe.name} vibe` },
          range && { f: { city, genres, free }, note: `nothing ${range.label}` },
          range && genres && { f: { city, free }, note: `nothing matching the ${genre || vibe.name} vibe ${range.label}` },
          city && { f: { genres, range }, note: `nothing in ${city}` },
          city && { f: {}, note: `nothing matching in ${city}` },
        ].filter(Boolean);
        let events = [], fallbackNote = null;
        for (const a of attempts) {
          events = await findEvents(a.f);
          if (events.length) { fallbackNote = a.note; break; }
        }
        if (city && citySource !== 'what they said' && fallbackNote && fallbackNote.includes(city)) nearCity = city;

        let eventsContext = '';
        for (const e of events) {
          allowedEvents.set(e.id, e.name);
          altLines.push(`**${e.name}** — ${fmtDay(e.date_local)}${e.time_local ? ' ' + String(e.time_local).slice(0, 5) : ''} @ ${e.venue_name || 'venue TBA'}, ${e.venue_city || 'SA'} https://pulsefy.co.za/?ev=${e.id}`);
        }
        if (events.length) {
          const { data: tiers } = await sb().from('ticket_tiers')
            .select('event_id,price,sold_out').in('event_id', events.map(e => e.id)).order('price', { ascending: true });
          const cheapest = {};
          for (const t of tiers || []) if (!t.sold_out && cheapest[t.event_id] == null) cheapest[t.event_id] = Number(t.price);
          eventsContext = (fallbackNote
            ? `\n\nNone of these is an exact match (${fallbackNote}). Closest alternatives on Pulsify:\n`
            : '\n\nMATCHING EVENTS ON PULSIFY:\n') + events.map(e => {
            const p = cheapest[e.id];
            const price = p === 0 || (p == null && e.is_free) ? 'FREE' : p != null ? `from R${p}` : 'price on event page';
            const when = `${fmtDay(e.date_local)}${e.time_local ? ' ' + String(e.time_local).slice(0, 5) : ''}`;
            const going = e.attendance_count > 0 ? ` | ${e.attendance_count} going` : '';
            const extra = clip(lineupText(e.lineup) ? 'Lineup: ' + lineupText(e.lineup) : e.description, 140);
            return `- ${e.name} — ${when} @ ${e.venue_name || 'venue TBA'}, ${e.venue_city || 'SA'} | ${e.genre || 'event'} | ${price}${going} → https://pulsefy.co.za/?ev=${e.id}${extra ? `\n  (${extra})` : ''}`;
          }).join('\n');
        }

        // Spots (restaurants/bars) when they ask about food, drinks or where to go.
        let bizContext = '';
        if (isFoodQuery) {
          let bq = sb().from('businesses')
            .select('name,category,suburb,city,tagline,price_range,rating')
            .eq('is_active', true)
            .order('is_frontline', { ascending: false })
            .order('rating', { ascending: false, nullsFirst: false })
            .limit(6);
          if (city) bq = bq.ilike('city', `%${city}%`);
          const { data: spots, error: bErr } = await bq;
          if (bErr) console.error('[lumi] spots query:', bErr.message);
          if (spots?.length) {
            bizContext = '\n\nSPOTS ON PULSIFY (places, not events — they have no dates or showtimes):\n' + spots.map(b =>
              `- ${b.name} (${b.category || 'spot'}, ${[b.suburb, b.city].filter(Boolean).join(', ') || 'SA'})${b.price_range ? ' ' + b.price_range : ''}${b.rating ? ' ★' + b.rating : ''}${b.tagline ? ' — ' + clip(b.tagline, 80) : ''}`
            ).join('\n') + '\nMore spots: https://pulsefy.co.za ("Spots near you" on the home feed)';
          }
        }

        const qs = [genre && `genre=${encodeURIComponent(genre)}`, city && `city=${encodeURIComponent(city)}`].filter(Boolean).join('&');
        const browseLine = `Browse more: https://pulsefy.co.za${qs ? '/?' + qs : ''}`;
        const understood = [
          city && `city: ${city} (from ${citySource})`,
          (genre || vibe) && `vibe: ${genre || vibe.name}`,
          range && `when: ${range.label} (${range.from}${range.to !== range.from ? ' to ' + range.to : ''})`,
          free && 'wants free events',
          isPriceQuery && 'price-conscious',
        ].filter(Boolean).join('; ') || 'nothing specific yet — vague ask';

        systemPrompt = buildLumiSystemPrompt(null, channel, { city, genres: genres || [], topics })
          + '\n\nMODE: DISCOVERY — help this person decide what to do, using real events and spots on Pulsify.'
          + `\nWHAT THEY WANT (so far): ${understood}`
          + '\nDISCOVERY RULES:'
          + '\n1. Recommend ONLY events from the list below — never invent events, dates, venues, lineups or prices.'
          + '\n2. Pick the 2–3 best fits, not the whole list, and say in a few words WHY each fits (vibe, lineup, price, how soon). Put each event\'s Pulsify link right after its name.'
          + '\n3. If the list says none is an exact match, say so honestly in one line, then offer the alternatives.'
          + '\n4. If the ask is vague (no city and no vibe), tease ONE standout event from the list and ask one short question to narrow it down (city, vibe or when).'
          + '\n5. If there are no events at all, say so warmly, suggest a spot if any are listed, and share: ' + browseLine
          + '\n6. If location came from their device/feed rather than their words, mention the city lightly ("near you in Durban") so they can correct you.'
          + (eventsContext || '\n\nNO UPCOMING EVENTS FOUND on Pulsify for this right now.')
          + bizContext
          + '\n\n' + browseLine
          + todayLine() + personLine;
      }

      const replyLang = detectLanguage(message);
      systemPrompt += '\n\nBEFORE YOU ANSWER — CHECK:'
        + '\n- Only events, dates, weekdays, times, venues, prices, age limits, dress codes and lineups that appear in the data above. If a detail isn\'t there, say you don\'t have it — never guess.'
        + '\n- Never describe a price as cheap, modest, affordable, early-bird or expensive unless an actual price is listed.'
        + '\n- You have no live data: no weather, traffic, load-shedding schedules or news. Say you can\'t check that and suggest a weather/traffic app — never make it up.'
        + '\n- Clubs, bars and restaurants from the city guide or spots list are places, not events: never give them a day, time, lineup or "tonight" — only events from the event list have dates.'
        + '\n- Don\'t re-ask anything already answered in this conversation.'
        + '\n- Never copy labels, headings or raw list lines (with | separators or arrows) from these instructions — rewrite each pick in your own words.'
        + (replyLang ? `\n- LANGUAGE: they wrote in ${replyLang}. Write your ENTIRE reply in ${replyLang} (keep event names, venues and links exactly as given).` : '\n- Reply in the language of their latest message.');

      const chatMessages = recentMsgs.map(m => ({
        role: m.direction === 'in' ? 'user' : 'assistant',
        content: m.body,
      }));
      chatMessages.push({ role: 'user', content: message });

      // Detect purchase intent
      const buyIntent = /buy|ticket|purchase|book|how many|want \d|get \d/i.test(message);

      let reply;
      let suggestPurchase = false;
      let suggestContact = false;

      try {
        if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY_MISSING');
        reply = (await groqChat(chatMessages, systemPrompt)).replace(/\\n/g, '\n');
        reply = reply.replace(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g, (m, label, href) => label.trim() === href ? href : `${label} ${href}`);
        const g = guardReply(reply, allowedEvents, eventId);
        if (g.removed) {
          reply = g.text;
          if (!/pulsefy\.co\.za\/\?\S*\bev=/.test(reply) && altLines.length) reply = (reply ? reply + '\n\n' : '') + "Here's what's actually on Pulsify:\n" + altLines.slice(0, 2).join('\n');
          if (!reply) reply = "I couldn't find a matching event on Pulsify right now — browse everything here: https://pulsefy.co.za";
        }
        if (ageUnknown && /\b(18|21)\s?\+/.test(reply)) {
          // No age limit in the data: drop any guessed one
          reply = reply.split('\n').map(l => l.split(/(?<=[.!?])\s+(?=\S)/).filter(sn => !/\b(18|21)\s?\+/.test(sn)).join(' ')).join('\n').trim();
          if (/\bage\b/i.test(message)) reply += "\n\nThe age limit isn't listed yet — check the event page before you go.";
        }
        if (nearCity && !reply.toLowerCase().includes(nearCity.toLowerCase())) {
          reply = `Nothing's listed near you in ${nearCity} right now — here's the closest on Pulsify.\n\n` + reply;
        }
        if (channel === 'whatsapp') reply = reply.replace(/\*\*(.+?)\*\*/g, '*$1*');
        // Buy / contact-organiser buttons only make sense when chatting about one event
        suggestPurchase = !!eventId && (buyIntent || /how much|price|cost|r\d/i.test(message));
        suggestContact = !!eventId && /don't have|contact|organis|not sure|I can't/i.test(reply);
      } catch (e) {
        const msg = e.message || '';
        console.error('[siza/chat] groq error:', msg);
        let reply;
        if (msg === 'GROQ_API_KEY_MISSING' || msg.includes('GROQ_API_KEY is not set')) {
          reply = "Lumi is still being set up — please contact the organiser directly for now.";
        } else if (/Groq 401/.test(msg)) {
          reply = "Lumi's connection needs attention — please contact the organiser directly for now.";
        } else if (/Groq 429/.test(msg)) {
          reply = "Eish, Lumi is getting a LOT of messages right now! Give me a moment and try again.";
        } else if (/Groq 400/.test(msg)) {
          reply = "Eish, something went sideways on my side. Try again in a sec!";
        } else if (/Groq 404/.test(msg)) {
          reply = "Lumi's AI is updating — please try again in a moment or contact the organiser.";
        } else if (/Groq [45]\d\d|overload|unavailable/i.test(msg)) {
          reply = "Lumi is a bit overloaded right now. Try again in a moment!";
        } else {
          reply = "Eish, something went sideways on my side. Try again in a sec!";
        }
        return res.status(200).json({ reply, conversationId: convId, suggestPurchase: false, suggestContact: !!eventId, _debug: msg });
      }

      // Store AI reply
      if (convId) {
        await sb().from('siza_messages').insert({
          conversation_id: convId,
          direction: 'out',
          body: reply,
          is_ai: true,
        });
      }

      return res.status(200).json({ reply, conversationId: convId, suggestPurchase, suggestContact });
    }

    /* ─── POST /siza/order ────────────────────────────────────── */
    if (url === '/siza/order' && req.method === 'POST') {
      const { eventId, conversationId, customerName, customerEmail, customerPhone, quantity } = req.body || {};
      if (!eventId || !customerEmail || !quantity) {
        return res.status(400).json({ error: 'eventId, customerEmail and quantity required' });
      }

      // Load ticket price from knowledge base
      const { data: priceItem } = await sb().from('event_siza_knowledge')
        .select('price_cents,title')
        .eq('event_id', eventId)
        .eq('kind', 'product')
        .eq('in_stock', true)
        .order('price_cents', { ascending: true })
        .limit(1).single();

      if (!priceItem || !priceItem.price_cents) {
        return res.status(422).json({ error: 'No ticket price found for this event. Please contact the organiser.' });
      }

      const totalCents = priceItem.price_cents * parseInt(quantity, 10);

      // Create siza_order record
      const { data: order, error: ordErr } = await sb().from('siza_orders').insert({
        event_id: eventId,
        conversation_id: conversationId || null,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        customer_email: customerEmail,
        quantity: parseInt(quantity, 10),
        total_cents: totalCents,
        state: 'pending',
      }).select().single();
      if (ordErr) throw ordErr;

      // Generate Paystack payment link
      const paystackKey = process.env.PAYSTACK_SECRET_KEY;
      if (!paystackKey) return res.status(500).json({ error: 'Payment system not configured' });

      const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${paystackKey}`,
        },
        body: JSON.stringify({
          email: customerEmail,
          amount: totalCents,
          currency: 'ZAR',
          reference: order.id,
          metadata: {
            siza_order_id: order.id,
            event_id: eventId,
            quantity: parseInt(quantity, 10),
            customer_name: customerName || '',
          },
          channels: ['card', 'bank'],
        }),
      });

      const paystackData = await paystackRes.json();
      if (!paystackData.status) {
        return res.status(502).json({ error: 'Could not generate payment link. Please try again.' });
      }

      // Store reference
      await sb().from('siza_orders')
        .update({ paystack_reference: paystackData.data?.reference })
        .eq('id', order.id);

      return res.status(200).json({
        orderId: order.id,
        paymentUrl: paystackData.data?.authorization_url,
        totalCents,
        quantity,
        ticketName: priceItem.title,
      });
    }

    /* ─── POST /siza/whatsapp/webhook — Meta Cloud API ──────── */
    if (url === '/siza/whatsapp/webhook' && req.method === 'POST') {
      // Verify Meta signature
      const sig = req.headers['x-hub-signature-256'] || '';
      const appSecret = process.env.WHATSAPP_APP_SECRET || '';
      if (appSecret) {
        const expected = 'sha256=' + crypto.createHmac('sha256', appSecret)
          .update(JSON.stringify(req.body)).digest('hex');
        if (sig !== expected) return res.status(401).json({ error: 'Invalid signature' });
      }

      const entry = req.body?.entry?.[0];
      const change = entry?.changes?.[0];
      if (change?.field !== 'messages') return res.status(200).json({ received: true });

      const msg = change?.value?.messages?.[0];
      if (!msg || msg.type !== 'text') return res.status(200).json({ received: true });

      const from = msg.from; // WhatsApp phone number
      const text = msg.text?.body || '';
      const token = process.env.WHATSAPP_TOKEN;

      // Route by phone_number_id: find which organizer owns this number
      const incomingPhoneId = change.value?.metadata?.phone_number_id;
      const phoneId = incomingPhoneId || process.env.WHATSAPP_PHONE_ID;

      // Look up organizer by their registered phone_number_id
      let organizerId = null;
      if (incomingPhoneId) {
        const { data: orgProfile } = await sb().from('profiles')
          .select('id').eq('whatsapp_phone_id', incomingPhoneId).single();
        organizerId = orgProfile?.id || null;
      }

      // Find active conversation scoped to this WhatsApp number (prevents cross-organizer leakage)
      let { data: conv } = await sb().from('siza_conversations')
        .select('*')
        .eq('customer_phone', from)
        .eq('channel', 'whatsapp')
        .eq('state', 'bot')
        .eq('customer_session_id', phoneId)
        .order('created_at', { ascending: false })
        .limit(1).single();

      // If no active conversation, handle event selection
      if (!conv) {
        // Look for active siza-enabled events; scope to organizer if matched
        let evQuery = sb().from('events')
          .select('id,name')
          .eq('siza_enabled', true)
          .gte('date_local', new Date().toISOString().split('T')[0])
          .order('date_local', { ascending: true })
          .limit(9);
        if (organizerId) evQuery = evQuery.eq('organiser_id', organizerId);
        const { data: activeEvents } = await evQuery;

        if (!activeEvents || activeEvents.length === 0) {
          await sendWhatsApp(from, phoneId, token, "Hi! There are no active events right now. Please check back soon.");
          return res.status(200).json({ received: true });
        }

        if (activeEvents.length === 1) {
          // Only one active event — start conversation for it
          const { data: newConv } = await sb().from('siza_conversations').insert({
            event_id: activeEvents[0].id,
            customer_phone: from,
            customer_session_id: phoneId,
            channel: 'whatsapp',
            state: 'bot',
            last_message_at: new Date().toISOString(),
          }).select().single();
          conv = newConv;
        } else {
          // Check if this message is a number selection from a previous list
          const isNumberReply = /^[1-9]$/.test(text.trim());
          if (isNumberReply) {
            const idx = parseInt(text.trim(), 10) - 1;
            if (idx >= 0 && idx < activeEvents.length) {
              // Valid selection — start conversation for chosen event
              const { data: newConv } = await sb().from('siza_conversations').insert({
                event_id: activeEvents[idx].id,
                customer_phone: from,
                customer_session_id: phoneId,
                channel: 'whatsapp',
                state: 'bot',
                last_message_at: new Date().toISOString(),
              }).select().single();
              conv = newConv;
            } else {
              // Out of range — re-send list
              const list = activeEvents.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
              await sendWhatsApp(from, phoneId, token, `Please reply with a number between 1 and ${activeEvents.length}:\n\n${list}`);
              return res.status(200).json({ received: true });
            }
          } else {
            // Multiple events — ask which one
            const list = activeEvents.map((e, i) => `${i + 1}. ${e.name}`).join('\n');
            await sendWhatsApp(from, phoneId, token, `Hi! Which event are you asking about?\n\n${list}\n\nReply with the number.`);
            return res.status(200).json({ received: true });
          }
        }
      }

      if (!conv?.event_id) return res.status(200).json({ received: true });

      let chatReply = "I'm having trouble right now. Please try again shortly.";
      let suggestContact = false;
      try {
        const { data: event } = await sb().from('events')
          .select('id,name,genre,siza_enabled')
          .eq('id', conv.event_id).single();

        await sb().from('siza_messages').insert({ conversation_id: conv.id, direction: 'in', body: text, is_ai: false });

        // Load last 6 messages for context
        const { data: history } = await sb().from('siza_messages')
          .select('direction,body')
          .eq('conversation_id', conv.id)
          .order('created_at', { ascending: false })
          .limit(7);
        const recentMsgs = (history || []).reverse().slice(0, -1);

        const queryEmb = await groqEmbed(text).catch(() => null);
        let ctx = '';
        if (queryEmb) {
          const { data: items } = await sb().rpc('siza_match_knowledge', {
            p_event_id: conv.event_id,
            p_embedding: `[${queryEmb.join(',')}]`,
            p_limit: 3,
          });
          if (items?.length) ctx = '\n\nKNOWLEDGE BASE:\n' + items.map(i =>
            `[${i.kind.toUpperCase()}] ${i.title}: ${i.body}` +
            (i.price_cents ? ` (Price: R${(i.price_cents / 100).toFixed(2)})` : '')
          ).join('\n');
        } else {
          // Fallback: table scan when embed fails
          const { data: items } = await sb().from('event_siza_knowledge')
            .select('kind,title,body,price_cents')
            .eq('event_id', conv.event_id)
            .eq('in_stock', true)
            .limit(10);
          if (items?.length) ctx = '\n\nKNOWLEDGE BASE:\n' + items.map(i =>
            `[${i.kind.toUpperCase()}] ${i.title}: ${i.body}` +
            (i.price_cents ? ` (Price: R${(i.price_cents / 100).toFixed(2)})` : '')
          ).join('\n');
        }

        const systemPrompt = buildLumiSystemPrompt(event, 'whatsapp') + ctx;
        const chatMessages = recentMsgs.map(m => ({
          role: m.direction === 'in' ? 'user' : 'assistant',
          content: m.body,
        }));
        chatMessages.push({ role: 'user', content: text });
        chatReply = await groqChat(chatMessages, systemPrompt);
        suggestContact = /don't have|contact|organis|not sure|I can't/i.test(chatReply);

        await sb().from('siza_messages').insert({ conversation_id: conv.id, direction: 'out', body: chatReply, is_ai: true });
        await sb().from('siza_conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conv.id);
      } catch (e) {
        console.error('[siza/whatsapp] chat error:', e.message);
        chatReply = "I'm having trouble right now. Please contact the organiser for help.";
      }

      const finalMsg = suggestContact ? chatReply + '\n\nNeed more help? Reply CONTACT to be connected to the organiser.' : chatReply;
      await sendWhatsApp(from, phoneId, token, finalMsg);
      return res.status(200).json({ received: true });
    }

    // POST /siza/whatsapp/register — start OTP flow for organizer's dedicated number
    if (req.method === 'POST' && url === '/siza/whatsapp/register') {
      const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
      const user = await verifyToken(authHeader);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { phone_number } = req.body || {};
      if (!phone_number) return res.status(400).json({ error: 'phone_number required' });

      const waToken = process.env.WHATSAPP_TOKEN;
      const bizId = process.env.WHATSAPP_BUSINESS_ID;
      if (!waToken || !bizId) return res.status(503).json({ error: 'WhatsApp not configured' });

      // Register the number with Meta (triggers OTP to that number)
      const regRes = await fetch(`https://graph.facebook.com/v18.0/${bizId}/phone_numbers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waToken}` },
        body: JSON.stringify({ cc: '27', phone_number: phone_number.replace(/^\+/, ''), migrate_phone_number: false }),
      });
      const regData = await regRes.json();
      if (!regRes.ok) return res.status(400).json({ error: regData.error?.message || 'Meta registration failed' });

      // Store the pending phone_number_id on the profile (not yet verified)
      await sb().from('profiles').update({
        whatsapp_phone_id: regData.id,
        whatsapp_display_number: phone_number,
        whatsapp_verified: false,
      }).eq('id', user.id);

      // Trigger OTP delivery
      await fetch(`https://graph.facebook.com/v18.0/${regData.id}/request_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waToken}` },
        body: JSON.stringify({ code_method: 'SMS', language: 'en_US' }),
      });

      return res.status(200).json({ ok: true, phone_number_id: regData.id });
    }

    // POST /siza/whatsapp/verify — confirm OTP, mark number as verified
    if (req.method === 'POST' && url === '/siza/whatsapp/verify') {
      const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
      const user = await verifyToken(authHeader);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      const { code } = req.body || {};
      if (!code) return res.status(400).json({ error: 'code required' });

      const waToken = process.env.WHATSAPP_TOKEN;
      const { data: profile } = await sb().from('profiles').select('whatsapp_phone_id').eq('id', user.id).single();
      if (!profile?.whatsapp_phone_id) return res.status(400).json({ error: 'No pending number — call /register first' });

      const verRes = await fetch(`https://graph.facebook.com/v18.0/${profile.whatsapp_phone_id}/verify_code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${waToken}` },
        body: JSON.stringify({ code }),
      });
      if (!verRes.ok) {
        const err = await verRes.json();
        return res.status(400).json({ error: err.error?.message || 'OTP verification failed' });
      }

      await sb().from('profiles').update({ whatsapp_verified: true }).eq('id', user.id);
      return res.status(200).json({ ok: true });
    }

    // DELETE /siza/whatsapp/disconnect — deregister number from Meta, clear profile fields
    if (req.method === 'DELETE' && url === '/siza/whatsapp/disconnect') {
      const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
      const user = await verifyToken(authHeader);
      if (!user) return res.status(401).json({ error: 'Unauthorized' });

      const token = process.env.WHATSAPP_TOKEN;
      const { data: profile } = await sb().from('profiles').select('whatsapp_phone_id').eq('id', user.id).single();

      if (profile?.whatsapp_phone_id && token) {
        await fetch(`https://graph.facebook.com/v18.0/${profile.whatsapp_phone_id}/deregister`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        }).catch(e => console.warn('[siza/whatsapp] deregister error:', e.message));
      }

      await sb().from('profiles').update({
        whatsapp_phone_id: null,
        whatsapp_display_number: null,
        whatsapp_verified: false,
      }).eq('id', user.id);

      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'Not found' });
  } catch (err) {
    console.error('[siza]', err);
    captureError && captureError(err);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

async function sendWhatsApp(to, phoneId, token, text) {
  if (!phoneId || !token) {
    console.warn('[siza/whatsapp] WHATSAPP_PHONE_ID or WHATSAPP_TOKEN not set');
    return;
  }
  await fetch(`https://graph.facebook.com/v18.0/${phoneId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text.slice(0, 1024) },
    }),
  }).catch(e => console.error('[siza/whatsapp] send error:', e.message));
}
