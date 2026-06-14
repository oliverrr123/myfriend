import { supabase } from "./lib/supabase";

export type ActiveTopic = {
	id: string;
	topic: string;
	time_from: string;
	time_to: string;
	created_at?: string;
};

type TopicAnalysisResult = {
	completed_topic_ids?: string[];
	new_topics?: Array<{
		topic?: string;
		time_from?: string;
		time_to?: string;
	}>;
};

function transcriptToText(transcript: unknown): string {
	if (Array.isArray(transcript)) {
		return transcript
			.map((entry) => {
				if (!entry || typeof entry !== "object") return String(entry);
				const record = entry as Record<string, unknown>;
				const role = record.role ?? record.speaker ?? record.source ?? "unknown";
				const text =
					record.message ??
					record.text ??
					record.transcript ??
					record.content ??
					JSON.stringify(record);
				return `${role}: ${text}`;
			})
			.join("\n");
	}
	if (typeof transcript === "string") return transcript;
	return JSON.stringify(transcript);
}

function asIsoDateString(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return date.toISOString();
}

function parseTopicAnalysis(text: string): TopicAnalysisResult {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const jsonText = fenced ? fenced[1] : trimmed;
	return JSON.parse(jsonText) as TopicAnalysisResult;
}

export async function loadActiveTopicsForUser(
	userId: string,
	now: Date = new Date(),
): Promise<ActiveTopic[]> {
	const nowIso = now.toISOString();
	const { data, error } = await supabase
		.from("topics")
		.select("id, topic, time_from, time_to, created_at")
		.eq("user_id", userId)
		.eq("active", true)
		.lte("time_from", nowIso)
		.gte("time_to", nowIso)
		.order("created_at", { ascending: false })
		.limit(8);

	if (error) {
		console.error("Failed to load active topics:", error);
		return [];
	}

	return (data ?? []) as ActiveTopic[];
}

export function formatActiveTopicsForPrompt(topics: ActiveTopic[]): string {
	if (topics.length === 0) return "[]";
	return JSON.stringify(
		topics.map((topic) => ({
			id: topic.id,
			active_from: topic.time_from,
			active_to: topic.time_to,
			instruction: topic.topic,
		})),
	);
}

export async function analyzeAndPersistConversationTopics(params: {
	userId: string;
	language: string | null | undefined;
	transcript: unknown;
	summary: string | null | undefined;
	loadedTopics: ActiveTopic[];
	conversationStartedAt: Date;
	conversationEndedAt: Date;
}): Promise<void> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		console.warn("OPENAI_API_KEY is not set; skipping topic analysis");
		return;
	}

	const nowIso = params.conversationEndedAt.toISOString();
	const transcriptText = transcriptToText(params.transcript);
	const loadedTopicBlock = formatActiveTopicsForPrompt(params.loadedTopics);

	const system = `You analyze phone conversations for MyFriend, an AI companion for seniors.
Return only strict JSON with this shape:
{
  "completed_topic_ids": ["topic id that was meaningfully discussed"],
  "new_topics": [
    {
      "topic": "brief instruction for the next conversation, phrased as what the agent should naturally ask or mention",
      "time_from": "ISO timestamp when this topic becomes relevant",
      "time_to": "ISO timestamp when this topic stops being relevant"
    }
  ]
}

Rules:
- Mark a loaded topic completed only if the user and agent actually discussed it. If the agent merely asked and the user hung up or did not answer, do not complete it.
- Create new topics only for concrete future or recent personal details worth following up on.
- Use narrow active windows. Recent daily events are usually relevant for about 3-7 days. Weekly activities can stay active until the next occurrence. Future events should become active shortly before the event and expire shortly after it.
- Do not create medical, financial, or sensitive topics unless the user clearly wants follow-up.
- Use the conversation language when writing topic instructions if possible.
- If there is nothing useful, return empty arrays.`;

	const user = `Current time: ${nowIso}
Conversation started: ${params.conversationStartedAt.toISOString()}
Conversation ended: ${params.conversationEndedAt.toISOString()}
Conversation language: ${params.language ?? "unknown"}

Loaded topics for this conversation:
${loadedTopicBlock}

Conversation summary:
${params.summary ?? ""}

Transcript:
${transcriptText}`;

	try {
		const response = await fetch("https://api.openai.com/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: process.env.OPENAI_TOPIC_MODEL || "gpt-4.1-mini",
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: system },
					{ role: "user", content: user },
				],
			}),
		});

		if (!response.ok) {
			console.error("Topic analysis failed:", await response.text());
			return;
		}

		const json = (await response.json()) as {
			choices?: Array<{ message?: { content?: string } }>;
		};
		const content = json.choices?.[0]?.message?.content;
		if (!content) return;

		const analysis = parseTopicAnalysis(content);
		const loadedTopicIds = new Set(params.loadedTopics.map((topic) => topic.id));
		const completedTopicIds = (analysis.completed_topic_ids ?? [])
			.filter((id): id is string => typeof id === "string" && loadedTopicIds.has(id));

		if (completedTopicIds.length > 0) {
			const { error } = await supabase
				.from("topics")
				.update({ active: false })
				.in("id", completedTopicIds)
				.eq("user_id", params.userId);
			if (error) console.error("Failed to deactivate completed topics:", error);
		}

		const newTopics = (analysis.new_topics ?? [])
			.map((topic) => ({
				user_id: params.userId,
				topic: typeof topic.topic === "string" ? topic.topic.trim() : "",
				time_from: asIsoDateString(topic.time_from),
				time_to: asIsoDateString(topic.time_to),
				active: true,
			}))
			.filter((topic) => topic.topic && topic.time_from && topic.time_to);

		if (newTopics.length > 0) {
			const { error } = await supabase.from("topics").insert(newTopics);
			if (error) console.error("Failed to insert new topics:", error);
		}
	} catch (error) {
		console.error("Error during topic analysis:", error);
	}
}
