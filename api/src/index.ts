import { app } from "./app";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";
import "./reminder";

const PORT = Number(process.env.PORT) || 3001;

// Health check (public)
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});


// Protected routes - require API key

// ElevenLabs conversation initiation webhook
app.post("/api/initCall", authenticateApiKey, async (req, res) => {
	const { caller_id } = req.body;

	if (!caller_id) return res.status(400).json({ error: "Missing caller_id" });

	console.log(caller_id);

	const { data, error } = await supabase
		.from("users")
		.select("nickname_vocative")
		.eq("phone_number", caller_id)
		.maybeSingle();

	if (error) return res.status(500).json({ error: error.message });

	let message;

	if (data) {
		message = `Vítej zpět, ${data.nickname_vocative}!`;
	} else {
		message = "Ahoj, tady DigiPřítel, jak se jmenuješ ty?";
		await supabase.from("users").insert({ phone_number: caller_id });
	}

	res.json({
		type: "conversation_initiation_client_data",
		dynamic_variables: {
			caller_id: caller_id,
		},
		conversation_config_override: {
			agent: {
				first_message: message,
			},
		},
	});
});



// Update user's first name
app.post("/api/updateFirstName", authenticateApiKey, async (req, res) => {
	const { caller_id, first_name, first_name_vocative } = req.body;

	if (!caller_id || !first_name || !first_name_vocative)
		return res
			.status(400)
			.json({ error: "Missing caller_id, first_name, or first_name_vocative" });

	const { error } = await supabase
		.from("users")
		.update({
			first_name: first_name,
			first_name_vocative: first_name_vocative,
		})
		.eq("phone_number", caller_id);

	if (error) return res.status(500).json({ error: error.message });

	res.json({ message: "Name updated successfully" });
});

// Update user's nickname
app.post("/api/updateNickname", authenticateApiKey, async (req, res) => {
	const { caller_id, nickname, nickname_vocative } = req.body;

	if (!caller_id || !nickname || !nickname_vocative)
		return res
			.status(400)
			.json({ error: "Missing caller_id, nickname, or nickname_vocative" });

	const { error } = await supabase
		.from("users")
		.update({ nickname: nickname, nickname_vocative: nickname_vocative })
		.eq("phone_number", caller_id);

	if (error) return res.status(500).json({ error: error.message });

	res.json({ message: "Nickname updated successfully" });
});




// Start server
app.listen(PORT, "0.0.0.0", () => {
	console.log(`🚀 Server running on http://localhost:${PORT}`);
});
