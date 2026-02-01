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

// Webhook for cron job to trigger reminder calls
app.get("/api/webhook/reminder", authenticateApiKey, async (req, res) => {
  const { id } = req.query;

  if (!id) {
    return res.status(400).json({ error: "Missing reminder ID" });
  }

  try {
    // Fetch reminder from database
    const { data: reminder, error: dbError } = await supabase
      .from("reminders")
      .select("phone_number, text")
      .eq("id", id)
      .single();

    if (dbError || !reminder) {
      console.error("Database error:", dbError);
      return res.status(404).json({ error: "Reminder not found" });
    }

    // Make the call
    const response = await fetch(
      "https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
      {
        method: "POST",
        headers: {
          "xi-api-key": process.env.ELEVENLABS_API_KEY || "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agent_id: process.env.ELEVENLABS_AGENT_ID,
          agent_phone_number_id: process.env.ELEVENLABS_PHONE_ID,
          to_number: reminder.phone_number,
          conversation_initiation_client_data: {
            dynamic_variables: {
              reason: reminder.text,
            },
            conversation_config_override: {
              agent: {
                first_message: reminder.text,
                prompt: {
                  prompt:
                    "You are calling to deliver one short reminder message, confirm the user heard it, then politely end the call. Speak in Czech.",
                },
              },
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("ElevenLabs error:", errorText);
      return res.status(500).json({ error: "Failed to make call" });
    }

    res.json({ message: "Call initiated successfully" });
  } catch (error) {
    console.error("Error making call:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Identify the user by phone number
app.post("/api/initCall", authenticateApiKey, async (req, res) => {
  const { caller_id } = req.body;

  if (!caller_id) return res.status(400).json({ error: "Missing caller_id" });

  console.log(caller_id);

  const { data, error } = await supabase
    .from("users")
    .select("nickname_vocative")
    .eq("phone_number", caller_id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  let message;

  if (data) {
    message = `Vítej zpět, ${data.nickname_vocative}!`;
  } else {
    message = "Ahoj, tady DigiPřítel, jak se jmenuješ ty?";
    await supabase.from("users").insert({ phone_number: caller_id });
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

// Update user's first name
app.post("/api/updateFirstName", authenticateApiKey, async (req, res) => {
  const { caller_id, first_name, first_name_vocative } = req.body;

  if (!caller_id || !first_name || !first_name_vocative)
    return res
      .status(400)
      .json({ error: "Missing caller_id, first_name, or first_name_vocative" });

  const { error } = await supabase
    .from("users")
    .update({
      first_name: first_name,
      first_name_vocative: first_name_vocative,
    })
    .eq("phone_number", caller_id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: "Name updated successfully" });
});

// Update user's nickname
app.post("/api/updateNickname", authenticateApiKey, async (req, res) => {
  const { caller_id, nickname, nickname_vocative } = req.body;

  if (!caller_id || !nickname || !nickname_vocative)
    return res
      .status(400)
      .json({ error: "Missing caller_id, nickname, or nickname_vocative" });

  const { error } = await supabase
    .from("users")
    .update({ nickname: nickname, nickname_vocative: nickname_vocative })
    .eq("phone_number", caller_id);

  if (error) return res.status(500).json({ error: error.message });

  res.json({ message: "Nickname updated successfully" });
});

// Create a reminder
app.post("/api/createReminder", authenticateApiKey, async (req, res) => {
  const {
    caller_id,
    reminder_text,
    time_hour,
    time_minute,
    date,
    end_date,
    frequency,
    weekdays,
  } = req.body;

  // Validate required fields with detailed error messages
  if (!caller_id) {
    return res.status(400).json({ error: "Missing caller_id" });
  }
  if (!reminder_text) {
    return res.status(400).json({ error: "Missing reminder_text" });
  }
  if (time_hour === undefined || time_hour === null) {
    return res.status(400).json({ error: "Missing time_hour" });
  }
  if (time_minute === undefined || time_minute === null) {
    return res.status(400).json({ error: "Missing time_minute" });
  }
  if (!date) {
    return res.status(400).json({ error: "Missing date" });
  }
  if (!frequency) {
    return res.status(400).json({ error: "Missing frequency" });
  }

  // Build schedule based on frequency
  const reminderDate = new Date(date);

  // Format expiresAt as YYYYMMDDhhmmss (cron-job.org format)
  const formatExpiresAt = (date: Date): number => {
    if (!date || date.getTime() <= 0) return 0;
    const d = new Date(date);
    d.setHours(23, 59, 59, 999); // End of day
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hour = String(d.getHours()).padStart(2, "0");
    const minute = String(d.getMinutes()).padStart(2, "0");
    const second = String(d.getSeconds()).padStart(2, "0");
    return parseInt(`${year}${month}${day}${hour}${minute}${second}`);
  };

  // For "once": no expiration needed
  // For recurring with end_date: use end_date
  // For recurring without end_date: no expiration (runs indefinitely)
  let expiresAt = 0;
  if (frequency !== "once" && end_date) {
    const endDate = new Date(end_date);
    expiresAt = formatExpiresAt(endDate);
  }

  const base = {
    timezone: "Europe/Prague",
    hours: [parseInt(time_hour)],
    minutes: [parseInt(time_minute)],
  };

  const schedules = {
    once: {
      ...base,
      mdays: [reminderDate.getDate()],
      months: [reminderDate.getMonth() + 1],
      wdays: [-1],
    },
    daily: { ...base, expiresAt, mdays: [-1], months: [-1], wdays: [-1] },
    weekly: {
      ...base,
      expiresAt,
      mdays: [-1],
      months: [-1],
      wdays: weekdays || [reminderDate.getDay()],
    },
    monthly: {
      ...base,
      expiresAt,
      mdays: [reminderDate.getDate()],
      months: [-1],
      wdays: [-1],
    },
    yearly: {
      ...base,
      expiresAt,
      mdays: [reminderDate.getDate()],
      months: [reminderDate.getMonth() + 1],
      wdays: [-1],
    },
  };

  const schedule = schedules[frequency as keyof typeof schedules];
  if (!schedule) {
    return res.status(400).json({
      error: "Invalid frequency. Use: once, daily, weekly, monthly, or yearly",
    });
  }

  try {
    // First, save reminder to database
    const { data: newReminder, error: insertError } = await supabase
      .from("reminders")
      .insert({
        phone_number: caller_id,
        text: reminder_text,
        time_hour: time_hour,
        time_minute: time_minute,
        date: date,
        end_date: end_date || null,
        frequency: frequency,
        weekdays: weekdays ? weekdays.join(",") : null,
      })
      .select()
      .single();

    if (insertError || !newReminder) {
      console.error("Database error:", insertError);
      return res.status(500).json({ error: "Failed to create reminder" });
    }

    // Get the deployed API URL from environment
    const apiUrl =
      process.env.API_URL || "https://api-nameless-water-1932.fly.dev";

    // Create cron job on cron-job.org that calls our webhook with the reminder ID
    const cronJobResponse = await fetch("https://api.cron-job.org/jobs", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.CRONJOB_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job: {
          enabled: true,
          title: `Reminder for ${caller_id}: ${reminder_text}`,
          saveResponses: true,
          url: `${apiUrl}/api/webhook/reminder?id=${newReminder.id}`,
          requestMethod: 0, // GET
          extendedData: {
            headers: {
              Authorization: `Bearer ${process.env.API_KEY}`,
            },
          },
          schedule: schedule,
        },
      }),
    });

    if (!cronJobResponse.ok) {
      const errorData = await cronJobResponse.text();
      console.error("Cron-job.org error:", errorData);
      return res.status(500).json({ error: "Failed to create cron job" });
    }

    const cronJobData = await cronJobResponse.json();
    const cronJobId = cronJobData.jobId;

    // Update reminder with cron job ID
    await supabase
      .from("reminders")
      .update({ cron_job_id: cronJobId })
      .eq("id", newReminder.id);

    res.json({
      message: "Reminder created successfully",

      reminder_id: newReminder.id,
      cron_job_id: cronJobId,
    });
  } catch (error) {
    console.error("Error creating reminder:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
