// server.js
import express from "express";
import { WebSocketServer } from "ws";
import cors from "cors";
import os from "os";
import http from "http";

const app = express();
app.use(cors());
app.use(express.json());

const fetch = globalThis.fetch;

const PORT = process.env.TABSYNC_PORT
  ? parseInt(process.env.TABSYNC_PORT)
  : 3210;
let WSPORT;

/** --- Device store --- **/
const devices = {}; // { deviceId: { tabs: [], lastSeen: number } }
const CLEANUP_INTERVAL = 60 * 1000; // every minute
const DEVICE_TIMEOUT = 5 * 60 * 1000; // 5 minutes

/** --- Utility: Get local IP --- **/
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return "localhost";
}

/** --- Utility: Fetch title from URL --- **/
async function fetchTitle(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) throw new Error("Non-200 response");
    const text = await res.text();
    const match = text.match(/<title>(.*?)<\/title>/i);
    return match ? match[1].trim() : new URL(url).hostname;
  } catch {
    try {
      return new URL(url).hostname; // fallback to domain
    } catch {
      return url;
    }
  }
}

/** --- Utility: Simplify devices object for clients --- **/
function simplify(devices) {
  const result = {};
  for (const [id, data] of Object.entries(devices)) {
    result[id] = data.tabs;
  }
  return result;
}

/** --- Broadcast to all connected clients --- **/
function broadcast() {
  const payload = JSON.stringify(simplify(devices));
  wss.clients.forEach((c) => {
    if (c.readyState === 1) c.send(payload);
  });
}

/** --- Cleanup inactive devices periodically --- **/
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [id, device] of Object.entries(devices)) {
    if (now - device.lastSeen > DEVICE_TIMEOUT) {
      delete devices[id];
      removed++;
    }
  }
  if (removed > 0) {
    console.log(`🧹 Cleaned ${removed} inactive device(s).`);
  }
}, CLEANUP_INTERVAL);

/** --- WebSocket server (dynamic port) --- **/
const wsServer = http.createServer();
let wss;
wsServer.listen(0, () => {
  WSPORT = wsServer.address().port;
  wss = new WebSocketServer({ server: wsServer });

  wss.on("connection", (ws) => {
    ws.on("message", async (msg) => {
      try {
        const data = JSON.parse(msg);
        const { deviceId, tabs } = data;

        if (!deviceId || !Array.isArray(tabs) || tabs.length === 0) return;

        // Deduplicate by URL
        const seen = new Set();
        const processedTabs = [];

        for (const tab of tabs) {
          if (!tab.url || seen.has(tab.url)) continue;
          seen.add(tab.url);

          const title =
            !tab.title || tab.title === tab.url
              ? await fetchTitle(tab.url)
              : tab.title;

          processedTabs.push({ title, url: tab.url });
        }

        devices[deviceId] = {
          tabs: processedTabs,
          lastSeen: Date.now(),
        };

        broadcast();
      } catch (err) {
        console.error("❌ WS parse error:", err.message);
      }
    });

    ws.send(JSON.stringify(simplify(devices)));
  });

  /** --- Express endpoints --- **/
  app.use(express.static("renderer"));

  app.get("/devices", (req, res) => res.json(simplify(devices)));

  app.post("/add", async (req, res) => {
    try {
      const { deviceId, url } = req.body;
      if (!deviceId || !url)
        return res.status(400).json({ error: "Missing fields" });

      const title = await fetchTitle(url);
      if (!devices[deviceId]) {
        devices[deviceId] = { tabs: [], lastSeen: Date.now() };
      }

      const exists = devices[deviceId].tabs.some((t) => t.url === url);
      if (!exists) {
        devices[deviceId].tabs.push({ title, url });
        devices[deviceId].lastSeen = Date.now();
        broadcast();
      }

      res.json({ success: true, title });
    } catch (err) {
      console.error("Error adding URL:", err.message);
      res.status(500).json({ error: "Failed to add URL" });
    }
  });

  // Get local IP + WS port
  app.get("/ip", (req, res) => {
    res.json({ ip: getLocalIP(), wsPort: WSPORT });
  });

  app.listen(PORT, "0.0.0.0", () => {
    const ip = getLocalIP();
    const url = `http://${ip}:${PORT}`;

    console.log(`SERVER_READY:${url}`); // 👈 Add this line
    console.log(`\n🧩 TabSync Local running at: ${url}`);
    console.log(`🌐 WebSocket on ws://${ip}:${WSPORT}`);
  });
});
