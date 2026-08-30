import { normalizePhoneNumber } from "./phoneNormalize";

export type AgentLineConfig = {
	name: string;
	freeCompanion: boolean;
};

const AGENT_LINES: Record<string, AgentLineConfig> = {
	// Original US line: full companion for everyone, no paywall.
	"+12346036167": {
		name: "MyFriend",
		freeCompanion: true,
	},
	// New US line: +1 callers verify and subscribe.
	"+19496767670": {
		name: "MyFriend",
		freeCompanion: false,
	},
};

export function knownAgentLineNumbers(): string[] {
	return Object.keys(AGENT_LINES);
}

export function getAgentLineConfig(
	agentPhoneNumber: unknown,
): AgentLineConfig | null {
	const normalized = normalizePhoneNumber(agentPhoneNumber);
	if (!normalized) return null;
	return AGENT_LINES[normalized] ?? null;
}

export function findConfiguredAgentNumber(
	values: unknown[],
): string | null {
	for (const value of values) {
		const normalized = normalizePhoneNumber(value);
		if (normalized && AGENT_LINES[normalized]) return normalized;
	}
	return null;
}

export function applyBrandName(text: string, brandName: string): string {
	if (brandName === "MyFriend") return text;
	return text.replaceAll("MyFriend", brandName);
}
