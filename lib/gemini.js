const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const GEMINI_KEY = () => process.env.GEMINI_API_KEY || '';

async function geminiChat(messages, systemPrompt) {
  const key = GEMINI_KEY();
  if (!key) throw new Error('GEMINI_API_KEY is not set');

  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  // Gemini requires at least one user turn
  if (!contents.length || contents[contents.length - 1].role !== 'user') {
    contents.push({ role: 'user', parts: [{ text: '...' }] });
  }

  const res = await fetch(`${GEMINI_API}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 600,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
}

module.exports = { geminiChat };
