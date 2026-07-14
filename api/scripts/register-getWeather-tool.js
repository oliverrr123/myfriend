#!/usr/bin/env node
/**
 * Register or update the getWeather ElevenLabs webhook tool and attach it to the agent.
 * Also adds optional `city` to the existing udpateTimezone tool.
 *
 * Usage: node scripts/register-getWeather-tool.js
 * Requires: ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID in .env
 */
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_BASE = "https://api.elevenlabs.io/v1/convai";
const apiKey = process.env.ELEVENLABS_API_KEY;
const agentId = process.env.ELEVENLABS_AGENT_ID;
const apiUrl = process.env.API_URL || "https://api-nameless-water-1932.fly.dev";

if (!apiKey || !agentId) {
	console.error("Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID in .env");
	process.exit(1);
}

const headers = {
	"xi-api-key": apiKey,
	"Content-Type": "application/json",
};

async function apiFetch(path, options = {}) {
	const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
	const text = await response.text();
	let json;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		json = { raw: text };
	}
	if (!response.ok) {
		throw new Error(`${options.method || "GET"} ${path} failed (${response.status}): ${text}`);
	}
	return json;
}

function loadGetWeatherToolConfig(authSecretId) {
	const templatePath = join(__dirname, "../elevenlabs-tools/getWeather.json");
	const template = JSON.parse(readFileSync(templatePath, "utf8"));
	template.api_schema.request_headers.Authorization.secret_id = authSecretId;
	template.api_schema.url = `${apiUrl}/api/getWeather`;
	return template;
}

async function getAuthSecretId(tools) {
	const referenceTool = tools.find((tool) =>
		["createReminder", "createFact", "udpateTimezone"].includes(tool.tool_config?.name),
	);
	const secretId =
		referenceTool?.tool_config?.api_schema?.request_headers?.Authorization?.secret_id;
	if (!secretId) {
		throw new Error("Could not find workspace Authorization secret_id from existing tools");
	}
	return secretId;
}

async function upsertGetWeatherTool(tools, authSecretId) {
	const toolConfig = loadGetWeatherToolConfig(authSecretId);
	const existing = tools.find((tool) => tool.tool_config?.name === "getWeather");

	if (existing) {
		const updated = await apiFetch(`/tools/${existing.id}`, {
			method: "PATCH",
			body: JSON.stringify({ tool_config: toolConfig }),
		});
		console.log(`Updated getWeather tool: ${existing.id}`);
		return updated;
	}

	const created = await apiFetch("/tools", {
		method: "POST",
		body: JSON.stringify({ tool_config: toolConfig }),
	});
	console.log(`Created getWeather tool: ${created.id}`);
	return created;
}

async function updateTimezoneTool(tools) {
	const existing = tools.find((tool) => tool.tool_config?.name === "udpateTimezone");
	if (!existing) {
		console.warn("udpateTimezone tool not found; skipping city field update");
		return;
	}

	const toolConfig = structuredClone(existing.tool_config);
	toolConfig.description =
		"Save or change the user's timezone and optionally their city. Use before creating reminders or calling preferences if the timezone is unknown. Also use whenever the user asks to change their timezone. Pass city when you know their town so weather works later. The timezone should be an IANA timezone like Europe/Prague, America/New_York, America/Chicago, America/Denver, America/Los_Angeles, or America/Phoenix.";
	toolConfig.api_schema.request_body_schema.properties.city = {
		type: "string",
		description:
			"Optional city or town name for the user, for example Prague or Brno. Pass this when the user tells you where they live while setting timezone.",
		enum: null,
		is_system_provided: false,
		dynamic_variable: "",
		allowed_values_dynamic_variable: "",
		constant_value: "",
		is_omitted: false,
	};

	await apiFetch(`/tools/${existing.id}`, {
		method: "PATCH",
		body: JSON.stringify({ tool_config: toolConfig }),
	});
	console.log(`Updated udpateTimezone tool with optional city: ${existing.id}`);
}

async function attachToolToAgent(toolId) {
	const agent = await apiFetch(`/agents/${agentId}`);
	const toolIds = agent.conversation_config?.agent?.prompt?.tool_ids ?? [];

	if (toolIds.includes(toolId)) {
		console.log("getWeather already attached to agent");
		return;
	}

	await apiFetch(`/agents/${agentId}`, {
		method: "PATCH",
		body: JSON.stringify({
			conversation_config: {
				agent: {
					prompt: {
						tool_ids: [...toolIds, toolId],
					},
				},
			},
		}),
	});
	console.log(`Attached getWeather to agent ${agentId}`);
}

async function main() {
	const { tools } = await apiFetch("/tools");
	const authSecretId = await getAuthSecretId(tools);
	const weatherTool = await upsertGetWeatherTool(tools, authSecretId);
	await updateTimezoneTool(tools);
	await attachToolToAgent(weatherTool.id);
	console.log("Done.");
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
