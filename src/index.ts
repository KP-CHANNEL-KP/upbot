import { Bot, webhookCallback, InlineKeyboard } from "grammy";

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db = env.DB; // D1 Database binding နာမည်

    // 1. Start Command
    // 1. Start Command
    bot.command("start", async (ctx) => {
      const keyboard = new InlineKeyboard()
        .url("📢 Channel Join ရန်နှိပ်ပါ", "https://t.me/KP_CHANNEL_KP")
        .row() // အသစ်တစ်ကြောင်းဆင်းမယ်
        .url("👤 Admin ကို ဆက်သွယ်ရန်", "https://t.me/kpbykp") // ဒီနေရာမှာ အစ်ကို့ Username ထည့်ပါ
        .row() // နောက်ထပ် အသစ်တစ်ကြောင်းဆင်းမယ်
        .text("🔑 Key ထုတ်ရန်", "generate_key");

      await ctx.reply("👋 မင်္ဂလာပါ။ Channel Join ပြီးမှ Key ထုပ်လို့ ရမှာဖြစ်ပါတယ်။ Key ထုပ်ပီးသွားရင် Website မှာ တခါသာ အသုံးပြုနိုင်ပါလိမ့်မယ်", { reply_markup: keyboard });
    });

    // 2. Key ထုတ်ပေးခြင်း (DB ထဲသိမ်းမယ်)
    // Key ထုတ်ပေးခြင်းအပိုင်း
bot.callbackQuery("generate_key", async (ctx) => {
  const CHANNEL_ID = "@KP_CHANNEL_KP";
  try {
    const member = await ctx.api.getChatMember(CHANNEL_ID, ctx.from!.id);
    if (member.status === "left" || member.status === "kicked") {
      return await ctx.answerCallbackQuery({ text: "❌ Channel Join ဖို့ မပြင်းပါနဲ့လို့။Channel ကို Join မှ Key ထုပ်လို့ ရမှာပါဆို 😭😭😭", show_alert: true });
    }

    const newKey = Math.random().toString(36).substring(7).toUpperCase();
    await db.prepare("INSERT INTO keys (key, status) VALUES (?, 'active')").bind(newKey).run();

    // ဒီနေရာမှာ `newKey` ကို ` ` (backticks) နဲ့ ဝိုင်းထားတာက Telegram မှာ Auto Copy ဖြစ်စေပါတယ်
    await ctx.editMessageText(
      `✅ သင်၏ Key မှာ: \`${newKey}\` \n\n(Key ကို ထိလိုက်တာနဲ့ Copy ဖြစ်ပါလိမ့်မယ်။)\n\nတစ်ခါသာ သုံးခွင့်ရှိသည်။`, 
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    await ctx.answerCallbackQuery({ text: "⚠️ Error ဖြစ်နေသည်", show_alert: true });
  }
});

    // 3. Website မှ Key လာစစ်ခြင်း (API Endpoint)
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/verify-key") {
      const body = (await request.json()) as { key?: string };
      const key = body.key;
      if (!key || typeof key !== "string") {
        return new Response(JSON.stringify({ valid: false, message: "Key မမှန်ပါ သို့မဟုတ် သုံးပြီးသားဖြစ်သည်" }), { status: 400 });
      }
      const row = await db.prepare("SELECT status FROM keys WHERE key = ?").bind(key).first();
      
      if (row && row.status === 'active') {
        // Key သုံးလိုက်တာနဲ့ ချက်ချင်း expired လုပ်ပစ်မယ် (One-time use)
        await db.prepare("UPDATE keys SET status = 'expired' WHERE key = ?").bind(key).run();
        return new Response(JSON.stringify({ valid: true, message: "Key မှန်ကန်ပါသည်။" }), { status: 200 });
      }
      return new Response(JSON.stringify({ valid: false, message: "Key မမှန်ပါ သို့မဟုတ် သုံးပြီးသားဖြစ်သည်" }), { status: 400 });
    }

    // Webhook Handler
    if (request.method === "POST") return webhookCallback(bot, "cloudflare-mod")(request);
    return new Response("Bot is active!", { status: 200 });
  },
};
