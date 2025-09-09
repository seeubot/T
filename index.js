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

const TELEGRAM_BOT_TOKEN = "7599815904:AAHWE869Ic4IQOpk9j6wF6aL8WFvix_L-n0";
const TELEGRAM_CHAT_ID = "@newdatare";
const WEBHOOK_URL = "https://dear-cynthie-seeutech-c86ea1f1.koyeb.app";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("💀 TELEGRAM_BOT_TOKEN is missing. Go check your .env.");
  process.exit(1);
}

// 🚀 Enhanced API configurations
const VIDEO_APIS = [
  {
    name: "multimodalart/self-forcing",
    endpoint: "multimodalart/self-forcing",
    method: "/video_generation_handler_streaming",
    maxDuration: 10,
    fps: 10
  },
  {
    name: "stabilityai/stable-video-diffusion-img2vid-xt",
    endpoint: "stabilityai/stable-video-diffusion-img2vid-xt",
    method: "/predict",
    maxDuration: 25,
    fps: 6
  },
  {
    name: "KingNish/video-generation",
    endpoint: "KingNish/video-generation",
    method: "/predict",
    maxDuration: 8,
    fps: 8
  },
  {
    name: "wangfuyun/AnimateLCM",
    endpoint: "wangfuyun/AnimateLCM",
    method: "/predict",
    maxDuration: 16,
    fps: 8
  },
  {
    name: "multimodalart/stable-video-diffusion",
    endpoint: "multimodalart/stable-video-diffusion",
    method: "/predict",
    maxDuration: 25,
    fps: 6
  }
];

const IMAGE_APIS = [
  {
    name: "stabilityai/stable-diffusion-xl-base-1.0",
    endpoint: "stabilityai/stable-diffusion-xl-base-1.0",
    method: "/predict"
  },
  {
    name: "runwayml/stable-diffusion-v1-5",
    endpoint: "runwayml/stable-diffusion-v1-5",
    method: "/predict"
  },
  {
    name: "microsoft/DiT-XL-2-256",
    endpoint: "microsoft/DiT-XL-2-256",
    method: "/predict"
  },
  {
    name: "playgroundai/playground-v2-1024px-aesthetic",
    endpoint: "playgroundai/playground-v2-1024px-aesthetic",
    method: "/predict"
  },
  {
    name: "SG161222/Realistic_Vision_V5.1_noVAE",
    endpoint: "SG161222/Realistic_Vision_V5.1_noVAE",
    method: "/predict"
  }
];

const bannedIPs = new Set();
const userSessions = new Map();
const apiHealthStatus = new Map();

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

function downloadVideo(videoUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(videoUrl, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(outputPath, () => {});
      reject(err);
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

function sendToTelegram(filePath, prompt, isImage = false) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("chat_id", TELEGRAM_CHAT_ID);
    form.append("caption", `${isImage ? '🖼️' : '🎥'} Prompt: ${prompt}`);
    
    if (isImage) {
      form.append("photo", fs.createReadStream(filePath));
    } else {
      form.append("video", fs.createReadStream(filePath));
    }

    const endpoint = isImage ? "sendPhoto" : "sendVideo";
    
    const req = https.request({
      hostname: "api.telegram.org",
      path: `/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
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

// Rate limiting function - More generous limits
function isRateLimited(userId) {
  const now = Date.now();
  const userSession = userSessions.get(userId);
  
  if (!userSession) {
    userSessions.set(userId, { lastRequest: now, requestCount: 1 });
    return false;
  }
  
  // Reset count if more than 30 minutes has passed
  if (now - userSession.lastRequest > 1800000) {
    userSession.requestCount = 1;
    userSession.lastRequest = now;
    return false;
  }
  
  // Allow max 10 requests per 30 minutes
  if (userSession.requestCount >= 10) {
    return true;
  }
  
  userSession.requestCount++;
  userSession.lastRequest = now;
  return false;
}

// Enhanced video generation with multiple APIs
async function generateVideo(prompt, seed = 3, fps = 10, duration = 16) {
  const errors = [];
  
  // Try each API until one works
  for (const api of VIDEO_APIS) {
    try {
      console.log(`🎬 Trying ${api.name} for video generation...`);
      
      const client = await Client.connect(api.endpoint);
      
      let result;
      
      // Handle different API signatures
      if (api.name === "multimodalart/self-forcing") {
        result = await client.predict(api.method, {
          prompt,
          seed: Number(seed),
          fps: Math.min(Number(fps), api.fps),
        });
      } else if (api.name === "stabilityai/stable-video-diffusion-img2vid-xt") {
        // This one needs an input image first
        continue;
      } else if (api.name === "wangfuyun/AnimateLCM") {
        result = await client.predict(api.method, {
          prompt,
          negative_prompt: "blurry, low quality, distorted",
          num_inference_steps: 8,
          guidance_scale: 2.0,
          width: 512,
          height: 512,
          num_frames: Math.min(duration, api.maxDuration),
          fps: api.fps
        });
      } else {
        result = await client.predict(api.method, {
          prompt,
          seed: Number(seed),
          num_frames: Math.min(duration, api.maxDuration),
          fps: api.fps
        });
      }

      let videoUrl;
      
      // Handle different response formats
      if (result.data[0]?.video?.url) {
        videoUrl = result.data[0].video.url;
      } else if (result.data[0]?.url) {
        videoUrl = result.data[0].url;
      } else if (typeof result.data[0] === 'string') {
        videoUrl = result.data[0];
      } else {
        throw new Error("Invalid response format");
      }

      if (!videoUrl?.startsWith("http")) {
        throw new Error("Invalid video URL from prediction");
      }

      const filename = `gen_${Date.now()}.mp4`;
      const outputPath = path.join(__dirname, filename);

      // Download video
      if (videoUrl.includes('.m3u8')) {
        await downloadWithFFmpeg(videoUrl, outputPath);
      } else {
        await downloadVideo(videoUrl, outputPath);
      }

      console.log(`✅ Successfully generated video using ${api.name}`);
      return outputPath;
      
    } catch (error) {
      console.error(`❌ ${api.name} failed:`, error.message);
      errors.push(`${api.name}: ${error.message}`);
      continue;
    }
  }
  
  throw new Error(`All video APIs failed: ${errors.join(', ')}`);
}

// Image generation function
async function generateImage(prompt, seed = 3) {
  const errors = [];
  
  for (const api of IMAGE_APIS) {
    try {
      console.log(`🖼️ Trying ${api.name} for image generation...`);
      
      const client = await Client.connect(api.endpoint);
      
      let result;
      
      // Handle different API signatures
      if (api.name === "stabilityai/stable-diffusion-xl-base-1.0") {
        result = await client.predict(api.method, {
          prompt,
          negative_prompt: "blurry, low quality, distorted",
          width: 1024,
          height: 1024,
          num_inference_steps: 20,
          guidance_scale: 7.5,
          seed: Number(seed)
        });
      } else if (api.name === "playgroundai/playground-v2-1024px-aesthetic") {
        result = await client.predict(api.method, {
          prompt,
          negative_prompt: "blurry, low quality",
          width: 1024,
          height: 1024,
          guidance_scale: 3.0,
          num_inference_steps: 50,
          seed: Number(seed)
        });
      } else {
        result = await client.predict(api.method, {
          prompt,
          num_inference_steps: 20,
          guidance_scale: 7.5,
          seed: Number(seed)
        });
      }

      let imageUrl;
      
      // Handle different response formats
      if (result.data[0]?.url) {
        imageUrl = result.data[0].url;
      } else if (typeof result.data[0] === 'string') {
        imageUrl = result.data[0];
      } else {
        throw new Error("Invalid response format");
      }

      if (!imageUrl?.startsWith("http")) {
        throw new Error("Invalid image URL from prediction");
      }

      const filename = `img_${Date.now()}.png`;
      const outputPath = path.join(__dirname, filename);

      // Download image
      await downloadVideo(imageUrl, outputPath);

      console.log(`✅ Successfully generated image using ${api.name}`);
      return outputPath;
      
    } catch (error) {
      console.error(`❌ ${api.name} failed:`, error.message);
      errors.push(`${api.name}: ${error.message}`);
      continue;
    }
  }
  
  throw new Error(`All image APIs failed: ${errors.join(', ')}`);
}

// Web Routes
app.get("/", (req, res) => {
  res.json({
    status: "🔥 Enhanced Video & Image Generation Bot API",
    endpoints: {
      "/generate-video": "Generate video from prompt (supports longer duration)",
      "/generate-image": "Generate image from prompt",
      "/webhook": "Telegram webhook endpoint",
      "/set-webhook": "Set Telegram webhook",
      "/api-status": "Check API health status"
    },
    features: {
      "Video APIs": VIDEO_APIS.length,
      "Image APIs": IMAGE_APIS.length,
      "Max Video Duration": "25 frames",
      "Content Filtering": "Enabled",
      "Rate Limiting": "10 requests per 30 minutes"
    }
  });
});

app.get("/api-status", (req, res) => {
  res.json({
    video_apis: VIDEO_APIS,
    image_apis: IMAGE_APIS,
    health_status: Object.fromEntries(apiHealthStatus)
  });
});

app.get("/generate-video", async (req, res) => {
  const { prompt, seed = 3, fps = 10, duration = 16 } = req.query;
  const ip = req.clientIp || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt parameter" });
  }

  if (bannedIPs.has(ip)) {
    return res.status(403).json({ error: "IP banned for inappropriate content" });
  }

  // Relaxed profanity check - only block extremely inappropriate content
  const offensiveWords = ['fuck', 'shit', 'damn', 'ass', 'bitch'];
  const hasOffensiveContent = offensiveWords.some(word => 
    prompt.toLowerCase().includes(word.toLowerCase())
  );

  if (hasOffensiveContent) {
    bannedIPs.add(ip);
    await notifyBanToTelegram(ip, prompt);
    return res.status(403).json({ error: "Content blocked for inappropriate language" });
  }

  let outputPath = "";

  try {
    outputPath = await generateVideo(prompt, seed, fps, duration);
    const publicUrl = await uploadToGofile(outputPath);
    const telegramInfo = await sendToTelegram(outputPath, prompt, false);

    fs.unlink(outputPath, () => {
      console.log(`🧹 Cleaned up: ${outputPath}`);
    });

    res.json({
      url: publicUrl,
      message: "Video generated and sent to group successfully.",
      link: telegramInfo.message_link,
      type: "video"
    });

  } catch (err) {
    console.error("Video generation error:", err.message);
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    res.status(500).json({ error: err.message });
  }
});

app.get("/generate-image", async (req, res) => {
  const { prompt, seed = 3 } = req.query;
  const ip = req.clientIp || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!prompt) {
    return res.status(400).json({ error: "Missing prompt parameter" });
  }

  if (bannedIPs.has(ip)) {
    return res.status(403).json({ error: "IP banned for inappropriate content" });
  }

  // Relaxed profanity check
  const offensiveWords = ['fuck', 'shit', 'damn', 'ass', 'bitch'];
  const hasOffensiveContent = offensiveWords.some(word => 
    prompt.toLowerCase().includes(word.toLowerCase())
  );

  if (hasOffensiveContent) {
    bannedIPs.add(ip);
    await notifyBanToTelegram(ip, prompt);
    return res.status(403).json({ error: "Content blocked for inappropriate language" });
  }

  let outputPath = "";

  try {
    outputPath = await generateImage(prompt, seed);
    const publicUrl = await uploadToGofile(outputPath);
    const telegramInfo = await sendToTelegram(outputPath, prompt, true);

    fs.unlink(outputPath, () => {
      console.log(`🧹 Cleaned up: ${outputPath}`);
    });

    res.json({
      url: publicUrl,
      message: "Image generated and sent to group successfully.",
      link: telegramInfo.message_link,
      type: "image"
    });

  } catch (err) {
    console.error("Image generation error:", err.message);
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

    if (update.message) {
      const message = update.message;
      const chatId = message.chat.id;
      const userId = message.from.id;
      const text = message.text;

      console.log(`📩 Message from ${message.from.first_name} (${userId}): ${text}`);

      // Handle /start command
      if (text === "/start") {
        const welcomeText = `🎥 *Welcome to Enhanced Video & Image Generation Bot!*

🚀 *How to use:*
Send me a text prompt and I'll generate content for you!

📝 *Commands:*
• \`/video [prompt]\` - Generate video (up to 25 frames)
• \`/image [prompt]\` - Generate image (1024x1024)
• \`/help\` - Show this help message

🎯 *Example prompts:*
• \`/video A cat playing with a ball in slow motion\`
• \`/image A futuristic city at sunset\`
• \`A dragon flying over mountains\` (auto-detects type)

⚡ *Features:*
• ${VIDEO_APIS.length} video generation APIs
• ${IMAGE_APIS.length} image generation APIs  
• Longer video duration (up to 25 frames)
• High-quality outputs
• Automatic fallback between APIs
• 10 generations per 30 minutes

🎬 *Just send your prompt and watch the magic happen!*`;

        await sendTelegramMessage(chatId, welcomeText);
        return res.status(200).send("OK");
      }

      // Handle /help command
      if (text === "/help") {
        const helpText = `📚 *Help & Commands*

*Basic Usage:*
• \`/video [prompt]\` - Generate video
• \`/image [prompt]\` - Generate image
• Just send text for auto-detection

*Advanced Options:*
• \`/video [prompt] seed:123\` - Use specific seed
• \`/image [prompt] seed:456\` - Use specific seed

*Limits:*
• 10 generations per 30 minutes
• Video: Up to 25 frames
• Image: 1024x1024 resolution

*Tips:*
• Be descriptive for better results
• Use "cinematic", "detailed", "high quality" in prompts
• Avoid inappropriate content

*Examples:*
• \`/video A majestic eagle soaring through clouds, cinematic\`
• \`/image A cyberpunk city with neon lights, highly detailed\``;

        await sendTelegramMessage(chatId, helpText);
        return res.status(200).send("OK");
      }

      // Check rate limiting
      if (isRateLimited(userId)) {
        await sendTelegramMessage(chatId, "⏰ *Rate limit exceeded!*\n\nYou can only generate 10 items per 30 minutes. Please wait and try again later.");
        return res.status(200).send("OK");
      }

      // Relaxed profanity check
      const offensiveWords = ['fuck', 'shit', 'damn', 'ass', 'bitch'];
      const hasOffensiveContent = offensiveWords.some(word => 
        text.toLowerCase().includes(word.toLowerCase())
      );

      if (hasOffensiveContent) {
        await sendTelegramMessage(chatId, "🚫 *Content blocked!*\n\nYour message contains inappropriate content. Please keep it clean! 🧼");
        bannedIPs.add(userId.toString());
        await notifyBanToTelegram(userId.toString(), text);
        return res.status(200).send("OK");
      }

      // Check if user is banned
      if (bannedIPs.has(userId.toString())) {
        await sendTelegramMessage(chatId, "🚫 *You are banned from using this bot.*\n\nReason: Inappropriate content.");
        return res.status(200).send("OK");
      }

      // Parse command and prompt
      let isVideo = true;
      let prompt = text;
      let seed = Math.floor(Math.random() * 1000);

      if (text.startsWith("/video ")) {
        prompt = text.substring(7);
        isVideo = true;
      } else if (text.startsWith("/image ")) {
        prompt = text.substring(7);
        isVideo = false;
      } else if (text.includes("image") || text.includes("picture") || text.includes("photo")) {
        isVideo = false;
      }

      // Extract seed if provided
      const seedMatch = prompt.match(/seed:(\d+)/);
      if (seedMatch) {
        seed = parseInt(seedMatch[1]);
        prompt = prompt.replace(/seed:\d+/, '').trim();
      }

      if (!prompt) {
        await sendTelegramMessage(chatId, "❌ *Empty prompt!*\n\nPlease provide a description for generation.");
        return res.status(200).send("OK");
      }

      // Generate content
      try {
        await sendTelegramMessage(chatId, `${isVideo ? '🎬' : '🖼️'} *Generating your ${isVideo ? 'video' : 'image'}...*\n\nThis may take a few moments. Please wait! ⏳`);
        
        let outputPath;
        if (isVideo) {
          outputPath = await generateVideo(prompt, seed, 8, 16);
        } else {
          outputPath = await generateImage(prompt, seed);
        }
        
        // Send content directly to user
        const form = new FormData();
        form.append("chat_id", chatId);
        form.append("caption", `${isVideo ? '🎥' : '🖼️'} *Your generated ${isVideo ? 'video' : 'image'}:*\n\n📝 Prompt: ${prompt}\n🎲 Seed: ${seed}`);
        form.append("parse_mode", "Markdown");
        
        if (isVideo) {
          form.append("video", fs.createReadStream(outputPath));
        } else {
          form.append("photo", fs.createReadStream(outputPath));
        }

        const endpoint = isVideo ? "sendVideo" : "sendPhoto";
        await axios.post(
          `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${endpoint}`,
          form,
          {
            headers: form.getHeaders(),
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
          }
        );

        // Also send to channel
        await sendToTelegram(outputPath, prompt, !isVideo);

        // Clean up
        fs.unlink(outputPath, () => {
          console.log(`🧹 Cleaned up: ${outputPath}`);
        });

        await sendTelegramMessage(chatId, `✅ *${isVideo ? 'Video' : 'Image'} generated successfully!*\n\nYour content has also been shared in our channel. 📢`);

      } catch (error) {
        console.error("Generation error:", error.message);
        await sendTelegramMessage(chatId, `❌ *Error generating ${isVideo ? 'video' : 'image'}*\n\nSorry, something went wrong. Please try again with a different prompt.`);
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
  console.log(`🔥 Enhanced API running on http://localhost:${port}`);
  console.log(`🌐 Webhook URL: ${WEBHOOK_URL}`);
  console.log(`🎬 Video APIs: ${VIDEO_APIS.length}`);
  console.log(`🖼️ Image APIs: ${IMAGE_APIS.length}`);
  
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
