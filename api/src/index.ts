import express from "express";
import cors from "cors";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";

const app = express();
const PORT = process.env.PORT || 3001;

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
  const { phoneNumber } = req.body;
  const { data, error } = await supabase
    .from("users")
    .select("first_name")
    .eq("phone_number", phoneNumber)
    .maybeSingle();

  console.log(data);
  console.log(phoneNumber);

  if (error) return res.status(500).json({ error: error.message });

  if (data) {
    res.json({ message: `Welcome back, ${data.first_name}!` });
  } else {
    res.json({ message: "Welcome, new user!" });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
