import { createHash, randomInt } from "crypto";
import { supabase } from "./supabase";
import { normalizePhoneNumber } from "./callParticipants";

const CODE_TTL_MS = 15 * 60 * 1000;
const HASH_CHARS = /^[0-9]{6}$/;

function hashSecret(): string {
	return process.env.API_KEY || "myfriend-verify";
}

export function hashVerificationCode(code: string): string {
	return createHash("sha256")
		.update(`${hashSecret()}:${code}`)
		.digest("hex");
}

export function spokenDigitSequence(code: string): string {
	return code.split("").join(", ");
}

function randomCode(): string {
	return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function issueVerificationCode(
	phoneNumber: string,
): Promise<string> {
	const phone = normalizePhoneNumber(phoneNumber);
	if (!phone) {
		throw new Error("Invalid phone number");
	}

	const now = new Date().toISOString();
	await supabase
		.from("phone_verifications")
		.update({ consumed_at: now })
		.eq("phone_number", phone)
		.is("consumed_at", null);

	for (let attempt = 0; attempt < 10; attempt++) {
		const code = randomCode();
		const code_hash = hashVerificationCode(code);
		const expires_at = new Date(Date.now() + CODE_TTL_MS).toISOString();

		const { data: existing } = await supabase
			.from("phone_verifications")
			.select("id")
			.eq("code_hash", code_hash)
			.is("consumed_at", null)
			.gt("expires_at", now)
			.maybeSingle();

		if (existing) continue;

		const { error } = await supabase.from("phone_verifications").insert({
			phone_number: phone,
			code_hash,
			expires_at,
		});

		if (error) {
			throw new Error(error.message);
		}
		return code;
	}

	throw new Error("Could not issue a unique verification code");
}

export async function consumeVerificationCode(code: string): Promise<{
	phone_number: string;
} | null> {
	const trimmed = code.replace(/\s/g, "");
	if (!HASH_CHARS.test(trimmed)) return null;

	const code_hash = hashVerificationCode(trimmed);
	const now = new Date().toISOString();

	const { data, error } = await supabase
		.from("phone_verifications")
		.select("id, phone_number")
		.eq("code_hash", code_hash)
		.is("consumed_at", null)
		.gt("expires_at", now)
		.maybeSingle();

	if (error || !data) return null;

	const { error: consumeError } = await supabase
		.from("phone_verifications")
		.update({ consumed_at: now })
		.eq("id", data.id)
		.is("consumed_at", null);

	if (consumeError) return null;

	return { phone_number: data.phone_number };
}
