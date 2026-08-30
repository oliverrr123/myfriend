import { normalizePhoneNumber } from "./phoneNormalize";

const DEFAULT_PREFIXES = ["+1"];

/** E.164 prefixes that must verify + subscribe. Others keep today's companion flow. */
export function paidAccessPrefixes(): string[] {
	const raw = process.env.PAID_ACCESS_PREFIXES ?? DEFAULT_PREFIXES.join(",");
	return raw
		.split(",")
		.map((value) => value.trim())
		.filter(Boolean);
}

export function requiresPaidAccess(phone: string): boolean {
	const normalized = normalizePhoneNumber(phone);
	if (!normalized) return false;
	return paidAccessPrefixes().some((prefix) => normalized.startsWith(prefix));
}
