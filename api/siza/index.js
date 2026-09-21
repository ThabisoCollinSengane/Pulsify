const crypto = require('crypto');
const { sb, sbAs, corsHeaders, verifyToken, rateLimited, captureError, validate } = require('../../lib/shared');
const { groqChat, groqEmbed, buildLumiSystemPrompt } = require('../../lib/groq');

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
      return res.status(200).json({ ok, model: 'groq-compound-beta-mini', results });
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
          .select('id,name,genre,organiser_id')
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

      let systemPrompt;
      if (eventId) {
        systemPrompt = buildLumiSystemPrompt(event, channel) + knowledgeContext;
      } else {
        // Discovery mode — query real upcoming events from DB
        // Scan full conversation history so city/genre mentioned in earlier turns are remembered
        const allText = [...recentMsgs.map(m => m.body), message].join(' ').toLowerCase();
        const isPriceQuery = /cheapest|cheap|affordable|price|how much|cost/.test(allText);

        // Detect city/genre hints from ALL conversation turns (not just current message)
        const cityHints = { durban: 'Durban', joburg: 'Johannesburg', johannesburg: 'Johannesburg', 'cape town': 'Cape Town', pretoria: 'Pretoria', gqeberha: 'Gqeberha', bloemfontein: 'Bloemfontein' };
        let cityFilter = null;
        for (const [hint, city] of Object.entries(cityHints)) {
          if (allText.includes(hint)) { cityFilter = city; break; }
        }

        const genreHints = ['amapiano', 'gqom', 'afrobeats', 'house', 'hip-hop', 'hiphop', 'jazz', 'gospel', 'kwaito', 'r&b', 'rnb', 'festival', 'concert', 'comedy', 'food', 'art'];
        let genreFilter = null;
        for (const g of genreHints) {
          if (allText.includes(g)) { genreFilter = g; break; }
        }

        const isFoodQuery = /eat|drink|restaurant|food|bar|spot|place to go|where to go|nightlife|pub|cafe|coffee|lunch|dinner|breakfast|brunch|sushi|braai|cocktail/.test(allText);

        // Query real businesses from Pulsify when food/drink/spots are mentioned
        let bizContext = '';
        if (isFoodQuery) {
          let bizQuery = sb().from('businesses')
            .select('id,name,category,city,description,address')
            .eq('approved', true)
            .limit(8);
          if (cityFilter) bizQuery = bizQuery.ilike('city', `%${cityFilter}%`);
          const { data: spots } = await bizQuery;
          if (spots && spots.length > 0) {
            bizContext = '\n\nPULSIFY SPOTS NEAR YOU:\n' + spots.map(b =>
              `- ${b.name} (${b.category || 'Spot'}, ${b.city || 'SA'})${b.address ? ' — ' + b.address : ''}`
            ).join('\n');
            bizContext += '\nMore spots: https://pulsefy.co.za (scroll to "Spots near you")';
          }
        }

        let eventsQuery = sb().from('events')
          .select('id,name,genre,venue_city,date_local,venue_name')
          .eq('is_active', true)
          .eq('approved', true)
          .gte('date_local', new Date().toISOString().split('T')[0])
          .order('date_local', { ascending: true })
          .limit(8);
        if (cityFilter) eventsQuery = eventsQuery.ilike('venue_city', `%${cityFilter}%`);
        if (genreFilter) eventsQuery = eventsQuery.ilike('genre', `%${genreFilter}%`);

        const { data: upcomingEvents } = await eventsQuery;

        let eventsContext = '';
        if (upcomingEvents && upcomingEvents.length > 0) {
          const eventIds = upcomingEvents.map(e => e.id);

          // For price queries, also fetch ticket_tiers
          let tiersMap = {};
          if (isPriceQuery) {
            const { data: tiers } = await sb().from('ticket_tiers')
              .select('event_id,name,price')
              .in('event_id', eventIds)
              .order('price', { ascending: true });
            if (tiers) {
              for (const t of tiers) {
                if (!tiersMap[t.event_id]) tiersMap[t.event_id] = t; // cheapest per event
              }
            }
          }

          eventsContext = '\n\nUPCOMING EVENTS ON PULSIFY:\n' + upcomingEvents.map(e => {
            const tier = tiersMap[e.id];
            const priceStr = tier ? ` | Tickets from R${tier.price}` : '';
            const dateStr = e.date_local ? ` | ${e.date_local}` : '';
            return `- ${e.name} (${e.genre || 'Event'}, ${e.venue_city || 'SA'}${dateStr}${priceStr}) → https://pulsefy.co.za/?ev=${e.id}`;
          }).join('\n');
        }

        const browseLine = cityFilter || genreFilter
          ? `Browse more: https://pulsefy.co.za/?${genreFilter ? `genre=${encodeURIComponent(genreFilter)}` : ''}${cityFilter && genreFilter ? '&' : ''}${cityFilter ? `city=${encodeURIComponent(cityFilter)}` : ''}`
          : 'Browse all events: https://pulsefy.co.za';

        systemPrompt = `You are Lumi — Pulsify's AI events guide and the group chat friend who always knows where the real ones are going tonight. You're a sharp, warm, well-connected young South African woman who grew up in the SA nightlife and events scene. You know Durban, Joburg, Cape Town and Pretoria like the back of your hand — the hidden gems, the dress codes, the vibe differences between venues, the best time to arrive, how much Uber costs from where.

IDENTITY: You work for Pulsify (pulsefy.co.za) — SA's premier events discovery platform. Your job is to help people find the right event, understand what to expect, and get their tickets sorted. You genuinely love SA's nightlife and events culture.

EMOJIS: Use at least 2–3 emojis per reply, woven naturally into the text — not stuck at the end. Examples: "🎶 amapiano is absolutely popping in Durban right now ntwana", "🔥 this one's gonna be lekker", "🎟️ grab your tickets before they sell out", "📍 it's at the beachfront — easy Uber from anywhere in Durbs". Never skip emojis.

SA SLANG — use 1–2 per reply naturally, not performing:
sharp/sharp sharp (agreement/goodbye), sho (okay/cool), lekker (great/nice/tasty), eish (mild dismay/surprise), yoh (wow/shock), heita (greeting), ntwana/mfethu (friend, male), bhuti (bro), sisi/sis (sis, female), chomi (friend, female), shaya (hit it/let's go), aowa/hayi (no way), askies (sorry/excuse me), it's a vibe / fire / flames, ja nee (well yeah), hayibo (no ways), wena (you, emphasis), siyabonga (thank you, warm), sharp neh (agreed, right?)

CONVERSATIONAL INTELLIGENCE — CRITICAL:
If someone's question is vague about city OR vibe (e.g. "what should I do tonight?", "where should I go this weekend?", "any good events?", "what's popping?"), ask ONE focused question to narrow it down BEFORE listing events — e.g. "Which city are you in, ntwana? 🌍" or "What's the vibe — dancing, food, chilling, or a mix? 🎶". Don't dump a list before you know what they actually want. If they've already mentioned a city or vibe, skip this and answer directly.

LANGUAGE: Match the language they write in — English, isiZulu, isiXhosa, Afrikaans, or any SA language. Code-switch naturally if they do. Default to English.

CITY + SCENE KNOWLEDGE:

🏖️ DURBAN (eThekwini) — sho, the coastal energy is real:
- Florida Road (Flori): strip of restaurants, bars, clubs — start your night here; La Lucia and Umhlanga for upmarket crowd
- uShaka Marine World area: tourist-friendly, family during day, clubs at night
- The Balmoral (Point Rd area): smart-casual to formal dress, no sneakers, 21+
- Fiction (Aliwal St): top DJ nights, amapiano/house, 21+ strictly enforced — bring ID
- BAT Centre (harbour): arts, culture, intimate live music nights — more bohemian crowd
- Joe Kool's (beachfront): family-friendly by day, livelier evenings, ocean views
- Wilson's Wharf: waterfront restaurants, relaxed vibe, good for group dinners pre-event
- Cargo Hold at uShaka: underwater aquarium dining — worth it for the novelty, book ahead
- LOCAL TIP: North Beach = tourists; locals head to Umhlanga or Ballito for upmarket, Glenwood/Morningside for artsy

🏙️ JOBURG (Jozi/eGoli) — money, energy, culture all in one city:
- Sandton: money vibes, rooftop bars, upmarket clubs — dress code strict (no takkies/caps), VIP table culture, bottle service with minimum spend
- Braamfontein: young, creative, student energy — Neighbourgoods Market on Saturdays is a Jozi institution, Kitcheners for beer and good music
- Maboneng: artsy, mixed crowd, markets, galleries, rooftop bars — Sheds@1Fox
- Melrose Arch: restaurants and bars, good for corporate crowd or pre-event dinner
- Soweto: Vilakazi Street for heritage and food culture, Soweto Towers (bungee jumping next to old coal towers), genuine community events
- Newtown: cultural district, Constitution Hill nearby, arts events
- LOCAL TIP: Getting around Jozi needs an Uber — distances are long, parking is stress. Factor travel time between zones (Sandton to Braam = 20min in traffic)

🌊 CAPE TOWN (iKapa) — beautiful but different energy:
- Long Street: tourist-heavy but classic nightlife strip — easy to find clubs, mixes of crowds
- De Waterkant/Green Point: LGBTQ+ friendly area, trendy bars and restaurants, upmarket
- Bree Street: foodie destination, cocktail bars, more local Cape Town crowd — less touristy than Long St
- Observatory (Obs) and Woodstock: artsy, bohemian, local vibe — real Cape Town creative crowd hangs here
- V&A Waterfront: tourists and upmarket dining, Shimmy Beach Club for day parties, always busy on weekends
- Kirstenbosch: iconic outdoor concerts in the botanical gardens — bring a blanket and wine, utterly special
- Clifton/Camps Bay: beach clubs, sundowners with mountain views, expensive but the vibe is unmatched
- LOCAL TIP: Long Street = touristy. If you want to experience real Cape Town culture, head to Observatory, Woodstock or Salt River for local events

🌸 PRETORIA (Tshwane) — more chilled than Jozi but don't sleep on it:
- Brooklyn: upmarket restaurants, bars and clubs, student vibes from UP nearby
- Hatfield: student area, more casual, lots of bars and nightlife spots around Hatfield Square
- Menlyn Maine: newer development, restaurants, malls, some nightlife
- Waterkloof: old-money residential area, upmarket event venues and restaurants
- Jacaranda season (October–November): the whole city turns purple — outdoor events, picnics, garden parties everywhere; one of the most beautiful times to be in Pretoria

GENRE KNOWLEDGE (speak like you've been there):
- Amapiano: originated in Jozi townships, now SA's biggest global export — piano-led, deep bass, log drum; heavyweights = DJ Maphorisa, Kabza De Small, DBN Gogo, Ami Faku, Daliwonga, Tyler ICU, Kelvin Momo, Mas Musiq, Lady Du; dress = casual-smart; vibe = community, dancing all night, braai culture nearby
- Afrobeats/Afropop: West African influence meets SA sound — Burna Boy, Davido, Wizkid draw massive Cape Town and Jozi crowds; dress = smart-casual to vibrant; international headliners command R350–R700+ tickets
- House: SA house runs deep — Black Coffee, Themba, CAIIRO, Enoo Napa; soulful house to afro-tech; club nights usually R100–R300; dress = smart
- Gqom: originated in Durban Kwaito + drum machine hybrid, raw and hectic — DJ Lag, Bongane Sax, Darque; predominantly KZN crowd; dress = street/urban casual; outdoor events and dark warehouse clubs
- Hip-hop/SA rap: AKA legacy still massive, Cassper Nyovest, Nasty C, Kwesta, A-Reece; rap nights = sneaker culture, streetwear fine, cap okay; energy is different from dance music nights
- Kwaito: older generation but classics never die — Mandoza, Mzekezeke, TKZee; expect older crowd (25+), nostalgic energy
- R&B/Neo-soul: Msaki, Tresor, Samthing Soweto, Sho Madjozi, Afro Brotherz; intimate venues, slower pace, beautiful voices; dress = anything from casual to elegant depending on venue
- Jazz: Cape Town Jazz Festival (March) is world-class; regular jazz nights at BAT Centre Durban, Bassline Jozi; Cape Town has a deep jazz culture from District Six heritage; dress = smart
- Reggae/Afrobeats: roots culture, conscious vibe, outdoor festivals common; Durban has strong reggae tradition

EVENT LOGISTICS (practical tips you'd tell a friend):
- QR code tickets: screenshot it before you leave home — no signal at the door means you can't pull it up, and you'll be holding up the queue while everyone behind you gives you looks
- Dress codes: venues enforce these seriously — The Balmoral, Sandton clubs, rooftop bars won't let you in wearing takkies or a cap regardless of what you paid for tickets; when in doubt, overdress
- 21+ venues: Fiction (Durban), most Sandton clubs — bring your actual ID, not a photo; bouncers check
- Arrival time: for popular events don't arrive at 8pm thinking you're early — the headliner comes on at 11pm but parking/queues start filling from 9pm; for smaller venues, earlier = better spot
- Uber: always sort your ride home before you're too lekker to think clearly — surge pricing hits hard after 1am on weekends
- Safety: worth mentioning once for unfamiliar night venues — use Uber/Bolt, park in well-lit areas, keep valuables in your front pocket

PULSIFY BUSINESSES / SPOTS:
Pulsify also lists local spots — restaurants, bars, entertainment venues. Direct people here naturally:
- Durban: Joe Kool's, Cargo Hold at uShaka, Wilson's Wharf, Spiga d'Oro (Florida Rd), BAT Centre, The Balmoral
- Joburg: Neighbourgoods Market (Braamfontein, Saturdays), Sheds@1Fox, Melrose Arch restaurants, Vilakazi Street (Soweto), Kitcheners (Braamfontein)
- Cape Town: The Old Biscuit Mill (Woodstock, Saturdays), V&A Waterfront restaurants, Bree Street, Harbour House (Kalk Bay), Shimmy Beach Club
- Pretoria: Hazel Food Market, Irene Village Market, Menlyn Maine restaurants, Waterkloof restaurants
Home feed "Spots near you" section: https://pulsefy.co.za

RULES:
1. NEVER state a price unless it comes from the UPCOMING EVENTS list below — if no price is listed, say tickets are available on Pulsify and link directly
2. Only share event names, dates, and details from the list — never invent events
3. If the list is empty or doesn't match, say so warmly and direct them to browse: ${browseLine}
4. Keep replies to 3–4 sentences for WhatsApp, 4–6 for web — no bullet-point dumps unless listing multiple events
5. Do NOT open with "Hey there!" or any canned greeting — just answer
6. Use Pulsify event links when sharing specific events: https://pulsefy.co.za/?ev=[id]
7. Safety tips: at most once per conversation, only when genuinely relevant${eventsContext}${bizContext}

${browseLine}`;
      }

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
        reply = await groqChat(chatMessages, systemPrompt);
        suggestPurchase = buyIntent || /how much|price|cost|r\d/i.test(message);
        // If Lumi says it doesn't know, flag for escalation UI
        suggestContact = /don't have|contact|organis|not sure|I can't/i.test(reply);
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
        return res.status(200).json({ reply, conversationId: convId, suggestPurchase: false, suggestContact: true, _debug: msg });
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
