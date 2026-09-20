const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = 'gemini-2.0-flash';

async function geminiChat(messages, systemPrompt) {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  // Map OpenAI-style roles → Gemini roles (assistant → model)
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    contents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: 0.55,
      maxOutputTokens: 600,
    },
  };

  const res = await fetch(
    `${GEMINI_API}/${GEMINI_MODEL}:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

module.exports = { geminiChat };
