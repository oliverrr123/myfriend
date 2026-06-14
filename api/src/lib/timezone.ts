type TimezoneInference = {
	timezone: string | null;
	ambiguous: boolean;
	reason: string;
};

const TIMEZONE_ALIASES: Record<string, string> = {
	eastern: "America/New_York",
	"eastern time": "America/New_York",
	et: "America/New_York",
	est: "America/New_York",
	edt: "America/New_York",
	central: "America/Chicago",
	"central time": "America/Chicago",
	ct: "America/Chicago",
	cst: "America/Chicago",
	cdt: "America/Chicago",
	mountain: "America/Denver",
	"mountain time": "America/Denver",
	mt: "America/Denver",
	mst: "America/Denver",
	mdt: "America/Denver",
	pacific: "America/Los_Angeles",
	"pacific time": "America/Los_Angeles",
	pt: "America/Los_Angeles",
	pst: "America/Los_Angeles",
	pdt: "America/Los_Angeles",
	arizona: "America/Phoenix",
};

const SINGLE_TIMEZONE_PREFIX_ENTRIES: [string, string][] = [
	["+420", "Europe/Prague"],
	["+421", "Europe/Bratislava"],
	["+49", "Europe/Berlin"],
	["+43", "Europe/Vienna"],
	["+48", "Europe/Warsaw"],
	["+36", "Europe/Budapest"],
	["+33", "Europe/Paris"],
	["+34", "Europe/Madrid"],
	["+39", "Europe/Rome"],
	["+31", "Europe/Amsterdam"],
	["+32", "Europe/Brussels"],
	["+45", "Europe/Copenhagen"],
	["+46", "Europe/Stockholm"],
	["+47", "Europe/Oslo"],
	["+358", "Europe/Helsinki"],
	["+44", "Europe/London"],
	["+353", "Europe/Dublin"],
	["+351", "Europe/Lisbon"],
	["+30", "Europe/Athens"],
	["+40", "Europe/Bucharest"],
	["+386", "Europe/Ljubljana"],
	["+385", "Europe/Zagreb"],
	["+381", "Europe/Belgrade"],
	["+380", "Europe/Kyiv"],
	["+972", "Asia/Jerusalem"],
	["+971", "Asia/Dubai"],
	["+966", "Asia/Riyadh"],
	["+91", "Asia/Kolkata"],
	["+81", "Asia/Tokyo"],
	["+82", "Asia/Seoul"],
	["+86", "Asia/Shanghai"],
	["+65", "Asia/Singapore"],
	["+64", "Pacific/Auckland"],
	["+27", "Africa/Johannesburg"],
];

const SINGLE_TIMEZONE_PREFIXES: [string, string][] = [
	...SINGLE_TIMEZONE_PREFIX_ENTRIES,
].sort((a, b) => b[0].length - a[0].length);

const AMBIGUOUS_TIMEZONE_PREFIXES = [
	"+1",
	"+7",
	"+52",
	"+55",
	"+56",
	"+57",
	"+58",
	"+61",
	"+62",
	"+63",
	"+90",
	"+98",
].sort((a, b) => b.length - a.length);

export function isValidTimezone(timezone: string): boolean {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
		return true;
	} catch {
		return false;
	}
}

export function normalizeTimezone(raw: unknown): string | null {
	if (typeof raw !== "string") return null;
	const trimmed = raw.trim();
	const timezone = TIMEZONE_ALIASES[trimmed.toLowerCase()] ?? trimmed;
	if (!timezone || !isValidTimezone(timezone)) return null;
	return timezone;
}

export function inferTimezoneFromE164(callerId: string): TimezoneInference {
	const normalized = callerId.trim().replace(/[\s-]/g, "");
	if (!normalized.startsWith("+")) {
		return {
			timezone: null,
			ambiguous: true,
			reason: "Phone number is not in E.164 format.",
		};
	}

	for (const [prefix, timezone] of SINGLE_TIMEZONE_PREFIXES) {
		if (normalized.startsWith(prefix)) {
			return {
				timezone,
				ambiguous: false,
				reason: `Phone prefix ${prefix} maps to ${timezone}.`,
			};
		}
	}

	for (const prefix of AMBIGUOUS_TIMEZONE_PREFIXES) {
		if (normalized.startsWith(prefix)) {
			return {
				timezone: null,
				ambiguous: true,
				reason: `Phone prefix ${prefix} covers multiple timezones.`,
			};
		}
	}

	return {
		timezone: null,
		ambiguous: true,
		reason: "No timezone mapping for this phone prefix.",
	};
}

export function timeZoneParts(
	date: Date,
	timezone: string,
): {
	year: number;
	month: number;
	day: number;
	weekday: number;
	hour: number;
	minute: number;
	second: number;
} {
	const parts = new Intl.DateTimeFormat("en-CA", {
		timeZone: timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
		weekday: "short",
	}).formatToParts(date);

	const value = (type: string) =>
		parts.find((part) => part.type === type)?.value ?? "0";
	const weekdayMap: Record<string, number> = {
		Sun: 0,
		Mon: 1,
		Tue: 2,
		Wed: 3,
		Thu: 4,
		Fri: 5,
		Sat: 6,
	};

	return {
		year: Number(value("year")),
		month: Number(value("month")),
		day: Number(value("day")),
		weekday: weekdayMap[value("weekday")] ?? date.getDay(),
		hour: Number(value("hour")),
		minute: Number(value("minute")),
		second: Number(value("second")),
	};
}

export function cronDateNumber(parts: {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}): number {
	return Number(
		`${parts.year}${String(parts.month).padStart(2, "0")}${String(parts.day).padStart(2, "0")}${String(parts.hour).padStart(2, "0")}${String(parts.minute).padStart(2, "0")}${String(parts.second).padStart(2, "0")}`,
	);
}
