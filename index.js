import express from "express";
import { Client } from "@gradio/client";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import FormData from "form-data";
import axios from "axios";
import dotenv from "dotenv";
import requestIp from "request-ip";
import { createRequire } from "module";

dotenv.config();

// 🧠 Leo Profanity — No API key, full disrespect filter
const require = createRequire(import.meta.url);
const leoProfanity = require("leo-profanity");

const app = express();
const port = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TELEGRAM_BOT_TOKEN = "7709302887:AAGt3tiRDOrRHu4t_Xd01Rv7qsphMZnUrko";
const TELEGRAM_CHAT_ID = "@requestsids";
const WEBHOOK_URL = "https://dear-cynthie-seeutech-c86ea1f1.koyeb.app";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("💀 TELEGRAM_BOT_TOKEN is missing. Go check your .env.");
  process.exit(1);
}

const bannedIPs = new Set();
const userSessions = new Map(); // Track user sessions for rate limiting

// Middleware
app.use(express.json());
app.use(requestIp.mw());

// Set webhook on startup
async function setWebhook() {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
      {
        url: `${WEBHOOK_URL}/webhook`,
        allowed_updates: ["message", "callback_query"]
      }
    );
    console.log("🔗 Webhook set successfully:", response.data);
  } catch (error) {
    console.error("❌ Failed to set webhook:", error.message);
  }
}

// Utility functions
function downloadWithFFmpeg(m3u8Url, outputPath) {
  return new Promise((resolve, reject) => {
    const cmd = `ffmpeg -y -i "${m3u8Url}" -c copy "${outputPath}"`;
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error("FFmpeg Exec Error:", stderr);
        return reject(new Error("FFmpeg error: " + stderr));
      }
      resolve();
    });
  });
}

async function uploadToGofile(filePath) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath));

  const response = await axios.post(
    "https://store1.gofile.io/uploadFile",
    form,
    {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    }
  );

  const data = response.data;
  if (data.status === "ok" && data.data?.downloadPage) {
    return data.data.downloadPage;
  } else {
    throw new Error("Gofile API failed: " + JSON.stringify(data));
  }
}

function sendToTelegram(filePath, prompt) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("chat_id", TELEGRAM_CHAT_ID);
    form.append("caption", `🎥 Prompt: ${prompt}`);
    form.append("video", fs.createReadStream(filePath));

    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
      method: "POST",
      headers: form.getHeaders(),
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.ok && json.result?.message_id) {
            const msgId = json.result.message_id;
            const messageLink = `https://t.me/${TELEGRAM_CHAT_ID.replace('@', '')}/${msgId}`;
            resolve({
              message_id: msgId,
              message_link: messageLink
            });
          } else {
            reject(new Error("Telegram failed: " + data));
          }
        } catch (parseErr) {
          reject(new Error("Invalid response from Telegram"));
        }
      });
    });

    req.on("error", reject);
    form.pipe(req);
  });
}

async function sendTelegramMessage(chatId, text, options = {}) {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown",
        ...options
      }
    );
    return response.data;
  } catch (error) {
    console.error("Failed to send Telegram message:", error.message);
    throw error;
  }
}

async function notifyBanToTelegram(ip, originalPrompt) {
  const censoredPrompt = leoProfanity.clean(originalPrompt, '*');
  const text = `🚫 *Blocked Request Alert!*\n\n*IP:* \`${ip}\`\n*Prompt:* \`${censoredPrompt}\``;
  await sendTelegramMessage(TELEGRAM_CHAT_ID, text);
}

// Rate limiting function
function isRateLimited(userId) {
  const now = Date.now();
  const userSession = userSessions.get(userId);
  
  if (!userSession) {
    userSessions.set(userId, { lastRequest: now, requestCount: 1 });
    return false;
  }
  
  // Reset count if more than 1 hour has passed
  if (now - userSession.lastRequest > 3600000) {
    userSession.requestCount = 1;
    userSession.lastRequest = now;
    return false;
  }
  
  // Allow max 5 requests per hour
  if (userSession.requestCount >= 5) {
    return true;
  }
  
  userSession.requestCount++;
  userSession.lastRequest = now;
  return false;
}

// Video generation function
async function generateVideo(prompt, seed = 3, fps = 10) {
  const client = await Client.connect("multimodalart/self-forcing");
  
  const result = await client.predict("/video_generation_handler_streaming", {
    prompt,
    seed: Number(seed),
    fps: Number(fps),
  });

  const m3u8Url = result.data[0]?.video?.url;
  if (!m3u8Url?.startsWith("http")) {
    throw new Error("Invalid M3U8 URL from prediction");
  }

  const filename = `gen_${Date.now()}.mp4`;
  const outputPath = path.join(__dirname, filename);

  await downloadWithFFmpeg(m3u8Url, outputPath);
  return outputPath;
}

// Web Routes
app.get("/", (req, res) => {
  res.json({
    status: "🔥 Video Generation Bot API",
    endpoints: {
      "/generate-video": "Generate video from prompt",
      "/webhook": "Telegram webhook endpoint",
      "/set-webhook": "Set Telegram webhook"
    }
  });
});

app.get("/generate-video", async (req, res) => {
  const { prompt, seed = 3, fps = 10 } = req.query;
  const ip = req.clientIp || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!prompt) {
    console.warn("Missing prompt. User skill issue.");
    return res.status(400).send("Missing prompt. This ain't it, chief.");
  }

  if (bannedIPs.has(ip)) {
    console.warn(`Banned IP tried access: ${ip}`);
    return res.status(403).send("You're banned. Go cry somewhere else 💀");
  }

  if (leoProfanity.check(prompt)) {
    const words = prompt.split(/\s+/);
    const caughtWords = words.filter(word => leoProfanity.check(word));

    bannedIPs.add(ip);
    await notifyBanToTelegram(ip, prompt);
    return res.status(403).send("Nah bruh, you got banned. Dirty mouth = no access 🧼");
  }

  let outputPath = "";

  try {
    outputPath = await generateVideo(prompt, seed, fps);
    const publicUrl = await uploadToGofile(outputPath);
    const telegramInfo = await sendToTelegram(outputPath, prompt);

    fs.unlink(outputPath, () => {
      console.log(`🧹 Cleaned up: ${outputPath}`);
    });

    res.json({
      url: publicUrl,
      message: "Sent to group successfully.",
      link: telegramInfo.message_link
    });

  } catch (err) {
    console.error("Final handler error:", err.message);
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    res.status(500).json({ error: err.message });
  }
});

// Webhook endpoint
app.post("/webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("📨 Received webhook update:", JSON.stringify(update, null, 2));

    // Handle messages
    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const userId = message.from.id;
      const text = message.text;

      console.log(`📩 Message from ${message.from.first_name} (${userId}): ${text}`);

      // Handle /start command
      if (text === "/start") {
        const welcomeText = `🎥 *Welcome to Video Generation Bot!*

🚀 *How to use:*
Send me a text prompt and I'll generate a video for you!

📝 *Example prompts:*
• "A cat playing with a ball"
• "Ocean waves at sunset"
• "Dancing robot in space"

⚡ *Features:*
• High-quality video generation
• Automatic sharing to channel
• Clean content filtering

🎯 *Just send your prompt and watch the magic happen!*`;

        await sendTelegramMessage(chatId, welcomeText);
        return res.status(200).send("OK");
      }

      // Check rate limiting
      if (isRateLimited(userId)) {
        await sendTelegramMessage(chatId, "⏰ *Rate limit exceeded!*\n\nYou can only generate 5 videos per hour. Please wait and try again later.");
        return res.status(200).send("OK");
      }

      // Check for profanity
      if (leoProfanity.check(text)) {
        await sendTelegramMessage(chatId, "🚫 *Content blocked!*\n\nYour message contains inappropriate content. Please keep it clean! 🧼");
        
        // Add to banned IPs (using user ID as identifier)
        bannedIPs.add(userId.toString());
        await notifyBanToTelegram(userId.toString(), text);
        return res.status(200).send("OK");
      }

      // Check if user is banned
      if (bannedIPs.has(userId.toString())) {
        await sendTelegramMessage(chatId, "🚫 *You are banned from using this bot.*\n\nReason: Inappropriate content.");
        return res.status(200).send("OK");
      }

      // Generate video
      try {
        await sendTelegramMessage(chatId, "🎬 *Generating your video...*\n\nThis may take a few moments. Please wait! ⏳");
        
        const outputPath = await generateVideo(text);
        
        // Send video directly to user
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", `🎥 *Your generated video:*\n\n📝 Prompt: ${text}`);
        form.append("video", fs.createReadStream(outputPath));
        form.append("parse_mode", "Markdown");

        const videoResponse = await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
          form,
          {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          }
        );

        // Also send to channel
        await sendToTelegram(outputPath, text);

        // Clean up
        fs.unlink(outputPath, () => {
          console.log(`🧹 Cleaned up: ${outputPath}`);
        });

        await sendTelegramMessage(chatId, "✅ *Video generated successfully!*\n\nYour video has also been shared in our channel. 📢");

      } catch (error) {
        console.error("Video generation error:", error.message);
        await sendTelegramMessage(chatId, "❌ *Error generating video*\n\nSorry, something went wrong. Please try again with a different prompt.");
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Webhook error:", error.message);
    res.status(500).send("Internal Server Error");
  }
});

// Webhook management endpoints
app.get("/set-webhook", async (req, res) => {
  try {
    await setWebhook();
    res.json({ message: "Webhook set successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/webhook-info", async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/webhook", async (req, res) => {
  try {
    const response = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`
    );
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start server and set webhook
app.listen(port, async () => {
  console.log(`🔥 API running on http://localhost:${port}`);
  console.log(`🌐 Webhook URL: ${WEBHOOK_URL}`);
  
  // Set webhook on startup
  await setWebhook();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT, shutting down gracefully...');
  process.exit(0);
});
