import { Bot, webhookCallback, InlineKeyboard } from "grammy";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db  = env.DB;

    const getCorsHeaders = (origin: string | null) => ({
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json",
    });

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url    = new URL(request.url);
    const origin = request.headers.get("Origin");

    // ── Bot Commands ──
    bot.command("start", async (ctx) => {
      const userId = ctx.from!.id;
      await db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").bind(userId).run();
      const keyboard = new InlineKeyboard()
        .url("📢 Channel Join ရန်နှိပ်ပါ", "https://t.me/KP_CHANNEL_KP").row()
        .url("👤 Admin ကို ဆက်သွယ်ရန်", "https://t.me/kpbykp").row()
        .text("🔑 Key ထုတ်ရန်", "generate_key");
      await ctx.reply(
        "👋 မင်္ဂလာပါ။ Channel Join ပြီးမှ Key ထုတ်လို့ ရမှာဖြစ်ပါတယ်။ VPN Key များဝယ်ယူချင်တယ် ဆိုရင်တော့ @KPBYKP သို့ ဆက်သွယ်နိုင်ပါသည်။",
        { reply_markup: keyboard }
      );
    });

    bot.callbackQuery("generate_key", async (ctx) => {
      const CHANNEL_ID = "@KP_CHANNEL_KP";
      try {
        const member = await ctx.api.getChatMember(CHANNEL_ID, ctx.from!.id);
        if (member.status === "left" || member.status === "kicked") {
          return await ctx.answerCallbackQuery({
            text: "❌ Channel Join မှ Key ထုတ်လို့ ရပါမည်။",
            show_alert: true,
          });
        }
        const newKey = Math.random().toString(36).substring(7).toUpperCase();
        await db.prepare("INSERT INTO keys (key, status) VALUES (?, 'active')").bind(newKey).run();
        await ctx.editMessageText(
          `✅ သင်၏ Key မှာ: \`${newKey}\` \n\n(Key ကို ထိလိုက်တာနဲ့ Copy ဖြစ်ပါလိမ့်မယ်။)`,
          { parse_mode: "Markdown" }
        );
      } catch {
        await ctx.answerCallbackQuery({ text: "⚠️ Error ဖြစ်နေသည်", show_alert: true });
      }
    });

    // ── /fetch-keys  (ping မပါ — browser က စစ်မယ်) ──
    // Worker မှာ TCP ping စစ်တာ Cloudflare outbound block ကြောင့် အလုပ်မဖြစ်ဘူး။
    // ဒါကြောင့် plain key list ပဲ ပြန်ပေးမယ် — ping ကို browser ကနေ စစ်မယ်။
    if (request.method === "GET" && url.pathname === "/fetch-keys") {
      try {
        const CACHE_KEY = "plain_keys_v1";
        const CACHE_TTL = 600; // 10 မိနစ်
        const kv: KVNamespace = env.KP_PING_CACHE;

        // Cache စစ်မယ်
        const cached = await kv.get(CACHE_KEY);
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: { ...getCorsHeaders(origin), "X-Cache": "HIT" },
          });
        }

        // Key subscription ကနေ ဆွဲယူမယ်
        const remoteUrl =
          "https://kptrial1.kpchannel2.cc.cd/sub?token=3fa6c9690bdb45c91a193a56750d5a15&b64";
        const response = await fetch(remoteUrl);
        const textData = await response.text();
        const decoded  = atob(textData);
        const lines    = decoded
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("trojan://"));

        const json = JSON.stringify(lines);

        // KV မှာ cache သိမ်းမယ်
        ctx.waitUntil(kv.put(CACHE_KEY, json, { expirationTtl: CACHE_TTL }));

        return new Response(json, {
          status: 200,
          headers: { ...getCorsHeaders(origin), "X-Cache": "MISS" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed to fetch keys" }), {
          status: 500,
          headers: getCorsHeaders(origin),
        });
      }
    }

    // ── Backward compat: /fetch-keys-with-ping ဟောင်းကို /fetch-keys သို့ redirect ──
    if (request.method === "GET" && url.pathname === "/fetch-keys-with-ping") {
      const newUrl = new URL(request.url);
      newUrl.pathname = "/fetch-keys";
      return Response.redirect(newUrl.toString(), 302);
    }

    // ── /verify-key ──
    if (request.method === "POST" && url.pathname === "/verify-key") {
      const body = (await request.json()) as { key?: string };
      const row  = await db
        .prepare("SELECT status FROM keys WHERE key = ?")
        .bind(body.key)
        .first();
      if (row && (row as any).status === "active") {
        await db
          .prepare("UPDATE keys SET status = 'expired' WHERE key = ?")
          .bind(body.key)
          .run();
        return new Response(JSON.stringify({ valid: true }), {
          status: 200,
          headers: getCorsHeaders(origin),
        });
      }
      return new Response(JSON.stringify({ valid: false }), {
        status: 400,
        headers: getCorsHeaders(origin),
      });
    }

    // ── /user-count ──
    if (request.method === "GET" && url.pathname === "/user-count") {
      const result = await db.prepare("SELECT count(*) as total FROM users").first();
      return new Response(JSON.stringify({ count: (result as any).total }), {
        status: 200,
        headers: getCorsHeaders(origin),
      });
    }

    if (request.method === "POST") return webhookCallback(bot, "cloudflare-mod")(request);

    return new Response("Bot is active!", { status: 200 });
  },
};
//