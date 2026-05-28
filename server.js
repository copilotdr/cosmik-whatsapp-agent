import express from "express";
import axios from "axios";
import OpenAI from "openai";
import { readFile } from "node:fs/promises";

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
  telegramWebhookUrl:
    process.env.TELEGRAM_WEBHOOK_URL ||
    buildTelegramWebhookUrl(process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || "https://api.wearecosmik.com"),
  adminWhatsappNumber: normalizeWhatsapp(process.env.ADMIN_WHATSAPP_NUMBER || ""),
  maxConversationTurns: Number(process.env.MAX_CONVERSATION_TURNS || 8),
  fallbackReply:
    process.env.FALLBACK_REPLY ||
    "Estamos revisando tu mensaje y en un momento te ayudamos con mucho gusto."
};

const app = express();
const openai = new OpenAI({ apiKey: config.openaiApiKey });
const processedMessageIds = new Set();
const memoryConversations = new Map();

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
    pickup:
      "Tenemos punto/tienda de recogida en Engativa, sector Gran Granada. La recogida se coordina directamente con el equipo.",
    bogota_fee_cop: 15000,
    colombia_fee_cop: 20000,
    free_shipping:
      "Envio gratis en compras desde $250.000 COP."
  },
  payments: {
    methods:
      "Metodos validos: transferencia Bancolombia o link de pago/tarjeta. No ofrecer efectivo como metodo de pago normal.",
    pickup_deposit:
      "Para recogida, el pedido se separa con 50% de anticipo.",
    bancolombia: {
      account: "467-000104-99",
      holder: "Katerina Barros",
      keys: "@katerina542"
    }
  },
  discounts: [
    "Desde la 6ta unidad del mismo producto aplica 10% de descuento.",
    "Envio gratis en compras desde $250.000 COP."
  ],
  custom_products: [
    "Si el cliente pide una forma o referencia que no aparece en catalogo, no afirmar que existe.",
    "Responder que se puede revisar como pedido personalizado con tiempo, sujeto a molde, diseno y disponibilidad del equipo.",
    "Pedir referencia visual si el cliente la tiene y escalar al equipo."
  ],
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

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");

  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));

app.get("/", (_req, res) => {
  res.type("text").send("Cosmik WhatsApp Agent is running.");
});

app.get("/health", (_req, res) => {
  res.type("text").send("OK");
});

app.get("/privacy", (_req, res) => {
  res.type("html").send("<h1>Cosmik Privacy Policy</h1><p>Cosmik usa WhatsApp para atender solicitudes, responder consultas y gestionar pedidos. Los datos compartidos por clientes se usan solo para la atencion comercial y operativa.</p>");
});

app.get("/catalog.csv", async (_req, res) => {
  try {
    const csv = await readFile(new URL("./templates/whatsapp-catalog-meta-feed.csv", import.meta.url), "utf8");
    res
      .setHeader("Cache-Control", "public, max-age=300")
      .type("text/csv")
      .send(csv);
  } catch (error) {
    console.error("Catalog feed read failed:", error.message);
    res.status(500).type("text").send("catalog_unavailable");
  }
});

app.get("/catalog.tsv", async (_req, res) => {
  try {
    const tsv = await readFile(new URL("./templates/whatsapp-catalog-meta-feed.tsv", import.meta.url), "utf8");
    res
      .setHeader("Cache-Control", "public, max-age=300")
      .type("text/tab-separated-values")
      .send(tsv);
  } catch (error) {
    console.error("Catalog TSV feed read failed:", error.message);
    res.status(500).type("text").send("catalog_unavailable");
  }
});

app.get("/api/dashboard", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
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

app.get("/api/manual-overrides", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
    res.sendStatus(401);
    return;
  }

  try {
    res.json(await readManualOverrides());
  } catch (error) {
    console.error("Manual overrides read failed:", error.response?.data || error.message);
    res.status(500).json({ error: "manual_overrides_unavailable" });
  }
});

app.post("/api/manual-overrides", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
    res.sendStatus(401);
    return;
  }

  const whatsapp = normalizeWhatsapp(req.body?.whatsapp);
  if (!whatsapp) {
    res.status(400).json({ error: "whatsapp_required" });
    return;
  }

  try {
    const override = await setManualOverride({
      whatsapp,
      active: req.body?.active !== false,
      note: req.body?.note || null
    });
    res.json(override);
  } catch (error) {
    console.error("Manual override update failed:", error.response?.data || error.message);
    res.status(500).json({ error: "manual_override_update_failed" });
  }
});

app.patch("/api/orders/:id", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
    res.sendStatus(401);
    return;
  }

  try {
    const updated = await updateOrder(req.params.id, {
      status: req.body?.status,
      priority: req.body?.priority,
      teamNotes: req.body?.teamNotes,
      checkoutUrl: req.body?.checkoutUrl,
      paymentMethod: req.body?.paymentMethod,
      estimatedValueCop: req.body?.estimatedValueCop
    });

    if (!updated) {
      res.status(404).json({ error: "order_not_found" });
      return;
    }

    res.json(updated);
  } catch (error) {
    console.error("Order update failed:", error.response?.data || error.message);
    res.status(500).json({ error: "order_update_failed" });
  }
});

app.post("/api/manual-messages", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
    res.sendStatus(401);
    return;
  }

  const to = normalizeWhatsapp(req.body?.to);
  const text = req.body?.text?.toString().trim();

  if (!to || !text) {
    res.status(400).json({ error: "to_and_text_required" });
    return;
  }

  try {
    await sendWhatsAppText(to, text);
    await appendConversation({
      id: `manual_${Date.now()}_${to}`,
      from: to,
      name: req.body?.name || "",
      text: "",
      reply: `[Manual] ${text}`
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("Manual message send failed:", error.response?.data || error.message);
    res.status(500).json({ error: "manual_message_send_failed" });
  }
});

app.post("/api/conversation-statuses", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
    res.sendStatus(401);
    return;
  }

  const whatsapp = normalizeWhatsapp(req.body?.whatsapp);
  const status = req.body?.status?.toString().trim() || "activo";

  if (!whatsapp) {
    res.status(400).json({ error: "whatsapp_required" });
    return;
  }

  try {
    const row = await setConversationStatus({
      whatsapp,
      status,
      reason: req.body?.reason || null
    });
    res.json(row);
  } catch (error) {
    console.error("Conversation status update failed:", error.response?.data || error.message);
    res.status(500).json({ error: "conversation_status_update_failed" });
  }
});

app.post("/api/test-notification", async (req, res) => {
  if (!isAuthorizedAdmin(req)) {
    res.sendStatus(401);
    return;
  }

  const sample = {
    id: `test_${Date.now()}`,
    from: config.adminWhatsappNumber || "573108001469",
    name: "Prueba Cosmik",
    text: req.body?.text || "Mensaje de prueba de notificaciones Cosmik."
  };

  try {
    await notifyIncomingMessage(sample, "test");
    res.json({
      ok: true,
      telegramConfigured: Boolean(config.telegramBotToken && config.telegramChatId),
      whatsappConfigured: Boolean(config.adminWhatsappNumber)
    });
  } catch (error) {
    console.error("Test notification failed:", error.response?.data || error.message);
    res.status(500).json({ error: "test_notification_failed" });
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

app.post("/telegram/webhook", async (req, res) => {
  res.status(200).json({ ok: true });

  try {
    await handleTelegramUpdate(req.body || {});
  } catch (error) {
    console.error("Telegram webhook handling failed:", error.response?.data || error.message);
  }
});

app.post("/webhook", async (req, res) => {
  const messages = extractMessages(req.body);
  res.status(200).json({ ok: true, received: messages.length });

  for (const message of messages) {
    if (processedMessageIds.has(message.id)) continue;
    processedMessageIds.add(message.id);

    console.log("Mensaje recibido:", message.from, message.text);

    if (await isManualOverrideActive(message.from)) {
      await appendConversation({
        ...message,
        reply: "[Modo manual activo: el bot no respondio automaticamente.]"
      });
      await notifyIncomingMessage(message, "manual");
      console.log(`Modo manual activo para ${message.from}; no se envio respuesta automatica.`);
      continue;
    }

    await notifyIncomingMessage(message, "auto");

    if (message.mediaId) {
      const reply = "Gracias, recibimos tu referencia. La compartimos con el equipo para revisarla y ayudarte mejor.";
      await appendConversation({ ...message, reply });
      await sendWhatsAppText(message.from, reply);
      console.log(`Referencia multimedia escalada para ${message.from}`);
      continue;
    }

    const history = await getRecentConversation(message.from);
    const reply = await buildReply(message, history);

    try {
      await sendWhatsAppText(message.from, reply);
      await appendConversation({ ...message, reply });
      await captureConfirmedOrder(message, reply, history);
      console.log(`Respuesta enviada a ${message.from}`);
    } catch (error) {
      console.error("No se pudo completar el post-proceso:", error.response?.data || error.message);
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
        if (message.type === "text" && message.text?.body) {
          messages.push({
            id: message.id,
            from: message.from,
            name: contactNameByWaId.get(message.from) || "",
            type: "text",
            text: message.text.body.trim()
          });
          continue;
        }

        const media = message[message.type];
        if (!media?.id) continue;

        messages.push({
          id: message.id,
          from: message.from,
          name: contactNameByWaId.get(message.from) || "",
          type: message.type,
          text: media.caption?.trim() || `[Referencia recibida: ${message.type}]`,
          mediaId: media.id,
          mimeType: media.mime_type || "",
          filename: media.filename || `${message.type}-${message.id}`
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
          content: `Cliente escribe por WhatsApp: ${message.text}`
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
- Guiar al cliente hacia la confirmacion de pedido por WhatsApp, sin enviar un link generico de checkout.
- Recopilar: producto, cantidad, color, aroma, nombre, telefono, direccion, fecha deseada, metodo de pago y mensaje personalizado si aplica.

Reglas:
- No inventes productos, precios, stock, promociones, metodos de pago ni fechas.
- Cosmik trabaja on-demand, no con stock fijo.
- Si el cliente pide una forma/producto que no aparece en la base, no digas que lo tenemos. Di que podemos revisarlo como personalizado con tiempo, sujeto a molde, diseno y disponibilidad del equipo.
- Si el cliente pregunta por descuentos: desde la 6ta unidad del mismo producto aplica 10% de descuento. En compras desde $250.000 COP el envio es gratis.
- No ofrezcas efectivo como metodo de pago normal.
- Metodos de pago validos: transferencia Bancolombia o link de pago/tarjeta. Para recogida, el pedido se separa con 50% de anticipo.
- Datos de transferencia Bancolombia: cuenta 467-000104-99, Katerina Barros. Llaves: @katerina542.
- Si el producto es un bouquet, pregunta que tipo de flores o estilo quiere antes de cerrar. Mientras el catalogo de flores no este confirmado, no inventes flores disponibles; pregunta su preferencia y di que el equipo confirma disponibilidad.
- Para bouquets, el mensaje/etiqueta personalizada y el aroma son obligatorios antes de confirmar.
- Para velas normales, no preguntes por mensaje personalizado salvo que el cliente lo pida o sea parte del producto.
- Para velas y bouquets, confirma aroma cuando aplique.
- Si falta informacion, haz una sola pregunta concreta a la vez.
- Si el historial esta vacio, empieza siempre con un saludo corto y natural antes de responder la solicitud del cliente.
- Usa el historial de conversacion para continuar el proceso; no vuelvas a saludar ni a empezar desde cero si el cliente ya esta avanzando un pedido.
- Si el cliente responde algo corto como "si", "confirmo", un telefono, una direccion, un color o un aroma, interpretalo segun la ultima pregunta del asistente.
- Si ya hay un pedido en curso, conserva los datos ya dados y pide solamente el dato faltante mas importante.
- No uses el nombre del perfil de WhatsApp para saludar o dirigirte a la persona, porque puede sentirse invasivo.
- Usa saludos neutrales como "Hola", "Perfecto", "Súper", "Listo" o "Qué lindo".
- Solo usa un nombre si el cliente lo escribe explicitamente como su nombre o como el nombre de la persona que recibe el pedido.
- Para envio, explica cuando sea relevante: recogida coordinada en Engativa Gran Granada; envio a Bogota $15.000 COP; envio a Colombia $20.000 COP; envio gratis desde $250.000 COP.
- Si el cliente elige pago con tarjeta, link de pago o pago online, despues de que confirme el pedido indicale que el equipo enviara un link de pago personalizado con el valor exacto. No envies links genericos ni el link de la pagina web para finalizar.
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

async function handleTelegramUpdate(update = {}) {
  if (!isAllowedTelegramChat(update)) return;

  if (update.callback_query) {
    await handleTelegramCallback(update.callback_query);
    return;
  }

  const text = update.message?.text?.trim();
  if (!text) return;

  await handleTelegramCommand(text);
}

function isAllowedTelegramChat(update = {}) {
  if (!config.telegramChatId) return false;

  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  return chatId?.toString() === config.telegramChatId.toString();
}

async function handleTelegramCallback(callbackQuery = {}) {
  const [action, rawWhatsapp] = (callbackQuery.data || "").split(":");
  const whatsapp = normalizeWhatsapp(rawWhatsapp);

  if (!whatsapp) {
    await answerTelegramCallback(callbackQuery.id, "No encontre el WhatsApp del cliente.");
    return;
  }

  if (action === "pause") {
    await setManualOverride({
      whatsapp,
      active: true,
      note: "Pausado desde Telegram"
    });
    await answerTelegramCallback(callbackQuery.id, "Bot pausado para este cliente.");
    await sendTelegramText(`Bot pausado para ${whatsapp}.\nPara responderle escribe:\nresponder ${whatsapp}: tu mensaje`);
    return;
  }

  if (action === "resume") {
    await setManualOverride({
      whatsapp,
      active: false,
      note: "Reactivado desde Telegram"
    });
    await answerTelegramCallback(callbackQuery.id, "Bot reactivado para este cliente.");
    await sendTelegramText(`Bot reactivado para ${whatsapp}.`);
    return;
  }

  if (action === "reply") {
    await answerTelegramCallback(callbackQuery.id, "Te deje el formato para responder.");
    await sendTelegramText(`Para responderle a ${whatsapp}, escribe:\nresponder ${whatsapp}: tu mensaje`);
  }
}

async function handleTelegramCommand(text) {
  const replyMatch = text.match(/^(?:responder|enviar)\s+(\+?\d[\d\s-]{6,})\s*:\s*([\s\S]+)/i);
  if (replyMatch) {
    const to = normalizeWhatsapp(replyMatch[1]);
    const message = replyMatch[2].trim();
    await sendManualWhatsappFromTelegram(to, message);
    return;
  }

  const pauseMatch = text.match(/^pausar\s+(\+?\d[\d\s-]{6,})/i);
  if (pauseMatch) {
    const whatsapp = normalizeWhatsapp(pauseMatch[1]);
    await setManualOverride({ whatsapp, active: true, note: "Pausado desde Telegram" });
    await sendTelegramText(`Bot pausado para ${whatsapp}.`);
    return;
  }

  const resumeMatch = text.match(/^(?:reactivar|activar)\s+(\+?\d[\d\s-]{6,})/i);
  if (resumeMatch) {
    const whatsapp = normalizeWhatsapp(resumeMatch[1]);
    await setManualOverride({ whatsapp, active: false, note: "Reactivado desde Telegram" });
    await sendTelegramText(`Bot reactivado para ${whatsapp}.`);
  }
}

async function sendManualWhatsappFromTelegram(to, text) {
  if (!to || !text) {
    await sendTelegramText("No pude enviar. Usa: responder 573001112233: mensaje");
    return;
  }

  await setManualOverride({
    whatsapp: to,
    active: true,
    note: "Respuesta manual enviada desde Telegram"
  });
  await sendWhatsAppText(to, text);
  await appendConversation({
    id: `telegram_manual_${Date.now()}_${to}`,
    from: to,
    name: "",
    text: "",
    reply: `[Manual Telegram] ${text}`
  });
  await sendTelegramText(`Enviado a ${to}:\n${text}`);
}

async function answerTelegramCallback(callbackQueryId, text) {
  if (!config.telegramBotToken || !callbackQueryId) return;

  await axios.post(
    `https://api.telegram.org/bot${config.telegramBotToken}/answerCallbackQuery`,
    {
      callback_query_id: callbackQueryId,
      text
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

  if (requiresPaymentLink(order.paymentMethod)) {
    await sendCardPaymentHoldMessage(message.from);
  }
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
            "Campos: confirmed boolean, product, quantity, color, scent, customerName, phone, address, deliveryDate, deliveryDateIso, paymentMethod, personalMessage, summary.",
            "deliveryDate debe conservar la forma natural que dijo el cliente.",
            "deliveryDateIso debe ser YYYY-MM-DD si puedes inferir una fecha exacta usando la fecha actual de Bogota; si no puedes, string vacio.",
            "Si no hay confirmacion clara del pedido, confirmed debe ser false.",
            "No inventes campos faltantes; usa strings vacios."
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify({
            currentDateBogota: getBogotaDateString(),
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
  const memoryHistory = memoryConversations.get(customerWhatsapp) || [];

  if (!supabaseEnabled()) return memoryHistory;

  try {
    const rows = await supabaseGet("conversations", {
      select: "incoming_text,assistant_reply,created_at",
      customer_whatsapp: `eq.${customerWhatsapp}`,
      order: "created_at.desc",
      limit: String(config.maxConversationTurns)
    });

    const persistedHistory = rows.reverse();
    return persistedHistory.length ? persistedHistory : memoryHistory;
  } catch (error) {
    console.error("Conversation history read failed:", error.response?.data || error.message);
    return memoryHistory;
  }
}

function rememberConversation(customerWhatsapp, turn) {
  const history = memoryConversations.get(customerWhatsapp) || [];
  history.push(turn);
  memoryConversations.set(customerWhatsapp, history.slice(-config.maxConversationTurns));
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
  if (event.text) {
    await reopenConversationIfNeeded(event.from);
  }

  rememberConversation(event.from, {
    incoming_text: event.text,
    assistant_reply: event.reply,
    created_at: new Date().toISOString()
  });

  if (!supabaseEnabled()) return;

  try {
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
  } catch (error) {
    console.error("Conversation persistence failed:", error.response?.data || error.message);
  }
}

async function appendOrder(order) {
  if (!supabaseEnabled()) return;

  try {
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
      desired_delivery_date: parseDate(order.deliveryDateIso || order.deliveryDate),
      payment_method: order.paymentMethod || null,
      estimated_value_cop: estimateOrderValue(order),
      summary: order.summary || null,
      updated_at: now
    });
  } catch (error) {
    console.error("Order persistence failed:", error.response?.data || error.message);
  }
}

async function readDashboardData() {
  if (!supabaseEnabled()) return { orders: [], conversations: [] };

  const [orders, conversations, conversationStatuses] = await Promise.all([
    supabaseGet("orders", { select: "*", order: "created_at.desc", limit: "250" }),
    supabaseGet("conversations", { select: "*", order: "created_at.desc", limit: "250" }),
    supabaseGet("conversation_statuses", { select: "*", order: "updated_at.desc", limit: "500" })
  ]);
  const statusByWhatsapp = new Map(
    conversationStatuses.map((row) => [row.customer_whatsapp, row])
  );

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
      createdAt: row.created_at,
      status: statusByWhatsapp.get(row.customer_whatsapp)?.status || "activo",
      statusReason: statusByWhatsapp.get(row.customer_whatsapp)?.reason || ""
    }))
  };
}

async function readManualOverrides() {
  if (!supabaseEnabled()) return [];

  return supabaseGet("manual_overrides", {
    select: "*",
    order: "updated_at.desc",
    limit: "250"
  });
}

async function setManualOverride({ whatsapp, active, note }) {
  const now = new Date().toISOString();
  const row = {
    customer_whatsapp: whatsapp,
    active: Boolean(active),
    note,
    updated_at: now
  };

  await supabaseUpsert("manual_overrides", row);
  return row;
}

async function setConversationStatus({ whatsapp, status, reason }) {
  if (!supabaseEnabled()) return null;

  const now = new Date().toISOString();
  const row = {
    customer_whatsapp: whatsapp,
    status,
    reason,
    archived_at: status === "archivado" ? now : null,
    updated_at: now
  };

  await supabaseUpsert("conversation_statuses", row);
  return row;
}

async function reopenConversationIfNeeded(customerWhatsapp) {
  if (!supabaseEnabled()) return;

  try {
    const rows = await supabaseGet("conversation_statuses", {
      select: "status",
      customer_whatsapp: `eq.${customerWhatsapp}`,
      limit: "1"
    });

    if (rows[0]?.status === "archivado") {
      await setConversationStatus({
        whatsapp: customerWhatsapp,
        status: "activo",
        reason: "Reabierto por nuevo mensaje del cliente"
      });
    }
  } catch (error) {
    console.error("Conversation reopen check failed:", error.response?.data || error.message);
  }
}

async function updateOrder(orderId, updates = {}) {
  if (!supabaseEnabled()) return null;

  const now = new Date().toISOString();
  const row = { updated_at: now };
  const map = {
    status: "status",
    priority: "priority",
    teamNotes: "team_notes",
    checkoutUrl: "checkout_url",
    paymentMethod: "payment_method",
    estimatedValueCop: "estimated_value_cop"
  };

  for (const [key, column] of Object.entries(map)) {
    if (Object.hasOwn(updates, key) && updates[key] !== undefined) {
      row[column] = updates[key] || null;
    }
  }

  await axios.patch(
    `${config.supabaseUrl}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`,
    row,
    {
      headers: { ...supabaseHeaders(), Prefer: "return=representation" }
    }
  );

  return { id: orderId, ...updates, updatedAt: now };
}

async function isManualOverrideActive(customerWhatsapp) {
  if (!supabaseEnabled()) return false;

  try {
    const rows = await supabaseGet("manual_overrides", {
      select: "active",
      customer_whatsapp: `eq.${customerWhatsapp}`,
      limit: "1"
    });

    return rows[0]?.active === true;
  } catch (error) {
    console.error("Manual override check failed:", error.response?.data || error.message);
    return false;
  }
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

function isAuthorizedAdmin(req) {
  if (!config.dashboardToken) return false;
  const authHeader = req.headers.authorization || "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  return req.query.token === config.dashboardToken || bearerToken === config.dashboardToken;
}

function normalizeWhatsapp(value = "") {
  return value.toString().replace(/\D/g, "");
}

function buildTelegramWebhookUrl(baseUrl = "") {
  const normalized = baseUrl.toString().trim().replace(/\/$/, "");
  return normalized ? `${normalized}/telegram/webhook` : "";
}

async function notifyIncomingMessage(message, mode = "auto") {
  const text = [
    message.mediaId
      ? "Referencia multimedia entrante Cosmik"
      : mode === "manual" ? "Mensaje entrante Cosmik (bot pausado)" : "Mensaje entrante Cosmik",
    `Cliente: ${message.name || "Sin nombre"}`,
    `WhatsApp: ${message.from}`,
    `Modo: ${mode === "manual" ? "manual" : mode === "test" ? "prueba" : "automatico"}`,
    message.mediaId ? `Tipo: ${message.type || "media"}` : null,
    message.filename ? `Archivo: ${message.filename}` : null,
    `Mensaje: ${message.text}`
  ].filter(Boolean).join("\n");

  const media = message.mediaId ? await downloadWhatsAppMedia(message) : null;
  const results = await Promise.allSettled([
    runNotificationChannel("telegram_text", () => sendTelegramText(text, customerActionButtons(message.from, mode))),
    media ? runNotificationChannel("telegram_media", () => sendTelegramMedia(message, text, media)) : null,
    runNotificationChannel("admin_whatsapp_text", () => sendAdminWhatsappText(text)),
    media ? runNotificationChannel("admin_whatsapp_media", () => sendAdminWhatsappMedia(message, text, media)) : null
  ]);

  logNotificationResults(results);
}

async function notifyTelegram(order) {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const needsPaymentLink = requiresPaymentLink(order.paymentMethod);
  const estimatedValue = estimateOrderValue(order);
  const text = [
    needsPaymentLink ? "URGENTE: generar link de pago personalizado" : null,
    "Nuevo pedido Cosmik",
    `Cliente: ${order.customerName || "Por confirmar"}`,
    `Telefono: ${order.phone || order.from || "Por confirmar"}`,
    `Producto: ${order.product || "Por confirmar"}`,
    `Cantidad: ${order.quantity || "Por confirmar"}`,
    `Color: ${order.color || "Por confirmar"}`,
    `Aroma: ${order.scent || "Por confirmar"}`,
    `Direccion: ${order.address || "Por confirmar"}`,
    `Fecha: ${order.deliveryDate || order.deliveryDateIso || "Por confirmar"}`,
    `Pago: ${order.paymentMethod || "Por confirmar"}`,
    `Valor estimado: ${estimatedValue ? `$${estimatedValue.toLocaleString("es-CO")} COP` : "Por confirmar"}`,
    `Mensaje: ${order.personalMessage || "No aplica"}`,
    `Resumen: ${order.summary || "Sin resumen"}`,
    needsPaymentLink
      ? "Accion: enviar link de pago con el valor exacto de la orden. No se envio link automatico al cliente."
      : null
  ].filter(Boolean).join("\n");

  try {
    await sendTelegramText(text, customerActionButtons(order.from || order.phone || "", "order"));
    console.log("Telegram order notification sent:", order.id || order.from);
  } catch (error) {
    console.error("Telegram notification failed:", error.response?.data || error.message);
  }
}

async function notifyManualOverrideMessage(message) {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const text = [
    "Modo manual activo",
    `Cliente: ${message.name || "Sin nombre"}`,
    `WhatsApp: ${message.from}`,
    `Mensaje: ${message.text}`,
    "El bot no respondio automaticamente."
  ].join("\n");

  try {
    await sendTelegramText(text, customerActionButtons(message.from, "manual"));
  } catch (error) {
    console.error("Manual override Telegram notification failed:", error.response?.data || error.message);
  }
}

async function sendTelegramText(text, replyMarkup = null) {
  if (!config.telegramBotToken || !config.telegramChatId) return;

  const body = {
    chat_id: config.telegramChatId,
    text
  };

  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  await axios.post(`https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`, body);
}

async function sendTelegramMedia(message, caption, media) {
  if (!config.telegramBotToken || !config.telegramChatId || !message.mediaId) return;

  try {
    const file = new Blob([media.buffer], {
      type: media.mimeType || message.mimeType || "application/octet-stream"
    });
    const form = new FormData();
    const { endpoint, field } = telegramMediaTarget(message.type);

    form.append("chat_id", config.telegramChatId);
    form.append("caption", caption.slice(0, 1000));
    form.append(field, file, mediaFilename(message));

    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${endpoint}`, {
      method: "POST",
      body: form
    });

    if (!response.ok) {
      throw new Error(`Telegram media HTTP ${response.status}: ${await response.text()}`);
    }
  } catch (error) {
    console.error("Telegram media notification failed:", error.response?.data || error.message);
  }
}

async function downloadWhatsAppMedia(message) {
  const mediaUrl = await getWhatsAppMediaUrl(message.mediaId);
  const mediaResponse = await axios.get(mediaUrl, {
    responseType: "arraybuffer",
    headers: { Authorization: `Bearer ${config.whatsappToken}` }
  });

  return {
    buffer: mediaResponse.data,
    mimeType: mediaResponse.headers["content-type"] || message.mimeType || "application/octet-stream"
  };
}

async function getWhatsAppMediaUrl(mediaId) {
  const response = await axios.get(
    `https://graph.facebook.com/${config.graphVersion}/${mediaId}`,
    { headers: { Authorization: `Bearer ${config.whatsappToken}` } }
  );
  return response.data?.url;
}

function telegramMediaTarget(type = "") {
  if (type === "image") return { endpoint: "sendPhoto", field: "photo" };
  if (type === "video") return { endpoint: "sendVideo", field: "video" };
  if (type === "audio" || type === "voice") return { endpoint: "sendAudio", field: "audio" };
  return { endpoint: "sendDocument", field: "document" };
}

async function sendAdminWhatsappText(text) {
  if (!config.adminWhatsappNumber) return;
  await sendWhatsAppText(config.adminWhatsappNumber, text);
}

async function sendAdminWhatsappMedia(message, caption, media) {
  if (!config.adminWhatsappNumber || !message.mediaId) return;

  try {
    await sendWhatsAppMedia(config.adminWhatsappNumber, message.mediaId, message, caption);
    return;
  } catch (error) {
    console.error("Admin WhatsApp media reuse failed, trying upload:", error.response?.data || error.message);
  }

  const uploadedMediaId = await uploadWhatsAppMedia(media, message);
  await sendWhatsAppMedia(config.adminWhatsappNumber, uploadedMediaId, message, caption);
}

async function uploadWhatsAppMedia(media, message) {
  const mimeType = media.mimeType || message.mimeType || "application/octet-stream";
  const file = new Blob([media.buffer], { type: mimeType });
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", file, mediaFilename(message));

  const response = await fetch(
    `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/media`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.whatsappToken}` },
      body: form
    }
  );

  if (!response.ok) {
    throw new Error(`WhatsApp media upload HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  return data.id;
}

async function sendWhatsAppMedia(to, mediaId, message, caption) {
  const type = whatsappMediaType(message.type);
  const url = `https://graph.facebook.com/${config.graphVersion}/${config.phoneNumberId}/messages`;
  const mediaPayload = { id: mediaId };

  if (type !== "audio") {
    mediaPayload.caption = caption.slice(0, 1000);
  }

  await axios.post(
    url,
    {
      messaging_product: "whatsapp",
      to,
      type,
      [type]: mediaPayload
    },
    {
      headers: {
        Authorization: `Bearer ${config.whatsappToken}`,
        "Content-Type": "application/json"
      }
    }
  );
}

function whatsappMediaType(type = "") {
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "audio" || type === "voice") return "audio";
  return "document";
}

function mediaFilename(message) {
  const current = message.filename || `cosmik-${message.type || "media"}`;
  if (/\.[a-z0-9]{2,5}$/i.test(current)) return current;

  return `${current}.${extensionForMedia(message)}`;
}

function extensionForMedia(message) {
  const mimeType = (message.mimeType || "").toLowerCase();

  if (mimeType.includes("jpeg")) return "jpg";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("pdf")) return "pdf";
  if (message.type === "image") return "jpg";
  if (message.type === "video") return "mp4";
  if (message.type === "audio" || message.type === "voice") return "ogg";
  return "bin";
}

async function runNotificationChannel(name, fn) {
  await fn();
  console.log(`Notification channel sent: ${name}`);
}

function logNotificationResults(results) {
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("Notification channel failed:", result.reason?.response?.data || result.reason?.message || result.reason);
    }
  }
}

function customerActionButtons(whatsapp, mode = "auto") {
  const phone = normalizeWhatsapp(whatsapp);
  if (!phone) return null;

  return {
    inline_keyboard: [
      [
        { text: "Responder", callback_data: `reply:${phone}` },
        mode === "manual"
          ? { text: "Reactivar bot", callback_data: `resume:${phone}` }
          : { text: "Pausar bot", callback_data: `pause:${phone}` }
      ]
    ]
  };
}

async function setupTelegramWebhook() {
  if (!config.telegramBotToken || !config.telegramWebhookUrl) return;

  try {
    await axios.post(`https://api.telegram.org/bot${config.telegramBotToken}/setWebhook`, {
      url: config.telegramWebhookUrl
    });
    console.log(`Telegram webhook configured: ${config.telegramWebhookUrl}`);
  } catch (error) {
    console.error("Telegram webhook setup failed:", error.response?.data || error.message);
  }
}

async function sendCardPaymentHoldMessage(to) {
  await sendWhatsAppText(
    to,
    "Perfecto. Para pago con tarjeta, el equipo te enviara un link de pago personalizado con el valor exacto de tu pedido."
  );
}

function requiresPaymentLink(paymentMethod = "") {
  const normalized = paymentMethod
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  return (
    normalized.includes("tarjeta") ||
    normalized.includes("link") ||
    normalized.includes("online") ||
    normalized.includes("pse") ||
    normalized.includes("wompi") ||
    normalized.includes("mercado pago") ||
    normalized.includes("mercadopago")
  );
}

function estimateOrderValue(order) {
  const product = findProduct(order.product);
  const quantity = parseInt(order.quantity, 10) || 1;
  if (!product?.price_cop) return null;
  return product.price_cop * quantity;
}

function findProduct(productName = "") {
  const normalizedName = normalizeText(productName);
  if (!normalizedName) return null;

  return knowledgeBase.products.find((product) => {
    const normalizedProduct = normalizeText(product.name);
    return (
      normalizedName.includes(normalizedProduct) ||
      normalizedProduct.includes(normalizedName)
    );
  });
}

function normalizeText(value = "") {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
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

  const rawValue = value.toString().trim();
  const isoMatch = rawValue.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];

  const numericMatch = rawValue.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericMatch) {
    const day = Number(numericMatch[1]);
    const month = Number(numericMatch[2]);
    const year = numericMatch[3]
      ? normalizeYear(Number(numericMatch[3]))
      : Number(getBogotaDateString().slice(0, 4));
    return datePartsToIso(year, month, day);
  }

  const spanishDate = parseSpanishDate(rawValue);
  if (spanishDate) return spanishDate;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parseSpanishDate(value) {
  const normalized = normalizeText(value);
  const dayMatch = normalized.match(/\b(\d{1,2})\b/);
  if (!dayMatch) return null;

  const requestedDay = Number(dayMatch[1]);
  const today = getBogotaDateParts();
  const requestedMonth = monthFromText(normalized);
  const requestedWeekday = weekdayFromText(normalized);

  if (requestedMonth) {
    const iso = datePartsToIso(today.year, requestedMonth, requestedDay);
    if (iso && iso >= getBogotaDateString()) return iso;
    return datePartsToIso(today.year + 1, requestedMonth, requestedDay);
  }

  for (let offset = 0; offset < 370; offset += 1) {
    const candidate = addDays(today.date, offset);
    if (candidate.getUTCDate() !== requestedDay) continue;
    if (requestedWeekday !== null && candidate.getUTCDay() !== requestedWeekday) continue;
    return candidate.toISOString().slice(0, 10);
  }

  return null;
}

function getBogotaDateString() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function getBogotaDateParts() {
  const [year, month, day] = getBogotaDateString().split("-").map(Number);
  return {
    year,
    month,
    day,
    date: new Date(Date.UTC(year, month - 1, day))
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeYear(year) {
  return year < 100 ? 2000 + year : year;
}

function datePartsToIso(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function monthFromText(value) {
  const months = {
    enero: 1,
    febrero: 2,
    marzo: 3,
    abril: 4,
    mayo: 5,
    junio: 6,
    julio: 7,
    agosto: 8,
    septiembre: 9,
    setiembre: 9,
    octubre: 10,
    noviembre: 11,
    diciembre: 12
  };

  return Object.entries(months).find(([month]) => value.includes(month))?.[1] || null;
}

function weekdayFromText(value) {
  const weekdays = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6
  };

  return Object.entries(weekdays).find(([weekday]) => value.includes(weekday))?.[1] ?? null;
}

subscribeWaba();
setupTelegramWebhook();

app.listen(config.port, () => {
  console.log(`Servidor activo en puerto ${config.port}`);
});
