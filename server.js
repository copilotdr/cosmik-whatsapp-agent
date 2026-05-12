import express from "express";
import axios from "axios";

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "cosmik_webhook_2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.get("/", (req, res) => {
  res.status(200).send("Cosmik WhatsApp Agent is running.");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

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

    const reply = `¡Hola! Gracias por escribir a Cosmik 💕 Recibimos tu mensaje: "${text}". ¿Buscas una vela para regalo, decoración o evento especial?`;

    if (WHATSAPP_TOKEN && PHONE_NUMBER_ID) {
      await sendWhatsAppMessage(from, reply);
    } else {
      console.log("Faltan WHATSAPP_TOKEN o PHONE_NUMBER_ID. No se envió respuesta real.");
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:", error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

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
