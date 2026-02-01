import express from "express";
import cors from "cors";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check (public)
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected routes - require API key

// Identify the user by phone number
app.post("/api/initCall", authenticateApiKey, async (req, res) => {
  const { caller_id } = req.body;

  if (!caller_id) return res.status(400).json({ error: "Missing caller_id" });

  console.log(caller_id);

  const { data, error } = await supabase
    .from("users")
    .select("first_name")
    .eq("phone_number", caller_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  let message;

  if (data) {
    message = `Welcome back, ${data.first_name}!`;
  } else {
    message = "Welcome, new user!";
  }

  res.json({
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      caller_id: caller_id,
    },
    conversation_config_override: {
      agent: {
        first_message: message,
      },
    },
  });
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
