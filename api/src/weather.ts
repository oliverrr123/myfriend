import { app } from "./app";
import { resolveUserPhoneNumberFromBody } from "./lib/callParticipants";
import { getWeatherForLocationQuery } from "./lib/openMeteo";
import { resolveWeatherLocationQuery } from "./lib/weatherLocation";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";

app.post("/api/getWeather", authenticateApiKey, async (req, res) => {
	const caller_id = resolveUserPhoneNumberFromBody(req.body);
	const requestedLocation =
		typeof req.body.location === "string" ? req.body.location.trim() : "";

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}

	let savedUser: {
		language?: string | null;
		timezone?: string | null;
		city?: string | null;
	} | null = null;

	const { data: user, error: userError } = await supabase
		.from("users")
		.select("language, timezone, city")
		.eq("phone_number", caller_id)
		.maybeSingle();

	if (userError?.message?.includes("city")) {
		const fallback = await supabase
			.from("users")
			.select("language, timezone")
			.eq("phone_number", caller_id)
			.maybeSingle();
		if (fallback.error) {
			return res.status(500).json({ error: fallback.error.message });
		}
		savedUser = fallback.data;
	} else if (userError) {
		return res.status(500).json({ error: userError.message });
	} else {
		savedUser = user;
	}

	const resolved = resolveWeatherLocationQuery({
		requestedLocation,
		savedCity: savedUser?.city,
		timezone: savedUser?.timezone,
	});

	if (!resolved) {
		return res.status(400).json({
			error: "Missing location. Ask the user which city or town they mean, or save their city with updateTimezone.",
			code: "ask_for_location",
		});
	}

	try {
		const { snapshot, summary } = await getWeatherForLocationQuery({
			locationQuery: resolved.query,
			language: savedUser?.language,
		});

		res.json({
			message: "Weather fetched successfully",
			location: snapshot.location.name,
			location_label: snapshot.location.admin1
				? `${snapshot.location.name}, ${snapshot.location.admin1}`
				: snapshot.location.name,
			location_source: resolved.source,
			temperature_c: snapshot.temperatureC,
			conditions: snapshot.conditions,
			high_c: snapshot.highC,
			low_c: snapshot.lowC,
			precipitation_chance_percent: snapshot.precipitationChancePercent,
			wind_speed_kmh: snapshot.windSpeedKmh,
			summary,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === "LOCATION_NOT_FOUND") {
			return res.status(404).json({
				error: `Could not find weather for "${resolved.query}". Ask the user to clarify the city or town.`,
				code: "location_not_found",
			});
		}

		console.error("Weather lookup failed:", error);
		return res.status(502).json({
			error: "Weather service is temporarily unavailable",
			code: "weather_unavailable",
		});
	}
});
