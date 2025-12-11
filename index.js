import express from "express";
import axios from "axios";
import cron from "node-cron";
import process from "process";

const app = express();
app.use(express.json({ limit: "200kb" }));

// Discord webhook sätts i Railway variables
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";

// Veckans totalsummor och föregående veckas totalsummor
let userTotals = {};
let previousTotals = {};

function parseSynCounty(text) {
  const lines = ("" + text).split(/\r?\n/);

  let clan = "";
  let materials = 0;
  let discordId = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.toLowerCase().startsWith("clan name:")) {
      clan = line.split(":").slice(1).join(":").trim();
    }

    if (line.toLowerCase().includes("materials added")) {
      const m = line.match(/([\d]+(?:\.[\d]+)?)/);
      if (m) materials = parseFloat(m[1]);
    }

    if (line.toLowerCase().startsWith("discord:")) {
      const match = line.match(/(\d{17,20})/);
      if (match) discordId = match[1];
    }
  }

  return { clan, materials, discordId };
}

function addToTotals(discordId, amount) {
  if (!userTotals[discordId]) userTotals[discordId] = 0;
  userTotals[discordId] += amount;
}

app.post("/syn-county", async (req, res) => {
  try {
    const text = req.body.text || "";
    const { clan, materials, discordId } = parseSynCounty(text);

    if (!discordId) {
      console.log("Ingen discordId hittades:", text);
      return res.status(200).send("OK (no ID)");
    }

    addToTotals(discordId, materials);

    const current = userTotals[discordId];
    const previous = previousTotals[discordId] || 0;

    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title: "📦 Ny Material-Donation",
          description: `Clan: **${clan}**\nAnvändare: <@${discordId}>`,
          fields: [
            { name: "Senaste donation", value: String(materials), inline: true },
            { name: "Totalt denna vecka", value: String(current), inline: true },
            { name: "Föregående vecka", value: String(previous), inline: true }
          ],
          color: 3447003,
          timestamp: new Date().toISOString()
        }
      ]
    });

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Error");
  }
});

// AUTO RESET: Fredag 24:00 = Lördag 00:00
cron.schedule("0 0 * * 6", async () => {
  previousTotals = { ...userTotals };
  userTotals = {};

  await axios.post(DISCORD_WEBHOOK, {
    embeds: [
      {
        title: "🟢 Veckan är avslutad",
        description:
          "Totala summor har sparats som 'Föregående vecka'.\nNya summor börjar räknas nu!",
        timestamp: new Date().toISOString()
      }
    ]
  });

  console.log("Veckosummering sparad och reset utförd");
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Server kör på port", process.env.PORT || 3000)
);
