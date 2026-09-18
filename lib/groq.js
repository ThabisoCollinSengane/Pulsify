const GROQ_API = 'https://api.groq.com/openai/v1';
const GROQ_KEY = () => process.env.GROQ_API_KEY || '';

async function groqChat(messages, systemPrompt) {
  const key = GROQ_KEY();
  if (!key) throw new Error('GROQ_API_KEY is not set');

  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
      temperature: 0.4,
      max_tokens: 512,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq chat error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function groqEmbed(text) {
  const key = GROQ_KEY();
  if (!key) throw new Error('GROQ_API_KEY is not set');

  const res = await fetch(`${GROQ_API}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: 'nomic-embed-text-v1.5',
      input: text,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq embed error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.data?.[0]?.embedding || null;
}

// Returns a tone-matched system prompt based on event genre/type.
// Lumi NEVER states a price unless it comes from the knowledge base.
function buildLumiSystemPrompt(event, channel) {
  const genre = (event?.genre || event?.type || '').toLowerCase();
  const eventName = event?.name || 'this event';

  const isFestival = /festival|concert|party|rave|nightlife|music/.test(genre);
  const isCorporate = /corporate|conference|seminar|workshop|business|summit/.test(genre);

  const tone = isFestival
    ? 'You are Lumi, an upbeat and friendly assistant. Keep it fun and energetic but still helpful.'
    : isCorporate
    ? 'You are Lumi, a professional and courteous assistant. Be concise, clear, and formal.'
    : 'You are Lumi, a warm and helpful assistant.';

  const channelNote = channel === 'whatsapp'
    ? 'Keep responses short — this is a WhatsApp chat. Use plain text only, no markdown.'
    : 'You may use light markdown (bold, line breaks) but keep replies concise.';

  return `${tone} You help customers with questions about "${eventName}".

Rules you must NEVER break:
1. NEVER state a ticket price unless it comes directly from the knowledge base provided to you.
   If price is unknown, say "I don't have the ticket price on hand — tap Contact Organiser for details."
2. If you cannot answer a question from the knowledge base, say so clearly and suggest the customer
   contact the organiser. Never guess or make up information.
3. If a customer wants to buy tickets, confirm quantity and collect their name, email and phone
   before generating a payment link.
4. Stay on-topic: this event and its details only.

${channelNote}

The knowledge base below contains everything you know about this event. Use only this information to answer questions.`;
}

module.exports = { groqChat, groqEmbed, buildLumiSystemPrompt };
