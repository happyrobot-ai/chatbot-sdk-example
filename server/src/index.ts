import express from "express";
import cors from "cors";
import { HappyRobotClient } from "@happyrobot-ai/sdk";

const PORT = process.env.PORT ?? 3001;
const API_KEY = process.env.HAPPYROBOT_API_KEY;
const WORKFLOW_ID = process.env.WORKFLOW_ID;

if (!API_KEY) {
  console.error("Missing HAPPYROBOT_API_KEY environment variable");
  process.exit(1);
}

if (!WORKFLOW_ID) {
  console.error("Missing WORKFLOW_ID environment variable");
  process.exit(1);
}

const client = new HappyRobotClient({ apiKey: API_KEY });

const app = express();
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());

/**
 * POST /api/chat/token
 *
 * Creates a scoped chat token for the browser client.
 * The browser never sees the API key — only a short-lived token.
 */
app.post("/api/chat/token", async (_req, res) => {
  try {
    const { token, expires_at } = await client.chat.createToken({
      workflow_id: WORKFLOW_ID,
    });
    res.json({ token, expires_at });
  } catch (err) {
    console.error("Failed to create chat token:", err);
    res.status(500).json({ error: "Failed to create chat token" });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Workflow: ${WORKFLOW_ID}`);
});
