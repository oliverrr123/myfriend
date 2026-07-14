/** Default city names for common IANA timezones when users have no saved city. */
const TIMEZONE_DEFAULT_CITY: Record<string, string> = {
	"Europe/Prague": "Prague",
	"Europe/Bratislava": "Bratislava",
	"Europe/Berlin": "Berlin",
	"Europe/Vienna": "Vienna",
	"Europe/Warsaw": "Warsaw",
	"Europe/Budapest": "Budapest",
	"Europe/Paris": "Paris",
	"Europe/Madrid": "Madrid",
	"Europe/Rome": "Rome",
	"Europe/Amsterdam": "Amsterdam",
	"Europe/Brussels": "Brussels",
	"Europe/Copenhagen": "Copenhagen",
	"Europe/Stockholm": "Stockholm",
	"Europe/Oslo": "Oslo",
	"Europe/Helsinki": "Helsinki",
	"Europe/London": "London",
	"Europe/Dublin": "Dublin",
	"Europe/Lisbon": "Lisbon",
	"Europe/Athens": "Athens",
	"Europe/Bucharest": "Bucharest",
	"Europe/Ljubljana": "Ljubljana",
	"Europe/Zagreb": "Zagreb",
	"Europe/Belgrade": "Belgrade",
	"Europe/Kyiv": "Kyiv",
	"America/New_York": "New York",
	"America/Chicago": "Chicago",
	"America/Denver": "Denver",
	"America/Los_Angeles": "Los Angeles",
	"America/Phoenix": "Phoenix",
	"Asia/Tokyo": "Tokyo",
	"Asia/Seoul": "Seoul",
	"Asia/Shanghai": "Shanghai",
	"Asia/Jerusalem": "Jerusalem",
	"Asia/Dubai": "Dubai",
	"Asia/Riyadh": "Riyadh",
	"Asia/Kolkata": "Mumbai",
	"Asia/Singapore": "Singapore",
	"Pacific/Auckland": "Auckland",
	"Africa/Johannesburg": "Johannesburg",
};

export function defaultCityForTimezone(timezone: string | null | undefined): string | null {
	if (!timezone) return null;
	return TIMEZONE_DEFAULT_CITY[timezone] ?? null;
}

export function resolveWeatherLocationQuery(params: {
	requestedLocation?: string;
	savedCity?: string | null;
	timezone?: string | null;
}): { query: string; source: "request" | "saved_city" | "timezone_default" } | null {
	const requested = params.requestedLocation?.trim();
	if (requested) {
		return { query: requested, source: "request" };
	}

	const savedCity = params.savedCity?.trim();
	if (savedCity) {
		return { query: savedCity, source: "saved_city" };
	}

	const fallbackCity = defaultCityForTimezone(params.timezone);
	if (fallbackCity) {
		return { query: fallbackCity, source: "timezone_default" };
	}

	return null;
}
