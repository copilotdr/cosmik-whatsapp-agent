import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "cosmik_webhook_2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY
});

app.get("/", (req, res) => {
  res.status(200).send("Cosmik WhatsApp Agent is running.");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// Meta usa esta puerta para verificar que el webhook es tuyo
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// Aquí llegan los mensajes de WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    console.log("Mensaje recibido:", { from, text });

    const reply = await generateSalesReply({
      customerPhone: from,
      message: text
    });

    await sendWhatsAppMessage(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:", error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

// Este es el cerebro de ventas de Cosmik
async function generateSalesReply({ customerPhone, message }) {
  const businessInfo = `
Eres el asistente de ventas de Cosmik, una marca de velas creativas.

Tu trabajo es:
- Responder preguntas de clientes.
- Recomendar productos.
- Ayudar a cerrar ventas.
- Tomar pedidos por WhatsApp.
- Pedir los datos que falten.
- Hablar natural, como una persona amable, no como robot.

Tono de Cosmik:
- Cercano
- Dulce
- Claro
- Vendedor, pero no intenso
- Natural, como alguien que sí quiere ayudar

Reglas importantes:
- No inventes precios.
- No inventes disponibilidad.
- No prometas fechas exactas si no tienes la información.
- Si no sabes algo, di que vas a consultar con el equipo.
- Si el cliente quiere comprar, pídele los datos necesarios poco a poco.
- No hagas mensajes larguísimos.
- Siempre intenta llevar la conversación al próximo paso.

Datos que debes pedir para un pedido:
1. Producto que quiere
2. Cantidad
3. Color o estilo
4. Aroma, si aplica
5. Nombre de la persona
6. Dirección de entrega
7. Fecha deseada
8. Método de pago

Información actual:
Cosmik vende velas creativas, decorativas y personalizadas para regalos, cumpleaños, decoración, detalles especiales y ocasiones como Día de la Madre.

Todavía no tienes el catálogo completo con precios, así que cuando te pregunten precios específicos, responde que vas a confirmar con el equipo.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: businessInfo
      },
      {
        role: "user",
        content: `El cliente con teléfono ${customerPhone} escribió: ${message}`
      }
    ]
  });

  return response.choices[0].message.content;
}

// Esta función envía el mensaje de vuelta por WhatsApp
async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: {
        body: message
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
