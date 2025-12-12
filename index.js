import express from "express";
import axios from "axios";

const app = express();
app.use(express.json({ limit: "1mb" }));

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

console.log("Syn County webhook server running.");
console.log("DISCORD_WEBHOOK =", DISCORD_WEBHOOK);

// Extract ANY format of text:
function extractText(body) {
    if (!body) return "";

    if (body.text) return body.text;
    if (body.content) return body.content;

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

    return "";
}

// ---- FIXED PARSER (handles both ID formats) ---- //
function parseSynCounty(text) {
    if (!text) return null;

    let clan = null;
    let donation = null;
    let id = null;
    let discordId = null;

    const lines = text.split("\n").map(l => l.trim());

    for (const line of lines) {

        if (line.startsWith("Clan Name:"))
            clan = line.replace("Clan Name:", "").trim();

        if (line.startsWith("Donated")) {
            donation = line.replace("Donated", "").trim();
            const idMatch = line.match(/ID[: ]+(\d+)/);
            if (idMatch) id = idMatch[1];
        }

        if (line.startsWith("**Discord:**")) {
            // Match <@ID>
            let matchA = line.match(/<@(\d+)>/);
            if (matchA) discordId = matchA[1];

            // Match trailing ID
            let matchB = line.match(/(\d{17,20})$/);
            if (!discordId && matchB) discordId = matchB[1];
        }

        if (line.startsWith("Discord:")) {
            // Match <@ID>
            let matchA = line.match(/<@(\d+)>/);
            if (matchA) discordId = matchA[1];

            // Match trailing ID
            let matchB = line.match(/(\d{17,20})$/);
            if (!discordId && matchB) discordId = matchB[1];
        }
    }

    return { clan, donation, id, discordId };
}

app.post("/syn-county", async (req, res) => {
    console.log("Incoming webhook:");
    console.log("RAW BODY:", JSON.stringify(req.body, null, 2));

    try {
        const text = extractText(req.body);
        console.log("Extracted text:\n" + text);

        const parsed = parseSynCounty(text);
        console.log("Parsed donation:", parsed);

        if (!parsed || !parsed.clan || !parsed.donation || !parsed.discordId) {
            console.log("❌ Parsing failed, missing fields.");
            return res.sendStatus(200);
        }

        const embed = {
            title: "📦 New Material Donation",
            color: 0x2ecc71,
            fields: [
                { name: "Clan", value: parsed.clan },
                { name: "Donation", value: parsed.donation },
                { name: "Discord User", value: `<@${parsed.discordId}>` },
                { name: "ID", value: parsed.id }
            ],
            timestamp: new Date()
        };

        console.log("Sending embed to Discord...");

        await axios.post(DISCORD_WEBHOOK, { embeds: [embed] });

        console.log("✔ Successfully sent to Discord");
        res.sendStatus(200);

    } catch (err) {
        console.log("❌ Discord send failed:", err.message);
        return res.sendStatus(200);
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
