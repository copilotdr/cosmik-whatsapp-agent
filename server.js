import express from "express";
import axios from "axios";
import OpenAI from "openai";

const config = {
  port: Number(process.env.PORT || 10000),
  verifyToken: process.env.VERIFY_TOKEN,
  whatsappToken: process.env.WHATSAPP_TOKEN,
  phoneNumberId: process.env.PHONE_NUMBER_ID,
  wabaId: process.env.WABA_ID || "1997668764206548",
  graphVersion: process.env.META_GRAPH_VERSION || "v25.0",
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  dashboardToken: process.env.DASHBOARD_TOKEN,
  supabaseUrl: process.env.SUPABASE_URL?.replace(/\/$/, ""),
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
  telegramChatId: process.env.TELEGRAM_CHAT_ID,
  maxConversationTurns: Number(process.env.MAX_CONVERSATION_TURNS || 8),
  fallbackReply:
    process.env.FALLBACK_REPLY ||
    "Estamos revisando tu mensaje y en un momento te ayudamos con mucho gusto."
};

const app = express();
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const processedMessageIds = new Set();

const knowledgeBase = {
  brand: {
    name: "Cosmik",
    website: "https://www.wearecosmik.com/",
    whatsapp: "+57 310 8001469",
    location: "Bogota, Colombia",
    positioning:
      "Piezas artesanales personalizadas, disenadas y elaboradas con mucho amor y 100% a mano."
  },
  shipping: {
    country: "Colombia",
    production_time:
      "Pedidos personalizados normalmente en 2 a 3 dias habiles. Confirmar disponibilidad antes de prometer fecha.",
    free_shipping:
      "La web menciona envio gratis desde compras mayores a $200.000; confirmar si aplica antes de cerrar."
  },
  personalization: ["color", "mensaje", "flor", "olor", "acabado", "etiqueta"],
  products: [
    { name: "Dado D&D", category: "Velas", price_cop: 45000, url: "https://www.wearecosmik.com/" },
    { name: "Pan Baguette", category: "Velas", price_cop: 10000, url: "https://www.wearecosmik.com/" },
    { name: "Corazon Flor Grande", category: "Velas", price_cop: 25000, url: "https://www.wearecosmik.com/" },
    { name: "Corazon Flor Chiqui", category: "Velas", price_cop: 15000, url: "https://www.wearecosmik.com/" },
    { name: "Cupcake con Merengue y Amor", category: "Velas", price_cop: 35000, url: "https://www.wearecosmik.com/" },
    { name: "Gelatina con Fresa", category: "Velas", price_cop: 35000, url: "https://www.wearecosmik.com/" },
    { name: "Bouquet Coqueto", category: "Velas", price_cop: 50000, url: "https://www.wearecosmik.com/" },
    { name: "Bouquet de Flores Corazon", category: "Velas", price_cop: 100000, url: "https://www.wearecosmik.com/" },
    { name: "Taza de cafe con crema", category: "Velas", price_cop: 60000, url: "https://www.wearecosmik.com/" },
    { name: "Forever Bouquet", category: "Bouquets de cera", price_cop: null, url: "https://www.wearecosmik.com/" }
  ],
  order_required_fields: [
    "producto",
    "cantidad",
    "color",
    "aroma",
    "nombre",
    "telefono",
    "direccion",
    "fecha deseada",
    "metodo de pago",
    "mensaje personalizado si aplica"
  ]
};

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.type("text").send("Cosmik WhatsApp Agent is running.");
});

app.get("/health", (_req, res) => {
  res.type("text").send("OK");
});

app.get("/privacy", (_req, res) => {
  res.type("html").send("<h1>Cosmik Privacy Policy</h1><p>Cosmik usa WhatsApp para atender solicitudes, responder consultas y gestionar pedidos. Los datos compartidos por clientes se usan solo para la atencion comercial y operativa.</p>");
});

app.get("/api/dashboard", async (req, res) => {
  if (!config.dashboardToken || req.query.token !== config.dashboardToken) {
    res.sendStatus(401);
    return;
  }

  try {
    res.json(await readDashboardData());
  } catch (error) {
    console.error("Dashboard read failed:", error.response?.data || error.message);
    res.status(500).json({
      orders: [],
      conversations: [],
      error: "dashboard_unavailable"
    });
  }
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.verifyToken) {
    res.status(200).send(challenge);
    return;
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  const messages = extractMessages(req.body);
  res.status(200).json({ ok: true, received: messages.length });

  for (const message of messages) {
    if (processedMessageIds.has(message.id)) continue;
    processedMessageIds.add(message.id);

    console.log("Mensaje recibido:", message.from, message.text);
    const history = await getRecentConversation(message.from);
    const reply = await buildReply(message, history);

    try {
      await sendWhatsAppText(message.from, reply);
      await appendConversation({ ...message, reply });
      await captureConfirmedOrder(message, reply, history);
      console.log(`Respuesta enviada a ${message.from}`);
    } catch (error) {
      console.error("No se pudo procesar el mensaje:", error.response?.data || error.message);
    }
  }
});

function extractMessages(payload = {}) {
  const messages = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contactNameByWaId = new Map(
        (value.contacts || []).map((contact) => [
          contact.wa_id,
          contact.profile?.name || ""
        ])
      );

      for (const message of value.messages || []) {
        if (message.type !== "text" || !message.text?.body) continue;
        messages.push({
          id: message.id,
          from: message.from,
          name: contactNameByWaId.get(message.from) || "",
          text: message.text.body.trim()
        });
      }
    }
  }

  return messages;
}

async function buildReply(message, history = []) {
  try {
    const completion = await openai.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        ...historyToOpenAiMessages(history),
        {
          role: "user",
          content: message.name
            ? `${message.name} escribe por WhatsApp: ${message.text}`
            : message.text
        }
      ],
      max_completion_tokens: 450
    });

    return (
      completion.choices?.[0]?.message?.content?.trim() ||
      "Gracias por escribirnos. Cuentame un poquito mas y te ayudo."
    );
  } catch (error) {
    console.error("OpenAI reply failed:", error.response?.data || error.message);
    return config.fallbackReply;
  }
}

function buildSystemPrompt() {
  return `
Eres el asistente de WhatsApp de Cosmik, una marca de velas y detalles personalizados.
Responde en espanol con tono cercano, dulce, claro y comercial.

Objetivo:
- Ayudar al cliente a elegir segun ocasion, color, aroma, forma, tamano/formato y cantidad.
- Recomendar maximo 3 opciones con precios solo si estan en la base.
- Guiar al cliente hacia el checkout o hacia la confirmacion de pedido por WhatsApp.
- Recopilar: producto, cantidad, color, aroma, nombre, telefono, direccion, fecha deseada, metodo de pago y mensaje personalizado si aplica.

Reglas:
- No inventes precios, stock, promociones, metodos de pago ni fechas.
- Cosmik trabaja on-demand, no con stock fijo.
- Si falta informacion, haz una sola pregunta concreta a la vez.
- Usa el historial de conversacion para continuar el proceso; no vuelvas a saludar ni a empezar desde cero si el cliente ya esta avanzando un pedido.
- Si el cliente responde algo corto como "si", "confirmo", un telefono, una direccion, un color o un aroma, interpretalo segun la ultima pregunta del asistente.
- Si ya hay un pedido en curso, conserva los datos ya dados y pide solamente el dato faltante mas importante.
- Antes de cerrar, resume el pedido y pregunta si confirma.
- Si el cliente confirma, responde breve y avisa que el equipo revisara el pedido.
- Mantén respuestas cortas para WhatsApp.

Base de conocimiento:
${JSON.stringify(knowledgeBase, null, 2)}
`.trim();
}

async function sendWhatsAppText(to, text) {
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: true, body: text.slice(0, 3900) }
    },
    {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function captureConfirmedOrder(message, reply, history = []) {
  const analysis = await analyzeOrder(message, reply, history);
  if (!analysis?.confirmed) return;

  const order = {
    ...analysis,
    id: message.id,
    from: message.from,
    customerName: analysis.customerName || message.name || "",
    sourceText: message.text
  };

  await appendOrder(order);
  await notifyTelegram(order);
}

async function analyzeOrder(message, reply, history = []) {
  try {
    const completion = await openai.chat.completions.create({
      model: config.openaiModel,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Analiza si el cliente acaba de confirmar un pedido de Cosmik.",
            "Devuelve solo JSON valido.",
            "Campos: confirmed boolean, product, quantity, color, scent, customerName, phone, address, deliveryDate, paymentMethod, personalMessage, summary.",
            "Si no hay confirmacion clara del pedido, confirmed debe ser false.",
            "No inventes campos faltantes; usa strings vacios."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            recentConversation: history,
            customer: message,
            assistantReply: reply
          })
        }
      ],
      max_completion_tokens: 450
    });

    return JSON.parse(completion.choices?.[0]?.message?.content || "{}");
  } catch (error) {
    console.error("Order analysis failed:", error.response?.data || error.message);
    return null;
  }
}

async function getRecentConversation(customerWhatsapp) {
  if (!supabaseEnabled()) return [];

  try {
    const rows = await supabaseGet("conversations", {
      select: "incoming_text,assistant_reply,created_at",
      customer_whatsapp: `eq.${customerWhatsapp}`,
      order: "created_at.desc",
      limit: String(config.maxConversationTurns)
    });

    return rows.reverse();
  } catch (error) {
    console.error("Conversation history read failed:", error.response?.data || error.message);
    return [];
  }
}

function historyToOpenAiMessages(history) {
  return history.flatMap((turn) => {
    const messages = [];
    if (turn.incoming_text) {
      messages.push({ role: "user", content: turn.incoming_text });
    }
    if (turn.assistant_reply) {
      messages.push({ role: "assistant", content: turn.assistant_reply });
    }
    return messages;
  });
}

async function appendConversation(event) {
  if (!supabaseEnabled()) return;

  const now = new Date().toISOString();
  await supabaseUpsert("customers", {
    id: event.from,
    whatsapp: event.from,
    name: event.name || null,
    last_seen_at: now,
    updated_at: now
  });

  await supabaseUpsert("conversations", {
    id: event.id,
    whatsapp_message_id: event.id,
    customer_id: event.from,
    customer_whatsapp: event.from,
    customer_name: event.name || null,
    incoming_text: event.text,
    assistant_reply: event.reply,
    created_at: now
  });
}

async function appendOrder(order) {
  if (!supabaseEnabled()) return;

  const now = new Date().toISOString();
  await supabaseUpsert("customers", {
    id: order.from,
    whatsapp: order.from,
    name: order.customerName || null,
    last_seen_at: now,
    updated_at: now
  });

  await supabaseUpsert("orders", {
    id: order.id || `order_${Date.now()}`,
    whatsapp_message_id: order.id || null,
    customer_id: order.from,
    customer_whatsapp: order.from,
    customer_name: order.customerName || null,
    status: "nuevo",
    priority: "normal",
    product: order.product || null,
    quantity: parseInt(order.quantity, 10) || null,
    color: order.color || null,
    scent: order.scent || null,
    personal_message: order.personalMessage || null,
    delivery_address: order.address || null,
    desired_delivery_date: parseDate(order.deliveryDate),
    payment_method: order.paymentMethod || null,
    summary: order.summary || null,
    updated_at: now
  });
}

async function readDashboardData() {
  if (!supabaseEnabled()) return { orders: [], conversations: [] };

  const [orders, conversations] = await Promise.all([
    supabaseGet("orders", { select: "*", order: "created_at.desc", limit: "250" }),
    supabaseGet("conversations", { select: "*", order: "created_at.desc", limit: "250" })
  ]);

  return {
    orders: orders.map((row) => ({
      ...row,
      createdAt: row.created_at,
      customerName: row.customer_name,
      deliveryDate: row.desired_delivery_date,
      paymentMethod: row.payment_method
    })),
    conversations: conversations.map((row) => ({
      ...row,
      from: row.customer_whatsapp,
      name: row.customer_name,
      text: row.incoming_text,
      reply: row.assistant_reply,
      createdAt: row.created_at
    }))
  };
}

async function supabaseGet(table, params = {}) {
  const query = new URLSearchParams(params).toString();
  const response = await axios.get(`${config.supabaseUrl}/rest/v1/${table}?${query}`, {
    headers: supabaseHeaders()
  });
  return response.data || [];
}

async function supabaseUpsert(table, row) {
  await axios.post(`${config.supabaseUrl}/rest/v1/${table}`, row, {
    headers: { ...supabaseHeaders(), Prefer: "resolution=merge-duplicates" }
  });
}

function supabaseHeaders() {
  return {
    apikey: config.supabaseServiceRoleKey,
    Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
    "Content-Type": "application/json"
  };
}

function supabaseEnabled() {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

async function notifyTelegram(order) {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const text = [
    "Nuevo pedido Cosmik",
    `Cliente: ${order.customerName || "Por confirmar"}`,
    `Telefono: ${order.phone || order.from || "Por confirmar"}`,
    `Producto: ${order.product || "Por confirmar"}`,
    `Cantidad: ${order.quantity || "Por confirmar"}`,
    `Color: ${order.color || "Por confirmar"}`,
    `Aroma: ${order.scent || "Por confirmar"}`,
    `Direccion: ${order.address || "Por confirmar"}`,
    `Fecha: ${order.deliveryDate || "Por confirmar"}`,
    `Pago: ${order.paymentMethod || "Por confirmar"}`,
    `Mensaje: ${order.personalMessage || "No aplica"}`,
    `Resumen: ${order.summary || "Sin resumen"}`
  ].join("\n");

  await axios.post(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, {
    chat_id: config.telegramChatId,
    text
  });
}

async function subscribeWaba() {
  if (!config.whatsappToken || !config.wabaId) return;

  try {
    const response = await axios.post(
      `https://graph.facebook.com/${config.graphVersion}/${config.wabaId}/subscribed_apps`,
      {},
      { headers: { Authorization: `Bearer ${config.whatsappToken}` } }
    );
    console.log("WABA subscribed_apps actualizado:", response.data);
  } catch (error) {
    console.error("No se pudo suscribir la app al WABA:", error.response?.data || error.message);
  }
}

function parseDate(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

subscribeWaba();

app.listen(config.port, () => {
  console.log(`Servidor activo en puerto ${config.port}`);
});
