import { knownAgentLineNumbers } from "./agentLines";
import { normalizePhoneNumber } from "./phoneNormalize";

export { normalizePhoneNumber };

export function getPhoneNumberToIdMap(): Record<string, string> {
	return JSON.parse(process.env.PHONE_NUMBER_TO_ID_MAP || "{}") as Record<
		string,
		string
	>;
}

function getKnownAgentNumberByNormalized(): Map<string, string> {
	const phoneMap = getPhoneNumberToIdMap();
	const fromMap = Object.keys(phoneMap)
		.map((phoneNumber) => {
			const normalized = normalizePhoneNumber(phoneNumber);
			return normalized ? ([normalized, phoneNumber] as const) : null;
		})
		.filter((entry): entry is readonly [string, string] => Boolean(entry));

	const extras = knownAgentLineNumbers()
		.map((phoneNumber) => {
			const normalized = normalizePhoneNumber(phoneNumber);
			return normalized ? ([normalized, phoneNumber] as const) : null;
		})
		.filter((entry): entry is readonly [string, string] => Boolean(entry));

	return new Map([...extras, ...fromMap]);
}

export function getAgentPhoneNumberId(agentPhoneNumber: unknown): string | null {
	const normalized = normalizePhoneNumber(agentPhoneNumber);
	if (!normalized) return null;

	const phoneMap = getPhoneNumberToIdMap();
	const knownAgentNumbers = getKnownAgentNumberByNormalized();
	const canonicalAgentPhoneNumber = knownAgentNumbers.get(normalized);
	return canonicalAgentPhoneNumber ? phoneMap[canonicalAgentPhoneNumber] : null;
}

export function resolveCallParticipants(params: {
	callerId?: unknown;
	agentPhoneNumber?: unknown;
	systemCallerId?: unknown;
	systemCalledNumber?: unknown;
	calledNumber?: unknown;
}): {
	userPhoneNumber: string | null;
	agentPhoneNumber: string | null;
} {
	const knownAgentNumbers = getKnownAgentNumberByNormalized();
	// Outbound vs inbound can flip which dynamic var is the agent line, so treat
	// every provided number as a candidate and pick the one in PHONE_NUMBER_TO_ID_MAP.
	const candidates = [
		params.systemCallerId,
		params.systemCalledNumber,
		params.calledNumber,
		params.callerId,
		params.agentPhoneNumber,
	]
		.map(normalizePhoneNumber)
		.filter((value): value is string => Boolean(value));

	const agentPhoneNumber =
		[...new Set(candidates)]
			.map((phoneNumber) => knownAgentNumbers.get(phoneNumber))
			.find((phoneNumber): phoneNumber is string => Boolean(phoneNumber)) ?? null;

	const normalizedAgentPhoneNumber = normalizePhoneNumber(agentPhoneNumber);
	const userPhoneNumber =
		candidates.find((phoneNumber) => phoneNumber !== normalizedAgentPhoneNumber) ??
		null;

	return { userPhoneNumber, agentPhoneNumber };
}

export function resolveUserPhoneNumber(params: {
	callerId?: unknown;
	agentPhoneNumber?: unknown;
	systemCallerId?: unknown;
	systemCalledNumber?: unknown;
	calledNumber?: unknown;
}): string | null {
	return resolveCallParticipants(params).userPhoneNumber;
}

export function resolveCallParticipantsFromBody(body: Record<string, unknown>): {
	userPhoneNumber: string | null;
	agentPhoneNumber: string | null;
} {
	return resolveCallParticipants({
		callerId: body.caller_id,
		agentPhoneNumber: body.agent_phone_number,
		systemCallerId: body.system_caller_id,
		systemCalledNumber: body.system_called_number,
		calledNumber: body.called_number ?? body.calledNumber,
	});
}

export function resolveUserPhoneNumberFromBody(body: Record<string, unknown>): string | null {
	return resolveCallParticipantsFromBody(body).userPhoneNumber;
}

export function resolveUserPhoneNumberFromHeadersOrQuery(req: {
	headers: Record<string, string | string[] | undefined>;
	query: Record<string, unknown>;
}): string | null {
	const h = req.headers;
	const headerCallerId = h["caller_id"] ?? h["caller-id"];
	const headerAgentPhoneNumber =
		h["agent_phone_number"] ?? h["agent-phone-number"];
	const headerSystemCallerId = h["system_caller_id"] ?? h["system-caller-id"];
	const headerSystemCalledNumber =
		h["system_called_number"] ?? h["system-called-number"];
	const headerCalledNumber = h["called_number"] ?? h["called-number"];

	const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
		Array.isArray(value) ? value[0] : value;

	return resolveUserPhoneNumber({
		callerId: req.query.caller_id ?? firstHeaderValue(headerCallerId),
		agentPhoneNumber:
			req.query.agent_phone_number ?? firstHeaderValue(headerAgentPhoneNumber),
		systemCallerId:
			req.query.system_caller_id ?? firstHeaderValue(headerSystemCallerId),
		systemCalledNumber:
			req.query.system_called_number ?? firstHeaderValue(headerSystemCalledNumber),
		calledNumber: req.query.called_number ?? firstHeaderValue(headerCalledNumber),
	});
}
