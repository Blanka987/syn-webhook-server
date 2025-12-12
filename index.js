import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Load ENV variables
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

console.log("Syn County webhook server running.");
console.log("DISCORD_WEBHOOK =", DISCORD_WEBHOOK);

// Safety check
if (!DISCORD_WEBHOOK || !DISCORD_WEBHOOK.startsWith("https://discord.com/api/webhooks/")) {
    console.log("❌ ERROR: Invalid or missing DISCORD_WEBHOOK env variable.");
}

// Parse donation message from Syn County
function parseSynCounty(text) {
    if (!text) return null;

    let clan = null;
    let donation = null;
    let id = null;
    let discordId = null;

    const lines = text.split("\n").map(l => l.trim());

    for (const line of lines) {
        if (line.startsWith("Clan Name:")) clan = line.replace("Clan Name:", "").trim();

        if (line.startsWith("Donated")) {
            donation = line.replace("Donated", "").trim();
            const idMatch = line.match(/ID:\s*(\d+)/);
            if (idMatch) id = idMatch[1];
        }

        if (line.startsWith("Discord:")) {
            const discordMatch = line.match(/<@(\d+)>/);
            if (discordMatch) discordId = discordMatch[1];
        }
    }

    return { clan, donation, id, discordId };
}

// Incoming webhook from Syn County
app.post("/syn-county", async (req, res) => {
    try {
        const text = req.body.text || "";

        console.log("Incoming webhook:");
        console.log(text);

        const parsed = parseSynCounty(text);

        if (!parsed || !parsed.clan || !parsed.donation) {
            console.log("❌ Parsing failed, missing fields.");
            return res.sendStatus(200);
        }

        console.log("Parsed data:", parsed);

        if (!DISCORD_WEBHOOK) {
            console.log("❌ No webhook URL configured.");
            return res.sendStatus(200);
        }

        // Build Discord embed
        const embed = {
            title: `📦 New Material Donation`,
            color: 0x00ff99,
            fields: [
                { name: "Clan", value: parsed.clan || "Unknown", inline: false },
                { name: "Donation", value: parsed.donation || "-", inline: false },
                { name: "User", value: parsed.discordId ? `<@${parsed.discordId}>` : "Unknown", inline: false },
                { name: "ID", value: parsed.id || "-", inline: true }
            ],
            timestamp: new Date()
        };

        console.log("Sending embed to Discord webhook...");

        await axios.post(DISCORD_WEBHOOK, { embeds: [embed] });

        console.log("✔ Successfully sent to Discord");
        res.sendStatus(200);

    } catch (err) {
        console.log("❌ Discord send failed:", err.message);
        res.sendStatus(200);
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
