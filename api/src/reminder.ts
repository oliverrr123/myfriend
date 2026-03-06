import { app } from "./app";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";


// This is what the cron job runs to make the agent call you

app.get("/api/webhook/reminder", authenticateApiKey, async (req, res) => {
	const { id } = req.query;

	if (!id) {
		return res.status(400).json({ error: "Missing reminder ID" });
	}

	try {
		// Fetch reminder from database
		const { data: reminder, error: dbError } = await supabase
			.from("reminders")
			.select("phone_number, text, agent_phone_number, agent_id, frequency, end_date")
			.eq("id", id)
			.single();

		if (dbError || !reminder) {
			console.error("Database error:", dbError);
			return res.status(404).json({ error: "Reminder not found" });
		}

		// Check if reminder should be marked inactive (frequency is once, or end_date reached)
		let shouldDeactivate = false;
		if (reminder.frequency === "once") {
			shouldDeactivate = true;
		} else if (reminder.end_date) {
			const endDate = new Date(reminder.end_date);
			endDate.setHours(23, 59, 59, 999); // end of day
			if (new Date() >= endDate) {
				shouldDeactivate = true;
			}
		}

		if (shouldDeactivate) {
			await supabase
				.from("reminders")
				.update({ active: false })
				.eq("id", id);
		}

		const phoneMap = JSON.parse(process.env.PHONE_NUMBER_TO_ID_MAP || "{}");
		const agent_phone_number_id = phoneMap[reminder.agent_phone_number];

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
					agent_id: reminder.agent_id,
					agent_phone_number_id: agent_phone_number_id,
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


// Reminders CRUD


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
		agent_id,
		agent_phone_number,
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
				agent_id: agent_id,
				agent_phone_number: agent_phone_number,
				active: true,
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


// List reminders
app.get("/api/listReminders", authenticateApiKey, async (req, res) => {
	const caller_id = req.headers['caller_id'];

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}

	try {
		const { data: reminders, error: dbError } = await supabase
			.from("reminders")
			.select("*")
			.eq("phone_number", caller_id)
			.eq("active", true)
			.order("date", { ascending: true });

		if (dbError) {
			console.error("Database error:", dbError);
			return res.status(500).json({ error: "Failed to fetch reminders" });
		}

		res.json({ reminders: reminders || [] });
	} catch (error) {
		console.error("Error fetching reminders:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});


// Create a reminder
app.patch("/api/updateReminder", authenticateApiKey, async (req, res) => {
	var {
		caller_id,
		cron_job_id,
		reminder_text,
		time_hour,
		time_minute,
		date,
		end_date,
		frequency,
		weekdays,
	} = req.body;

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}
	if (!cron_job_id) {
		return res.status(400).json({ error: "Missing cron_job_id" });
	}

	try {
		const { data: reminder, error: dbError } = await supabase
			.from("reminders")
			.select("*")
			.eq("phone_number", caller_id)
			.eq("cron_job_id", cron_job_id)
			.single();

		if (dbError || !reminder) {
			console.error("Database error:", dbError);
			return res.status(404).json({ error: "Reminder not found" });
		}

		// Fill in any missing fields from the existing reminder
		if (!reminder_text) reminder_text = reminder.text;
		if (time_hour === undefined || time_hour === null) time_hour = reminder.time_hour;
		if (time_minute === undefined || time_minute === null) time_minute = reminder.time_minute;
		if (!date) date = reminder.date;
		if (!frequency) frequency = reminder.frequency;
		if (!end_date) end_date = reminder.end_date;
		if (!weekdays) weekdays = reminder.weekdays;
	} catch (error) {
		console.error("Error fetching reminder:", error);
		return res.status(500).json({ error: "Internal server error" });
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
		// Update reminder in database
		const { data: updatedReminder, error: updateError } = await supabase
			.from("reminders")
			.update({
				text: reminder_text,
				time_hour: time_hour,
				time_minute: time_minute,
				date: date,
				end_date: end_date || null,
				frequency: frequency,
				weekdays: weekdays ? weekdays.join(",") : null,
			})
			.eq("cron_job_id", cron_job_id)
			.eq("phone_number", caller_id)
			.select()
			.single();

		if (updateError || !updatedReminder) {
			console.error("Database error:", updateError);
			return res.status(500).json({ error: "Failed to update reminder" });
		}

		// Get the deployed API URL from environment
		const apiUrl =
			process.env.API_URL || "https://api-nameless-water-1932.fly.dev";

		// Update the existing cron job on cron-job.org using PATCH
		const cronJobResponse = await fetch(
			`https://api.cron-job.org/jobs/${cron_job_id}`,
			{
				method: "PATCH",
				headers: {
					Authorization: `Bearer ${process.env.CRONJOB_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					job: {
						title: `Reminder for ${caller_id}: ${reminder_text}`,
						url: `${apiUrl}/api/webhook/reminder?id=${updatedReminder.id}`,
						schedule: schedule,
					},
				}),
			}
		);

		if (!cronJobResponse.ok) {
			const errorData = await cronJobResponse.text();
			console.error("Cron-job.org error:", errorData);
			return res.status(500).json({ error: "Failed to update cron job" });
		}

		res.json({
			message: "Reminder updated successfully",
			reminder_id: updatedReminder.id,
			cron_job_id: cron_job_id,
		});
	} catch (error) {
		console.error("Error updating reminder:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});


// Delete a reminder
app.delete("/api/deleteReminder", authenticateApiKey, async (req, res) => {
	const {
		caller_id,
		cron_job_id
	} = req.query;

	// Validate required fields with detailed error messages
	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}
	if (!cron_job_id) {
		return res.status(400).json({ error: "Missing cron_job_id" });
	}

	try {
		// Delete reminder from database
		const { error: deleteError } = await supabase
			.from("reminders")
			.delete()
			.eq("cron_job_id", cron_job_id)
			.eq("phone_number", caller_id);

		if (deleteError) {
			console.error("Database error:", deleteError);
			return res.status(500).json({ error: "Failed to delete reminder" });
		}

		// Get the deployed API URL from environment
		const apiUrl =
			process.env.API_URL || "https://api-nameless-water-1932.fly.dev";

		// Create cron job on cron-job.org that calls our webhook with the reminder ID
		const cronJobResponse = await fetch("https://api.cron-job.org/jobs/" + cron_job_id, {
			method: "DELETE",
			headers: {
				Authorization: `Bearer ${process.env.CRONJOB_API_KEY}`,
				"Content-Type": "application/json",
			}
		});

		if (!cronJobResponse.ok) {
			const errorData = await cronJobResponse.text();
			console.error("Cron-job.org error:", errorData);
			return res.status(500).json({ error: "Failed to delete cron job" });
		}

		res.json({
			message: "Reminder deleted successfully",
		});
	} catch (error) {
		console.error("Error deleting reminder:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});
