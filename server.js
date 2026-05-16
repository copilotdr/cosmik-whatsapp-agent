import express from "express";
import axios from "axios";
import OpenAI from "openai";

const app = express();
app.use(express.json({ limit: "1mb" }));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "cosmik_webhook_2026";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID || "1997668764206548";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

app.get("/", (req, res) => {
  res.status(200).send("Cosmik WhatsApp Agent is running.");
});

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/privacy", (req, res) => {
  res.type("html").send("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>Privacy Policy | Cosmik</title><style>body{font-family:Arial,sans-serif;line-height:1.6;margin:0;padding:40px 20px;background:#fffaf6;color:#241f1b}main{max-width:820px;margin:0 auto}a{color:#7a4b2a}</style></head><body><main><h1>Privacy Policy</h1><p>Last updated: May 15, 2026</p><p>Cosmik collects customer information such as name, phone number, delivery address, order details, payment preference, and messages sent through WhatsApp or our website in order to process orders, provide customer support, coordinate deliveries, and improve our service.</p><h2>How we use information</h2><p>We use customer information to answer questions, recommend products, prepare and confirm orders, coordinate delivery, provide support, and keep internal records related to purchases and service requests.</p><h2>Sharing information</h2><p>We do not sell personal information. We may share only the information necessary with service providers, delivery partners, payment providers, or internal tools when required to complete a purchase, provide support, or comply with applicable obligations.</p><h2>WhatsApp communications</h2><p>When customers contact Cosmik through WhatsApp, we may process message content and contact details to respond, guide the purchase process, and follow up on orders.</p><h2>Customer rights</h2><p>Customers may contact us to request access, correction, or deletion of their personal information where applicable.</p><h2>Contact</h2><p>Email: <a href=\"mailto:equipocosmik@gmail.com\">equipocosmik@gmail.com</a></p><p>Website: <a href=\"https://www.wearecosmik.com/\">https://www.wearecosmik.com/</a></p></main></body></html>");
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("Verificacion de webhook recibida:", { mode, token, challenge });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado correctamente.");
    return res.status(200).send(challenge);
  }

  console.log("Error verificando webhook. Token incorrecto.");
  return res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;
    console.log("Webhook POST recibido:");
    console.log(JSON.stringify(body, null, 2));

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) {
      console.log("No hay mensaje nuevo. Puede ser un status/update de WhatsApp.");
      return res.sendStatus(200);
    }

    const from = message.from;
    const text = message.text?.body || "";

    if (!text) {
      await sendWhatsAppMessage(from, "Hola. Por ahora solo puedo leer mensajes de texto. Escribeme que estas buscando y te ayudo.");
      return res.sendStatus(200);
    }

    console.log("Mensaje recibido:", { from, text });

    let reply;
    try {
      reply = await generateSalesReply({ customerPhone: from, message: text });
    } catch (aiError) {
      console.error("Error generando respuesta con OpenAI:");
      console.error(aiError.response?.data || aiError.message);
      reply = "Hola. Gracias por escribir a Cosmik. Estamos revisando tu mensaje y te responderemos en breve.";
    }

    await sendWhatsAppMessage(from, reply);
    console.log("Respuesta enviada correctamente a:", from);
    return res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:");
    console.error(error.response?.data || error.message);
    return res.sendStatus(200);
  }
});

async function generateSalesReply({ customerPhone, message }) {
  if (!OPENAI_API_KEY) {
    console.log("Falta OPENAI_API_KEY en Render.");
    return "Hola. Gracias por escribir a Cosmik. En este momento estoy teniendo un problema tecnico, pero ya el equipo recibio tu mensaje.";
  }

  const businessInfo = [
    "Eres el asistente de ventas de Cosmik, una marca de velas creativas, decorativas y personalizadas.",
    "Responde en espanol con tono cercano, dulce, claro y comercial.",
    "Ayuda a recomendar productos segun ocasion, color, aroma, forma, tamano y cantidad.",
    "No inventes precios, stock, promociones ni fechas exactas.",
    "Si falta informacion, haz una sola pregunta concreta a la vez.",
    "Para tomar un pedido pide producto, cantidad, color, aroma, nombre, direccion, fecha deseada, metodo de pago y mensaje personalizado si aplica.",
    "Si preguntan por precios o disponibilidad que no conoces, di que lo confirmaras con el equipo.",
    "Mantén mensajes cortos y naturales para WhatsApp.",
    "Guia al cliente hacia elegir un producto y confirmar el pedido."
  ].join("\n");

  const response = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: businessInfo },
      { role: "user", content: "Cliente con telefono " + customerPhone + " escribio: " + message }
    ],
    temperature: 0.7,
    max_tokens: 350
  });

  return response.choices[0].message.content;
}

async function sendWhatsAppMessage(to, message) {
  if (!WHATSAPP_TOKEN) throw new Error("Falta WHATSAPP_TOKEN en Render.");
  if (!PHONE_NUMBER_ID) throw new Error("Falta PHONE_NUMBER_ID en Render.");

  const url = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + PHONE_NUMBER_ID + "/messages";
  console.log("Enviando mensaje a WhatsApp:", { to, url, message });

  const response = await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: message.slice(0, 3900) }
    },
    {
      headers: {
        Authorization: "Bearer " + WHATSAPP_TOKEN,
        "Content-Type": "application/json"
      }
    }
  );

  console.log("Respuesta de Meta:");
  console.log(response.data);
}

async function subscribeWabaToApp() {
  if (!WHATSAPP_TOKEN || !WABA_ID) {
    console.log("No se puede suscribir WABA: faltan WHATSAPP_TOKEN o WABA_ID.");
    return;
  }

  try {
    const url = "https://graph.facebook.com/" + GRAPH_VERSION + "/" + WABA_ID + "/subscribed_apps";
    const response = await axios.post(url, {}, { headers: { Authorization: "Bearer " + WHATSAPP_TOKEN } });
    console.log("WABA subscribed_apps actualizado:", response.data);
  } catch (error) {
    console.error("No se pudo suscribir la app al WABA:");
    console.error(error.response?.data || error.message);
  }
}

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log("Servidor activo en puerto " + PORT);
  await subscribeWabaToApp();
});
