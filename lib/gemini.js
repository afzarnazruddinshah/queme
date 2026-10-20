export async function parseMessageWithAI(userText) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('[Gemini] GEMINI_API_KEY is missing from process.env');
    return cleanFallback(userText);
  }

  // Use the standard v1beta endpoint with both query param and header
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

  const promptText = `Extract the person's name from this WhatsApp message for a queue booking.
Respond ONLY with a JSON object in this format:
{"action": "CREATE_TOKEN" | "REQUEST_NAME", "name": "string or null"}

Rules:
- If a person's name is found (e.g. "Rahul", "generate token for Rahul", "get token for rohit", "book for Priya"), return action "CREATE_TOKEN" and set "name" to ONLY the person's first/last name (e.g. "Rahul", "Rohit", "Priya"). Never include words like "token", "for", "please", "book", "generate".
- If the message is just a greeting, random text, or question without a specific person's name (e.g. "hi", "hello", "how are you", "can I get a token"), return action "REQUEST_NAME" and set "name" to null.

Message: "${userText}"`;

  const payload = {
    contents: [
      {
        parts: [{ text: promptText }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.0,
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[Gemini HTTP Error] Status ${res.status}:`, errBody);
      return cleanFallback(userText);
    }

    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      console.error('[Gemini Empty Response]:', JSON.stringify(data));
      return cleanFallback(userText);
    }

    const parsed = JSON.parse(candidateText.trim());
    console.log('[Gemini Parsed Output]:', parsed);

    return {
      action: parsed.action === 'CREATE_TOKEN' ? 'CREATE_TOKEN' : 'REQUEST_NAME',
      name: parsed.name ? String(parsed.name).trim() : null,
    };
  } catch (err) {
    console.error('[Gemini Exception]:', err.message);
    return cleanFallback(userText);
  }
}

// Deterministic fallback regex so even without Gemini, it NEVER takes "generate token for" as the name
function cleanFallback(text) {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  // 1. Detect pure greetings/questions
  const greetingWords = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'help', 'status', 'test'];
  if (greetingWords.includes(lower) || lower.length < 2) {
    return { action: 'REQUEST_NAME', name: null };
  }

  // 2. Aggressively strip booking commands (e.g., "generate token for rahul", "book a slot for rohit")
  let cleanName = raw.replace(
    /^(hi|hello|hey)?[,\s]*(please\s+)?(can\s+you\s+)?(generate|get|book|give|create|add)?(\s+(a|me)?\s+token)?(\s+(a|the)?\s+slot)?(\s+for)?\s+/i,
    ''
  ).trim();

  // Also strip "my name is X" or "I am X"
  cleanName = cleanName.replace(/^(my\s+name\s+is|i\s+am|this\s+is)\s+/i, '').trim();

  // If after stripping nothing is left or it's just "token"
  if (!cleanName || cleanName.toLowerCase() === 'token' || greetingWords.includes(cleanName.toLowerCase())) {
    return { action: 'REQUEST_NAME', name: null };
  }

  return { action: 'CREATE_TOKEN', name: cleanName };
}
