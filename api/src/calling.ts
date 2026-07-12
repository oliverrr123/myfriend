import { app } from "./app";
import {
	getAgentPhoneNumberId,
	resolveCallParticipants,
	resolveUserPhoneNumberFromBody,
} from "./lib/callParticipants";
import { getOrInferUserTimezone } from "./lib/userTimezone";
import { supabase } from "./lib/supabase";
import { cronDateNumber, timeZoneParts } from "./lib/timezone";
import {
	CRON_JOB_ORG_CREATE_DELAY_MS,
	createCronJobOrgJob,
	friendlyCallJobTitle,
	sleepMs,
} from "./lib/cronJobOrg";
import { authenticateApiKey } from "./middleware/auth";
import { loadActiveTopicsForUser } from "./topics";

type CallingPreferenceInput = {
	weekdays?: unknown;
	hour_range_from?: unknown;
	hour_range_to?: unknown;
	agent_id?: unknown;
	agent_phone_number?: unknown;
};

type CallingPreference = {
	id: string;
	user_id: string;
	weekdays: string | number[] | null;
	hour_range_from: string;
	hour_range_to: string;
	agent_id: string | null;
	agent_phone_number: string | null;
};

type UserRecord = {
	id: string;
	phone_number: string;
	language: string | null;
	nickname_vocative?: string | null;
	first_name_vocative?: string | null;
	agent_voice_id?: string | null;
	agent_gender?: string | null;
	timezone?: string | null;
};

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

function parseWeekdays(weekdays: unknown): number[] {
	if (Array.isArray(weekdays)) {
		return weekdays
			.map(Number)
			.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
	}
	if (typeof weekdays === "string") {
		return weekdays
			.replace(/[\[\]]/g, "")
			.split(",")
			.map((part) => Number(part.trim()))
			.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);
	}
	return [];
}

function parseHour(value: unknown): number | null {
	const hour = Number(value);
	if (!Number.isInteger(hour)) return null;
	return hour;
}

function parseTimeToMinuteOfDay(value: unknown): number | null {
	if (typeof value !== "string") return null;
	const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
	if (!match) return null;
	return Number(match[1]) * 60 + Number(match[2]);
}

function minuteOfDayToTime(value: number): string {
	const hour = Math.floor(value / 60);
	const minute = value % 60;
	return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function randomCallTime(timeFrom: string, timeTo: string): {
	hour: number;
	minute: number;
} {
	const startMinute = parseTimeToMinuteOfDay(timeFrom);
	const endExclusive = parseTimeToMinuteOfDay(timeTo);
	if (startMinute === null || endExclusive === null || startMinute >= endExclusive) {
		throw new Error("Invalid calling preference time range");
	}
	const endMinute = endExclusive - 1;
	const selected =
		startMinute + Math.floor(Math.random() * (endMinute - startMinute + 1));
	return {
		hour: Math.floor(selected / 60),
		minute: selected % 60,
	};
}

function isTodayTimeInFuture(hour: number, minute: number, timezone: string): boolean {
	const now = timeZoneParts(new Date(), timezone);
	return hour > now.hour || (hour === now.hour && minute > now.minute);
}

function getApiUrl(): string {
	return process.env.API_URL || "https://api-nameless-water-1932.fly.dev";
}

function parseMinute(value: unknown): number | null {
	const minute = Number(value);
	if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
	return minute;
}

function fallbackFriendlyFirstMessage(params: {
	language: string;
	name: string;
	topics: Array<{ topic: string }>;
}): string {
	return "Hey, this is MyFriend. I thought I'd call and see if you have a minute to chat.";
}

function sanitizeFirstMessage(message: string): string {
	return message
		.replace(/^["'\s]+|["'\s]+$/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 500);
}

async function generateFriendlyFirstMessage(params: {
	language: string;
	name: string;
	topics: Array<{ topic: string; time_from: string; time_to: string }>;
}): Promise<string> {
	const fallback = fallbackFriendlyFirstMessage(params);
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) return fallback;

	const languageInstruction =
		params.language === "cs"
			? "Write the message in Czech."
			: `Write the message in the user's conversation language. Language code: ${params.language}.`;

	const topicBlock =
		params.topics.length > 0
			? JSON.stringify(
				params.topics.map((topic) => ({
					instruction: topic.topic,
					active_from: topic.time_from,
					active_to: topic.time_to,
				})),
			)
			: "[]";

	const system = `You write the first spoken line for an outbound phone call from MyFriend, an AI companion for seniors.
Return exactly one short natural spoken message, no JSON, no quotation marks.
Make it feel fresh and specific, not repetitive.
If there are active topics, gently use one of them in the opener.
If there are no useful topics, make a warm casual check-in.
Do not claim to know things not in the topics.
Do not sound formal, salesy, or like a notification.
Keep it under 30 words. ${languageInstruction}`;

	const user = `User vocative/preferred name: ${params.name || "(none)"}
Active topics:
${topicBlock}`;

	try {
		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: process.env.OPENAI_TOPIC_MODEL || "gpt-4.1-mini",
				temperature: 0.8,
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
			}),
		});

		if (!response.ok) {
			console.error("First message generation failed:", await response.text());
			return fallback;
		}

		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const generated = sanitizeFirstMessage(
			json.choices?.[0]?.message?.content ?? "",
		);
		return generated || fallback;
	} catch (error) {
		console.error("Error generating first message:", error);
		return fallback;
	}
}

async function getOutboundConversationInitiationData(params: {
	callerId: string;
	firstMessage: string;
}): Promise<ConversationInitiationData> {
	const apiUrl = getApiUrl();
	const response = await fetch(`${apiUrl}/api/initCall`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ caller_id: params.callerId }),
	});

	if (!response.ok) {
		throw new Error(`initCall failed for outbound call: ${await response.text()}`);
	}

	const data = (await response.json()) as ConversationInitiationData;
	data.dynamic_variables = {
		...(data.dynamic_variables ?? {}),
		caller_id: params.callerId,
		outbound_call: "true",
	};
	data.conversation_config_override ??= {};
	data.conversation_config_override.agent ??= {};
	data.conversation_config_override.agent.first_message = params.firstMessage;

	const language = data.conversation_config_override.agent.language;
	const outboundInstruction =
		language === "cs"
			? "\n\n──────────────── ODCHOZÍ HOVOR:\nTentokrát voláš uživateli ty. Pokračuj přirozeně po první větě a chovej se stejně jako při běžném hovoru, jen neříkej věci typu „díky, že voláš“. Pokud první věta otevře aktivní téma, navazuj na něj nenuceně."
			: "\n\n──────────────── OUTBOUND CALL:\nThis time you called the user. Continue naturally after the first line and behave the same as in a normal conversation, but do not say things like “thanks for calling.” If the first line opens an active topic, follow it gently.";

	const prompt = data.conversation_config_override.agent.prompt?.prompt;
	if (prompt) {
		data.conversation_config_override.agent.prompt = {
			prompt: `${prompt}${outboundInstruction}`,
		};
	}

	return data;
}

function normalizePreferenceInput(input: CallingPreferenceInput): {
	weekdays: number[];
	hourRangeFrom: string;
	hourRangeTo: string;
	agentId: string | null;
	agentPhoneNumber: string | null;
} | { error: string } {
	const weekdays = parseWeekdays(input.weekdays);
	if (weekdays.length === 0) {
		return { error: "Missing or invalid weekdays. Use numbers 0-6, Sunday=0." };
	}

	const hourRangeFromMinute = parseTimeToMinuteOfDay(input.hour_range_from);
	const hourRangeToMinute = parseTimeToMinuteOfDay(input.hour_range_to);
	if (hourRangeFromMinute === null) {
		return { error: "Invalid hour_range_from. Use HH:mm in 24-hour format." };
	}
	if (hourRangeToMinute === null) {
		return { error: "Invalid hour_range_to. Use HH:mm in 24-hour format." };
	}
	if (hourRangeFromMinute >= hourRangeToMinute) {
		return { error: "hour_range_from must be lower than hour_range_to." };
	}

	return {
		weekdays,
		hourRangeFrom: minuteOfDayToTime(hourRangeFromMinute),
		hourRangeTo: minuteOfDayToTime(hourRangeToMinute),
		agentId:
			typeof input.agent_id === "string" && input.agent_id.trim()
				? input.agent_id.trim()
				: null,
		agentPhoneNumber:
			typeof input.agent_phone_number === "string" &&
			input.agent_phone_number.trim()
				? input.agent_phone_number.trim()
				: null,
	};
}

app.post("/api/saveCallingPreference", authenticateApiKey, async (req, res) => {
	const caller_id = resolveUserPhoneNumberFromBody(req.body);
	const participants = resolveCallParticipants({
		callerId: req.body.caller_id,
		agentPhoneNumber: req.body.agent_phone_number,
		systemCallerId: req.body.system_caller_id,
		systemCalledNumber: req.body.system_called_number,
	});
	const agentPhoneNumber = participants.agentPhoneNumber;
	const agentId =
		typeof req.body.agent_id === "string" && req.body.agent_id.trim()
			? req.body.agent_id.trim()
			: null;
	const rawPreferences = Array.isArray(req.body.preferences)
		? (req.body.preferences as CallingPreferenceInput[])
		: [req.body as CallingPreferenceInput];

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}
	if (!agentId) {
		return res.status(400).json({ error: "Missing agent_id" });
	}
	if (!agentPhoneNumber) {
		return res.status(400).json({
			error:
				"Could not determine agent phone number. Send system_caller_id and system_called_number, and make sure PHONE_NUMBER_TO_ID_MAP contains the agent number.",
		});
	}

	const { data: user, error: userError } = await supabase
		.from("users")
		.select("id, timezone")
		.eq("phone_number", caller_id)
		.maybeSingle();

	if (userError) return res.status(500).json({ error: userError.message });
	if (!user) return res.status(404).json({ error: "User not found" });

	const timezoneResult = await getOrInferUserTimezone({
		callerId: caller_id,
		currentTimezone: user.timezone,
	});
	if (!timezoneResult.ok) {
		return res.status(timezoneResult.status).json({
			error: timezoneResult.error,
		});
	}

	const normalized = rawPreferences.map(normalizePreferenceInput);
	const invalid = normalized.find(
		(preference): preference is { error: string } => "error" in preference,
	);
	if (invalid) return res.status(400).json({ error: invalid.error });

	const rows = normalized.map((preference) => {
		if ("error" in preference) throw new Error(preference.error);
		return {
			user_id: user.id,
			weekdays: preference.weekdays.join(","),
			hour_range_from: preference.hourRangeFrom,
			hour_range_to: preference.hourRangeTo,
			agent_id: preference.agentId || agentId,
			agent_phone_number: preference.agentPhoneNumber || agentPhoneNumber,
		};
	});

	const { data, error } = await supabase
		.from("calling_preferences")
		.insert(rows)
		.select("id");

	if (error) return res.status(500).json({ error: error.message });

	res.json({
		message: "Calling preference saved successfully",
		preference_ids: (data ?? []).map((row) => row.id),
	});
});

app.post("/api/createCallingJobGeneratorCron", authenticateApiKey, async (req, res) => {
	const hour = parseHour(req.body.time_hour ?? 0);
	const minute = parseMinute(req.body.time_minute ?? 5);

	if (hour === null || hour < 0 || hour > 23) {
		return res.status(400).json({ error: "Invalid time_hour. Use 0-23." });
	}
	if (minute === null) {
		return res.status(400).json({ error: "Invalid time_minute. Use 0-59." });
	}

	const apiUrl = getApiUrl();
	const cronJobResult = await createCronJobOrgJob({
		enabled: true,
		title: "Generate friendly call jobs",
		saveResponses: true,
		url: `${apiUrl}/api/webhook/generate-calling-jobs`,
		requestMethod: 0,
		extendedData: {
			headers: {
				Authorization: `Bearer ${process.env.API_KEY}`,
			},
		},
		schedule: {
			timezone: "UTC",
			hours: [hour],
			minutes: [minute],
			mdays: [-1],
			months: [-1],
			wdays: [-1],
		},
	});

	if (!cronJobResult.ok) {
		console.error("Cron-job.org generator setup error:", cronJobResult.error);
		return res.status(500).json({ error: "Failed to create generator cron job" });
	}

	res.json({
		message: "Calling job generator cron created successfully",
		cron_job_id: cronJobResult.jobId,
	});
});

app.get("/api/webhook/generate-calling-jobs", authenticateApiKey, async (_req, res) => {
	const { data: preferences, error: preferencesError } = await supabase
		.from("calling_preferences")
		.select("id, user_id, weekdays, hour_range_from, hour_range_to, agent_id, agent_phone_number");

	if (preferencesError) {
		return res.status(500).json({ error: preferencesError.message });
	}

	const allPreferences = (preferences ?? []) as CallingPreference[];
	if (allPreferences.length === 0) {
		return res.json({ message: "No calling preferences found", jobs: [] });
	}

	const userIds = [...new Set(allPreferences.map((preference) => preference.user_id))];
	const { data: users, error: usersError } = await supabase
		.from("users")
		.select("id, phone_number, language, nickname_vocative, first_name_vocative, agent_voice_id, agent_gender, timezone")
		.in("id", userIds);

	if (usersError) return res.status(500).json({ error: usersError.message });

	const userById = new Map((users ?? []).map((user) => [user.id, user as UserRecord]));
	const apiUrl = getApiUrl();
	const jobs: Array<{
		preference_id: string;
		user_id: string;
		phone_number?: string;
		hour?: number;
		minute?: number;
		cron_job_id?: string;
		skipped?: string;
	}> = [];
	let cronJobsCreated = 0;

	for (const preference of allPreferences) {
		const user = userById.get(preference.user_id);
		if (!user?.phone_number) {
			jobs.push({
				preference_id: preference.id,
				user_id: preference.user_id,
				skipped: "User or phone number not found",
			});
			continue;
		}

		const timezoneResult = await getOrInferUserTimezone({
			callerId: user.phone_number,
			currentTimezone: user.timezone,
		});
		if (!timezoneResult.ok) {
			jobs.push({
				preference_id: preference.id,
				user_id: preference.user_id,
				phone_number: user.phone_number,
				skipped: timezoneResult.error,
			});
			continue;
		}
		const timezone = timezoneResult.timezone;
		const now = new Date();
		const today = timeZoneParts(now, timezone);
		const tomorrow = timeZoneParts(
			new Date(now.getTime() + 24 * 60 * 60 * 1000),
			timezone,
		);
		const weekdays = parseWeekdays(preference.weekdays);

		const selected = randomCallTime(
			preference.hour_range_from,
			preference.hour_range_to,
		);
		const scheduleDay = weekdays.includes(today.weekday) &&
			isTodayTimeInFuture(selected.hour, selected.minute, timezone)
			? today
			: weekdays.includes(tomorrow.weekday)
				? tomorrow
				: null;

		if (!scheduleDay) {
			jobs.push({
				preference_id: preference.id,
				user_id: preference.user_id,
				phone_number: user.phone_number,
				hour: selected.hour,
				minute: selected.minute,
				skipped: "No matching future local day in the next 24 hours",
			});
			continue;
		}

		if (cronJobsCreated > 0) {
			await sleepMs(CRON_JOB_ORG_CREATE_DELAY_MS);
		}

		const cronJobResult = await createCronJobOrgJob({
			enabled: true,
			title: friendlyCallJobTitle({
				phoneNumber: user.phone_number,
				year: scheduleDay.year,
				month: scheduleDay.month,
				day: scheduleDay.day,
				hour: selected.hour,
				minute: selected.minute,
			}),
			saveResponses: true,
			url: `${apiUrl}/api/webhook/call-user?preference_id=${preference.id}`,
			requestMethod: 0,
			extendedData: {
				headers: {
					Authorization: `Bearer ${process.env.API_KEY}`,
				},
			},
			schedule: {
				timezone,
				hours: [selected.hour],
				minutes: [selected.minute],
				mdays: [scheduleDay.day],
				months: [scheduleDay.month],
				wdays: [-1],
				expiresAt: cronDateNumber({
					...scheduleDay,
					hour: 23,
					minute: 59,
					second: 59,
				}),
			},
		});

		if (!cronJobResult.ok) {
			console.error(
				`Failed to create friendly call cron for ${user.phone_number}:`,
				cronJobResult.error,
			);
			jobs.push({
				preference_id: preference.id,
				user_id: preference.user_id,
				phone_number: user.phone_number,
				hour: selected.hour,
				minute: selected.minute,
				skipped: cronJobResult.error,
			});
			continue;
		}

		cronJobsCreated++;
		jobs.push({
			preference_id: preference.id,
			user_id: preference.user_id,
			phone_number: user.phone_number,
			hour: selected.hour,
			minute: selected.minute,
			cron_job_id: String(cronJobResult.jobId),
		});
	}

	res.json({ message: "Calling jobs generated", jobs });
});

app.get("/api/webhook/call-user", authenticateApiKey, async (req, res) => {
	const preferenceId = req.query.preference_id;
	if (typeof preferenceId !== "string" || !preferenceId) {
		return res.status(400).json({ error: "Missing preference_id" });
	}

	const { data: preference, error: preferenceError } = await supabase
		.from("calling_preferences")
		.select("id, user_id, weekdays, hour_range_from, hour_range_to, agent_id, agent_phone_number")
		.eq("id", preferenceId)
		.maybeSingle();

	if (preferenceError) return res.status(500).json({ error: preferenceError.message });
	if (!preference) return res.status(404).json({ error: "Calling preference not found" });

	const { data: user, error: userError } = await supabase
		.from("users")
		.select("id, phone_number, language, nickname_vocative, first_name_vocative, agent_voice_id, agent_gender")
		.eq("id", preference.user_id)
		.maybeSingle();

	if (userError) return res.status(500).json({ error: userError.message });
	if (!user?.phone_number) return res.status(404).json({ error: "User not found" });

	const agentId =
		preference.agent_id ||
		process.env.ELEVENLABS_AGENT_ID ||
		process.env.DEFAULT_AGENT_ID;
	const agentPhoneNumber =
		preference.agent_phone_number ||
		process.env.AGENT_PHONE_NUMBER ||
		process.env.DEFAULT_AGENT_PHONE_NUMBER;

	if (!agentId || !agentPhoneNumber) {
		return res.status(500).json({
			error:
				"Missing agent_id or agent_phone_number for outbound call. Re-save this calling preference after adding system_caller_id and system_called_number to the saveCallingPreference tool.",
		});
	}

	const agentPhoneNumberId = getAgentPhoneNumberId(agentPhoneNumber);
	if (!agentPhoneNumberId) {
		return res.status(500).json({
			error: "Agent phone number is missing from PHONE_NUMBER_TO_ID_MAP",
		});
	}

	try {
		const topics = await loadActiveTopicsForUser(user.id);
		const language = user.language || "cs";
		const name = user.nickname_vocative || user.first_name_vocative || "";
		const firstMessage = await generateFriendlyFirstMessage({
			language,
			name,
			topics,
		});
		const conversationInitiationClientData =
			await getOutboundConversationInitiationData({
				callerId: user.phone_number,
				firstMessage,
			});

		const response = await fetch(
			"https://api.elevenlabs.io/v1/convai/twilio/outbound-call",
			{
				method: "POST",
				headers: {
					"xi-api-key": process.env.ELEVENLABS_API_KEY || "",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					agent_id: agentId,
					agent_phone_number_id: agentPhoneNumberId,
					to_number: user.phone_number,
					conversation_initiation_client_data: conversationInitiationClientData,
				}),
			},
		);

		if (!response.ok) {
			console.error("ElevenLabs friendly call error:", await response.text());
			return res.status(500).json({ error: "Failed to make call" });
		}

		res.json({ message: "Call initiated successfully" });
	} catch (error) {
		console.error("Error making friendly call:", error);
		res.status(500).json({ error: "Internal server error" });
	}
});
