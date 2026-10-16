const GRAPH_URL = 'https://graph.facebook.com/v21.0';

export async function sendWhatsAppText(to, text) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  try {
    await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
  } catch (err) {
    console.error('WhatsApp sendText error:', err);
  }
}

export async function sendWhatsAppButtons(to, bodyText, buttons) {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  // Formats up to 3 interactive reply buttons
  const formattedButtons = buttons.map((btn) => ({
    type: 'reply',
    reply: {
      id: btn.id,
      title: btn.title.slice(0, 20), // Meta limit: 20 chars per button
    },
  }));

  try {
    await fetch(`${GRAPH_URL}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: bodyText },
          action: { buttons: formattedButtons },
        },
      }),
    });
  } catch (err) {
    console.error('WhatsApp sendButtons error:', err);
  }
}