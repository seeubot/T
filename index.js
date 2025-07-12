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

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = "@requestsids";

if (!TELEGRAM_BOT_TOKEN) {
  console.error("💀 TELEGRAM_BOT_TOKEN is missing. Go check your .env.");
  process.exit(1);
}

const bannedIPs = new Set();

app.use(requestIp.mw());

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

async function notifyBanToTelegram(ip, originalPrompt) {
  const censoredPrompt = leoProfanity.clean(originalPrompt, '*'); // mask bad words
  const text = `🚫 *Blocked Request Alert!*\n\n*IP:* \`${ip}\`\n*Prompt:* \`${censoredPrompt}\``;

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    chat_id: TELEGRAM_CHAT_ID,
    text: text,
    parse_mode: "Markdown",
  });
}

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
    outputPath = path.join(__dirname, filename);

    await downloadWithFFmpeg(m3u8Url, outputPath);

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

app.listen(port, () => {
  console.log(`🔥 API running on http://localhost:${port}`);
});
