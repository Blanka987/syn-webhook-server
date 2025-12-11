import express from "express";
import axios from "axios";
import cron from "node-cron";
import process from "process";

const app = express();
app.use(express.json({ limit: "200kb" }));

// Discord webhook lagras i Railway → Variables → DISCORD_WEBHOOK
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

// Veckans totalsummor
let userTotals = {};

// Föregående veckas summor
let previousTotals = {};


// -------------------------------------------------------------
//   PARSER FÖR SYN COUNTY WEBHOOK TEXT
// -------------------------------------------------------------
function parseSynCounty(text) {
  const lines = ("" + text).split(/\r?\n/);

  let clan = "";
  let materials = 0;
  let discordId = "";

  for (const raw of lines) {
    const line = raw.trim().toLowerCase();

    // Hitta clan
    if (line.startsWith("clan name:")) {
      clan = raw.split(":")[1].trim();
    }

    // Hitta materialmängd
    if (line.includes("materials added")) {
      const m = raw.match(/([\d]+(?:\.[\d]+)?)/);
      if (m) materials = parseFloat(m[1]);
    }

    // Hitta Discord-ID (17–20 siffror)
    if (line.startsWith("discord:")) {
      const match = raw.match(/(\d{17,20})/);
      if (match) discordId = match[1];
    }
  }

  return { clan, materials, discordId };
}


// -------------------------------------------------------------
//   ADD TO TOTALS
// -------------------------------------------------------------
function addToTotals(discordId, amount) {
  if (!userTotals[discordId]) userTotals[discordId] = 0;
  userTotals[discordId] += amount;
}


// -------------------------------------------------------------
//   WEBHOOK ENDPOINT — Syn County POSTAR HIT
// -------------------------------------------------------------
app.post("/syn-county", async (req, res) => {
  try {
    const text = req.body.text || "";

    const { clan, materials, discordId } = parseSynCounty(text);

    if (!discordId) {
      console.log("❗ Ingen Discord-ID hittades i webhooken:", text);
      return res.status(200).send("OK (no ID)");
    }

    addToTotals(discordId, materials);

    const current = userTotals[discordId];
    const previous = previousTotals[discordId] || 0;

    // Skicka embed till Discord
    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title: "📦 Ny material-donation",
          description: `Clan: **${clan}**\nAnvändare: <@${discordId}>`,
          fields: [
            {
              name: "Senaste donation",
              value: `${materials}`,
              inline: true
            },
            {
              name: "Totalt denna vecka",
              value: `${current}`,
              inline: true
            },
            {
              name: "Föregående vecka",
              value: `${previous}`,
              inline: true
            }
          ],
          color: 3447003,
          timestamp: new Date().toISOString()
        }
      ]
    });

    res.send("OK");
  } catch (err) {
    console.error("Fel i /syn-county:", err);
    res.status(500).send("Server error");
  }
});


// -------------------------------------------------------------
//   AUTO-RESET FREDAG 24:00 (Lördag 00:00)
// -------------------------------------------------------------
cron.schedule("0 0 * * 6", async () => {
  console.log("🔄 Auto-reset körs...");

  // Flytta denna veckas summor till previousTotals
  previousTotals = { ...userTotals };

  // Nollställ veckans summor
  userTotals = {};

  // Skicka sammanfattning till Discord
  await axios.post(DISCORD_WEBHOOK, {
    embeds: [
      {
        title: "🟢 Veckan avslutad",
        description:
          "Veckans totalsummor har sparats som **'Föregående vecka'**.\nNya summor börjar räknas nu!",
        timestamp: new Date().toISOString(),
        color: 15844367
      }
    ]
  });

  console.log("✔ Reset klar");
});


// -------------------------------------------------------------
//   STANDARD ROOT ENDPOINT (för att testa att servern kör)
// -------------------------------------------------------------
app.get("/", (req, res) => {
  res.send("Webhook-servern körs 🚀");
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server lyssnar på port", PORT));
