export async function parseMessageWithAI(userText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set');
    return fallbackParser(userText);
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

  const systemInstruction = `You are an automated WhatsApp queue assistant router.
Your job is to analyze the user's input and classify it into one of two actions:
1. "CREATE_TOKEN": If the user provides their name (e.g., "Rahul", "Priya Sharma") OR asks to book a token with an identifiable name (e.g., "Hi, please book a token for Rahul", "Book slot for Arun"). Extract ONLY the person's real name. Clean up titles like "Dr." or extra verbs.
2. "REQUEST_NAME": If the message is a greeting, filler, question, gibberish, or lacks a specific personal name (e.g., "hi", "hello", "good morning", "how are you", "book a token", "where are you located", "test").

You MUST return a strict JSON object with this exact schema:
{
  "action": "CREATE_TOKEN" | "REQUEST_NAME",
  "name": "ExtractedName" | null
}`;

  const payload = {
    contents: [
      {
        role: 'user',
        parts: [{ text: userText }],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
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
      console.error('Gemini API request failed:', await res.text());
      return fallbackParser(userText);
    }

    const data = await res.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return fallbackParser(userText);

    const parsed = JSON.parse(candidateText.trim());
    return {
      action: parsed.action || 'REQUEST_NAME',
      name: parsed.name ? String(parsed.name).trim() : null,
    };
  } catch (err) {
    console.error('Error invoking Gemini:', err);
    return fallbackParser(userText);
  }
}

// Fallback logic in case the AI API times out or is unreachable
function fallbackParser(text) {
  const greetings = ['hi', 'hello', 'hey', 'good morning', 'good evening', 'test', 'help'];
  const cleaned = text.trim().toLowerCase();

  if (greetings.includes(cleaned) || cleaned.length < 2) {
    return { action: 'REQUEST_NAME', name: null };
  }
  return { action: 'CREATE_TOKEN', name: text.trim() };
}
