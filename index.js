import express from "express";
import axios from "axios";
import cron from "node-cron";
import process from "process";

const app = express();
app.use(express.json({ limit: "200kb" }));

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

let userTotals = {};
let previousTotals = {};

function parseSynCountyMessage(text) {
  const lines = ("" + text).split(/\r?\n/);
  let clan = "";
  let materials = 0;
  let discordId = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.toLowerCase().startsWith("clan name:")) {
      clan = line.split(":").slice(1).join(":").trim();
    } else if (/Donated Ram/i.test(line) || /Materials added/i.test(line)) {
      const m = line.match(/([\d]+(?:\.[\d]+)?)/);
      if (m) materials = parseFloat(m[1]);
    } else if (line.toLowerCase().startsWith("discord:")) {
      const match = line.match(/(\d{17,20})/);
      if (match) discordId = match[1];
    }
  }
  return { clan, materials, discordId };
}

function addToTotals(discordId, amount) {
  if (!discordId) return;
  if (!userTotals[discordId]) userTotals[discordId] = 0;
  userTotals[discordId] += amount;
}

function verifySecret(req) {
  if (!WEBHOOK_SECRET) return true;
  const header = req.headers["x-webhook-secret"];
  return header === WEBHOOK_SECRET;
}

app.post("/syn-county", async (req, res) => {
  try {
    if (!verifySecret(req)) return res.status(401).send("Unauthorized");

    const text = req.body.text || JSON.stringify(req.body);
    const { clan, materials, discordId } = parseSynCountyMessage(text);

    if (!discordId) return res.status(400).send("Missing discord id");

    addToTotals(discordId, materials);

    const previous = previousTotals[discordId] || 0;
    const current = userTotals[discordId] || 0;

    await axios.post(DISCORD_WEBHOOK, {
      embeds: [
        {
          title: "📦 Ny Material-Donation",
          description: `Clan: **${clan}**\nUser: <@${discordId}>`,
          fields: [
            { name: "Senaste donation", value: String(materials), inline: true },
            { name: "Totalt denna vecka", value: String(current), inline: true },
            { name: "Föregående vecka", value: String(previous), inline: true }
          ],
          timestamp: new Date().toISOString()
        }
      ]
    });

    res.send("OK");
  } catch (err) {
    console.error(err);
    res.status(500).send("Server error");
  }
});

// AUTO RESET — Fredag 24:00 = Lördag 00:00
cron.schedule("0 0 * * 6", async () => {
  previousTotals = { ...userTotals };
  userTotals = {};

  await axios.post(DISCORD_WEBHOOK, {
    embeds: [
      {
        title: "🟢 Veckosummering sparad!",
        description: "Alla totalsummor sparade som föregående vecka. Ny vecka startad.",
        timestamp: new Date().toISOString()
      }
    ]
  });

  console.log("Veckosummering klar + reset utförd.");
});

app.get("/", (req, res) => {
  res.send("Server running.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server listening on port " + PORT));
