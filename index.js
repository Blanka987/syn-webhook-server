import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

// Load ENV
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

console.log("Syn County webhook server running.");
console.log("DISCORD_WEBHOOK =", DISCORD_WEBHOOK);

// ---------------------------
//  Extract text from ANY format
// ---------------------------
function extractText(body) {
    if (!body) return "";

    // Format A: { text: "..." }
    if (body.text) return body.text;

    // Format B: { content: "..." }
    if (body.content) return body.content;

    // Format C: Webhook embed
    if (body.embeds && body.embeds.length > 0) {
        let e = body.embeds[0];

        let combined = "";
        if (e.title) combined += e.title + "\n";
        if (e.description) combined += e.description + "\n";

        if (e.fields) {
            for (let f of e.fields) {
                combined += `${f.name}: ${f.value}\n`;
            }
        }

        return combined.trim();
    }

    // Format D: raw JSON converted to string
    if (typeof body === "string") return body;

    return "";
}

// ---------------------------
//  Parse donation data
// ---------------------------
function parseSynCounty(text) {
    if (!text) return null;

    let clan = null;
    let donation = null;
    let id = null;
    let discordId = null;

    const lines = text.split("\n").map(l => l.trim());

    for (const line of lines) {
        if (line.startsWith("Clan Name:")) {
            clan = line.replace("Clan Name:", "").trim();
        }

        if (line.startsWith("Donated")) {
            donation = line.replace("Donated", "").trim();
            const idMatch = line.match(/ID[: ]+(\d+)/);
            if (idMatch) id = idMatch[1];
        }

        if (line.startsWith("Discord:")) {
            const d = line.match(/<@(\d+)>/);
            if (d) discordId = d[1];
        }
    }

    return { clan, donation, id, discordId };
}

// ---------------------------
//  Handle Syn County Webhook
// ---------------------------
app.post("/syn-county", async (req, res) => {
    console.log("Incoming webhook:");
    console.log("RAW BODY:", JSON.stringify(req.body, null, 2));

    try {
        const text = extractText(req.body);

        console.log("Extracted text:");
        console.log(text);

        const parsed = parseSynCounty(text);

        if (!parsed || !parsed.clan || !parsed.donation) {
            console.log("❌ Parsing failed, missing fields.");
            return res.sendStatus(200);
        }

        console.log("Parsed donation:", parsed);

        if (!DISCORD_WEBHOOK) {
            console.log("❌ No DISCORD_WEBHOOK env set.");
            return res.sendStatus(200);
        }

        // Build embed for Discord
        const embed = {
            title: "📦 New Material Donation",
            color: 0x2ecc71,
            fields: [
                { name: "Clan", value: parsed.clan || "Unknown" },
                { name: "Donation", value: parsed.donation || "-" },
                { name: "Discord User", value: parsed.discordId ? `<@${parsed.discordId}>` : "Unknown" },
                { name: "ID", value: parsed.id || "-" }
            ],
            timestamp: new Date()
        };

        console.log("Sending embed to Discord...");

        await axios.post(DISCORD_WEBHOOK, { embeds: [embed] });

        console.log("✔ Successfully sent to Discord");

        res.sendStatus(200);

    } catch (err) {
        console.log("❌ Discord send failed:", err.message);
        res.sendStatus(200);
    }
});

// ---------------------------
//  Start Server
// ---------------------------
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
