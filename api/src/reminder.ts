import { app } from "./app";
import {
	getAgentPhoneNumberId,
	getPhoneNumberToIdMap,
	resolveCallParticipantsFromBody,
	resolveUserPhoneNumberFromBody,
	resolveUserPhoneNumberFromHeadersOrQuery,
} from "./lib/callParticipants";
import { applyBrandName, getAgentLineConfig } from "./lib/agentLines";
import { getOrInferUserTimezone } from "./lib/userTimezone";
import { supabase } from "./lib/supabase";
import { cronDateNumber, timeZoneParts } from "./lib/timezone";
import { authenticateApiKey } from "./middleware/auth";

type ConversationInitiationData = {
	type?: string;
	dynamic_variables?: Record<string, unknown>;
	conversation_config_override?: {
		agent?: {
			first_message?: string;
			language?: string;
			prompt?: {
				prompt?: string;
			};
		};
		tts?: {
			voice_id?: string;
		};
		[key: string]: unknown;
	};
};

function localDateParts(
	value: string,
	timezone: string,
): { year: number; month: number; day: number; weekday: number } {
	const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (dateOnly) {
		const year = Number(dateOnly[1]);
		const month = Number(dateOnly[2]);
		const day = Number(dateOnly[3]);
		const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
		return { year, month, day, weekday };
	}

	const parts = timeZoneParts(new Date(value), timezone);
	return {
		year: parts.year,
		month: parts.month,
		day: parts.day,
		weekday: parts.weekday,
	};
}

function endOfLocalDateCronNumber(value: string, timezone: string): number {
	const parts = localDateParts(value, timezone);
	return cronDateNumber({
		...parts,
		hour: 23,
		minute: 59,
		second: 59,
	});
}

function getApiUrl(): string {
	return process.env.API_URL || "https://api-nameless-water-1932.fly.dev";
}

async function getReminderConversationInitiationData(params: {
	callerId: string;
	reminderText: string;
	agentPhoneNumber?: string | null;
}): Promise<ConversationInitiationData> {
	const response = await fetch(`${getApiUrl()}/api/initCall`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			caller_id: params.callerId,
			agent_phone_number: params.agentPhoneNumber,
		}),
	});

	console.log("--------------------------------")
	console.log("caller_id: ", params.callerId);
	console.log("--------------------------------")

	if (!response.ok) {
		throw new Error(`initCall failed for reminder call: ${await response.text()}`);
	}

	const data = (await response.json()) as ConversationInitiationData;
	data.dynamic_variables = {
		...(data.dynamic_variables ?? {}),
		caller_id: params.callerId,
		reason: params.reminderText,
		outbound_call: "true",
		reminder_call: "true",
	};
	data.conversation_config_override ??= {};
	data.conversation_config_override.agent ??= {};
	data.conversation_config_override.agent.first_message = params.reminderText;

	const language = data.conversation_config_override.agent.language;
	const brandName = getAgentLineConfig(params.agentPhoneNumber)?.name ?? "MyFriend";
	const reminderInstruction =
		language === "cs"
			? `\n\n──────────────── ODCHOZÍ PŘIPOMÍNKA:\nTentokrát voláš uživateli ty kvůli připomínce. Tvá první a hlavní povinnost je jasně předat tuto připomínku: "${params.reminderText}"\nUjisti se, že ji uživatel slyšel nebo pochopil. Pokud jen poděkuje nebo potvrdí, můžeš hovor krátce a mile ukončit. Pokud ale chce pokračovat v rozhovoru, pokračuj normálně jako DigiPřítel se všemi pravidly, pamětí, nástroji a stylem z hlavního promptu.`
			: applyBrandName(
				`\n\n──────────────── OUTBOUND REMINDER CALL:\nThis time you called the user because of a reminder. Your first and primary job is to clearly deliver this reminder: "${params.reminderText}"\nMake sure the user heard or understood it. If they simply thank you or confirm, you may end the call briefly and warmly. If they want to keep talking, continue normally as MyFriend with all the rules, memory, tools, and style from the main prompt.`,
				brandName,
			);

	const prompt = data.conversation_config_override.agent.prompt?.prompt;
	if (prompt) {
		data.conversation_config_override.agent.prompt = {
			prompt: `${prompt}${reminderInstruction}`,
		};
	}

	return data;
}

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

		const phoneMap = getPhoneNumberToIdMap();
		const agent_phone_number_id = getAgentPhoneNumberId(reminder.agent_phone_number);
		if (!agent_phone_number_id) {
			console.error("Missing agent phone number id for reminder:", {
				agent_phone_number: reminder.agent_phone_number,
				phone_map_keys: Object.keys(phoneMap),
			});
			return res.status(500).json({
				error: "Reminder agent_phone_number is not in PHONE_NUMBER_TO_ID_MAP",
			});
		}
		const conversationInitiationClientData =
			await getReminderConversationInitiationData({
				callerId: reminder.phone_number,
				reminderText: reminder.text,
				agentPhoneNumber: reminder.agent_phone_number,
			});

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
					conversation_initiation_client_data: conversationInitiationClientData,
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
		reminder_text,
		time_hour,
		time_minute,
		date,
		end_date,
		frequency,
		weekdays,
		minutes_from_now,
		agent_id,
	} = req.body;

	const participants = resolveCallParticipantsFromBody(req.body);
	const userPhoneNumber = participants.userPhoneNumber;
	const resolvedAgentPhoneNumber = participants.agentPhoneNumber;

	// Validate required fields with detailed error messages
	if (!userPhoneNumber) {
		return res.status(400).json({ error: "Missing caller_id" });
	}
	if (!resolvedAgentPhoneNumber) {
		return res.status(400).json({
			error:
				"Could not determine agent phone number. Make sure PHONE_NUMBER_TO_ID_MAP contains the agent line (whichever of caller_id / agent_phone_number / system_* is the agent).",
		});
	}
	if (!reminder_text) {
		return res.status(400).json({ error: "Missing reminder_text" });
	}
	if (!frequency) {
		return res.status(400).json({ error: "Missing frequency" });
	}

	const minutesFromNow =
		minutes_from_now !== undefined && minutes_from_now !== null
			? Number(minutes_from_now)
			: null;

	if (minutesFromNow !== null) {
		if (!Number.isFinite(minutesFromNow) || minutesFromNow < 1) {
			return res.status(400).json({
				error: "minutes_from_now must be a positive number",
			});
		}
		if (frequency !== "once") {
			return res.status(400).json({
				error: "minutes_from_now is only supported for frequency 'once'",
			});
		}
	} else {
		if (time_hour === undefined || time_hour === null) {
			return res.status(400).json({ error: "Missing time_hour" });
		}
		if (time_minute === undefined || time_minute === null) {
			return res.status(400).json({ error: "Missing time_minute" });
		}
		if (!date) {
			return res.status(400).json({ error: "Missing date" });
		}
	}

	console.log("--------------------------------")
	console.log("create reminder caller_id: ", userPhoneNumber);
	console.log("create reminder agent_phone_number: ", resolvedAgentPhoneNumber);
	console.log("--------------------------------")

	const { data: user, error: userError } = await supabase
		.from("users")
		.select("timezone")
		.eq("phone_number", userPhoneNumber)
		.maybeSingle();

	if (userError) return res.status(500).json({ error: userError.message });

	const timezoneResult = await getOrInferUserTimezone({
		callerId: userPhoneNumber,
		currentTimezone: user?.timezone,
	});
	if (!timezoneResult.ok) {
		return res.status(timezoneResult.status).json({
			error: timezoneResult.error,
		});
	}
	const timezone = timezoneResult.timezone;

	let resolvedTimeHour = time_hour;
	let resolvedTimeMinute = time_minute;
	let resolvedDate = date;

	if (minutesFromNow !== null) {
		const target = new Date(Date.now() + minutesFromNow * 60 * 1000);
		const parts = timeZoneParts(target, timezone);
		resolvedTimeHour = parts.hour;
		resolvedTimeMinute = parts.minute;
		resolvedDate = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
	}

	// Parse weekdays if it came as a string from ElevenLabs
	let parsedWeekdays: number[] | null = null;
	if (weekdays) {
		if (Array.isArray(weekdays)) {
			parsedWeekdays = weekdays.map(Number);
		} else if (typeof weekdays === "string") {
			parsedWeekdays = weekdays
				.replace(/[\[\]]/g, "")
				.split(",")
				.map((s) => Number(s.trim()))
				.filter((n) => !isNaN(n));
		}
	}

	// Build schedule based on frequency
	const reminderDate = localDateParts(resolvedDate, timezone);

	// For "once": no expiration needed
	// For recurring with end_date: use end_date
	// For recurring without end_date: no expiration (runs indefinitely)
	let expiresAt = 0;
	if (frequency !== "once" && end_date) {
		expiresAt = endOfLocalDateCronNumber(end_date, timezone);
	}

	const base = {
		timezone,
		hours: [parseInt(String(resolvedTimeHour))],
		minutes: [parseInt(String(resolvedTimeMinute))],
	};

	const schedules = {
		once: {
			...base,
			mdays: [reminderDate.day],
			months: [reminderDate.month],
			wdays: [-1],
		},
		daily: { ...base, expiresAt, mdays: [-1], months: [-1], wdays: [-1] },
		weekly: {
			...base,
			expiresAt,
			mdays: [-1],
			months: [-1],
			wdays: parsedWeekdays || [reminderDate.weekday],
		},
		monthly: {
			...base,
			expiresAt,
			mdays: [reminderDate.day],
			months: [-1],
			wdays: [-1],
		},
		yearly: {
			...base,
			expiresAt,
			mdays: [reminderDate.day],
			months: [reminderDate.month],
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
				phone_number: userPhoneNumber,
				text: reminder_text,
				time_hour: resolvedTimeHour,
				time_minute: resolvedTimeMinute,
				date: resolvedDate,
				end_date: end_date || null,
				frequency: frequency,
				weekdays: parsedWeekdays ? parsedWeekdays.join(",") : null,
				agent_id: agent_id,
				agent_phone_number: resolvedAgentPhoneNumber,
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
					title: `Reminder for ${userPhoneNumber}: ${reminder_text}`,
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
	const caller_id = resolveUserPhoneNumberFromHeadersOrQuery(req);

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

	caller_id = resolveUserPhoneNumberFromBody(req.body);

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}
	if (!cron_job_id) {
		return res.status(400).json({ error: "Missing cron_job_id" });
	}

	let timezone = "";
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

		const { data: user, error: userError } = await supabase
			.from("users")
			.select("timezone")
			.eq("phone_number", caller_id)
			.maybeSingle();

		if (userError) {
			console.error("User timezone error:", userError);
			return res.status(500).json({ error: userError.message });
		}

		const timezoneResult = await getOrInferUserTimezone({
			callerId: caller_id,
			currentTimezone: user?.timezone,
		});
		if (!timezoneResult.ok) {
			return res.status(timezoneResult.status).json({
				error: timezoneResult.error,
			});
		}
		timezone = timezoneResult.timezone;
	} catch (error) {
		console.error("Error fetching reminder:", error);
		return res.status(500).json({ error: "Internal server error" });
	}

	// Parse weekdays if it came as a string from ElevenLabs
	let parsedWeekdays: number[] | null = null;
	if (weekdays) {
		if (Array.isArray(weekdays)) {
			parsedWeekdays = weekdays.map(Number);
		} else if (typeof weekdays === "string") {
			parsedWeekdays = weekdays
				.replace(/[\[\]]/g, "")
				.split(",")
				.map((s) => Number(s.trim()))
				.filter((n) => !isNaN(n));
		}
	}

	// Build schedule based on frequency
	const reminderDate = localDateParts(date, timezone);

	// For "once": no expiration needed
	// For recurring with end_date: use end_date
	// For recurring without end_date: no expiration (runs indefinitely)
	let expiresAt = 0;
	if (frequency !== "once" && end_date) {
		expiresAt = endOfLocalDateCronNumber(end_date, timezone);
	}

	const base = {
		timezone,
		hours: [parseInt(time_hour)],
		minutes: [parseInt(time_minute)],
	};

	const schedules = {
		once: {
			...base,
			mdays: [reminderDate.day],
			months: [reminderDate.month],
			wdays: [-1],
		},
		daily: { ...base, expiresAt, mdays: [-1], months: [-1], wdays: [-1] },
		weekly: {
			...base,
			expiresAt,
			mdays: [-1],
			months: [-1],
			wdays: parsedWeekdays || [reminderDate.weekday],
		},
		monthly: {
			...base,
			expiresAt,
			mdays: [reminderDate.day],
			months: [-1],
			wdays: [-1],
		},
		yearly: {
			...base,
			expiresAt,
			mdays: [reminderDate.day],
			months: [reminderDate.month],
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
				weekdays: parsedWeekdays ? parsedWeekdays.join(",") : null,
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
	const { cron_job_id } = req.query;
	const userPhoneNumber = resolveUserPhoneNumberFromHeadersOrQuery(req);

	// Validate required fields with detailed error messages
	if (!userPhoneNumber) {
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
			.eq("phone_number", userPhoneNumber);

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
