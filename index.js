// index.js
import express from "express";
import fs from "fs";
import path from "path";
import axios from "axios";
import cron from "node-cron";

const app = express();
app.use(express.json({ limit: "1mb" }));

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK; // where the server posts summaries
const ADMIN_SECRET = process.env.ADMIN_SECRET || ""; // used by bot to call /admin/reset

// data file
const DB_FILE = path.join(process.cwd(), "database.json");

// default db shape
let db = {
  users: {
    // "<discordId>": { thisWeek: 0.0, previousWeek: 0.0 }
  }
};

// load DB
function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf8");
      db = JSON.parse(raw);
    } else {
      saveDB();
    }
  } catch (e) {
    console.error("Failed to load DB:", e.message);
  }
}

// save DB
function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// helpers
function toNumber(x) {
  const v = parseFloat(String(x).replace(",", "."));
  return isNaN(v) ? 0 : v;
}

function addDonation(discordId, amount) {
  if (!discordId) return;
  if (!db.users[discordId]) db.users[discordId] = { thisWeek: 0, previousWeek: 0 };
  db.users[discordId].thisWeek = +(db.users[discordId].thisWeek + amount).toFixed(4);
  saveDB();
}

function getUserTotals(discordId) {
  const u = db.users[discordId] || { thisWeek: 0, previousWeek: 0 };
  return { thisWeek: u.thisWeek || 0, previousWeek: u.previousWeek || 0 };
}

function getTop(n = 10) {
  const arr = Object.entries(db.users).map(([id, v]) => ({
    id,
    thisWeek: v.thisWeek || 0,
    previousWeek: v.previousWeek || 0
  }));
  arr.sort((a, b) => b.thisWeek - a.thisWeek);
  return arr.slice(0, n);
}

function resetWeek() {
  // move thisWeek -> previousWeek and zero thisWeek
  for (const id of Object.keys(db.users)) {
    db.users[id].previousWeek = db.users[id].thisWeek || 0;
    db.users[id].thisWeek = 0;
  }
  saveDB();
}

// parse text robustly (handles the common Syn County formats we've seen)
function parseText(text) {
  if (!text) return null;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  let clan = null;
  let discordId = null;
  let donation = null;
  let itemId = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (!clan && /^Clan Name:/i.test(line)) {
      clan = line.split(":").slice(1).join(":").trim();
    }

    // "Donated Ram (body) / Materials added: 1.25 ID: 2184"
    const matMatch = line.match(/Materials added[:\s]*([\d.,]+)/i);
    if (matMatch) {
      donation = matMatch[1];
    } else {
      // fallback to "worth 5.1"
      const worth = line.match(/worth[:\s]*([\d.,]+)/i);
      if (worth) donation = worth[1];
    }

    // extract ID: "ID: 2184"
    const itemMatch = line.match(/ID[:\s]*(\d+)/i);
    if (itemMatch) itemId = itemMatch[1];

    // discord: could be "<@123...> 123...", or "**Discord:** <@id> id", or "Discord: @Name 123"
    if (/Discord[:\s]/i.test(line) || /\*\*Discord\:\*\*/i.test(line) || /<@!?(\d{17,20})>/i.test(line)) {
      // prefer mention
      const m1 = line.match(/<@!?(\d{17,20})>/);
      if (m1) discordId = m1[1];
      // trailing numeric id fallback
      const m2 = line.match(/(\d{17,20})$/);
      if (!discordId && m2) discordId = m2[1];
      // "Discord: @Name 7032..." fallback
      const m3 = line.match(/Discord[:\s].*?(\d{17,20})/i);
      if (!discordId && m3) discordId = m3[1];
    }
  }

  // normalize donation number
  const amount = donation ? toNumber(donation) : 0;

  return { clan, donation: donation ? amount : 0, itemId, discordId, rawLines: lines };
}

// load DB on startup
loadDB();

console.log("Syn webhook server ready. DISCORD_WEBHOOK =", DISCORD_WEBHOOK ? "[set]" : "[MISSING]");
console.log("ADMIN_SECRET =", ADMIN_SECRET ? "[set]" : "[MISSING]");

// POST /syn-county : receives { text, embeds } forwarded by bot
app.post("/syn-county", async (req, res) => {
  try {
    // Accept either text, content or embeds payload
    let text = "";
    if (req.body.text) text = req.body.text;
    else if (req.body.content) text = req.body.content;
    else if (req.body.embeds && req.body.embeds.length) {
      const e = req.body.embeds[0];
      let combined = "";
      if (e.title) combined += e.title + "\n";
      if (e.description) combined += e.description + "\n";
      if (e.fields && Array.isArray(e.fields)) {
        for (const f of e.fields) {
          combined += `${f.name}: ${f.value}\n`;
        }
      }
      text = combined.trim();
    }

    console.log("Incoming webhook:");
    console.log(text);

    const parsed = parseText(text);
    console.log("Parsed:", parsed);

    // must have discordId and donation > 0 to be treated as donation
    if (!parsed || !parsed.discordId || !parsed.donation || parsed.donation <= 0) {
      console.log("Ignored (missing id or donation <= 0).");
      return res.sendStatus(200);
    }

    // persist
    addDonation(parsed.discordId, parsed.donation);

    const totals = getUserTotals(parsed.discordId);

    // Send stylish embed back to Discord
    if (DISCORD_WEBHOOK && DISCORD_WEBHOOK.startsWith("https://discord.com/api/webhooks/")) {
      const embed = {
        title: "📦 Material Donation Logged",
        color: 0x3498db,
        fields: [
          { name: "Clan", value: parsed.clan || "Unknown", inline: true },
          { name: "User", value: `<@${parsed.discordId}>`, inline: true },
          { name: "Donation", value: `${parsed.donation}`, inline: true },
          { name: "Total This Week", value: `${totals.thisWeek}`, inline: true },
          { name: "Previous Week", value: `${totals.previousWeek}`, inline: true }
        ],
        footer: { text: "Camp Tracker" },
        timestamp: new Date().toISOString()
      };

      try {
        await axios.post(DISCORD_WEBHOOK, { embeds: [embed] });
        console.log("Sent summary embed to Discord");
      } catch (e) {
        console.error("Failed sending embed:", e.message);
      }
    } else {
      console.warn("DISCORD_WEBHOOK not set or invalid; skipp sending back.");
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Error in /syn-county:", err && err.message ? err.message : err);
    res.sendStatus(500);
  }
});

// GET /stats/user/:id
app.get("/stats/user/:id", (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: "Missing id" });
  const u = getUserTotals(id);
  return res.json({ id, thisWeek: u.thisWeek, previousWeek: u.previousWeek });
});

// GET /stats/top?n=10
app.get("/stats/top", (req, res) => {
  const n = parseInt(String(req.query.n || "10"), 10) || 10;
  const top = getTop(n);
  return res.json({ top });
});

// POST /admin/reset  (protected by header x-admin-secret)
app.post("/admin/reset", (req, res) => {
  const secret = req.headers["x-admin-secret"] || "";
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: "Forbidden" });
  }

  // snapshot and reset
  const snapshot = JSON.parse(JSON.stringify(db.users));
  resetWeek();
  return res.json({ ok: true, previousWeekSnapshot: snapshot });
});

// Automatic weekly reset — Friday 24:00 -> Saturday 00:00
// node-cron format: minute hour day month weekday (0-6 Sun-Sat)
// Saturday 00:00 is: "0 0 * * 6"
cron.schedule("0 0 * * 6", async () => {
  console.log("Automatic weekly reset triggered (Saturday 00:00, Friday 24:00).");
  // snapshot
  const snapshot = JSON.parse(JSON.stringify(db.users));
  resetWeek();

  // optional: post a summary message to Discord that previous week was saved
  if (DISCORD_WEBHOOK && DISCORD_WEBHOOK.startsWith("https://discord.com/api/webhooks/")) {
    try {
      await axios.post(DISCORD_WEBHOOK, {
        content: "🟢 Weekly reset executed. Previous week totals are saved."
      });
    } catch (e) {
      console.error("Failed to notify Discord about weekly reset:", e.message);
    }
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server listening on port", PORT);
});
