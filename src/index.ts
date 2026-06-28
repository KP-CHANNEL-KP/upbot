import { Bot, webhookCallback, InlineKeyboard } from "grammy";

// ── Trojan key ထဲက host:port ဆွဲထုတ်မယ် ──
function extractHostPort(trojanKey: string): { host: string; port: number } | null {
  try {
    // trojan://password@host:port?...
    const match = trojanKey.match(/trojan:\/\/[^@]+@([^:]+):(\d+)/);
    if (!match) return null;
    return { host: match[1], port: parseInt(match[2]) };
  } catch {
    return null;
  }
}

// ── တစ်ခုချင်း ping စစ်မယ် (HTTPS fetch timing) ──
async function checkPing(host: string, port: number): Promise<number> {
  const url = `https://${host}:${port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000); // 3s timeout

  try {
    const start = Date.now();
    await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      // @ts-ignore
      cf: { cacheTtl: 0 },
    });
    clearTimeout(timeout);
    return Date.now() - start;
  } catch (e: any) {
    clearTimeout(timeout);
    // Connection refused / TLS error ဆိုလည်း server alive ဆိုတာ သိတယ်
    // AbortError ဆိုတော့မှ timeout
    if (e?.name === "AbortError") return -1; // timeout
    // တခြား error (CORS, TLS) = server online ဖြစ်နိုင်တယ်
    // timing ကို တိုင်းလို့မရဘူးဆိုရင် 0 ပြန်ပေး (Active အနေနဲ့ ပြမယ်)
    return 0;
  }
}

// ── Chunk array helper ──
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export default {
  async fetch(request: Request, env: any, ctx: any) {
    const bot = new Bot(env.BOT_TOKEN);
    const db = env.DB;
    const kv: KVNamespace = env.KP_PING_CACHE;

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

    const url = new URL(request.url);
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

    // ── /fetch-keys-with-ping ──
    if (request.method === "GET" && url.pathname === "/fetch-keys-with-ping") {
      try {
        const CACHE_KEY = "ping_results_v1";
        const CACHE_TTL = 600; // 10 မိနစ်

        // ① Cache စစ်မယ်
        const cached = await kv.get(CACHE_KEY);
        if (cached) {
          return new Response(cached, {
            status: 200,
            headers: {
              ...getCorsHeaders(origin),
              "X-Cache": "HIT",
              "Cache-Control": "max-age=600",
            },
          });
        }

        // ② Key တွေ fetch လုပ်မယ်
        const remoteUrl =
          "https://kp.kptrial.mytunnel.org/sub?token=667dc54ee074665a1f8774e433251666&b64";
        const response = await fetch(remoteUrl);
        const textData = await response.text();
        const decoded = atob(textData);
        const lines = decoded.split("\n").filter((l) => l.trim().startsWith("trojan://"));

        // ③ Unique IP:Port တွေ ဆွဲထုတ်မယ် (Strategy 5)
        const ipPingMap = new Map<string, number>(); // "host:port" → ping ms
        const uniqueHostPorts: Array<{ host: string; port: number; key: string }> = [];
        const seenKeys = new Set<string>();

        for (const line of lines) {
          const parsed = extractHostPort(line);
          if (!parsed) continue;
          const ipKey = `${parsed.host}:${parsed.port}`;
          if (!seenKeys.has(ipKey)) {
            seenKeys.add(ipKey);
            uniqueHostPorts.push({ ...parsed, key: ipKey });
          }
        }

        // ④ Chunk 10 စီ စစ်မယ် (Strategy 1)
        const chunks = chunkArray(uniqueHostPorts, 10);
        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async ({ host, port, key }) => {
              const ping = await checkPing(host, port);
              ipPingMap.set(key, ping);
            })
          );
        }

        // ⑤ Key တိုင်းကို ping result ပေးမယ် + Sort လုပ်မယ် (Strategy 10)
        const result = lines
          .map((line) => {
            const parsed = extractHostPort(line);
            if (!parsed) return { key: line, ping: -1 };
            const ipKey = `${parsed.host}:${parsed.port}`;
            return { key: line, ping: ipPingMap.get(ipKey) ?? -1 };
          })
          .sort((a, b) => {
            // Timeout (-1) တွေ အောက်ဆုံးချမယ်
            if (a.ping === -1 && b.ping === -1) return 0;
            if (a.ping === -1) return 1;
            if (b.ping === -1) return -1;
            return a.ping - b.ping; // ping နည်းတာ အပေါ်
          });

        const json = JSON.stringify(result);

        // ⑥ KV Cache မှာ သိမ်းမယ်
        ctx.waitUntil(kv.put(CACHE_KEY, json, { expirationTtl: CACHE_TTL }));

        return new Response(json, {
          status: 200,
          headers: {
            ...getCorsHeaders(origin),
            "X-Cache": "MISS",
            "Cache-Control": "max-age=600",
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Failed to fetch keys" }), {
          status: 500,
          headers: getCorsHeaders(origin),
        });
      }
    }

    // ── /verify-key ──
    if (request.method === "POST" && url.pathname === "/verify-key") {
      const body = (await request.json()) as { key?: string };
      const row = await db
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