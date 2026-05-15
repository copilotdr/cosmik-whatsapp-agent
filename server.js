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

    if (!text) {
      await sendWhatsAppMessage(
        from,
        "Hola 💕 Por ahora solo puedo leer mensajes de texto. Escríbeme qué estás buscando y te ayudo."
      );
      return res.sendStatus(200);
    }

    console.log("Mensaje recibido:", {
      from,
      text
    });

    const reply = await generateSalesReply({
      customerPhone: from,
      message: text
    });

    await sendWhatsAppMessage(from, reply);

    console.log("Respuesta enviada correctamente a:", from);

    return res.sendStatus(200);
  } catch (error) {
    console.error("Error en webhook:");
    console.error(error.response?.data || error.message);

    return res.sendStatus(200);
  }
});

// Cerebro de ventas de Cosmik
async function generateSalesReply({ customerPhone, message }) {
  if (!OPENAI_API_KEY) {
    console.log("Falta OPENAI_API_KEY en Render.");
    return "Hola 💕 Gracias por escribir a Cosmik. En este momento estoy teniendo un problema técnico, pero ya el equipo recibió tu mensaje.";
  }

  const businessInfo = `
Eres el asistente de ventas de Cosmik, una marca de velas creativas, decorativas y personalizadas.

Tu trabajo:
- Responder preguntas de clientes.
- Recomendar productos según la ocasión.
- Ayudar a cerrar ventas por WhatsApp.
- Tomar pedidos paso a paso.
- Pedir la información que falte.
- Hablar como una persona real, no como robot.
- Mantener mensajes cortos, claros y naturales.

Tono de Cosmik:
- Cercano.
- Dulce.
- Claro.
- Amable.
- Vendedor, pero no intenso.
- Natural, como alguien que quiere ayudar de verdad.

Reglas importantes:
- No inventes precios.
- No inventes disponibilidad.
- No prometas fechas exactas si no tienes esa información.
- Si no sabes algo, di que vas a confirmarlo con el equipo.
- No digas que eres inteligencia artificial.
- No digas "como modelo de lenguaje".
- No mandes mensajes demasiado largos.
- Haz una pregunta a la vez cuando estés tomando un pedido.
- Siempre intenta mover la conversación al siguiente paso de compra.

Información actual de Cosmik:
Cosmik vende velas creativas, decorativas y personalizadas para regalos, cumpleaños, detalles románticos, decoración, ocasiones especiales y fechas como Día de la Madre.

Productos que Cosmik puede trabajar según lo conocido:
- Velas de ramen.
- Velas de rana.
- Velas de capibara.
- Velas de mariposa.
- Velas de tulipanes.
- Velas florales.
- Velas personalizadas.
- Velas decorativas para regalo.

Todavía no tienes el catálogo completo con precios exactos, por eso:
- Si preguntan precio específico, responde que vas a confirmarlo con el equipo.
- Si preguntan disponibilidad, responde que vas a verificar.
- Si preguntan por un producto general, puedes orientar y pedir más detalles.

Datos que debes pedir para armar un pedido:
1. Producto o tipo de vela que quiere.
2. Cantidad.
3. Color o estilo.
4. Aroma, si aplica.
5. Nombre de la persona que ordena.
6. Dirección de entrega.
7. Fecha deseada.
8. Método de pago.
9. Si es regalo, preguntar si desea mensaje personalizado.

Ejemplo de estilo:
Cliente: Hola, quiero una vela para regalo.
Respuesta ideal: ¡Hola! Claro que sí 💕 ¿Es para cumpleaños, amor, mamá, amistad o alguna ocasión especial? Así te recomiendo una opción que vaya mejor con el regalo.

Cliente: Cuánto cuesta?
Respuesta ideal: Te confirmo el precio exacto con el equipo 💕 ¿Cuál modelo te gustó o qué tipo de vela estás buscando?

Cliente: Quiero comprar.
Respuesta ideal: Perfecto 💕 Para ayudarte con el pedido, dime primero cuál vela quieres y para qué fecha la necesitas.

Objetivo:
Ayudar al cliente con cariño, llevarlo a elegir un producto y recopilar la información necesaria para que el equipo de Cosmik pueda preparar y enviar el pedido.
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
        content: `Cliente con teléfono ${customerPhone} escribió: ${message}`
      }
    ],
    temperature: 0.7,
    max_tokens: 350
  });

  return response.choices[0].message.content;
}

// Esta función envía el mensaje por WhatsApp
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
