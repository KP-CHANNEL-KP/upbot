import { Bot, webhookCallback, InlineKeyboard } from "grammy";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db = env.DB;

    // CORS Headers ကို Origin အလိုက် Dynamic ပြန်ပေးမယ်
    const getCorsHeaders = (origin: string | null) => ({
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    });

    // OPTIONS Request ကို ချက်ချင်းဖြေရှင်းပေးရန်
    if (request.method === "OPTIONS") {
      return new Response(null, { 
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        } 
      });
    }

    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // --- 1. Bot Endpoints ---
    if (request.method === "POST" && url.pathname.includes("/bot")) {
        return webhookCallback(bot, "cloudflare-mod")(request);
    }
    
    // --- 2. API Endpoints ---
    if (request.method === "GET" && url.pathname === "/fetch-keys-with-ping") {
      try {
        const remoteUrl = "https://www.kpkey.mytunnel.org/sub?token=368c66340d34f97681309be837425b1d&b64";
        const response = await fetch(remoteUrl);
        const textData = await response.text();
        const decoded = atob(textData);
        const lines = decoded.split('\n').filter(l => l.trim().startsWith('trojan://'));

        // Ping -1 နဲ့ ပို့မယ်၊ Timeout မဖြစ်အောင် ကန့်သတ်ထားမယ်
        const result = lines.slice(0, 30).map(line => ({ key: line, ping: -1 }));

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: getCorsHeaders(origin)
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: getCorsHeaders(origin) });
      }
    }

    if (request.method === "POST" && url.pathname === "/verify-key") {
      const body = await request.json() as { key?: string };
      const row = await db.prepare("SELECT status FROM keys WHERE key = ?").bind(body.key).first();
      if (row && (row as any).status === 'active') {
        await db.prepare("UPDATE keys SET status = 'expired' WHERE key = ?").bind(body.key).run();
        return new Response(JSON.stringify({ valid: true }), { status: 200, headers: getCorsHeaders(origin) });
      }
      return new Response(JSON.stringify({ valid: false }), { status: 400, headers: getCorsHeaders(origin) });
    }

    return new Response("OK", { status: 200 });
  },
};