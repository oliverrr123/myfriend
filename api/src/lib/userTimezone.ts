import { supabase } from "./supabase";
import { inferTimezoneFromE164, normalizeTimezone } from "./timezone";

export type UserTimezoneResult =
	| { ok: true; timezone: string; inferred: boolean }
	| { ok: false; status: number; error: string; inference_reason: string };

export async function getOrInferUserTimezone(params: {
	callerId: string;
	currentTimezone?: unknown;
}): Promise<UserTimezoneResult> {
	const savedTimezone = normalizeTimezone(params.currentTimezone);
	if (savedTimezone) {
		return { ok: true, timezone: savedTimezone, inferred: false };
	}

	const inference = inferTimezoneFromE164(params.callerId);
	if (inference.timezone && !inference.ambiguous) {
		const { error } = await supabase
			.from("users")
			.update({ timezone: inference.timezone })
			.eq("phone_number", params.callerId);

		if (error) {
			return {
				ok: false,
				status: 500,
				error: error.message,
				inference_reason: inference.reason,
			};
		}

		return { ok: true, timezone: inference.timezone, inferred: true };
	}

	return {
		ok: false,
		status: 409,
		error:
			"Missing timezone. Ask the user what timezone they are in or what time it is for them, then call updateTimezone.",
		inference_reason: inference.reason,
	};
}
