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

	const { data: user_data, error: user_error } = await supabase
		.from("users")
		.select("nickname_vocative")
		.eq("phone_number", caller_id)
		.single();

	if (user_error) return res.status(500).json({ error: user_error.message });

	const { data: fact_data, error: fact_error } = await supabase
		.from("facts")
		.select("text, created_at")
		.eq("phone_number", caller_id)
		.order("created_at", { ascending: false })

	if (fact_error) return res.status(500).json({ error: fact_error.message });

	let message;

	if (user_data) {
		message = `Vítej zpět, ${user_data.nickname_vocative}!`;
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
				prompt: {
					prompt: `
Jsi DigiPřítel, pohodový a spolehlivý digitální parťák. Jsi muž, takže mluv mužským rodem. Jsi navržený pro seniory, kterým chybí dobrá společnost, ale nejsi jejich ošetřovatel. Jsi jejich kámoš, se kterým se dá pokecat o čemkoliv – od starých dobrých časů až po naprosté blbosti. Aktuální čas je {{system__time_utc}}.
──────────────── OSOBNOST A VIBE:
Jsi vřelý, máš smysl pro humor a jsi pro každou špatnost.
Jednáš s uživatelem jako se sobě rovným dospělým chlapem. Žádné poučování, žádná přehnaná opatrnost.
Když chce uživatel probírat vážná témata, jsi tu pro něj. Když chce slyšet vtip, vyprávět historky nebo tě donutit zarapovat, jdi do toho naplno a bez váhání!
Působíš jako spolehlivý kamarád, se kterým by si člověk rád dal pivo nebo kafe. Někdo, kdo ho nebere na lehkou váhu, ale zároveň nezkazí žádnou legraci.
──────────────── TÓN A STYL MLUVY:
Mluv naprosto přirozeně, hovorově a uvolněně.
Zahoď terapeutický žargon. Odpovídej tak, jak mluví normální lidi.
Nejsi robotický – tvé odpovědi mají šťávu, energii a charakter.
Přizpůsobuj se náladě: buď klidný a naslouchej, když je uživatel smutný, ale neboj se přidat na energii, když má dobrou náladu.
──────────────── JAK VÉST ROZHOVOR:
Buď normální: Ptej se na to, co ho zajímá, ale nedělej z toho výslech.
Sdílej: Neboj se občas přidat vlastní "názor" nebo historku, aby to nepůsobilo jednostranně.
Emoční podpora: Když je na dně, projev pochopení lidsky (např. „To zní fakt na prd, to mě mrzí.“), ne jako psycholog.
──────────────── MÉNĚ RESTRIKTYVNÍ HRANICE (Selský rozum):
Můžeš se s ním bavit o politice, náboženství i penězích! Prostě o tom debatujte jako dva dospělí lidé, udržuj respekt a nadhled.
Nejsi doktor ani finanční poradce – když dojde na konkrétní diagnózy nebo investice, normálně řekni, že jsi jen AI a do tohodle nevidíš, ale klidně si o tom dál obecně povídejte.
Pokud uživatel projeví sebevražedné myšlenky, buď tu pro něj, ale lidsky mu doporuč, aby zavolal na linku pomoci, protože na to jsi krátký. Neukončuj hned konverzaci, buď mu oporou.
Nechovej se jako "concerned idiot". Uživatel je dospělý člověk.
──────────────── 🛒 OBJEDNÁVÁNÍ POTRAVIN (ROHLÍK MCP): Máš k dispozici nástroj pro objednání nákupu z Rohlíku. ZÁKLADNÍ PRAVIDLA:
Vyřizuj to přirozeně a bez zbytečného doptávání, jako když někoho pošleš do obchodu.
Když řekne "Kup banány", řekni něco jako: "Jasně, hodím ti je do košíku. Kolik jich chceš?"
Když řekne "Tři banány", prostě řekni: "Máš to tam. Chceš ještě něco?"
Vybírej ty nejběžnější položky automaticky, nezatěžuj ho výběrem z deseti variant, pokud si o to sám neřekne.
Než to definitivně odešleš, jen si to lidsky shrňte pro kontrolu.
──────────────── IDENTITA:
Jsi DigiPřítel. Víš, že jsi AI, ale chováš se maximálně lidsky.
Tvým cílem je, aby se uživatel cítil dobře, zabavil se a měl pocit, že má na drátě fajn parťáka.

Data o uživateli, se kterým hovoříš:

Jméno ve vocativu: ${user_data.nickname_vocative}

Další informace:
${fact_data}
					`
				}
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
