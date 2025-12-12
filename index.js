import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const DISCORD_FORWARD_WEBHOOK = process.env.DISCORD_FORWARD_WEBHOOK;

function isRealDonation(text) {
    return (
        text.includes("Materials added") ||
        text.includes("worth") ||
        text.includes("added:")
    );
}

function extractUserId(text) {
    const match = text.match(/<@(\d+)>/);
    return match ? match[1] : null;
}

function extractDonationAmount(text) {
    const m1 = text.match(/Materials added:\s*([0-9.]+)/i);
    const m2 = text.match(/worth\s*([0-9.]+)/i);

    return m1?.[1] || m2?.[1] || null;
}

app.post("/syn-county", async (req, res) => {
    try {
        const embeds = req.body.embeds || [];
        if (!embeds.length) return res.sendStatus(200);

        for (const embed of embeds) {
            const title = embed.title || "";
            const description = embed.description || "";

            const fullText = `${title}\n${description}`;

            console.log("Incoming webhook:");
            console.log("Title:", title);
            console.log(description);

            // 🔥 Ignore non-donation summary embeds
            if (!isRealDonation(fullText)) {
                console.log("⚠ Ignored non-donation embed.");
                continue;
            }

            const userId = extractUserId(fullText);
            const amount = extractDonationAmount(fullText);

            if (!amount) {
                console.log("❗ No donation amount found, skipping.");
                continue;
            }

            // Build message for Discord webhook
            const msg = {
                content: `**Donation processed:** <@${userId}> donated **${amount}**`
            };

            try {
                await axios.post(DISCORD_FORWARD_WEBHOOK, msg);
                console.log(`Processed donation: ${amount} for ${userId}`);
            } catch (err) {
                console.log("❗ Failed sending embed:", err.message);
            }
        }

        res.sendStatus(200);
    } catch (err) {
        console.log("Server error:", err.message);
        res.sendStatus(500);
    }
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Syn County webhook server running.");
});
