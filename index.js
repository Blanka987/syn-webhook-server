import express from "express";
import axios from "axios";
import cron from "node-cron";
import process from "process";

const app = express();
app.use(express.json({ limit: "200kb" }));

// Discord webhook stored in Railway Variables
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

// Weekly and previous totals
let userTotals = {};
let previousTotals = {};


// -------------------------------------------------------------
// PARSE SYN COUNTY WEBHOOK TEXT
// -------------------------------------------------------------
function parseSynCounty(text) {
  const lines = ("" + text).split(/\r?\n/);

  let clan = "";
  let materials = 0;
  let discordId = "";

  for (const raw of lines) {
    const line = raw.trim().toLowerCase();

    // Extract clan name
    if (line.startsWith("clan name:")) {
      clan = raw.split(":")[1].trim();
    }

    // Extract material amount
    if (line.includes("materials added")) {
      const m = raw.match(/([\d]+(?:\.[\d]+)?)/);
      if (m) materials = parseFloat(m[1]);
    }

    // Extract Discord ID (17–20 digits)
    if (line.startsWith("discord:")) {
      const match = raw.match(/(\d{17,20})/);
      if (match) discordId = match[1];
    }
  }

  return { clan, materials, discordId };
}


// -------------------------------------------------------------
// ADD TO WEEKLY TOTALS
// -------------------------------------------------------------
function addToTotals(discordId, amount) {
  if (!userTotals[discordId]) userTotals[discordId] = 0;
  userTotals[discordId] += amount;
}


// -------------------------------------------------------------
// DISCORD-COMPATIBLE WEBHOOK ROUTE (SYN COUNTY WILL ACCEPT THIS)
// Looks like a real Discord webhook: /api/webhooks/:id/:token
// -------------------------------------------------------------
app.post("/api/webhooks/:id/:token", async (req, res) => {
  req.url = "/syn-county";      // Forward request internally
  app._router.handle(req, res); // Reuse our real handler
});


// -------------------------------------------------------------
// MAIN WEBHOOK ENDPOINT USED INTERNALLY
// -------------------------------------------------------------
app.post("/syn-county", async (req, res) => {
  try {
    const text = req.body.text || "";
    const { clan, materials, discordId } = parseSynCounty(text);

    if (!discordId) {
      console.log("❗ No Discord ID found in webhook:", text);
      return res.status(200).send("OK (no ID)");
    }

    addToTotals(discordId, materials);

    const current = userTotals[discordId];
    const previous = previousTotals[discordId] || 0;

    // Send embed to Discord
    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title: "📦 New Material Donation",
          description: `Clan: **${clan}**\nUser: <@${discordId}>`,
          fields: [
            { name: "Last Donation", value: `${materials}`, inline: true },
            { name: "Total This Week", value: `${current}`, inline: true },
            { name: "Previous Week", value: `${previous}`, inline: true }
          ],
          color: 3447003,
          timestamp: new Date().toISOString()
        }
      ]
    });

    res.send("OK");
  } catch (err) {
    console.error("Error in /syn-county:", err);
    res.status(500).send("Server error");
  }
});


// -------------------------------------------------------------
// AUTO-RESET FRIDAY 24:00 (SATURDAY 00:00)
// -------------------------------------------------------------
cron.schedule("0 0 * * 6", async () => {
  console.log("🔄 Weekly auto-reset running...");

  previousTotals = { ...userTotals };
  userTotals = {};

  await axios.post(DISCORD_WEBHOOK, {
    embeds: [
      {
        title: "🟢 Weekly Reset Complete",
        description:
          "This week's totals have been stored as **Previous Week**. New totals start now!",
        timestamp: new Date().toISOString(),
        color: 15844367
      }
    ]
  });

  console.log("✔ Weekly reset done");
});


// -------------------------------------------------------------
// HEALTH CHECK (optional)
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Syn County Webhook Server is running 🚀");
});


// -------------------------------------------------------------
// START SERVER
// -------------------------------------------------------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on port", PORT));
