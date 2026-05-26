# WhatsApp AI Assistant

Microservicio Node/Express para atender clientes por WhatsApp usando WhatsApp Cloud API y OpenAI.

## Arquitectura

El servidor expone tres rutas:

- `GET /`: comprueba que el servicio esta vivo.
- `GET /health`: chequeo simple para Render o monitores externos.
- `GET /webhook`: verificacion del webhook de Meta.
- `POST /webhook`: recibe eventos de WhatsApp, genera una respuesta con OpenAI y responde por WhatsApp Cloud API.

Cuando Meta verifica el webhook, envia `hub.mode`, `hub.verify_token` y `hub.challenge`. El servidor valida que el modo sea `subscribe`, que el token coincida con `VERIFY_TOKEN` y devuelve el `challenge` con codigo `200`.

## Flujo de mensajes

1. WhatsApp envia un evento `messages` al endpoint `/webhook`.
2. El servidor extrae el remitente, nombre y texto del cliente.
3. OpenAI genera una respuesta con el prompt de sistema del negocio.
4. El servidor envia la respuesta a:

```text
https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
```

Si OpenAI falla por cuota, llave invalida u otro error, se envia una respuesta generica:

```text
Estamos revisando tu mensaje y en un momento te ayudamos con mucho gusto.
```

## Variables de entorno

Configuralas en Render:

```bash
VERIFY_TOKEN=un-secreto-largo
WHATSAPP_TOKEN=token-de-meta
PHONE_NUMBER_ID=id-del-numero-de-whatsapp
OPENAI_API_KEY=tu-llave-openai
```

Opcionales:

```bash
PORT=3000
HOST=0.0.0.0
META_GRAPH_VERSION=v25.0
OPENAI_MODEL=gpt-5.4-mini
MAX_REPLY_TOKENS=350
MAX_CONVERSATION_TURNS=8
FALLBACK_REPLY=Estamos revisando tu mensaje y en un momento te ayudamos con mucho gusto.
SYSTEM_PROMPT=Eres el asistente de WhatsApp de Cosmik...
DASHBOARD_TOKEN=un-secreto-para-ver-el-dashboard
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/.../exec
TELEGRAM_BOT_TOKEN=token-del-bot
TELEGRAM_CHAT_ID=id-del-chat
ADMIN_WHATSAPP_NUMBER=573001112233
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service-role-key
```

El servidor tambien acepta los nombres anteriores `WEBHOOK_VERIFY_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID` para no romper despliegues existentes.

## Prompt del asistente

El prompt por defecto esta en `src/server.js` e indica que el asistente debe:

- Saludar con tono cercano, dulce y claro.
- Preguntar para que ocasion es la vela o el detalle.
- Recomendar productos segun la ocasion, color, aroma o intencion del regalo.
- Recopilar producto, cantidad, color, aroma, nombre, direccion, fecha de entrega y metodo de pago.
- Confirmar el pedido antes de cerrarlo.
- No inventar precios, stock, promociones ni tiempos de entrega.
- Indicar que consultara con el equipo cuando falte informacion.

La base de conocimiento inicial esta en `data/knowledge-base.json` y fue armada con informacion visible de `www.wearecosmik.com`. Para enriquecerla, actualiza ese archivo con catalogo, precios, disponibilidad, tiempos de entrega y reglas comerciales. Tambien puedes reemplazar `SYSTEM_PROMPT` en Render si necesitas reglas temporales sin tocar codigo.

## Dashboard local

El dashboard esta en:

```text
public/dashboard.html
```

Puedes abrirlo en el navegador o visitar:

```text
https://cosmik-whatsapp-agent.onrender.com/dashboard.html
```

Para que cargue datos, define `DASHBOARD_TOKEN` en Render. En el dashboard escribe:

```text
API URL: https://cosmik-whatsapp-agent.onrender.com
Dashboard token: el valor de DASHBOARD_TOKEN
```

El dashboard lee:

```text
GET /api/dashboard?token={DASHBOARD_TOKEN}
```

Tambien permite:

```text
POST /api/manual-overrides?token={DASHBOARD_TOKEN}
POST /api/manual-messages?token={DASHBOARD_TOKEN}
POST /api/test-notification?token={DASHBOARD_TOKEN}
PATCH /api/orders/{orderId}?token={DASHBOARD_TOKEN}
```

Con esto puedes pausar el bot para un cliente especifico, responder manualmente por WhatsApp desde el dashboard, reactivarlo y actualizar estados de pedidos desde el dashboard.

## Fotos, videos y referencias

Cuando un cliente envia una foto, video, audio o documento por WhatsApp:

- El mensaje se guarda como conversacion.
- Se notifica al equipo por Telegram.
- Si Telegram esta configurado, el servidor intenta reenviar tambien el archivo real.
- El cliente recibe una confirmacion breve de que la referencia fue recibida.
- El archivo no se envia a OpenAI como si fuera texto, para evitar respuestas inventadas sobre contenido visual.

## Supabase

Ejecuta `docs/supabase-schema.sql` en el SQL Editor de Supabase. El bot usa estas tablas:

- `customers`: clientes por WhatsApp.
- `conversations`: historial que da memoria real al agente.
- `orders`: pedidos confirmados, fechas, pagos y estado operativo.
- `manual_overrides`: clientes donde el bot queda pausado para atencion humana.

En Render son necesarias estas variables para activar Supabase:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Usa la `service_role key` solo en Render, nunca en frontend publico.

## Modo manual

Desde `dashboard.html` puedes poner un WhatsApp en pausa. Mientras este activo:

- El bot no responde automaticamente a ese cliente.
- La conversacion queda registrada.
- Si Telegram esta configurado, llega aviso al equipo.
- Puedes escribir una respuesta manual desde el dashboard y saldra por el mismo numero de WhatsApp conectado a la Cloud API.

Para reactivar, usa el boton `Reactivar` en el dashboard.

## Google Sheets como base cloud inicial

La forma mas simple de guardar pedidos en una hoja sin meter OAuth todavia es usar Google Apps Script como webhook.

1. Crea un Google Sheet con columnas como:

```text
createdAt, type, from, name, text, reply, product, quantity, color, scent, customerName, phone, address, deliveryDate, paymentMethod, personalMessage, summary
```

2. En `Extensiones > Apps Script`, pega:

```javascript
function doPost(e) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const payload = JSON.parse(e.postData.contents);
  const now = new Date().toISOString();

  if (payload.type === "conversation") {
    const message = payload.message || {};
    sheet.appendRow([
      now,
      "conversation",
      message.from || "",
      message.name || "",
      message.text || "",
      message.reply || "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      ""
    ]);
  }

  if (payload.type === "order") {
    const order = payload.order || {};
    sheet.appendRow([
      now,
      "order",
      order.from || "",
      order.customerName || "",
      order.sourceText || "",
      "",
      order.product || "",
      order.quantity || "",
      order.color || "",
      order.scent || "",
      order.customerName || "",
      order.phone || "",
      order.address || "",
      order.deliveryDate || "",
      order.paymentMethod || "",
      order.personalMessage || "",
      order.summary || ""
    ]);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

3. Haz deploy como `Web app`.
4. En acceso, usa `Anyone with the link`.
5. Copia la URL `/exec` en Render como `GOOGLE_SHEETS_WEBHOOK_URL`.

## Telegram

1. En Telegram, abre `@BotFather`.
2. Crea un bot con `/newbot`.
3. Copia el token en Render como `TELEGRAM_BOT_TOKEN`.
4. Agrega el bot a un grupo interno de Cosmik o escríbele directo.
5. Para obtener el `TELEGRAM_CHAT_ID`, visita:

```text
https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/getUpdates
```

6. Copia el `chat.id` y guárdalo en Render como `TELEGRAM_CHAT_ID`.

Cuando el agente detecte un pedido confirmado, enviara resumen a Telegram y Google Sheets si esas variables estan configuradas.

Ademas, cada mensaje entrante puede reenviarse a Telegram y a un WhatsApp interno. Para WhatsApp interno define:

```text
ADMIN_WHATSAPP_NUMBER=57...
```

Usa el numero en formato internacional, solo digitos. Ejemplo Colombia: `573001112233`.

## Desarrollo local

Instala dependencias:

```bash
npm install
```

Copia el archivo de ejemplo:

```bash
cp .env.example .env
```

Exporta variables e inicia:

```bash
set -a
source .env
set +a
npm start
```

Comprueba el servicio:

```text
http://localhost:3000/health
```

## Verificacion en Meta

Configura en la app de Meta:

```text
Callback URL: https://api.wearecosmik.com/webhook
Verify token: el valor de VERIFY_TOKEN
Campo suscrito: messages
```

Prueba de verificacion:

```text
https://api.wearecosmik.com/webhook?hub.mode=subscribe&hub.verify_token={token}&hub.challenge=12345
```

La respuesta debe ser:

```text
12345
```

## Despliegue en Render

Render debe usar:

```text
Build command: npm install
Start command: npm start
```

El subdominio `api.wearecosmik.com` debe apuntar al servicio de Render con HTTPS activo.

## Nota sobre el numero real

Si el numero real `+57 310 8001469` estuvo vinculado a la app movil de WhatsApp Business, los mensajes entrantes pueden no llegar al webhook de Cloud API. Desvincula completamente el numero de la app movil o migralo siguiendo la guia oficial de Meta antes de probar el flujo de produccion.

Pasos practicos:

1. En el telefono donde estaba la app WhatsApp Business, abre WhatsApp Business.
2. Ve a `Ajustes > Cuenta > Eliminar mi cuenta`.
3. Ingresa el numero completo y confirma la eliminacion.
4. Desinstala la app o confirma que no quede sesion activa.
5. En Meta Business Suite o WhatsApp Manager, confirma que el numero este en el WABA correcto y con estado `Connected`.
6. En la app de Meta, confirma que el `PHONE_NUMBER_ID` en Render sea el mismo que aparece para el numero real.
7. En Webhooks, verifica que la app este suscrita a `messages`.
8. Haz un `Manual Deploy` en Render despues de cualquier cambio de variables.
9. Escribe al numero desde un WhatsApp externo que no sea el mismo numero de negocio.
10. Si no aparecen logs, prueba registrar un numero nuevo exclusivo para Cloud API. Eso aisla si el problema es el numero heredado o la configuracion del webhook.
