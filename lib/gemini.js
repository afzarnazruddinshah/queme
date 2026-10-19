export async function parseMessageWithAI(userText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return cleanFallback(userText);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const prompt = `You are a strict data extractor for a WhatsApp queue booking system.
Analyze the user message and output ONLY a JSON object.

RULES:
1. If the message contains a person's name or is a request to book/generate a token for someone (e.g. "Rahul", "generate token for Rahul", "get token for rohit", "book slot for Priya Sharma", "Dr. Ramesh"):
   - Set "action" to "CREATE_TOKEN"
   - Set "name" to ONLY the extracted person's name (e.g. "Rahul", "Rohit", "Priya Sharma"). Strip out filler words like "generate", "token", "for", "please", "book", "get", "my name is", "hi".
2. If the message is a greeting, filler, question, or lacks a specific personal name (e.g. "hi", "hello", "good morning", "how are you", "can I get a token", "test"):
   - Set "action" to "REQUEST_NAME"
   - Set "name" to null

EXAMPLES:
User: "generate token for Rahul"
JSON: {"action": "CREATE_TOKEN", "name": "Rahul"}

User: "get token for rohit"
JSON: {"action": "CREATE_TOKEN", "name": "Rohit"}

User: "Priya"
JSON: {"action": "CREATE_TOKEN", "name": "Priya"}

User: "Hi, please book an appointment for Arun Kumar"
JSON: {"action": "CREATE_TOKEN", "name": "Arun Kumar"}

User: "hi how are you"
JSON: {"action": "REQUEST_NAME", "name": null}

User: "can i get a token"
JSON: {"action": "REQUEST_NAME", "name": null}

User message to evaluate:
"${userText}"`;

  const payload = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Gemini API Error:', errText);
      return cleanFallback(userText);
    }

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return cleanFallback(userText);
    }

    const parsed = JSON.parse(candidateText.trim());
    return {
      action: parsed.action || 'REQUEST_NAME',
      name: parsed.name ? String(parsed.name).trim() : null,
    };
  } catch (err) {
    console.error('Gemini processing exception:', err);
    return cleanFallback(userText);
  }
}

// Fallback regex cleaner in case API is unreachable
function cleanFallback(text) {
  const cleaned = text.trim();
  const lower = cleaned.toLowerCase();
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'test', 'help'];

  if (greetings.includes(lower) || lower.length < 2) {
    return { action: 'REQUEST_NAME', name: null };
  }

  // Strip common prefixes if someone says "generate token for X"
  const stripped = cleaned
    .replace(/^(hi|hello|hey)?[,\s]*(please\s+)?(book|get|generate|give|create)?(\s+(a|me)?\s+token)?(\s+for)?/i, '')
    .trim();

  if (!stripped || greetings.includes(stripped.toLowerCase())) {
    return { action: 'REQUEST_NAME', name: null };
  }

  return { action: 'CREATE_TOKEN', name: stripped };
}
