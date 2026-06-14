import { Bot, webhookCallback, InlineKeyboard } from "grammy";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db = env.DB;

    // --- Bot Command များကို ဤနေရာတွင် ထည့်ပါ ---
    
    bot.command("start", async (ctx) => {
      const userId = ctx.from!.id;
      await db.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").bind(userId).run();
      const keyboard = new InlineKeyboard()
        .url("📢 Channel Join ရန်နှိပ်ပါ", "https://t.me/KP_CHANNEL_KP").row()
        .url("👤 Admin ကို ဆက်သွယ်ရန်", "https://t.me/kpbykp").row()
        .text("🔑 Key ထုတ်ရန်", "generate_key");
      await ctx.reply("👋 မင်္ဂလာပါ။ Channel Join ပြီးမှ Key ထုတ်လို့ ရမှာဖြစ်ပါတယ်။", { reply_markup: keyboard });
    });

    // အရေးကြီး: သင်ထည့်လိုက်တဲ့ getkey command ကို ဒီနေရာမှာ ထည့်ပါ
    bot.command("getkey", async (ctx) => {
      const args = ctx.message?.text.split(" ");
      if (args && args.length >= 3) {
        const orderId = args[2].replace("order_id:", "");
        try {
          const update = await db.prepare("UPDATE orders SET status = 'completed' WHERE id = ?").bind(orderId).run();
          if (update.success) {
            await ctx.reply(`✅ Order ID: ${orderId} အောင်မြင်စွာ Update လုပ်ပြီးပါပြီ။`);
          } else {
            await ctx.reply("❌ Update မအောင်မြင်ပါ။");
          }
        } catch (e) {
          await ctx.reply("⚠️ Database Error ဖြစ်နေပါသည်။");
        }
      } else {
        await ctx.reply("ပုံစံအမှား! /getkey [GB] order_id:[ID] ဟု ရိုက်ပါ။");
      }
    });

    bot.callbackQuery("generate_key", async (ctx) => {
        // ... (သင်ရေးထားတဲ့ Code အတိုင်း) ...
    });

    // --- API Endpoints ---
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    // Fetch Keys API (Error Handling အသစ်)
    if (request.method === "GET" && url.pathname === "/fetch-keys-with-ping") {
      try {
        const remoteUrl = "https://www.kpkey.mytunnel.org/sub?token=368c66340d34f97681309be837425b1d&b64";
        const response = await fetch(remoteUrl);
        const textData = await response.text();
        let decoded = "";
        try { decoded = atob(textData); } catch { decoded = textData; }
        const lines = decoded.split('\n').filter(l => l.trim().startsWith('trojan://'));
        const result = lines.map(line => ({ key: line, ping: 0 }));

        return new Response(JSON.stringify(result || []), {
          status: 200,
          headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify([]), { status: 200, headers: { "Access-Control-Allow-Origin": "*" } });
      }
    }

    // တခြား API Endpoint တွေ (Verify-key, User-count) ကို ဒီနေရာမှာ ဆက်ထည့်ပါ...

    // Webhook Callback
    if (request.method === "POST") return webhookCallback(bot, "cloudflare-mod")(request);
    
    return new Response("Bot is active!", { status: 200 });
  },
};