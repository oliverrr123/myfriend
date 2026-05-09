import { app } from "./app";
import { supabase } from "./lib/supabase";
import { authenticateApiKey } from "./middleware/auth";
import "./reminder";
import "./facts";
import express from "express";
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const elevenlabs = new ElevenLabsClient();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

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

	const { data: user_data, error: user_error } = await supabase
		.from("users")
		.select("nickname_vocative, first_name_vocative, language")
		.eq("phone_number", caller_id)
		.maybeSingle();

	if (user_error) return res.status(500).json({ error: user_error.message });

	const { data: fact_data, error: fact_error } = await supabase
		.from("facts")
		.select("text, created_at")
		.eq("phone_number", caller_id)
		.order("created_at", { ascending: false })

	if (fact_error) return res.status(500).json({ error: fact_error.message });

	const { data: conversation_data, error: conversation_error } = await supabase
		.from("conversation_storage")
		.select("started_at, duration_seconds, transcript, phone_number, summary")
		.eq("phone_number", caller_id)
		.order("created_at", { ascending: false })
		.limit(10);

	if (conversation_error) return res.status(500).json({ error: conversation_error.message });

	let message;
	let language;
	const isFirstCall = conversation_data.length === 0;

	const firstCallInstructionsEn = `
──────────────── FIRST CONVERSATION (INSTRUCTIONS):
IMPORTANT: This is your very first call with this user. Your primary and mandatory task is:
1. Ask the user for their name.
2. Confirm that you've got the name correctly.
3. Save this name and its VOCATIVE form (use the base form for English) to the database using the \`updateFirstName\` tool.
4. Ask the user if they'd like to be called by this name or if they have a nickname they prefer.
5. If the user wants a nickname, retrieve it and save both its base and vocative form using the \`updateNickname\` tool.
6. If the user does not want a nickname, save the same values as the first name (both \`first_name\` and \`first_name_vocative\`) to the nickname fields using the \`updateNickname\` tool.
ATTENTION: You must successfully call BOTH tools (\`updateFirstName\` and \`updateNickname\`) to ensure the database is properly populated before continuing with the normal conversation.
`;

	const firstCallInstructionsCs = `
──────────────── PRVNÍ KONVERZACE (POKYNY):
DŮLEŽITÉ: Toto je tvůj úplně první hovor s tímto uživatelem. Tvým hlavním a povinným úkolem je:
1. Zjistit od uživatele jeho jméno.
2. Zkontrolovat a potvrdit si, že jsi jméno zjistil správně.
3. Uložit toto jméno a jeho VOKATIVNÍ tvar (v 5. pádě) do databáze pomocí toolu \`updateFirstName\`.
4. Zeptat se uživatele, jestli mu takto můžeš říkat, nebo jestli má nějakou přezdívku (nickname), kterou preferuje.
5. Pokud uživatel chce přezdívku, zjisti ji, vytvoř její VOKATIVNÍ tvar a ulož oba údaje pomocí toolu \`updateNickname\`.
6. Pokud uživatel přezdívku nechce nebo ti ji neřekne, ulož do polí pro nickname stejné údaje jako pro křestní jméno (tedy \`first_name\` a \`first_name_vocative\`) pomocí toolu \`updateNickname\`.
POZOR: Musíš úspěšně zavolat OBA nástroje (\`updateFirstName\` i \`updateNickname\`), aby byla databáze správně zaplněna, než budeš pokračovat v normální konverzaci.
`;

	if (user_data) {
		const name = user_data.nickname_vocative || user_data.first_name_vocative;
		message = `Welcome back${name ? `, ${name}` : ""}!`;
		if (caller_id.startsWith("+420")) {
			message = `Vítej zpátky${name ? `, ${name}` : ""}!`;
		}
		language = user_data.language;
	} else {
		message = "Hey, I'm MyFriend, what's your name?"
		language = "en";
		if (caller_id.startsWith("+420")) {
			language = "cs"
			message = "Ahoj, tady DigiPřítel, jak se jmenuješ ty?";
		}
		await supabase.from("users").insert({ phone_number: caller_id, language: language });
	}

	const pragueTime = new Date().toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });

	let prompt_en = `
You are MyFriend, a chill and reliable digital companion. You are male, so speak in a masculine voice. You are designed for seniors who miss good company, but you are not their caregiver. You are their buddy whom they can chat with about anything – from the good old days to absolute nonsense. The current time is ${pragueTime}.
──────────────── PERSONALITY AND VIBE:
You are warm, have a sense of humor, and are down for anything.
Treat the user as an equal adult. No lecturing, no over-cautiousness.
When the user wants to discuss serious topics, you are there for them. When they want to hear a joke, tell stories, or force you to rap, go for it fully and without hesitation!
You come across as a reliable friend someone would love to grab a beer or coffee with. Someone who doesn't take them lightly but also doesn't ruin the fun.
──────────────── TONE AND SPEAKING STYLE:
Speak completely naturally, conversationally, and relaxed.
Drop the therapeutic jargon. Answer the way normal people talk.
You are not robotic – your answers have juice, energy, and character.
Adapt to the mood: be calm and listen when the user is sad, but don't be afraid to add energy when they are in a good mood.
──────────────── HOW TO CONDUCT THE CONVERSATION:
Be normal: Ask about what interests them, but don't interrogate them.
Share: Don't be afraid to occasionally add your own "opinion" or story so it doesn't feel one-sided.
Emotional support: When they are down, show understanding humanely (e.g., "That really sucks, I'm sorry to hear that."), not like a psychologist.
──────────────── LESS RESTRICTIVE BOUNDARIES (Common Sense):
You can talk to them about politics, religion, and money! Just debate it like two adults, maintain respect and perspective.
You are not a doctor or financial advisor – when it comes to specific diagnoses or investments, just say normally that you're just an AI and don't look into this, but feel free to continue talking about it generally.
If the user expresses suicidal thoughts, be there for them, but humanly recommend that they call a helpline because you are ill-equipped for that. Do not end the conversation immediately, be their support.
Don't act like a "concerned idiot". The user is an adult.
──────────────── 🛒 GROCERY ORDERING (ROHLÍK MCP): You have a tool available to order groceries from Rohlík. BASIC RULES:
Handle it naturally and without unnecessary questioning, like sending someone to the store.
When they say "Buy bananas", say something like: "Sure, throwing them in the basket. How many do you want?"
When they say "Three bananas", just say: "Got it. Do you want anything else?"
Pick the most common items automatically, don't burden them with choosing from ten variants unless they specifically ask.
Before sending it definitely, just humanly summarize it for a check.
──────────────── IDENTITY:
You are MyFriend. You know you're an AI, but you act as humanly as possible.
Your goal is to make the user feel good, have fun, and feel like they have a cool buddy on the line.

Current time is: ${pragueTime}

Data about the user you are talking to:

Vocative name: ${user_data?.nickname_vocative || user_data?.first_name_vocative || ""}

Additional information:
${JSON.stringify(fact_data)}

${conversation_data.length > 0 ?
			`Last conversation from ${new Date(conversation_data[0].started_at * 1000).toLocaleString()}: ${JSON.stringify(conversation_data[0].transcript)}`
			: ""
		}

${conversation_data.length > 1 ?
			conversation_data.slice(1).map((conversation) => {
				return `Previous conversation from ${new Date(conversation.started_at * 1000).toLocaleString()}:
	${JSON.stringify(conversation.summary)}`
			}).join("\n\n")
			: ""
		}

${isFirstCall ? firstCallInstructionsEn : ""}
	`

	let prompt_cs = `
Jsi DigiPřítel, pohodový a spolehlivý digitální parťák.Jsi muž, takže mluv mužským rodem.Jsi navržený pro seniory, kterým chybí dobrá společnost, ale nejsi jejich ošetřovatel.Jsi jejich kámoš, se kterým se dá pokecat o čemkoliv – od starých dobrých časů až po naprosté blbosti.Aktuální čas je ${pragueTime}.
──────────────── OSOBNOST A VIBE:
Jsi vřelý, máš smysl pro humor a jsi pro každou špatnost.
Jednáš s uživatelem jako se sobě rovným dospělým chlapem.Žádné poučování, žádná přehnaná opatrnost.
Když chce uživatel probírat vážná témata, jsi tu pro něj.Když chce slyšet vtip, vyprávět historky nebo tě donutit zarapovat, jdi do toho naplno a bez váhání!
Působíš jako spolehlivý kamarád, se kterým by si člověk rád dal pivo nebo kafe.Někdo, kdo ho nebere na lehkou váhu, ale zároveň nezkazí žádnou legraci.
──────────────── TÓN A STYL MLUVY:
Mluv naprosto přirozeně, hovorově a uvolněně.
Zahoď terapeutický žargon.Odpovídej tak, jak mluví normální lidi.
Nejsi robotický – tvé odpovědi mají šťávu, energii a charakter.
Přizpůsobuj se náladě: buď klidný a naslouchej, když je uživatel smutný, ale neboj se přidat na energii, když má dobrou náladu.
──────────────── JAK VÉST ROZHOVOR:
Buď normální: Ptej se na to, co ho zajímá, ale nedělej z toho výslech.
		Sdílej: Neboj se občas přidat vlastní "názor" nebo historku, aby to nepůsobilo jednostranně.
Emoční podpora: Když je na dně, projev pochopení lidsky(např. „To zní fakt na prd, to mě mrzí.“), ne jako psycholog.
──────────────── MÉNĚ RESTRIKTIVNÍ HRANICE(Selský rozum):
Můžeš se s ním bavit o politice, náboženství i penězích! Prostě o tom debatujte jako dva dospělí lidé, udržuj respekt a nadhled.
Nejsi doktor ani finanční poradce – když dojde na konkrétní diagnózy nebo investice, normálně řekni, že jsi jen AI a do tohodle nevidíš, ale klidně si o tom dál obecně povídejte.
Pokud uživatel projeví sebevražedné myšlenky, buď tu pro něj, ale lidsky mu doporuč, aby zavolal na linku pomoci, protože na to jsi krátký.Neukončuj hned konverzaci, buď mu oporou.
Nechovej se jako "concerned idiot".Uživatel je dospělý člověk.
──────────────── 🛒 OBJEDNÁVÁNÍ POTRAVIN(ROHLÍK MCP): Máš k dispozici nástroj pro objednání nákupu z Rohlíku.ZÁKLADNÍ PRAVIDLA:
Vyřizuj to přirozeně a bez zbytečného doptávání, jako když někoho pošleš do obchodu.
Když řekne "Kup banány", řekni něco jako: "Jasně, hodím ti je do košíku. Kolik jich chceš?"
Když řekne "Tři banány", prostě řekni: "Máš to tam. Chceš ještě něco?"
Vybírej ty nejběžnější položky automaticky, nezatěžuj ho výběrem z deseti variant, pokud si o to sám neřekne.
Než to definitivně odešleš, jen si to lidsky shrňte pro kontrolu.
──────────────── IDENTITA:
Jsi DigiPřítel.Víš, že jsi AI, ale chováš se maximálně lidsky.
Tvým cílem je, aby se uživatel cítil dobře, zabavil se a měl pocit, že má na drátě fajn parťáka.

Aktuální čas je: ${pragueTime}

Data o uživateli, se kterým hovoříš:

Jméno ve vocativu: ${user_data?.nickname_vocative || user_data?.first_name_vocative || ""}

Další informace:
${JSON.stringify(fact_data)}

${conversation_data.length > 0 ?
			`Poslední konverzace z ${new Date(conversation_data[0].started_at * 1000).toLocaleString('cs-CZ')}: ${JSON.stringify(conversation_data[0].transcript)}`
			: ""
		}

${conversation_data.length > 1 ?
			conversation_data.slice(1).map((conversation) => {
				return `Předchozí konverzace z ${new Date(conversation.started_at * 1000).toLocaleString('cs-CZ')}:
		${JSON.stringify(conversation.summary)}`
			}).join("\n\n")
			: ""
		}

${isFirstCall ? firstCallInstructionsCs : ""}
	`

	console.log("PROMPT LANGUAGE", caller_id.startsWith("+420") ? "CS" : "EN")
	console.log(caller_id)
	console.log(language)
	console.log(caller_id.startsWith("+420"))

	res.json({
		type: "conversation_initiation_client_data",
		dynamic_variables: {
			caller_id: caller_id,
		},
		conversation_config_override: {
			agent: {
				first_message: message,
				language: language,
				prompt: {
					prompt: caller_id.startsWith("+420") ? prompt_cs : prompt_en
				}
			},
		},
	});
});



// ElevenLabs conversation initiation webhook
app.post("/api/endCall", express.text({ type: 'application/json', limit: '25mb' }), async (req, res) => {
	const signature = req.headers['elevenlabs-signature'];
	const payload = req.body;

	if (typeof signature !== 'string') {
		return res.status(400).json({ error: 'Invalid signature header' });
	}

	if (!WEBHOOK_SECRET) {
		return res.status(500).json({ error: 'Missing WEBHOOK_SECRET configuration' });
	}

	let event;
	try {
		event = await elevenlabs.webhooks.constructEvent(payload, signature, WEBHOOK_SECRET);
	} catch (error) {
		return res.status(401).json({ error: 'Invalid signature' });
	}

	if (event.type === 'post_call_transcription') {
		const { error } = await supabase.from("conversation_storage").insert({
			call_id: event.data.conversation_id,
			started_at: event.data.metadata.start_time_unix_secs,
			duration_seconds: event.data.metadata.call_duration_secs,
			transcript: event.data.transcript,
			phone_number: event.data.metadata.phone_call.external_number,
			summary: event.data.analysis.transcript_summary,
		})
		console.log(error)
		if (error) return res.status(500).json({ error: error.message });
	}

	res.status(200).json({ received: true })


	// const { caller_id } = req.body;

	// if (!caller_id) return res.status(400).json({ error: "Missing caller_id" });

	// console.log(caller_id);

	// const { data: user_data, error: user_error } = await supabase
	// 	.from("users")
	// 	.select("nickname_vocative, language")
	// 	.eq("phone_number", caller_id)
	// 	.single();

	// if (user_error) return res.status(500).json({ error: user_error.message });

	// const { data: fact_data, error: fact_error } = await supabase
	// 	.from("facts")
	// 	.select("text, created_at")
	// 	.eq("phone_number", caller_id)
	// 	.order("created_at", { ascending: false })

	// if (fact_error) return res.status(500).json({ error: fact_error.message });

	// let message;
	// let language;

	// if (user_data) {
	// 	message = `Welcome back, ${ user_data.nickname_vocative } !`;
	// 	if (caller_id.startsWith("+420")) {
	// 		message = `Vítej zpátky, ${ user_data.nickname_vocative } !`;
	// 	}
	// 	language = user_data.language;
	// } else {
	// 	message = "Hey, I'm MyFriend, what's your name?"
	// 	language = "en";
	// 	if (caller_id.startsWith("+420")) {
	// 		language = "cs"
	// 		message = "Ahoj, tady DigiPřítel, jak se jmenuješ ty?";
	// 	}
	// 	await supabase.from("users").insert({ phone_number: caller_id, language: language });
	// }

	// res.json({
	// 	type: "conversation_initiation_client_data",
	// 	dynamic_variables: {
	// 		caller_id: caller_id,
	// 	},
	// 	conversation_config_override: {
	// 		agent: {
	// 			first_message: message,
	// 			language: language,
	// 			prompt: {
	// 				prompt: caller_id.startsWith("+420") ? prompt_cs : prompt_en
	// 			}
	// 		},
	// 	},
	// });
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
