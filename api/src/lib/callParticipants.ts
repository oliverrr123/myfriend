export function normalizePhoneNumber(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().replace(/[\s-]/g, "");
	return normalized || null;
}

export function getPhoneNumberToIdMap(): Record<string, string> {
	return JSON.parse(process.env.PHONE_NUMBER_TO_ID_MAP || "{}") as Record<
		string,
		string
	>;
}

function getKnownAgentNumberByNormalized(): Map<string, string> {
	const phoneMap = getPhoneNumberToIdMap();
	return new Map(
		Object.keys(phoneMap)
			.map((phoneNumber) => {
				const normalized = normalizePhoneNumber(phoneNumber);
				return normalized ? ([normalized, phoneNumber] as const) : null;
			})
			.filter((entry): entry is readonly [string, string] => Boolean(entry)),
	);
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
}): {
	userPhoneNumber: string | null;
	agentPhoneNumber: string | null;
} {
	const knownAgentNumbers = getKnownAgentNumberByNormalized();
	const callerId = normalizePhoneNumber(params.callerId);
	const explicitAgentPhoneNumber = normalizePhoneNumber(params.agentPhoneNumber);
	const systemCallerId = normalizePhoneNumber(params.systemCallerId);
	const systemCalledNumber = normalizePhoneNumber(params.systemCalledNumber);
	const systemNumbers = [systemCallerId, systemCalledNumber].filter(
		(value): value is string => Boolean(value),
	);

	const agentPhoneNumber =
		systemNumbers
			.map((phoneNumber) => knownAgentNumbers.get(phoneNumber))
			.find((phoneNumber): phoneNumber is string => Boolean(phoneNumber)) ??
		(explicitAgentPhoneNumber
			? knownAgentNumbers.get(explicitAgentPhoneNumber) ?? null
			: null);

	const normalizedAgentPhoneNumber = normalizePhoneNumber(agentPhoneNumber);
	const userPhoneNumber =
		callerId && callerId !== normalizedAgentPhoneNumber
			? callerId
			: systemNumbers.find((phoneNumber) => phoneNumber !== normalizedAgentPhoneNumber) ??
			null;

	return { userPhoneNumber, agentPhoneNumber };
}

export function resolveUserPhoneNumber(params: {
	callerId?: unknown;
	systemCallerId?: unknown;
	systemCalledNumber?: unknown;
}): string | null {
	return resolveCallParticipants(params).userPhoneNumber;
}

export function resolveUserPhoneNumberFromBody(body: Record<string, unknown>): string | null {
	return resolveUserPhoneNumber({
		callerId: body.caller_id,
		systemCallerId: body.system_caller_id,
		systemCalledNumber: body.system_called_number,
	});
}

export function resolveUserPhoneNumberFromHeadersOrQuery(req: {
	headers: Record<string, string | string[] | undefined>;
	query: Record<string, unknown>;
}): string | null {
	const h = req.headers;
	const headerCallerId = h["caller_id"] ?? h["caller-id"];
	const headerSystemCallerId = h["system_caller_id"] ?? h["system-caller-id"];
	const headerSystemCalledNumber =
		h["system_called_number"] ?? h["system-called-number"];

	const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
		Array.isArray(value) ? value[0] : value;

	return resolveUserPhoneNumber({
		callerId: req.query.caller_id ?? firstHeaderValue(headerCallerId),
		systemCallerId:
			req.query.system_caller_id ?? firstHeaderValue(headerSystemCallerId),
		systemCalledNumber:
			req.query.system_called_number ?? firstHeaderValue(headerSystemCalledNumber),
	});
}
