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
const WEBHOOK_URL = "https://important-condor-school1660440-f1a4e1ca.koyeb.app";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("💀 TELEGRAM_BOT_TOKEN is missing. Go check your .env.");
  process.exit(1);
}

// 🚀 Enhanced API configurations - Updated for Image-to-Video
const VIDEO_APIS = [
  {
    name: "stabilityai/stable-video-diffusion-img2vid-xt",
    endpoint: "stabilityai/stable-video-diffusion-img2vid-xt",
    method: "/predict",
    maxDuration: 25,
    fps: 6,
    requiresImage: true
  },
  {
    name: "ali-vilab/i2vgen-xl",
    endpoint: "ali-vilab/i2vgen-xl",
    method: "/predict",
    maxDuration: 16,
    fps: 8,
    requiresImage: true
  },
  {
    name: "multimodalart/stable-video-diffusion",
    endpoint: "multimodalart/stable-video-diffusion",
    method: "/predict",
    maxDuration: 25,
    fps: 6,
    requiresImage: true
  },
  {
    name: "camenduru/AnimateDiff-Lightning",
    endpoint: "camenduru/AnimateDiff-Lightning",
    method: "/predict",
    maxDuration: 16,
    fps: 8,
    requiresImage: true
  },
  {
    name: "KingNish/Image-to-Video",
    endpoint: "KingNish/Image-to-Video",
    method: "/predict",
    maxDuration: 8,
    fps: 8,
    requiresImage: true
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

function downloadImage(imageUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(imageUrl, (response) => {
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
    form.append("caption", `${isImage ? '🖼️' : '🎥'} ${isImage ? 'Image' : 'Image-to-Video'}: ${prompt}`);
    
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

// Enhanced image-to-video generation with multiple APIs
async function generateVideoFromImage(imagePath, prompt = "", seed = 3, fps = 8, duration = 16) {
  const errors = [];
  
  // Try each API until one works
  for (const api of VIDEO_APIS) {
    try {
      console.log(`🎬 Trying ${api.name} for image-to-video generation...`);
      
      const client = await Client.connect(api.endpoint);
      
      let result;
      
      // Handle different API signatures for image-to-video
      if (api.name === "stabilityai/stable-video-diffusion-img2vid-xt") {
        result = await client.predict(api.method, {
          image: imagePath,
          seed: Number(seed),
          motion_bucket_id: 127,
          fps_id: 6,
          version: "svd_xt",
          cond_aug: 0.02,
          decoding_t: 3,
          num_frames: Math.min(duration, api.maxDuration)
        });
      } else if (api.name === "ali-vilab/i2vgen-xl") {
        result = await client.predict(api.method, {
          image: imagePath,
          text_prompt: prompt || "animate this image",
          negative_prompt: "blurry, low quality, distorted",
          randomize_seed: true,
          seed: Number(seed),
          motion_scale: 1.0
        });
      } else if (api.name === "multimodalart/stable-video-diffusion") {
        result = await client.predict(api.method, {
          image: imagePath,
          seed: Number(seed),
          num_frames: Math.min(duration, api.maxDuration),
          motion_bucket_id: 127,
          fps_id: 6
        });
      } else if (api.name === "camenduru/AnimateDiff-Lightning") {
        result = await client.predict(api.method, {
          image: imagePath,
          prompt: prompt || "animate this image with natural motion",
          num_inference_steps: 8,
          guidance_scale: 2.0,
          num_frames: Math.min(duration, api.maxDuration),
          fps: api.fps
        });
      } else {
        result = await client.predict(api.method, {
          image: imagePath,
          prompt: prompt || "animate this image",
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

// Image generation function (unchanged)
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
      await downloadImage(imageUrl, outputPath);

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
    status: "🔥 Enhanced Image-to-Video & Image Generation Bot API",
    endpoints: {
      "/generate-video": "Generate video from image (Image-to-Video)",
      "/generate-image": "Generate image from prompt",
      "/webhook": "Telegram webhook endpoint",
      "/set-webhook": "Set Telegram webhook",
      "/api-status": "Check API health status"
    },
    features: {
      "Video APIs": VIDEO_APIS.length + " (Image-to-Video)",
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
  const { image_url, prompt = "", seed = 3, fps = 8, duration = 16 } = req.query;
  const ip = req.clientIp || req.headers["x-forwarded-for"]?.split(",")[0] || "unknown";

  if (!image_url) {
    return res.status(400).json({ error: "Missing image_url parameter for image-to-video generation" });
  }

  if (bannedIPs.has(ip)) {
    return res.status(403).json({ error: "IP banned for inappropriate content" });
  }

  // Relaxed profanity check for prompt
  if (prompt) {
    const offensiveWords = ['fuck', 'shit', 'damn', 'ass', 'bitch'];
    const hasOffensiveContent = offensiveWords.some(word => 
      prompt.toLowerCase().includes(word.toLowerCase())
    );

    if (hasOffensiveContent) {
      bannedIPs.add(ip);
      await notifyBanToTelegram(ip, prompt);
      return res.status(403).json({ error: "Content blocked for inappropriate language" });
    }
  }

  let outputPath = "";
  let inputImagePath = "";

  try {
    // Download input image first
    const imageFilename = `input_${Date.now()}.jpg`;
    inputImagePath = path.join(__dirname, imageFilename);
    await downloadImage(image_url, inputImagePath);

    outputPath = await generateVideoFromImage(inputImagePath, prompt, seed, fps, duration);
    const publicUrl = await uploadToGofile(outputPath);
    const telegramInfo = await sendToTelegram(outputPath, `Image-to-Video: ${prompt}`, false);

    // Clean up files
    fs.unlink(outputPath, () => {
      console.log(`🧹 Cleaned up: ${outputPath}`);
    });
    fs.unlink(inputImagePath, () => {
      console.log(`🧹 Cleaned up: ${inputImagePath}`);
    });

    res.json({
      url: publicUrl,
      message: "Video generated from image and sent to group successfully.",
      link: telegramInfo.message_link,
      type: "video"
    });

  } catch (err) {
    console.error("Image-to-video generation error:", err.message);
    if (outputPath && fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
    if (inputImagePath && fs.existsSync(inputImagePath)) {
      fs.unlinkSync(inputImagePath);
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
        const welcomeText = `🎥 *Welcome to Enhanced Image-to-Video & Image Generation Bot!*

🚀 *How to use:*
Send me an image and I'll animate it, or send text to generate an image!

📝 *Commands:*
• Send an image → I'll animate it into a video!
• \`/image [prompt]\` - Generate image (1024x1024)
• \`/help\` - Show this help message

🎯 *Example usage:*
• Send a photo of a landscape → Get animated video
• \`/image A futuristic city at sunset\` → Get generated image
• Add text with your image for motion guidance

⚡ *Features:*
• ${VIDEO_APIS.length} image-to-video generation APIs
• ${IMAGE_APIS.length} image generation APIs  
• Longer video duration (up to 25 frames)
• High-quality outputs
• Automatic fallback between APIs
• 10 generations per 30 minutes

🎬 *Just send an image and watch it come to life!*`;

        await sendTelegramMessage(chatId, welcomeText);
        return res.status(200).send("OK");
      }

      // Handle /help command
      if (text === "/help") {
        const helpText = `📚 *Help & Commands*

*Image-to-Video:*
• Send any image (photo/document)
• Add optional text for motion guidance
• I'll create an animated video from your image!

*Image Generation:*
• \`/image [prompt]\` - Generate image from text

*Advanced Options:*
• \`seed:123\` in caption - Use specific seed
• Motion prompts: "gentle breeze", "flowing water", etc.

*Limits:*
• 10 generations per 30 minutes
• Video: Up to 25 frames from your image
• Image: 1024x1024 resolution

*Tips:*
• High quality images work best
• Use motion descriptions for better animation
• Portrait/landscape images both supported

*Examples:*
• Send landscape photo + "gentle wind blowing"
• Send portrait + "subtle head movement"
• \`/image A cyberpunk city with neon lights\``;

        await sendTelegramMessage(chatId, helpText);
        return res.status(200).send("OK");
      }

      // Check rate limiting
      if (isRateLimited(userId)) {
        await sendTelegramMessage(chatId, "⏰ *Rate limit exceeded!*\n\nYou can only generate 10 items per 30 minutes. Please wait and try again later.");
        return res.status(200).send("OK");
      }

      // Check if user is banned
      if (bannedIPs.has(userId.toString())) {
        await sendTelegramMessage(chatId, "🚫 *You are banned from using this bot.*\n\nReason: Inappropriate content.");
        return res.status(200).send("OK");
      }

      // Handle image messages for video generation
      if (message.photo || message.document) {
        let fileId;
        
        if (message.photo) {
          // Get the highest quality photo
          fileId = message.photo[message.photo.length - 1].file_id;
        } else if (message.document && message.document.mime_type?.startsWith('image/')) {
          fileId = message.document.file_id;
        }

        if (fileId) {
          try {
            // Get file info from Telegram
            const fileResponse = await axios.get(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`
            );
            
            if (!fileResponse.data.ok) {
              throw new Error("Failed to get file info from Telegram");
            }

            const filePath = fileResponse.data.result.file_path;
            const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;

            // Get motion prompt from caption
            let motionPrompt = message.caption || "natural motion, animate this image";
            let seed = Math.floor(Math.random() * 1000);

            // Extract seed if provided in caption
            if (message.caption) {
              const seedMatch = message.caption.match(/seed:(\d+)/);
              if (seedMatch) {
                seed = parseInt(seedMatch[1]);
                motionPrompt = message.caption.replace(/seed:\d+/, '').trim() || "natural motion";
              }

              // Check for profanity in caption
              const offensiveWords = ['fuck', 'shit', 'damn', 'ass', 'bitch'];
              const hasOffensiveContent = offensiveWords.some(word => 
                motionPrompt.toLowerCase().includes(word.toLowerCase())
              );

              if (hasOffensiveContent) {
                await sendTelegramMessage(chatId, "🚫 *Content blocked!*\n\nYour caption contains inappropriate content. Please keep it clean! 🧼");
                bannedIPs.add(userId.toString());
                await notifyBanToTelegram(userId.toString(), motionPrompt);
                return res.status(200).send("OK");
              }
            }

            await sendTelegramMessage(chatId, `🎬 *Converting your image to video...*\n\nMotion: ${motionPrompt}\n\nThis may take a few moments. Please wait! ⏳`);
            
            // Download the image
            const imageFilename = `input_${Date.now()}.jpg`;
            const inputImagePath = path.join(__dirname, imageFilename);
            await downloadImage(fileUrl, inputImagePath);
            
            // Generate video from image
            const outputPath = await generateVideoFromImage(inputImagePath, motionPrompt, seed, 8, 16);
            
            // Send video directly to user
            const form = new FormData();
            form.append("chat_id", chatId);
            form.append("caption", `🎥 *Your animated video:*\n\n🎭 Motion: ${motionPrompt}\n🎲 Seed: ${seed}`);
            form.append("parse_mode", "Markdown");
            form.append("video", fs.createReadStream(outputPath));

            await axios.post(
              `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendVideo`,
              form,
              {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
              }
            );

            // Also send to channel
            await sendToTelegram(outputPath, `Image-to-Video: ${motionPrompt}`, false);

            // Clean up
            fs.unlink(outputPath, () => {
              console.log(`🧹 Cleaned up: ${outputPath}`);
            });
            fs.unlink(inputImagePath, () => {
              console.log(`🧹 Cleaned up: ${inputImagePath}`);
            });

            await sendTelegramMessage(chatId, `✅ *Video generated successfully!*\n\nYour animated video has also been shared in our channel. 📢`);

          } catch (error) {
            console.error("Image-to-video error:", error.message);
            await sendTelegramMessage(chatId, `❌ *Error converting image to video*\n\nSorry, something went wrong. Please try with a different image.`);
          }
        }
        return res.status(200).send("OK");
      }

      // Handle text commands for image generation
      if (text && text.startsWith("/image ")) {
        const prompt = text.substring(7);
        let seed = Math.floor(Math.random() * 1000);

        // Extract seed if provided
        const seedMatch = prompt.match(/seed:(\d+)/);
        let finalPrompt = prompt;
        if (seedMatch) {
          seed = parseInt(seedMatch[1]);
          finalPrompt = prompt.replace(/seed:\d+/, '').trim();
        }

        if (!finalPrompt) {
          await sendTelegramMessage(chatId, "❌ *Empty prompt!*\n\nPlease provide a description for image generation.");
          return res.status(200).send("OK");
        }

        // Check profanity
        const offensiveWords = ['fuck', 'shit', 'damn', 'ass', 'bitch'];
        const hasOffensiveContent = offensiveWords.some(word => 
          finalPrompt.toLowerCase().includes(word.toLowerCase())
        );

        if (hasOffensiveContent) {
          await sendTelegramMessage(chatId, "🚫 *Content blocked!*\n\nYour prompt contains inappropriate content. Please keep it clean! 🧼");
          bannedIPs.add(userId.toString());
          await notifyBanToTelegram(userId.toString(), finalPrompt);
          return res.status(200).send("OK");
        }

        try {
          await sendTelegramMessage(chatId, `🖼️ *Generating your image...*\n\nPrompt: ${finalPrompt}\n\nThis may take a few moments. Please wait! ⏳`);
          
          const outputPath = await generateImage(finalPrompt, seed);
          
          // Send image directly to user
          const form = new FormData();
          form.append("chat_id", chatId);
          form.append("caption", `🖼️ *Your generated image:*\n\n📝 Prompt: ${finalPrompt}\n🎲 Seed: ${seed}`);
          form.append("parse_mode", "Markdown");
          form.append("photo", fs.createReadStream(outputPath));

          await axios.post(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`,
            form,
            {
              headers: form.getHeaders(),
              maxBodyLength: Infinity,
              maxContentLength: Infinity,
            }
          );

          // Also send to channel
          await sendToTelegram(outputPath, finalPrompt, true);

          // Clean up
          fs.unlink(outputPath, () => {
            console.log(`🧹 Cleaned up: ${outputPath}`);
          });

          await sendTelegramMessage(chatId, `✅ *Image generated successfully!*\n\nYour image has also been shared in our channel. 📢`);

        } catch (error) {
          console.error("Image generation error:", error.message);
          await sendTelegramMessage(chatId, `❌ *Error generating image*\n\nSorry, something went wrong. Please try again with a different prompt.`);
        }
        return res.status(200).send("OK");
      }

      // Handle regular text messages
      if (text && !text.startsWith('/')) {
        await sendTelegramMessage(chatId, `📖 *How to use this bot:*

🎬 *For Image-to-Video:*
• Send me any image (photo or document)
• Add optional caption for motion guidance
• I'll create an animated video!

🖼️ *For Image Generation:*
• Use: \`/image [your prompt]\`
• Example: \`/image a beautiful sunset over mountains\`

💡 *Tips:*
• Send photos with captions like "gentle wind", "flowing water"
• Use \`seed:123\` in captions for consistent results
• High quality images work best for animation

Try sending me an image or use \`/image\` command! 🚀`);
        return res.status(200).send("OK");
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
  console.log(`🔥 Enhanced Image-to-Video API running on http://localhost:${port}`);
  console.log(`🌐 Webhook URL: ${WEBHOOK_URL}`);
  console.log(`🎬 Image-to-Video APIs: ${VIDEO_APIS.length}`);
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
