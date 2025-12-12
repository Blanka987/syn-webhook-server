import express from "express";
import bodyParser from "body-parser";
import axios from "axios";

const app = express();
app.use(bodyParser.json());

const DISCORD_FORWARD_WEBHOOK = process.env.DISCORD_FORWARD_WEBHOOK;

function extractDonationAmount(text) {
  const m1 = text.match(/Materials added:? ([0-9.]+)/i);
  const m2 = text.match(/worth ([0-9.]+)/i);
  return m1?.[1] || m2?.[1] || null;
}

function extractUserId(text) {
  const m = text.match(/<@(\d+)>/);
  return m ? m[1] : null;
}

app.post("/syn-county", async (req, res) => {
  const { text, embeds } = req.body;

  if (!embeds || embeds.length === 0) return res.sendStatus(200);

  for (const embed of embeds) {
    const title = embed.title || "";
    const desc = embed.description || "";

    const fullText = `${title}\n${desc}`;

    console.log("Incoming webhook:");
    console.log(fullText);

    const amount = extractDonationAmount(fullText);
    const userId = extractUserId(fullText);

    if (!amount || !userId) {
      console.log("❌ Missing amount or userId");
      continue;
    }

    try {
      await axios.post(DISCORD_FORWARD_WEBHOOK, {
        content: `📦 **Donation:** <@${userId}> added **${amount}** materials.`
      });
      console.log("✔ Processed donation:", amount);
    } catch (err) {
      console.log("❌ Discord send failed:", err.message);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Syn County webhook server running.");
  console.log("Webhook ENV:", `"${process.env.DISCORD_WEBHOOK}"`);

});
