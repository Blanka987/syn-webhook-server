import express from "express";
import axios from "axios";
import bodyParser from "body-parser";
import fs from "fs";

const app = express();
app.use(bodyParser.json());

const WEBHOOK = process.env.DISCORD_WEBHOOK;

// Load or initialize storage
let db = { users: {}, previousWeek: {} };
if (fs.existsSync("data.json")) {
    try {
        db = JSON.parse(fs.readFileSync("data.json"));
    } catch (e) {
        console.error("Failed to load data.json, starting new DB.");
    }
}

// Save function
function saveDB() {
    fs.writeFileSync("data.json", JSON.stringify(db, null, 2));
}

// Extract numeric ID (18–20 digits)
function extractDiscordId(text) {
    const match = text.match(/\b\d{17,20}\b/);
    return match ? match[0] : null;
}

// Extract material amount
function extractAmount(text) {
    const match = text.match(/(?:Materials added|worth)\s*[: ]\s*([\d.]+)/i);

    if (!match) return 0;
    return parseFloat(match[1]);
}

// Extract clan
function extractClan(text) {
    const match = text.match(/Clan Name:\s*([A-Za-z0-9_]+)/i);
    return match ? match[1] : "Unknown";
}

app.post("/syn-county", async (req, res) => {
    const text = req.body.text || "";
    console.log("Incoming webhook:\n" + text);

    // 1. Get Discord ID
    const discordId = extractDiscordId(text);
    if (!discordId) {
        console.log("! No Discord ID found in webhook!");
        return res.status(400).send("Missing Discord ID");
    }

    // 2. Get donation
    const amount = extractAmount(text);

    // 3. Get clan
    const clan = extractClan(text);

    // Initialize user
    if (!db.users[discordId]) {
        db.users[discordId] = {
            clan,
            totalWeek: 0
        };
    }

    db.users[discordId].clan = clan;
    db.users[discordId].totalWeek += amount;

    saveDB();

    const userTotal = db.users[discordId].totalWeek;
    const prev = db.previousWeek[discordId] || 0;

    // Send embed to Discord
    try {
        await axios.post(WEBHOOK, {
            embeds: [
                {
                    title: "📦 New Material Donation",
                    color: 0xffcc00,
                    fields: [
                        { name: "Clan", value: clan, inline: true },
                        { name: "User", value: `<@${discordId}>`, inline: true },
                        { name: "Last Donation", value: amount.toString(), inline: false },
                        {
                            name: "Totals",
                            value: `This Week: **${userTotal}**\nPrevious Week: **${prev}**`,
                            inline: false
                        }
                    ],
                    timestamp: new Date().toISOString()
                }
            ]
        });

        console.log(`Processed donation: ${amount} for ${discordId}`);

        res.send("OK");
    } catch (e) {
        console.error("Failed sending embed:", e.message);
        res.status(500).send("Failed");
    }
});

// Weekly reset every Friday at 00:00
setInterval(() => {
    const date = new Date();
    const isFriday = date.getDay() === 5;
    const isMidnight = date.getHours() === 0 && date.getMinutes() === 0;

    if (isFriday && isMidnight) {
        console.log("Weekly reset triggered.");

        // Move totals to previousWeek
        for (const id in db.users) {
            db.previousWeek[id] = db.users[id].totalWeek;
            db.users[id].totalWeek = 0;
        }

        saveDB();
    }
}, 60 * 1000); // Check every minute

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Syn webhook server running on port", PORT));
