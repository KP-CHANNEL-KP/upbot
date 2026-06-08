import { Bot, webhookCallback, InlineKeyboard } from "grammy";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db = env.DB;

    // --- CORS Headers ---
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Handle OPTIONS request for CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // --- 1. Start Command ---
    bot.command("start", async (ctx) => {
      const userId = ctx.from!.id;
      await db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").bind(userId).run();

      const keyboard = new InlineKeyboard()
        .url("📢 Channel Join ရန်နှိပ်ပါ", "https://t.me/KP_CHANNEL_KP")
        .row()
        .url("👤 Admin ကို ဆက်သွယ်ရန်", "https://t.me/kpbykp")
        .row()
        .text("🔑 Key ထုတ်ရန်", "generate_key");

      await ctx.reply("👋 မင်္ဂလာပါ။ Channel Join ပြီးမှ Key ထုတ်လို့ ရမှာဖြစ်ပါတယ်။", { reply_markup: keyboard });
    });

    // --- 2. Key Generation ---
    bot.callbackQuery("generate_key", async (ctx) => {
      const CHANNEL_ID = "@KP_CHANNEL_KP";
      try {
        const member = await ctx.api.getChatMember(CHANNEL_ID, ctx.from!.id);
        if (member.status === "left" || member.status === "kicked") {
          return await ctx.answerCallbackQuery({ text: "❌ Channel Join မှ Key ထုတ်လို့ ရပါမည်။", show_alert: true });
        }

        const newKey = Math.random().toString(36).substring(7).toUpperCase();
        await db.prepare("INSERT INTO keys (key, status) VALUES (?, 'active')").bind(newKey).run();

        await ctx.editMessageText(
          `✅ သင်၏ Key မှာ: \`${newKey}\` \n\n(Key ကို ထိလိုက်တာနဲ့ Copy ဖြစ်ပါလိမ့်မယ်။)\n\nတစ်ခါသာ သုံးခွင့်ရှိသည်။`, 
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        await ctx.answerCallbackQuery({ text: "⚠️ Error ဖြစ်နေသည်", show_alert: true });
      }
    });

    // --- 3. API Endpoints ---
    const url = new URL(request.url);
    
    // Verify Key Endpoint
    if (request.method === "POST" && url.pathname === "/verify-key") {
      const body = await request.json() as { key?: string };
      const row = await db.prepare("SELECT status FROM keys WHERE key = ?").bind(body.key).first();
      
      if (row && (row as any).status === 'active') {
        await db.prepare("UPDATE keys SET status = 'expired' WHERE key = ?").bind(body.key).run();
        return new Response(JSON.stringify({ valid: true }), { status: 200, headers: corsHeaders });
      }
      return new Response(JSON.stringify({ valid: false }), { status: 400, headers: corsHeaders });
    }

    // User Count Endpoint
    if (request.method === "GET" && url.pathname === "/user-count") {
      const result = await db.prepare("SELECT count(*) as total FROM users").first();
      return new Response(JSON.stringify({ count: (result as any).total }), { 
        status: 200, 
        headers: { "Content-Type": "application/json", ...corsHeaders } 
      });
    }

    // Webhook Handler
    if (request.method === "POST") return webhookCallback(bot, "cloudflare-mod")(request);
    
    return new Response("Bot is active!", { status: 200 });
  },
};