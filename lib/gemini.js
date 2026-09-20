const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';

// Chat with Gemini Flash. messages = [{role:'user'|'assistant', content:'...'}]
// systemPrompt is passed via systemInstruction (Gemini 2.0 Flash supports it natively).
async function geminiChat(messages, systemPrompt) {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  // Map OpenAI-style roles to Gemini roles
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 600,
    },
  };
  if (systemPrompt) {
    body.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const url = `${GEMINI_API}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

module.exports = { geminiChat };
