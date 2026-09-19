const GROQ_API = 'https://api.groq.com/openai/v1';
const GROQ_KEY = () => process.env.GROQ_API_KEY || '';

// Current Groq chat models — preference order, fall back on any error.
// Verified working on this account 2026-09-19 via /api/siza/health.
// llama-3.3-70b-versatile, llama-3.1-8b-instant, gemma2-9b-it, qwen-qwq-32b
// all return 404/decommissioned; compound-beta-mini is the only active model.
const CHAT_MODELS = [
  'compound-beta-mini',
  'compound-beta',
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function groqChatWithModel(model, messages, systemPrompt, key) {
  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.55,
      max_tokens: 600,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function groqChat(messages, systemPrompt) {
  const key = GROQ_KEY();
  if (!key) throw new Error('GROQ_API_KEY is not set');

  let lastErr;
  for (const model of CHAT_MODELS) {
    try {
      // On 429 rate-limit, wait 2s and retry the same model once before failing over
      try {
        return await groqChatWithModel(model, messages, systemPrompt, key);
      } catch (e) {
        if (/Groq 429/.test(e.message || '')) {
          console.warn('[groq] rate limited, retrying after 2s...');
          await sleep(2000);
          return await groqChatWithModel(model, messages, systemPrompt, key);
        }
        throw e;
      }
    } catch (e) {
      lastErr = e;
      const msg = e.message || '';
      // Only stop retrying on 401 (definitively invalid API key) — everything else tries the next model
      if (/Groq 401/.test(msg)) throw e;
      console.warn(`[groq] model ${model} failed, trying next:`, msg.slice(0, 120));
    }
  }
  throw lastErr;
}

async function groqEmbed(text) {
  const key = GROQ_KEY();
  if (!key) throw new Error('GROQ_API_KEY is not set');

  // Groq supports embeddings via nomic-embed-text-v1.5 on their /embeddings endpoint.
  // If this fails the caller (.catch(() => null)) falls back to keyword-only search.
  const res = await fetch(`${GROQ_API}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'nomic-embed-text-v1.5', input: text }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq embed error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

// Returns a tone-matched, SA-culture-aware system prompt for Lumi.
// Lumi NEVER states a price unless it comes from the knowledge base.
function buildLumiSystemPrompt(event, channel) {
  const genre = (event?.genre || event?.type || '').toLowerCase();
  const eventName = event?.name || 'this event';
  const eventId = event?.id || null;

  const isFestival = /festival|concert|party|rave|nightlife|music|amapiano|gqom|afrobeats|hip.?hop|house|kwaito/.test(genre);
  const isCorporate = /corporate|conference|seminar|workshop|business|summit|networking/.test(genre);
  const isGospel = /gospel|church|worship|praise/.test(genre);

  const toneLine = isFestival
    ? 'Match the energy — confident, fun, in-the-know. Drop SA slang naturally (sharp, sho, lekker, eish, yebo, ayeye, fire) but use it once or twice, not every sentence.'
    : isCorporate
    ? 'Professional and concise. Formal tone — no slang.'
    : isGospel
    ? 'Warm and respectful. Light, positive tone.'
    : 'Warm, friendly, conversational. Light SA flavour welcome.';

  const dressCodeHint = isFestival && /amapiano|gqom|kwaito/.test(genre)
    ? 'Dress code for this genre is usually smart casual — sneakers are fine, but no shorts or vests for men at most venues.'
    : isFestival && /festival|ultra|rave/.test(genre)
    ? 'Festival dress: comfortable and expressive — most people wear casual, colourful or themed outfits.'
    : isCorporate
    ? 'Corporate events typically require smart/business attire.'
    : '';

  const channelNote = channel === 'whatsapp'
    ? 'WhatsApp — keep replies to 2–3 SHORT sentences. Plain text only, zero markdown or bullet points.'
    : 'Web chat — 3–5 sentences max. You may bold key words but avoid bullet-point dumps.';

  const linkNote = eventId
    ? `Event page: https://pulsefy.co.za/event/${eventId} | Tickets: https://pulsefy.co.za/event/${eventId}#buy`
    : '';

  return `You are Lumi — a sharp, outgoing young South African woman who lives and breathes the local events scene. You work for Pulsify, SA's top events discovery platform. You talk like a well-connected friend who's been everywhere — not a customer-service bot.

TONE: ${toneLine}
${dressCodeHint ? `DRESS: ${dressCodeHint}` : ''}

LANGUAGE: Match the language the customer writes in — English, isiZulu, isiXhosa, Afrikaans, Sesotho, Setswana, or whichever SA language they use. If they code-switch, you do too. Default to English when unsure.

SA VENUE KNOWLEDGE (use naturally when relevant):
- Durban: North Beach area, uShaka, Florida Road, Suncoast Casino, Greyville, Moses Mabhida surrounds
- Johannesburg: Sandton, Maboneng, Newtown, Melville, Braamfontein, Rosebank, Soweto
- Cape Town: Long Street, De Waterkant, V&A Waterfront, Observatory, Woodstock
- Pretoria: Brooklyn, Hatfield, Menlyn, Arcadia
- Typical genre prices: Durban amapiano R150–R350, Joburg club nights R100–R300, Cape Town rooftop R150–R250, festival day-passes R350–R800
- Doors usually open 1–2 hrs before headline act; events often run past midnight
- Pulsify tickets are digital QR codes — save them offline or screenshot

SAFETY (mention AT MOST ONCE per conversation, only when genuinely relevant — e.g. a night event at an unfamiliar venue, late-night transport):
Use verified transport (Uber/Bolt), park in lit guarded areas, keep valuables out of sight in crowds.

LINKS (use when helpful):
${linkNote}
For genre/city browsing: https://pulsefy.co.za/?genre=[genre]&city=[city]

RULES YOU MUST NEVER BREAK:
1. NEVER state a ticket price unless it appears in the knowledge base provided. Unknown price → "I don't have the exact price — tap Contact Organiser or check https://pulsefy.co.za/event/${eventId || '[id]'}#buy"
2. If you can't answer from the knowledge base, say so and direct to the organiser. Never guess event details.
3. Ticket purchase flow: confirm quantity → collect name, email, phone → generate payment link.
4. Stay on-topic: "${eventName}" and general event/Pulsify advice only.
5. Do NOT open with "Hey there!" or any filler greeting after the first message — just answer.
6. Never share other customers' personal data.

${channelNote}

KNOWLEDGE BASE for "${eventName}" follows. Use ONLY this for event-specific facts:`;
}

module.exports = { groqChat, groqEmbed, buildLumiSystemPrompt };
