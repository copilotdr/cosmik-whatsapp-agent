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

// Meta usa esta ruta para verificar tu webhook
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("Verificación de webhook recibida:", {
    mode,
    token,
    challenge
  });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  console.log("Error verificando webhook. Token incorrecto.");
  return res.sendStatus(403);
});

// Aquí llegan los mensajes de WhatsApp
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    console.log("Webhook POST recibido:");
    console.log(JSON.stringify(body, null, 2));

    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      console.log("No hay mensaje nuevo. Puede ser un status/update de WhatsApp.");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    console.log("Mensaje recibido:", {
      from,
      text
    });

    // RESPUESTA FIJA DE PRUEBA
    const reply = "Hola 💕 Soy el bot de Cosmik. Esta es una prueba automática desde Render.";

    await sendWhatsAppMessage(from, reply);

    console.log("Respuesta enviada correctamente a:", from);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:");
    console.error(error.response?.data || error.message);

    return res.sendStatus(200);
  }
});

// Esta función envía el mensaje de vuelta por WhatsApp
async function sendWhatsAppMessage(to, message) {
  if (!WHATSAPP_TOKEN) {
    throw new Error("Falta WHATSAPP_TOKEN en Render.");
  }

  if (!PHONE_NUMBER_ID) {
    throw new Error("Falta PHONE_NUMBER_ID en Render.");
  }

  const url = `https://graph.facebook.com/v25.0/${PHONE_NUMBER_ID}/messages`;

  console.log("Enviando mensaje a WhatsApp:", {
    to,
    url,
    message
  });

  const response = await axios.post(
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

  console.log("Respuesta de Meta:");
  console.log(response.data);
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor activo en puerto ${PORT}`);
});
