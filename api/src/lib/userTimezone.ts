import { normalizeTimezone } from "./timezone";

export type UserTimezoneResult =
	| { ok: true; timezone: string }
	| { ok: false; status: number; error: string };

export async function getOrInferUserTimezone(params: {
	callerId: string;
	currentTimezone?: unknown;
}): Promise<UserTimezoneResult> {
	const savedTimezone = normalizeTimezone(params.currentTimezone);
	if (savedTimezone) {
		return { ok: true, timezone: savedTimezone };
	}

	return {
		ok: false,
		status: 409,
		error:
			"Missing timezone. Ask the user what timezone they are in or what time it is for them, then call updateTimezone.",
	};
}
