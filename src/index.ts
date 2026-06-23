import { Bot, webhookCallback, InlineKeyboard } from "grammy";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db = env.DB;

    // CORS Headers ကို အမြဲတမ်းသုံးနိုင်ရန်အတွက် function တစ်ခုဆောက်ပေးထားသည်
    const getCorsHeaders = (origin: string | null) => ({
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    });

    // OPTIONS request ဆိုရင် ခွင့်ပြုချက်ချက်ချင်းပေးပါ
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
    bot.command("start", async (ctx) => {
      const userId = ctx.from!.id;
      await db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").bind(userId).run();
      const keyboard = new InlineKeyboard()
        .url("📢 Channel Join ရန်နှိပ်ပါ", "https://t.me/KP_CHANNEL_KP").row()
        .url("👤 Admin ကို ဆက်သွယ်ရန်", "https://t.me/kpbykp").row()
        .text("🔑 Key ထုတ်ရန်", "generate_key");
      await ctx.reply("👋 မင်္ဂလာပါ။ Channel Join ပြီးမှ Key ထုတ်လို့ ရမှာဖြစ်ပါတယ်။", { reply_markup: keyboard });
    });

    bot.callbackQuery("generate_key", async (ctx) => {
      const CHANNEL_ID = "@KP_CHANNEL_KP";
      try {
        const member = await ctx.api.getChatMember(CHANNEL_ID, ctx.from!.id);
        if (member.status === "left" || member.status === "kicked") {
          return await ctx.answerCallbackQuery({ text: "❌ Channel Join မှ Key ထုတ်လို့ ရပါမည်။", show_alert: true });
        }
        const newKey = Math.random().toString(36).substring(7).toUpperCase();
        await db.prepare("INSERT INTO keys (key, status) VALUES (?, 'active')").bind(newKey).run();
        await ctx.editMessageText(`✅ သင်၏ Key မှာ: \`${newKey}\` \n\n(Key ကို ထိလိုက်တာနဲ့ Copy ဖြစ်ပါလိမ့်မယ်။)`, { parse_mode: "Markdown" });
      } catch (err) {
        await ctx.answerCallbackQuery({ text: "⚠️ Error ဖြစ်နေသည်", show_alert: true });
      }
    });

    // --- 2. API Endpoints ---

    // [FIXED] Backend ကနေ Ping စစ်တာကို လုံးဝဖြုတ်လိုက်ပါပြီ။ Frontend ကပဲ စစ်ပါတော့မည်။
    if (request.method === "GET" && url.pathname === "/fetch-keys-with-ping") {
  try {
    const remoteUrl = "https://kp.kptrial.mytunnel.org/sub?token=0373a808853be80b19697d3e09fa0d7c&b64";
    const response = await fetch(remoteUrl);
    const textData = await response.text();
    const decoded = atob(textData);
    const lines = decoded.split('\n').filter(l => l.trim().startsWith('trojan://'));

    // Ping: 0 သို့မဟုတ် "Active" လို့ပဲ ပို့ပေးလိုက်မယ်
    // .slice(0, 30) ကို ဖျက်လိုက်ပါ
const result = lines.map(line => ({ key: line, ping: 0 }));

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...getCorsHeaders(origin), "Cache-Control": "max-age=3600" } // 1 နာရီ Cache လုပ်ထားလို့ ပိုမြန်မယ်
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "Failed" }), { status: 500, headers: getCorsHeaders(origin) });
  }
}

    // Key Verify
    if (request.method === "POST" && url.pathname === "/verify-key") {
      const body = await request.json() as { key?: string };
      const row = await db.prepare("SELECT status FROM keys WHERE key = ?").bind(body.key).first();
      if (row && (row as any).status === 'active') {
        await db.prepare("UPDATE keys SET status = 'expired' WHERE key = ?").bind(body.key).run();
        return new Response(JSON.stringify({ valid: true }), { status: 200, headers: getCorsHeaders(origin) });
      }
      return new Response(JSON.stringify({ valid: false }), { status: 400, headers: getCorsHeaders(origin) });
    }

    // User Count
    if (request.method === "GET" && url.pathname === "/user-count") {
      const result = await db.prepare("SELECT count(*) as total FROM users").first();
      return new Response(JSON.stringify({ count: (result as any).total }), { 
        status: 200, headers: getCorsHeaders(origin) 
      });
    }

    if (request.method === "POST") return webhookCallback(bot, "cloudflare-mod")(request);
    
    return new Response("Bot is active!", { status: 200 });
  },
};
//