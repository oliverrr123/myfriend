export type GeocodedLocation = {
	name: string;
	latitude: number;
	longitude: number;
	timezone: string;
	country?: string;
	admin1?: string;
};

export type WeatherSnapshot = {
	location: GeocodedLocation;
	temperatureC: number;
	conditions: string;
	windSpeedKmh: number;
	highC: number | null;
	lowC: number | null;
	precipitationChancePercent: number | null;
};

const WEATHER_DESCRIPTION_EN: Record<number, string> = {
	0: "clear skies",
	1: "mainly clear",
	2: "partly cloudy",
	3: "overcast",
	45: "foggy",
	48: "foggy",
	51: "light drizzle",
	53: "drizzle",
	55: "heavy drizzle",
	56: "freezing drizzle",
	57: "freezing drizzle",
	61: "light rain",
	63: "rain",
	65: "heavy rain",
	66: "freezing rain",
	67: "freezing rain",
	71: "light snow",
	73: "snow",
	75: "heavy snow",
	77: "snow grains",
	80: "light rain showers",
	81: "rain showers",
	82: "heavy rain showers",
	85: "snow showers",
	86: "heavy snow showers",
	95: "thunderstorms",
	96: "thunderstorms with hail",
	99: "thunderstorms with hail",
};

const WEATHER_DESCRIPTION_CS: Record<number, string> = {
	0: "jasno",
	1: "skoro jasno",
	2: "polojasno",
	3: "zataženo",
	45: "mlha",
	48: "mlha",
	51: "slabé mrholení",
	53: "mrholení",
	55: "silné mrholení",
	56: "mrznoucí mrholení",
	57: "mrznoucí mrholení",
	61: "slabý déšť",
	63: "déšť",
	65: "silný déšť",
	66: "mrznoucí déšť",
	67: "mrznoucí déšť",
	71: "slabé sněžení",
	73: "sněžení",
	75: "silné sněžení",
	77: "sněhové krupky",
	80: "slabé přeháňky",
	81: "přeháňky",
	82: "silné přeháňky",
	85: "sněhové přeháňky",
	86: "silné sněhové přeháňky",
	95: "bouřky",
	96: "bouřky s krupobitím",
	99: "bouřky s krupobitím",
};

function describeWeatherCode(code: number, language: string): string {
	const table = language === "cs" ? WEATHER_DESCRIPTION_CS : WEATHER_DESCRIPTION_EN;
	return table[code] ?? (language === "cs" ? "proměnlivé počasí" : "changeable weather");
}

function formatLocationLabel(location: GeocodedLocation): string {
	if (location.admin1 && location.admin1 !== location.name) {
		return `${location.name}, ${location.admin1}`;
	}
	return location.name;
}

function roundTemperature(value: number): number {
	return Math.round(value);
}

export async function geocodeLocation(
	name: string,
	language = "en",
): Promise<GeocodedLocation | null> {
	const params = new URLSearchParams({
		name,
		count: "1",
		language,
		format: "json",
	});

	const response = await fetch(
		`https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`,
	);
	if (!response.ok) {
		throw new Error(`Geocoding failed with HTTP ${response.status}`);
	}

	const json = (await response.json()) as {
		results?: Array<{
			name: string;
			latitude: number;
			longitude: number;
			timezone: string;
			country?: string;
			admin1?: string;
		}>;
	};

	const result = json.results?.[0];
	if (!result) return null;

	return {
		name: result.name,
		latitude: result.latitude,
		longitude: result.longitude,
		timezone: result.timezone,
		country: result.country,
		admin1: result.admin1,
	};
}

export async function fetchWeatherSnapshot(params: {
	location: GeocodedLocation;
	language?: string;
}): Promise<WeatherSnapshot> {
	const timezone = params.location.timezone || "auto";
	const forecastParams = new URLSearchParams({
		latitude: String(params.location.latitude),
		longitude: String(params.location.longitude),
		timezone,
		forecast_days: "1",
		current: "temperature_2m,weather_code,wind_speed_10m",
		daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
	});

	const response = await fetch(
		`https://api.open-meteo.com/v1/forecast?${forecastParams.toString()}`,
	);
	if (!response.ok) {
		throw new Error(`Weather forecast failed with HTTP ${response.status}`);
	}

	const json = (await response.json()) as {
		current?: {
			temperature_2m?: number;
			weather_code?: number;
			wind_speed_10m?: number;
		};
		daily?: {
			temperature_2m_max?: number[];
			temperature_2m_min?: number[];
			precipitation_probability_max?: number[];
			weather_code?: number[];
		};
	};

	const currentTemp = json.current?.temperature_2m;
	const currentCode = json.current?.weather_code;
	if (currentTemp === undefined || currentCode === undefined) {
		throw new Error("Weather forecast response missing current conditions");
	}

	const language = params.language === "cs" ? "cs" : "en";

	return {
		location: params.location,
		temperatureC: roundTemperature(currentTemp),
		conditions: describeWeatherCode(currentCode, language),
		windSpeedKmh: Math.round(json.current?.wind_speed_10m ?? 0),
		highC:
			json.daily?.temperature_2m_max?.[0] !== undefined
				? roundTemperature(json.daily.temperature_2m_max[0])
				: null,
		lowC:
			json.daily?.temperature_2m_min?.[0] !== undefined
				? roundTemperature(json.daily.temperature_2m_min[0])
				: null,
		precipitationChancePercent:
			json.daily?.precipitation_probability_max?.[0] ?? null,
	};
}

export function buildWeatherSummary(
	snapshot: WeatherSnapshot,
	language: string,
): string {
	const place = formatLocationLabel(snapshot.location);
	const isCs = language === "cs";

	if (isCs) {
		let summary = `V ${place} je teď asi ${snapshot.temperatureC} stupňů a ${snapshot.conditions}.`;
		if (snapshot.highC !== null && snapshot.lowC !== null) {
			summary += ` Dnes nejvýš kolem ${snapshot.highC} a nejnižší asi ${snapshot.lowC} stupňů.`;
		}
		if (
			snapshot.precipitationChancePercent !== null &&
			snapshot.precipitationChancePercent >= 30
		) {
			summary += ` Šance na déšť dnes asi ${snapshot.precipitationChancePercent} procent.`;
		}
		return summary;
	}

	let summary = `In ${place} it is about ${snapshot.temperatureC} degrees and ${snapshot.conditions} right now.`;
	if (snapshot.highC !== null && snapshot.lowC !== null) {
		summary += ` Today's high is around ${snapshot.highC} and the low about ${snapshot.lowC} degrees.`;
	}
	if (
		snapshot.precipitationChancePercent !== null &&
		snapshot.precipitationChancePercent >= 30
	) {
		summary += ` Chance of rain today is about ${snapshot.precipitationChancePercent} percent.`;
	}
	return summary;
}

export async function getWeatherForLocationQuery(params: {
	locationQuery: string;
	language?: string | null;
}): Promise<{ snapshot: WeatherSnapshot; summary: string }> {
	const language = params.language === "cs" ? "cs" : "en";
	const geocoded = await geocodeLocation(params.locationQuery, language);
	if (!geocoded) {
		throw new Error("LOCATION_NOT_FOUND");
	}

	const snapshot = await fetchWeatherSnapshot({
		location: geocoded,
		language,
	});

	return {
		snapshot,
		summary: buildWeatherSummary(snapshot, language),
	};
}
