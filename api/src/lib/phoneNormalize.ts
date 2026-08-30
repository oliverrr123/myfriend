export function normalizePhoneNumber(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().replace(/[\s\-().]/g, "");
	return normalized || null;
}
