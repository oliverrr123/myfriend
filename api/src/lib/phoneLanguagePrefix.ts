/**
 * Heuristic E.164 prefix → ISO 639-1 language for first-time / empty-DB defaults.
 * Longest prefix wins. One primary supported language per region; many countries
 * map to en when we have no better match.
 */

const ENTRIES: [string, string][] = [
	// Kazakhstan mobile (before generic +7)
	["+777", "kk"],
	["+776", "kk"],
	["+775", "kk"],
	["+774", "kk"],
	["+773", "kk"],
	["+772", "kk"],
	["+771", "kk"],
	["+770", "kk"],
	// Greater China
	["+886", "zh"],
	["+853", "zh"],
	["+852", "zh"],
	["+972", "he"],
	["+380", "uk"],
	["+386", "sl"],
	["+385", "hr"],
	["+421", "sk"],
	["+420", "cs"],
	["+358", "fi"],
	["+354", "is"],
	["+298", "da"],
	["+299", "da"],
	["+46", "sv"],
	["+45", "da"],
	["+49", "de"],
	["+48", "pl"],
	["+47", "en"],
	["+44", "en"],
	["+43", "de"],
	["+41", "de"],
	["+40", "ro"],
	["+39", "it"],
	["+34", "es"],
	["+33", "fr"],
	["+32", "fr"],
	["+31", "en"],
	["+30", "el"],
	["+357", "el"],
	["+373", "ro"],
	["+352", "de"],
	["+351", "pt"],
	["+353", "en"],
	["+27", "en"],
	["+262", "fr"],
	["+596", "fr"],
	["+594", "fr"],
	["+590", "fr"],
	["+508", "fr"],
	["+509", "fr"],
	["+598", "es"],
	["+595", "es"],
	["+593", "es"],
	["+507", "es"],
	["+506", "es"],
	["+505", "es"],
	["+504", "es"],
	["+503", "es"],
	["+502", "es"],
	["+58", "es"],
	["+57", "es"],
	["+56", "es"],
	["+54", "es"],
	["+53", "es"],
	["+52", "es"],
	["+51", "es"],
	["+55", "pt"],
	["+64", "en"],
	["+61", "en"],
	["+65", "en"],
	["+60", "en"],
	["+63", "en"],
	["+62", "en"],
	["+66", "en"],
	["+81", "ja"],
	["+82", "ko"],
	["+84", "vi"],
	["+86", "zh"],
	["+90", "tr"],
	["+91", "hi"],
	["+92", "ur"],
	["+375", "ru"],
	["+7", "ru"],
	["+1", "en"],
];

export const E164_PREFIX_TO_LANGUAGE_SORTED: [string, string][] = [
	...ENTRIES,
].sort((a, b) => b[0].length - a[0].length);

/** Returns a lowercase ISO 639-1 code (not validated against app allow-list). */
export function inferLanguageCodeFromE164(callerId: string): string {
	const normalized = callerId.trim().replace(/[\s-]/g, "");
	if (!normalized.startsWith("+")) {
		return "en";
	}
	for (const [prefix, lang] of E164_PREFIX_TO_LANGUAGE_SORTED) {
		if (normalized.startsWith(prefix)) return lang;
	}
	return "en";
}
