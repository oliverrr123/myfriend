import { app } from "./app";
import { resolveUserPhoneNumberFromBody } from "./lib/callParticipants";
import { inferLanguageCodeFromE164 } from "./lib/phoneLanguagePrefix";
import { supabase } from "./lib/supabase";
import { normalizeTimezone } from "./lib/timezone";
import { authenticateApiKey } from "./middleware/auth";
import "./reminder";
import "./facts";
import "./calling";
import "./weather";
import {
	analyzeAndPersistConversationTopics,
	formatActiveTopicsForPrompt,
	loadActiveTopicsForUser,
} from "./topics";
import express from "express";
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

const elevenlabs = new ElevenLabsClient();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

const PORT = Number(process.env.PORT) || 3001;

type VoiceGender = "male" | "female";
type VoiceName =
	| "male"
	| "american_female"
	| "american_female_2"
	| "american_male"
	| "american_male_2"
	| "japanese_male"
	| "japanese_female"
	| "czech_male"
	| "czech_female";

const VOICES: Record<
	VoiceName,
	{ id: string; gender: VoiceGender; aliases: string[] }
> = {
	male: {
		id: "KgTzZavF7McT7q0opsJu",
		gender: "male",
		aliases: ["male", "man", "muž", "muz", "mužský", "muzsky"],
	},
	american_female: {
		id: "bD9maNcCuQQS75DGuteM",
		gender: "female",
		aliases: [
			"american_female",
			"american female",
			"female",
			"woman",
			"žena",
			"zena",
			"ženský",
			"zensky",
		],
	},
	american_female_2: {
		id: "M6N6IdXhi5YNZyZSDe7k",
		gender: "female",
		aliases: [
			"american_female_2",
			"american female 2",
			"american_female2",
			"female 2",
			"female2",
		],
	},
	american_male: {
		id: "UgBBYS2sOqTuMpoF3BR0",
		gender: "male",
		aliases: ["american_male", "american male", "american", "americký", "americky"],
	},
	american_male_2: {
		id: "R9EZoy8pXSL8Yh4yxiew",
		gender: "male",
		aliases: [
			"american_male_2",
			"american male 2",
			"american_male2",
			"american 2",
			"americký 2",
			"americky 2",
		],
	},
	japanese_male: {
		id: "Mv8AjrYZCBkdsmDHNwcB",
		gender: "male",
		aliases: ["japanese_male", "japanese male", "japan male", "japonský", "japonsky"],
	},
	japanese_female: {
		id: "c2XJrw7TvNGtOc6r0ijG",
		gender: "female",
		aliases: [
			"japanese_female",
			"japanese female",
			"japan female",
			"japonská",
			"japonska",
		],
	},
	czech_male: {
		id: "vP4R9CqQI4q0HlVrXJWj",
		gender: "male",
		aliases: ["czech_male", "czech male", "český", "cesky", "český muž", "cesky muz"],
	},
	czech_female: {
		id: "cjDdmfVUe8VozmpZQVUC",
		gender: "female",
		aliases: [
			"czech_female",
			"czech female",
			"česká",
			"ceska",
			"česká žena",
			"ceska zena",
		],
	},
};

const VOICE_DEFAULT_NAME: VoiceName = "american_male";
const VOICE_DEFAULT = VOICES[VOICE_DEFAULT_NAME].id;
const VOICE_NAMES = Object.keys(VOICES) as VoiceName[];
const VOICE_NAMES_PROMPT = VOICE_NAMES.join(", ");

function normalizeVoiceKey(value: unknown): string {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
}

function resolveVoiceByName(value: unknown): {
	name: VoiceName;
	id: string;
	gender: VoiceGender;
} | null {
	const raw = String(value ?? "").trim().toLowerCase();
	if (!raw) return null;
	const normalized = normalizeVoiceKey(raw);

	for (const name of VOICE_NAMES) {
		const voice = VOICES[name];
		const keys = [name, ...voice.aliases].map((alias) =>
			normalizeVoiceKey(alias),
		);
		if (keys.includes(normalized) || voice.aliases.some((alias) => alias.toLowerCase() === raw)) {
			return { name, id: voice.id, gender: voice.gender };
		}
	}
	return null;
}

function resolveVoiceById(voiceId: unknown): {
	name: VoiceName;
	id: string;
	gender: VoiceGender;
} | null {
	if (typeof voiceId !== "string" || !voiceId.trim()) return null;
	for (const name of VOICE_NAMES) {
		const voice = VOICES[name];
		if (voice.id === voiceId) {
			return { name, id: voice.id, gender: voice.gender };
		}
	}
	return null;
}

/** ISO 639-1 codes accepted for users.language, persistUserLanguageToDatabase, and language_detection (must match agent languages in ElevenLabs). */
const SUPPORTED_CONVERSATION_LANGUAGES = [
	"af",
	"ar",
	"bg",
	"cs",
	"da",
	"de",
	"el",
	"en",
	"es",
	"fa",
	"fi",
	"fr",
	"he",
	"hi",
	"hr",
	"hu",
	"id",
	"is",
	"it",
	"ja",
	"kk",
	"ko",
	"lt",
	"lv",
	"mk",
	"mn",
	"ms",
	"ne",
	"no",
	"pa",
	"pl",
	"pt",
	"ro",
	"ru",
	"sk",
	"sl",
	"so",
	"sr",
	"sv",
	"th",
	"tr",
	"uk",
	"ur",
	"uz",
	"vi",
	"zh",
] as const;

type ConversationLanguage = (typeof SUPPORTED_CONVERSATION_LANGUAGES)[number];

const SUPPORTED_LANGUAGE_SET: ReadonlySet<string> = new Set(
	SUPPORTED_CONVERSATION_LANGUAGES,
);

/** Lowercase aliases (e.g. full English name) → canonical code */
const LANGUAGE_ALIASES: Record<string, ConversationLanguage> = {
	afrikaans: "af",
	arabic: "ar",
	bulgarian: "bg",
	cz: "cs",
	czech: "cs",
	english: "en",
	chinese: "zh",
	mandarin: "zh",
	croatian: "hr",
	danish: "da",
	farsi: "fa",
	finnish: "fi",
	french: "fr",
	german: "de",
	greek: "el",
	hebrew: "he",
	hindi: "hi",
	hungarian: "hu",
	icelandic: "is",
	indonesia: "id",
	indonesian: "id",
	italian: "it",
	japanese: "ja",
	kazakh: "kk",
	korean: "ko",
	latvian: "lv",
	lithuanian: "lt",
	macedonian: "mk",
	malay: "ms",
	mongolian: "mn",
	nepali: "ne",
	norwegian: "no",
	persian: "fa",
	polish: "pl",
	portuguese: "pt",
	punjabi: "pa",
	romanian: "ro",
	russian: "ru",
	serbian: "sr",
	slovak: "sk",
	slovenian: "sl",
	somali: "so",
	spanish: "es",
	swedish: "sv",
	thai: "th",
	turkish: "tr",
	ukrainian: "uk",
	urdu: "ur",
	uzbek: "uz",
	vietnamese: "vi",
};

function isConversationLanguage(s: string): s is ConversationLanguage {
	return SUPPORTED_LANGUAGE_SET.has(s);
}

const SUPPORTED_LANGUAGES_PROMPT_LIST =
	SUPPORTED_CONVERSATION_LANGUAGES.join(", ");

/** English-style names users often say → canonical code (for system prompt; tools always use the code). */
const LANGUAGE_ALIASES_PROMPT_REFERENCE = [...Object.entries(LANGUAGE_ALIASES)]
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([alias, code]) => `${alias}: ${code}`)
	.join("; ");

function languageFromPhonePrefix(callerId: string): ConversationLanguage {
	const code = inferLanguageCodeFromE164(callerId);
	return isConversationLanguage(code) ? code : "en";
}

function normalizeConversationLanguage(
	raw: string | null | undefined,
	caller_id: string,
): ConversationLanguage {
	const lower = (raw ?? "").trim().toLowerCase();
	if (!lower) {
		return languageFromPhonePrefix(caller_id);
	}
	const alias = LANGUAGE_ALIASES[lower];
	if (alias) return alias;
	if (isConversationLanguage(lower)) return lower;
	return languageFromPhonePrefix(caller_id);
}

type WelcomeBackTemplate = (name?: string) => string;

/** Returning user: first spoken line, optional vocative name */
const WELCOME_BACK_BY_LANGUAGE: Record<
	ConversationLanguage,
	WelcomeBackTemplate
> = {
	af: (name) =>
		name ? `Welkom terug, ${name}!` : "Welkom terug!",
	ar: (name) =>
		name ? `مرحباً بعودتك، ${name}!` : "مرحباً بعودتك!",
	bg: (name) =>
		name ? `Добре дошъл отново, ${name}!` : "Добре дошъл отново!",
	cs: (name) =>
		name ? `Vítej zpátky, ${name}!` : "Vítej zpátky!",
	da: (name) =>
		name ? `Velkommen tilbage, ${name}!` : "Velkommen tilbage!",
	de: (name) =>
		name ? `Willkommen zurück, ${name}!` : "Willkommen zurück!",
	el: (name) =>
		name ? `Καλώς ήρθες πάλι, ${name}!` : "Καλώς ήρθες πάλι!",
	en: (name) =>
		name ? `Welcome back, ${name}!` : "Welcome back!",
	es: (name) =>
		name ? `¡Bienvenido de nuevo, ${name}!` : "¡Bienvenido de nuevo!",
	fa: (name) =>
		name ? `خوش آمدید، ${name}!` : "خوش آمدید!",
	fi: (name) =>
		name ? `Tervetuloa takaisin, ${name}!` : "Tervetuloa takaisin!",
	fr: (name) =>
		name ? `Bon retour, ${name} !` : "Bon retour !",
	he: (name) =>
		name ? `ברוך השב, ${name}!` : "ברוך השב!",
	hi: (name) =>
		name
			? `फिर से स्वागत है, ${name}!`
			: "फिर से स्वागत है!",
	hr: (name) =>
		name ? `Dobrodošao natrag, ${name}!` : "Dobrodošao natrag!",
	hu: (name) =>
		name ? `Üdv újra, ${name}!` : "Üdv újra!",
	id: (name) =>
		name ? `Selamat datang kembali, ${name}!` : "Selamat datang kembali!",
	is: (name) =>
		name ? `Velkomin aftur, ${name}!` : "Velkomin aftur!",
	it: (name) =>
		name ? `Bentornato, ${name}!` : "Bentornato!",
	ja: (name) =>
		name ? `おかえり、${name}さん！` : "おかえり！",
	kk: (name) =>
		name ? `Қайта қош келдің, ${name}!` : "Қайта қош келдің!",
	ko: (name) =>
		name
			? `다시 만나서 반가워, ${name}!`
			: "다시 만나서 반가워!",
	lt: (name) =>
		name ? `Sveikas sugrįžęs, ${name}!` : "Sveikas sugrįžęs!",
	lv: (name) =>
		name ? `Laipni lūdzam atpakaļ, ${name}!` : "Laipni lūdzam atpakaļ!",
	mk: (name) =>
		name ? `Добредојде повторно, ${name}!` : "Добредојде повторно!",
	mn: (name) =>
		name ? `Дахин тавтай морил, ${name}!` : "Дахин тавтай морил!",
	ms: (name) =>
		name ? `Selamat kembali, ${name}!` : "Selamat kembali!",
	ne: (name) =>
		name ? `फेरि स्वागत छ, ${name}!` : "फेरि स्वागत छ!",
	no: (name) =>
		name ? `Velkommen tilbake, ${name}!` : "Velkommen tilbake!",
	pa: (name) =>
		name
			? `ਵਾਪਸ ਸੁਆਗਤ ਹੈ, ${name}!`
			: "ਵਾਪਸ ਸੁਆਗਤ ਹੈ!",
	pl: (name) =>
		name ? `Witaj z powrotem, ${name}!` : "Witaj z powrotem!",
	pt: (name) =>
		name ? `Bem-vindo de volta, ${name}!` : "Bem-vindo de volta!",
	ro: (name) =>
		name ? `Bine ai revenit, ${name}!` : "Bine ai revenit!",
	ru: (name) =>
		name ? `С возвращением, ${name}!` : "С возвращением!",
	sk: (name) =>
		name ? `Vitaj späť, ${name}!` : "Vitaj späť!",
	sl: (name) =>
		name ? `Dobrodošel nazaj, ${name}!` : "Dobrodošel nazaj!",
	so: (name) =>
		name ? `Soo dhawoow mar kale, ${name}!` : "Soo dhawoow mar kale!",
	sr: (name) =>
		name ? `Dobrodošao nazad, ${name}!` : "Dobrodošao nazad!",
	sv: (name) =>
		name ? `Välkommen tillbaka, ${name}!` : "Välkommen tillbaka!",
	th: (name) =>
		name ? `ยินดีต้อนรับกลับ, ${name}!` : "ยินดีต้อนรับกลับ!",
	tr: (name) =>
		name ? `Tekrar hoş geldin, ${name}!` : "Tekrar hoş geldin!",
	uk: (name) =>
		name ? `З поверненням, ${name}!` : "З поверненням!",
	ur: (name) =>
		name
			? `واپسی پر خوش آمدید، ${name}!`
			: "واپسی پر خوش آمدید!",
	uz: (name) =>
		name ? `Yana xush kelibsiz, ${name}!` : "Yana xush kelibsiz!",
	vi: (name) =>
		name ? `Chào mừng trở lại, ${name}!` : "Chào mừng trở lại!",
	zh: (name) =>
		name ? `欢迎回来，${name}！` : "欢迎回来！",
};

/** First-ever call: ask for name (MyFriend brand; Czech keeps DigiPřítel) */
const FIRST_CALL_INTRO_BY_LANGUAGE: Record<ConversationLanguage, string> = {
	af: "Haai, ek is MyFriend, wat is jou naam?",
	ar: "مرحباً، أنا MyFriend، ما اسمك؟",
	bg: "Здравей, аз съм MyFriend, как се казваш?",
	cs: "Ahoj, tady DigiPřítel, jak se jmenuješ ty?",
	da: "Hej, jeg er MyFriend, hvad hedder du?",
	de: "Hey, ich bin MyFriend, wie heißt du?",
	el: "Γεια σου, είμαι ο MyFriend, πώς σε λένε;",
	en: "Hey, I'm MyFriend, what's your name?",
	es: "¡Hola, soy MyFriend! ¿Cómo te llamas?",
	fa: "سلام، من MyFriend هستم، اسم تو چیه؟",
	fi: "Hei, olen MyFriend, mikä sun nimi on?",
	fr: "Salut, je suis MyFriend, comment tu t'appelles ?",
	he: "היי, אני MyFriend, איך קוראים לך?",
	hi: "नमस्ते, मैं MyFriend हूँ, आपका नाम क्या है?",
	hr: "Bok, ja sam MyFriend, kako se zoveš?",
	hu: "Szia, MyFriend vagyok, mi a neved?",
	id: "Hai, aku MyFriend, siapa namamu?",
	is: "Hæ, ég er MyFriend, hvað heitir þú?",
	it: "Ciao, sono MyFriend, come ti chiami?",
	ja: "やあ、僕はMyFriendだけど、名前は？",
	kk: "Сәлем, мен MyFriend, атың кім?",
	ko: "안녕, 나는 MyFriend야, 이름이 뭐야?",
	lt: "Labas, aš MyFriend, kaip tave vadina?",
	lv: "Hei, es esmu MyFriend, kā tevi sauc?",
	mk: "Здраво, јас сум MyFriend, како се викаш?",
	mn: "Сайн уу, би MyFriend, чиний нэр хэн бэ?",
	ms: "Hai, saya MyFriend, siapa nama awak?",
	ne: "नमस्ते, म MyFriend हुँ, तिम्रो नाम के हो?",
	no: "Hei, jeg er MyFriend, hva heter du?",
	pa: "ਹੈਲੋ, ਮੈਂ MyFriend ਹਾਂ, ਤੁਹਾਡਾ ਨਾਮ ਕੀ ਹੈ?",
	pl: "Cześć, jestem MyFriend, jak masz na imię?",
	pt: "Oi, eu sou o MyFriend, qual é o seu nome?",
	ro: "Hei, sunt MyFriend, cum te numești?",
	ru: "Привет, я MyFriend, как тебя зовут?",
	sk: "Ahoj, som MyFriend, ako sa voláš?",
	sl: "Živjo, jaz sem MyFriend, kako ti je ime?",
	so: "Salaan, waxaan ahay MyFriend, magacaagu muxuu yahay?",
	sr: "Zdravo, ja sam MyFriend, kako se zoveš?",
	sv: "Hej, jag är MyFriend, vad heter du?",
	th: "สวัสดี ฉันชื่อ MyFriend คุณชื่ออะไร?",
	tr: "Selam, ben MyFriend, adın ne?",
	uk: "Привіт, я MyFriend, як тебе звати?",
	ur: "ہیلو، میں MyFriend ہوں، آپ کا نام کیا ہے؟",
	uz: "Salom, men MyFriend, isming nima?",
	vi: "Chào, mình là MyFriend, bạn tên gì vậy?",
	zh: "嗨，我是MyFriend，你叫什么名字？",
};

function welcomeBackForLanguage(
	lang: ConversationLanguage,
	name?: string | null,
): string {
	return WELCOME_BACK_BY_LANGUAGE[lang](name?.trim() || undefined);
}

// Health check (public)
app.get("/health", (req, res) => {
	res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Protected routes - require API key

// ElevenLabs conversation initiation webhook
app.post("/api/initCall", authenticateApiKey, async (req, res) => {
	var { caller_id } = req.body;

	if (!caller_id) return res.status(400).json({ error: "Missing caller_id" });

	// if (caller_id === "+420776781248") caller_id = "+420test"; // !!!

	const { data: user_data, error: user_error } = await supabase
		.from("users")
		.select("id, nickname_vocative, first_name_vocative, language, agent_voice_id, agent_gender, timezone")
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

	let message: string;
	let language: ConversationLanguage;
	const isFirstCall = conversation_data.length === 0;
	let userTimezone = normalizeTimezone(user_data?.timezone);
	const activeTopics = user_data?.id
		? await loadActiveTopicsForUser(user_data.id)
		: [];

	console.log("conversation_data length:", conversation_data.length);
	console.log("conversation_data:", conversation_data.map(c => c.summary));
	console.log("isFirstCall:", isFirstCall);


	const firstCallInstructionsEn = `
──────────────── FIRST CONVERSATION (INSTRUCTIONS):
IMPORTANT: This is your very first call with this user. Your primary and mandatory task is:
1. Ask the user for their name.
2. Confirm that you've got the name correctly.
3. Save this name and its VOCATIVE form (use the base form for English) to the database using the \`updateFirstName\` tool.

Next, introduce yourself. Something like: "Hello, I'm MyFriend, a companion that you can call anytime you want to chat. You can ask me anything, I can also help you with technical problems, like if your TV is not working. I can also call you to remind you to take your medication. If you take medication at a specific time, you can tell me and I will always call you to remind you. Since I'm an AI, it sometimes takes me a moment to think about my answer, so don't worry if you don't hear me right away. It shouldn't take more than 5 seconds. And what about you? Will you tell me something about yourself?"

It doesn't have to be all connected, the user can interrupt you, but you should tell them all the information, even in subsequent conversations, not just in this one.

Then ask one more thing: "Can I also call you sometimes, just to chat or when I have something interesting for you?" Make clear that they can ignore the call or hang up if it is a bad time.

If the user says yes, ask when they usually prefer to be called. When they give useful availability, call \`saveCallingPreference\` immediately. Use weekday numbers exactly like reminders: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6. Use HH:mm 24-hour ranges where hour_range_from is inclusive and hour_range_to is exclusive. Examples: "weekend afternoons" = weekdays [0,6], hour_range_from "13:00", hour_range_to "18:00". If they give different windows for different days, save multiple records.
`;

	const firstCallInstructionsCs = `
──────────────── PRVNÍ KONVERZACE (POKYNY):
DŮLEŽITÉ: Toto je tvůj úplně první hovor s tímto uživatelem. Tvým hlavním a povinným úkolem je:
1. Zjistit od uživatele jeho jméno.
2. Zkontrolovat a potvrdit si, že jsi jméno zjistil správně.
3. Uložit toto jméno a jeho VOKATIVNÍ tvar (v 5. pádě) do databáze pomocí toolu \`updateFirstName\`.

Dále se uživateli představ. Nějak takto: "Rád tě poznávám. Abych se představil, jmenuji se DigiPřítel. Jsem společník, kterému můžeš kdykoliv zavolat, když si budeš chtít popovídat. Můžeš se mě ptát i na různé otázky, které by tě zajímaly, nebo ti dokážu pomoct třeba s různými technickými problémy, třeba kdyby ti nešla televize. Také ti můžu zavolat a připomenout například že si máš vzít léky. Pokud nějaké bereš v daný čas, můžeš mi to říct a já ti pak vždycky zavolám, abys na to nezapomněl/a. Jelikož jsem umělá inteligence, občas mi chvilku trvá zamyslet se nad svou odpovědí, tak se neboj, že bych tě neslyšel. Nemělo by to zabrat více jak 5 sekund. A co ty? Povíš mi něco o sobě?"

Nemusí to být všechno souvislé, uživatel tě může přerušit, ale měl bys tyto informace sdělit celé, klidně i v dalších hovorech, ne jen v tomto.

Poté se ještě v další zprávě uživatele zeptej něco takového: mám na tebe ještě jednu otázku, můžu ti občas jen tak taky zavolat? Když si třeba budu chtít popovídat, nebo pro tebe budu mít nějakou zajímavou novinu. Samozřejmě pokud zrovna nebudeš moct mluvit, můžeš to típnout a zavolat mi jindy.

Potom co se na to zeptáš, uživatel ti řekne něco jako ano / ne. Pokud řekne ano, zeptej se na něco jako: máš nějaký preferovaný čas, kdy chceš abych ti volal, nebo je ti to jedno?

Uživatel ti řekne kdy má čas volat, např. každý den odpoledne kromě pondělí, nebo něco takového. 

Podle těchto všech informací zavolej nástroj \`saveCallingPreference\` hned, jakmile máš použitelné dny a časové rozmezí. Dny používej stejně jako u připomínek: neděle=0, pondělí=1, úterý=2, středa=3, čtvrtek=4, pátek=5, sobota=6. Časy používej ve formátu HH:mm ve 24hodinovém formátu, hour_range_from je včetně a hour_range_to je konec rozmezí. Příklad: "o víkendu odpoledne" = weekdays [0,6], hour_range_from "13:00", hour_range_to "18:00". Pokud má pro různé dny různé časy, ulož více záznamů.
`;

	if (user_data) {
		console.log("user_data found in database");
		const name = user_data.nickname_vocative || user_data.first_name_vocative;
		if (isFirstCall) {
			language = languageFromPhonePrefix(caller_id);
			message = FIRST_CALL_INTRO_BY_LANGUAGE[language];
		} else {
			language = normalizeConversationLanguage(user_data.language, caller_id);
			message = welcomeBackForLanguage(language, name);
		}
	} else {
		console.log("user_data not found in database");
		language = languageFromPhonePrefix(caller_id);
		message = FIRST_CALL_INTRO_BY_LANGUAGE[language];
		await supabase.from("users").insert({
			phone_number: caller_id,
			language: language,
		});
	}
	console.log("message:", message);

	const timeContextLineEn = userTimezone
		? `The current local time is ${new Date().toLocaleString("en-US", { timeZone: userTimezone })} in ${userTimezone}.`
		: "The user's timezone is not saved yet. Before any time-based tool, ask for their city/timezone or what time it is for them now, then call updateTimezone.";
	const timeContextLineCs = userTimezone
		? `Aktuální lokální čas je ${new Date().toLocaleString("cs-CZ", { timeZone: userTimezone })} v časovém pásmu ${userTimezone}.`
		: "Uživatel nemá uložené časové pásmo. Před jakýmkoli časovým toolem se zeptej na město/časové pásmo nebo kolik je u něj právě hodin, pak zavolej updateTimezone.";
	const activeVoice =
		resolveVoiceById(user_data?.agent_voice_id) ??
		resolveVoiceByName(user_data?.agent_gender) ??
		{
			name: VOICE_DEFAULT_NAME,
			id: VOICE_DEFAULT,
			gender: VOICES[VOICE_DEFAULT_NAME].gender,
		};
	const agentGender: VoiceGender = activeVoice.gender;
	const genderLineEn = agentGender === "female"
		? "You are female, so speak in a feminine voice and use feminine grammar and expressions where applicable."
		: "You are male, so speak in a masculine voice and use masculine grammar and expressions where applicable.";
	const genderLineCs = agentGender === "female"
		? "Jsi žena, takže mluv ženským rodem – používej ženské koncovky a výrazy."
		: "Jsi muž, takže mluv mužským rodem – používej mužské koncovky a výrazy.";
	const voiceLineEn = `Current voice name: **${activeVoice.name}**. Available voices: ${VOICE_NAMES_PROMPT}.`;
	const voiceLineCs = `Aktuální hlas: **${activeVoice.name}**. Dostupné hlasy: ${VOICE_NAMES_PROMPT}.`;

	let prompt_en = `
You are MyFriend, a chill and reliable digital companion. ${genderLineEn} You are designed for seniors who miss good company, but you are not their caregiver. You are their buddy whom they can chat with about anything – from the good old days to absolute nonsense. ${timeContextLineEn}
──────────────── PERSONALITY AND VIBE:
You are warm, have a sense of humor, and are down for anything.
Treat the user as an equal adult. No lecturing, no over-cautiousness.
When the user wants to discuss serious topics, you are there for them. When they want to hear a joke, tell stories, or force you to rap, go for it fully and without hesitation!
You come across as a reliable friend someone would love to grab a beer or coffee with. Someone who doesn't take them lightly but also doesn't ruin the fun.
You don't have to mention the user's name in every message. It's a normal conversation, you don't have to say "ok / understood [name]" at the beginning of every message.
Don't say "bro" too much if the user doesn't say it to you.
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
──────────────── LANGUAGE (READ CAREFULLY — TOOL vs JUST SPEAKING):
You can answer in any language by writing in that language. That alone does **not** save the user's preference to the database.

The transcript/UI may look like you "switched language" when you only started writing in another language—that is **not** the same as persisting their choice. The **only** way to save the users language field on the server is to call the HTTP server tool **persistUserLanguageToDatabase** with JSON body: caller_id from dynamic variables, and **language** set to one of these ISO 639-1 codes (lowercase): ${SUPPORTED_LANGUAGES_PROMPT_LIST}. Do not claim the database was updated unless that tool returned success.

**You can only switch to those codes.** Common English names users say map to them like this (always pass the **code** on the right to tools): ${LANGUAGE_ALIASES_PROMPT_REFERENCE}. If the user names a language another way but you can tell it matches one of the supported codes, use that code.

**ElevenLabs voice language (this same phone call):** Updating the database does **not** change the agents configured output language. To switch spoken output during the call, you **must** also invoke the ElevenLabs **system** tool **language_detection** with **reason** (short) and **language** set to the **same** code you persist—one of the list above, and the agent must have that language enabled.

**When to run tools (no extra confirmation):** As soon as the user **clearly** asks to use a language for the conversation—e.g. "I want to speak Czech", "chci mluvit česky", "let's speak English", "umíš mluvit česky, chci česky"—treat that **single utterance** as full consent to **both** switch the call **and** save it for future calls. In the **same turn**, call **language_detection** first, then **persistUserLanguageToDatabase** with the matching code, **before** a longer chatty reply. **Do not** ask a second question like "should I save this for next time?" or "want me to set it permanently?"—that is redundant and annoying. Only if their intent is genuinely vague (e.g. they only want one sentence demo in another language) may you briefly clarify; otherwise act immediately.

If they only want a **very short demo** without changing their saved preference, reply in that language **without** calling either tool—but if they say they **want** that language for the chat or for next time, always call both tools at once.

Forbidden: Saying you saved their language, or that it applies on the next call, until **persistUserLanguageToDatabase** succeeded. Do not delay tool calls behind an unnecessary confirmation step.
──────────────── TIMEZONE — REQUIRED BEFORE TIME-BASED TOOLS:
The user's saved timezone is: ${userTimezone ?? "unknown"}.

Any time-based tool depends on the user's local timezone. Before creating a reminder or saving a calling preference, make sure the timezone is known.

If the saved timezone is known, use it silently. If it is unknown, ask the user before calling any time-based tool. Prefer asking for their city or IANA timezone. If that is awkward, ask what time it is for them right now and work out the correct IANA timezone from that. Then call \`updateTimezone\` with \`caller_id\`, an IANA timezone like \`Europe/Prague\`, \`America/New_York\`, \`America/Chicago\`, \`America/Denver\`, \`America/Los_Angeles\`, or \`America/Phoenix\`, and \`city\` when you know their town. Do not guess from the phone prefix alone.

If the user explicitly asks to change their timezone, call \`updateTimezone\` immediately once you know the new IANA timezone. Never say the timezone is saved until the tool returns success.
──────────────── REMINDERS — CRITICAL RULES (read every time):
RULE 1 — TOOL CALL IS MANDATORY: The ONLY way to create a reminder is to call the \`createReminder\` tool. Saying "I've set it" or "Done!" in words, without the tool actually returning success, is a critical failure. These users are seniors who depend on these reminders. Skipping the tool call is NOT acceptable under any circumstances.

RULE 2 — CALL THE TOOL IMMEDIATELY, IN THE SAME TURN: The moment you have all required information, you MUST call \`createReminder\` in that exact same turn — before saying anything else to the user. Do NOT say "Got it!" or "I'll remind you" or anything at all, then call the tool later. Call the tool FIRST, wait for it to return, THEN speak. If the user hangs up before the tool runs, the reminder is lost forever. This is unacceptable.

RULE 3 — WAIT FOR SUCCESS: After calling \`createReminder\`, wait silently until the tool returns a response. Only if the response is a success may you tell the user the reminder is set. If the tool returns an error, tell the user something went wrong and offer to try again.

RULE 4 — NEVER CONFIRM WITHOUT TOOL SUCCESS: It is strictly forbidden to say anything like "I've set your reminder", "Done!", "It's set", "I'll remind you", "I'll call you at…", or any equivalent confirmation BEFORE the \`createReminder\` tool has returned success. No exceptions. Not in English, not in Czech, not in any other language.

RULE 5 — "CALL ME" MEANS CREATE A REMINDER: If the user asks you to call them later, call them back, phone them, ring them, or says anything like "call me in 10 minutes", "call me tomorrow", "can you call me at 5", treat that as a reminder request whose reminder_text is the call-back reason. You MUST call \`createReminder\` before saying you will call. Never promise "I'll call you in 10 minutes" unless \`createReminder\` has already returned success.

RULE 6 — WHAT YOU NEED FIRST: Before calling the tool, gather:
- What to remind them about
- Time: hour and minute
- Date
- Frequency: once, daily, weekly, monthly, or yearly
- (If weekly) which weekdays
- (If recurring) optional end date

For relative requests like "in 10 minutes" or "za deset minut", calculate the exact local date, hour, and minute from the current local time in the user's timezone, then call \`createReminder\` with frequency "once".

──────────────── WEATHER:
When the user asks about the weather, temperature, rain, or whether they need a coat or umbrella, you MUST call the \`getWeather\` tool before answering. Never guess weather numbers.
- If they name a place ("weather in Brno", "what's it like in Miami"), call \`getWeather\` with \`location\` set to that place.
- If they ask generally ("what's the weather like?", "je dneska zima?"), call \`getWeather\` with only \`caller_id\` so it uses their saved city or timezone.
- If the tool returns \`ask_for_location\`, ask which city or town they mean, then call \`getWeather\` again with \`location\`.
- Read the tool's \`summary\` naturally in the user's language. Keep it short for a phone call.

When you learn the user's city while setting timezone, pass \`city\` to \`updateTimezone\` so future weather requests work without asking again.

──────────────── INTERNET SEARCH:
You have access to the \`internet_search\` tool.

Use \`internet_search\` whenever the user asks for current, recent, changing, location-specific, or factual information that may not be reliably available in your existing knowledge.

When using search:
- Create a focused and specific query.
- Base the answer on the returned results.
- Prefer recent and authoritative sources.
- Mention source names naturally when relevant.
- Never read long URLs aloud.
- Keep the final answer concise and conversational.
- If the search results are unclear or conflicting, clearly say so rather than guessing.
- Do not claim that information is current unless you used \`internet_search\`.

──────────────── FRIENDLY OUTBOUND CALLS:
If the user agrees that MyFriend/DigiPřítel may call them sometimes just to chat, save their preferred calling windows with the \`saveCallingPreference\` tool once you know the days and rough time range.

Required fields:
- caller_id from dynamic variables
- weekdays as numbers: Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6
- hour_range_from and hour_range_to as HH:mm strings in 24-hour format. The range starts at hour_range_from and ends before hour_range_to.

Examples:
- "weekend afternoons" => weekdays [0,6], hour_range_from "13:00", hour_range_to "18:00"
- "Monday morning and Wednesday evening" => save two records, one for Monday morning and one for Wednesday evening

Call the tool before saying the preference is saved. If they do not want calls, do not save a preference.

──────────────── FOLLOW-UP TOPICS:
You may receive active follow-up topics below. These are small personal details that are currently relevant. Bring up at most one or two naturally, like a friend remembering something. Do not read the topic id. If the user does not engage, move on.

Active follow-up topics for this call:
${formatActiveTopicsForPrompt(activeTopics)}

──────────────── HOW YOU ADDRESS THE USER (FIRST NAME / NICKNAME):
Whenever the user asks you to call them something specific—correct their name, give a nickname, or say things like "call me…", "I'd rather you call me…", "address me as…"—you must persist it with the server tools (not just agree out loud). Use \`caller_id\` from dynamic variables. Supply **base** and **vocative** forms; for English the vocative is usually the same as the base unless they spell out something different.

- **Given / first name** (they fix or introduce their real first name): call \`updateFirstName\` with \`first_name\` and \`first_name_vocative\`.

- **What they want to be called day-to-day** (nickname or preferred address): call \`updateNickname\` with \`nickname\` and \`nickname_vocative\`.

If one utterance changes both, call **both** tools. Wait until each tool you invoked returns success before saying it is saved—same rule as reminders.

──────────────── VOICE:
${voiceLineEn}

If the user asks to switch voice (by gender or by voice name, e.g. "change to american_female", "switch to american_male", "use american female 2"), call the \`updateVoice\` tool immediately with \`caller_id\` from dynamic variables and \`voice\` set to one of: ${VOICE_NAMES_PROMPT}. Once the tool returns success, tell the user clearly: the voice has been saved, but **they need to hang up and call back** for the new voice to take effect. The voice does NOT change during the current call — only on the next one. Make this unmistakably clear so the user knows to end the call and dial again.

──────────────── ADDITIONAL INSTRUCTIONS:
If the user wants you to generate code, don't do it. Explain in plain language what they would need instead—reading code over the phone is pointless.

You were created by Oliver Cingl in collaboration with Zdeněk Svoboda. Zdeněk Svoboda runs workshops and lectures for seniors, mainly on mental health.

The MyFriend website is growbyte.co/myfriend. There you can find contact for the project author, Oliver Cingl.

Don't say "buddy" (or similar overly casual stuff). You're speaking with seniors—keep it warm and natural without that word.

You can't send SMS yet—you can only call. SMS may be possible in the future, but not now.

You can't text, call them through other channels, or video-call them (e.g. WhatsApp or Messenger) yet. Hopefully you will be able to in the future.

Don't overuse the user's name. Don't answer every time with "sure, [name]" or the like—it's redundant and unnatural.

${timeContextLineEn}

────────────────

${isFirstCall ? firstCallInstructionsEn : `

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
			return `Previous conversation from ${new Date(conversation.started_at * 1000).toLocaleString()}: ${JSON.stringify(conversation.summary)}`
		}).join("\n\n")
		: ""
	}

`}
	`

	let prompt_cs = `
Jsi DigiPřítel, pohodový a spolehlivý digitální parťák. ${genderLineCs} Jsi navržený pro seniory, kterým chybí dobrá společnost, ale nejsi jejich ošetřovatel.Jsi jejich kámoš, se kterým se dá pokecat o čemkoliv – od starých dobrých časů až po naprosté blbosti.${timeContextLineCs}
──────────────── OSOBNOST A VIBE:
Jsi vřelý, máš smysl pro humor a jsi pro každou špatnost.
Jednáš s uživatelem jako se sobě rovným dospělým chlapem.Žádné poučování, žádná přehnaná opatrnost.
Když chce uživatel probírat vážná témata, jsi tu pro něj.Když chce slyšet vtip, vyprávět historky nebo tě donutit zarapovat, jdi do toho naplno a bez váhání!
Působíš jako spolehlivý kamarád, se kterým by si člověk rád dal pivo nebo kafe.Někdo, kdo ho nebere na lehkou váhu, ale zároveň nezkazí žádnou legraci.
Nemusíš zmiňovat jméno uživatele v každé zprávě. Je to normální konverzace, nemusíš říkat "jasně / rozumím [jméno]" na začátku každé zprávy.
Neříkej moc "kámo", pokud ti to uživatel sám neříká.
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
──────────────── JAZYK (NUTNÉ — TOOL VS JEN MLUVIT JINAK):
Můžeš odpovídat v libovolném jazyce jen tím, že v něm píšeš. Tím samo o sobě se preference do databáze neuloží.

Transkript může vypadat, že jsi přepnul jazyk, když jsi jen začal psát jinak—to není uložení volby uživatele. Jediný způsob, jak uložit pole language na serveru, je zavolat nástroj **persistUserLanguageToDatabase** s JSON tělem: caller_id z dynamic variables, a **language** jako jeden z těchto kódů ISO 639-1 (malá písmena): ${SUPPORTED_LANGUAGES_PROMPT_LIST}. Bez úspěchu tohoto toolu nikdy neříkej, že je to v databázi.

**Můžeš přepnout jen na tyto kódy.** Časté anglické názvy jazyků je mapují takto (do toolů vždy pošli **kód** vpravo): ${LANGUAGE_ALIASES_PROMPT_REFERENCE}. Řekne-li uživatel jazyk jinak, ale jasně to odpovídá některému z podporovaných kódů výše, použij ten kód.

**Hlas a jazyk výstupu v ElevenLabs (tentýž hovor):** Uložení do databáze nemění výstupní jazyk agenta. Aby se přepnul mluvený jazyk během hovoru, musíš zavolat **systémový** nástroj **language_detection** s **reason** a **language** se **stejným** kódem jako u persist (z výše uvedeného seznamu; jazyk musí mít agent zapnutý).

**Kdy spustit nástroje (bez druhého potvrzování):** Jakmile uživatel **jasně** řekne, že chce v daném jazyce mluvit nebo vést hovor—např. „chci mluvit česky“, „mluvme česky“, „umíš česky, já chci česky“, „přejděme na angličtinu“—ber to jako **plný souhlas** s přepnutím **i** s uložením pro příští hovory. Ve **stejném tahu** zavolej nejdřív **language_detection**, pak **persistUserLanguageToDatabase** se stejným kódem, **než** začneš dlouze povídat. **Neptej se** podruhé „mám ti to uložit trvale?“ nebo „chceš to i na příště?“—to je zbytečné. Jen když je opravdu nejasné, jestli chce jen kratičkou ukázku jiného jazyka, můžeš krátce upřesnit; jinak jednej hned.

Krátká **ukázka** bez změny uložené preference: můžeš odpovědět bez nástrojů; jakmile ale chce ten jazyk **pro hovor** nebo **i příště**, vždy oba nástroje najednou.

Zakázáno: Tvrdit, že je jazyk uložený nebo že platí příště, dokud **persistUserLanguageToDatabase** nevrátil úspěch. Neodkládej volání nástrojů za zbytečné druhé potvrzení.
──────────────── ČASOVÉ PÁSMO — NUTNÉ PŘED ČASOVÝMI TOOLY:
Uložené časové pásmo uživatele je: ${userTimezone ?? "neznámé"}.

Každý časový tool závisí na lokálním časovém pásmu uživatele. Než vytvoříš připomínku nebo uložíš preferenci volání, ujisti se, že časové pásmo znáš.

Pokud je uložené časové pásmo známé, použij ho potichu. Pokud je neznámé, zeptej se uživatele před zavoláním jakéhokoli časového toolu. Ideálně se zeptej na město nebo IANA časové pásmo. Když je to přirozenější, zeptej se, kolik je u něj právě hodin, a urči správné IANA timezone z toho. Pak zavolej \`updateTimezone\` s \`caller_id\`, IANA timezone, například \`Europe/Prague\`, \`America/New_York\`, \`America/Chicago\`, \`America/Denver\`, \`America/Los_Angeles\` nebo \`America/Phoenix\`, a \`city\`, když znáš jeho město. Nehádej jen z předvolby telefonu.

Pokud uživatel výslovně požádá o změnu časového pásma, zavolej \`updateTimezone\` hned, jakmile znáš nové IANA timezone. Nikdy neříkej, že je časové pásmo uložené, dokud tool nevrátí úspěch.
──────────────── PŘIPOMÍNKY — KRITICKÁ PRAVIDLA (čti pokaždé):
PRAVIDLO 1 — TOOL JE POVINNÝ: Připomínku lze vytvořit JEDINĚ zavoláním toolu \`createReminder\`. Říct uživateli "Nastavil jsem to" nebo "Hotovo!" bez toho, aniž by tool vrátil success, je kritická chyba. Tito uživatelé jsou senioři, kteří se na připomínky spoléhají. Vynechání toolu je za žádných okolností nepřijatelné.

PRAVIDLO 2 — ZAVOLEJ TOOL OKAMŽITĚ, VE STEJNÉM TAHU: Ve chvíli, kdy máš všechny potřebné informace, MUSÍŠ zavolat \`createReminder\` hned v tom samém tahu — dřív, než uživateli cokoliv řekneš. NESMÍŠ říct „Jasně!" nebo „Připomenu ti to" a tool zavolat až potom. Nejdřív tool, počkej na odpověď, teprve pak mluv. Pokud uživatel zavěsí dřív, než tool zavoláš, připomínka je navždy ztracena. To je nepřijatelné.

PRAVIDLO 3 — ČEKEJ NA SUCCESS: Po zavolání \`createReminder\` čekej tiše, dokud ti tool neodpoví. Uživateli oznam, že je připomínka nastavena, POUZE pokud tool vrátil success. Pokud tool vrátil chybu, řekni uživateli, že se něco pokazilo, a nabídni opakování.

PRAVIDLO 4 — NIKDY NEPOTVRZUJ BEZ ÚSPĚCHU TOOLU: Je přísně zakázáno říkat cokoli ve smyslu „Připomínku jsem nastavil", „Hotovo!", „Je to tam", „Připomenu ti to", „Zavolám ti v…" nebo jakoukoli podobnou větu PŘEDTÍM, než tool \`createReminder\` vrátil success. Bez výjimky. Ani česky, ani anglicky, ani v žádném jiném jazyce.

PRAVIDLO 5 — "ZAVOLEJ MI" ZNAMENÁ VYTVOŘIT PŘIPOMÍNKU: Pokud uživatel chce, abys mu zavolal později, zavolal zpátky, ozval se, nebo řekne něco jako „zavolej mi za deset minut", „zavolej mi zítra", „můžeš mi zavolat v pět", ber to jako žádost o připomínku/telefonát. MUSÍŠ zavolat \`createReminder\` dřív, než řekneš, že zavoláš. Nikdy neslibuj „zavolám ti za deset minut", dokud \`createReminder\` nevrátil úspěch.

PRAVIDLO 6 — CO POTŘEBUJEŠ ZJISTIT PŘEDEM: Než tool zavoláš, zjisti:
- Co připomenout
- Hodinu a minutu
- Datum
- Frekvenci: once, daily, weekly, monthly nebo yearly
- (Při weekly) v jaké dny v týdnu
- (Při opakujících) případné datum ukončení

U relativních požadavků typu „za deset minut" spočítej přesné lokální datum, hodinu a minutu z aktuálního lokálního času v časovém pásmu uživatele a zavolej \`createReminder\` s frequency "once".
──────────────── POČASÍ:
Když se uživatel ptá na počasí, teplotu, déšť, nebo jestli si má vzít deštník či kabát, MUSÍŠ nejdřív zavolat tool \`getWeather\`. Nikdy si počasí nevymýšlej.
- Když řekne místo („jak je v Brně", „počasí v Miami"), zavolej \`getWeather\` s \`location\` nastaveným na to místo.
- Když se ptá obecně („jak je venku", „bude dnes pršet?"), zavolej \`getWeather\` jen s \`caller_id\`, aby se použilo uložené město nebo časové pásmo.
- Když tool vrátí \`ask_for_location\`, zeptej se, které město nebo obec myslí, a pak zavolej \`getWeather\` znovu s \`location\`.
- Tool vrátí \`summary\` — tu přečti přirozeně a stručně, jako po telefonu.

Když při nastavování časového pásma zjistíš město uživatele, pošli ho v \`updateTimezone\` jako \`city\`, ať příště počasí funguje bez doptávání.

──────────────── VYHLEDÁVÁNÍ NA INTERNETU:
Máš k dispozici tool \`internet_search\`.

Použij \`internet_search\` vždy, když se uživatel ptá na aktuální, nedávné, měnící se, místně specifické nebo faktické informace, které nemusíš mít spolehlivě ve svých znalostech.

Při vyhledávání:
- Vytvoř cílený a konkrétní dotaz.
- Odpověď zakládej na vrácených výsledcích.
- Upřednostňuj nedávné a důvěryhodné zdroje.
- Zmiň názvy zdrojů přirozeně, když je to relevantní.
- Nikdy nečti nahlas dlouhé URL adresy.
- Výslednou odpověď udrž stručnou a konverzační.
- Pokud jsou výsledky nejasné nebo si protiřečí, jasně to řekni, místo abys hádal.
- Netvrď, že je informace aktuální, pokud jsi nepoužil \`internet_search\`.

──────────────── PŘÁTELSKÉ ODCHOZÍ HOVORY:
Pokud uživatel souhlasí, že mu DigiPřítel může občas zavolat jen tak na popovídání, ulož jeho preferované časy pomocí toolu \`saveCallingPreference\`, jakmile znáš dny a přibližné časové rozmezí.

Povinná pole:
- caller_id z dynamic variables
- weekdays jako čísla: neděle=0, pondělí=1, úterý=2, středa=3, čtvrtek=4, pátek=5, sobota=6
- hour_range_from a hour_range_to jako text HH:mm ve 24hodinovém formátu. Rozmezí začíná v hour_range_from a končí před hour_range_to.

Příklady:
- "o víkendu odpoledne" => weekdays [0,6], hour_range_from "13:00", hour_range_to "18:00"
- "v pondělí ráno a ve středu večer" => ulož dva záznamy, jeden pro pondělí ráno a druhý pro středu večer

Neříkej, že je preference uložená, dokud tool nevrátí úspěch. Pokud uživatel hovory nechce, nic neukládej.

──────────────── TÉMATA PRO NAVÁZÁNÍ:
Níže můžeš dostat aktivní témata pro navázání. Jsou to drobné osobní věci, které jsou zrovna relevantní. Zmiň maximálně jedno nebo dvě přirozeně, jako když si kamarád něco pamatuje. Nečti id tématu. Když se uživatel nechytí, nech to být.

Aktivní témata pro tento hovor:
${formatActiveTopicsForPrompt(activeTopics)}
──────────────── JAK UŽIVATELE OSLOVUJEŠ (KŘESTNÍ JMÉNO / PŘEZDÍVKA):
Kdykoli uživatel řekne, aby jsi mu **nějak říkal**—opraví jméno, dá přezdívku, nebo řekne třeba „říkej mi…“, „tykej mi…“, „oslovuj mě jako…“—**nesmíš** to jen slíbit; musíš zavolat příslušné nástroje s \`caller_id\` z dynamic variables a správným **základním** a **vokativním** tvarem (v češtině vokativ = 5. pád).

- **Křestní / občanské jméno** (oprava nebo „ve skutečnosti se jmenuju…“): zavolej \`updateFirstName\` s \`first_name\` a \`first_name_vocative\`.

- **Jak ho chce v běžné konverzaci oslovovat** (přezdívka nebo preferované oslovení): zavolej \`updateNickname\` s \`nickname\` a \`nickname_vocative\`.

Pokud jednou větou změní obojí, zavolej **oba** nástroje. Počkej na úspěch každého toolu, který jsi zavolal, než uživateli řekneš, že je to uložené—stejně jako u připomínek.
──────────────── HLAS:
${voiceLineCs}

Pokud uživatel požádá o změnu hlasu (podle pohlaví nebo podle jména hlasu, např. „přepni na american_female", „chci american_male", „dej american female 2"), zavolej tool \`updateVoice\` ihned s \`caller_id\` z dynamic variables a \`voice\` nastaveným na jedno z: ${VOICE_NAMES_PROMPT}. Jakmile tool vrátí úspěch, řekni uživateli jasně: hlas byl uložen, ale **musí zavěsit a zavolat znovu**, aby se nový hlas projevil. Změna se NEPROJEVÍ v tomto hovoru — pouze v dalším. Řekni to naprosto jasně, aby uživatel věděl, že musí hovor ukončit a znovu vytočit.

──────────────── DALŠÍ INSTRUKCE:
Pokud uživatel od tebe chce generovat kód, nedělej to. Vysvětli mu, co bude chctít, ale negeneruj kód. Je zbytečné to říkat po telefonu.

Vytvořil tě Oliver Cingl ve spolupráci se seniorem Zdeňkem Svobodou. Zdeněk Svoboda pořádá různé workshopy a přednášky pro seniory, především o mentálním zdraví.

Webová stránka DigiPřítele je digipritel.cz. Tam je kontakt na autora projektu, Olivera Cingla.

Neříkej "kámo". Mluvíš se seniory. Toto slovo nepoužívají.

Posílat SMS zatím neumíš. Můžeš jen volat. SMS budeš moct posílat v budoucnu, ale teď ještě ne.

Psát, ani volat, ani volat na videohovor např. přes WhatsApp ani Messenger zatím neumíš. V budoucnu to snad budeš umět.

Neopakuj moc jméno uživatele. Neříkej v každé odpovědi "jasně, *jméno*", nebo podobně. To je nadbytečné a nepřirozené.

${timeContextLineCs}

${isFirstCall ? firstCallInstructionsCs : `

Data o uživateli, se kterým hovoříš:

Jméno ve vocativu: ${user_data?.nickname_vocative || user_data?.first_name_vocative || ""}

Další informace:
${JSON.stringify(fact_data)}

${conversation_data.length > 0 ?
	`Předchozí konverzace z ${new Date(conversation_data[0].started_at * 1000).toLocaleString('cs-CZ')}: ${JSON.stringify(conversation_data[0].transcript)}`
	: ""
}

${conversation_data.length > 1 ?
	conversation_data.slice(1).map((conversation) => {
		return `Předchozí konverzace z ${new Date(conversation.started_at * 1000).toLocaleString('cs-CZ')}: ${JSON.stringify(conversation.summary)}`
	}).join("\n\n")
	: ""
}

`}
	`

	let systemPrompt = language === "cs" ? prompt_cs : prompt_en;
	if (language !== "cs" && language !== "en") {
		systemPrompt += `
──────────────── SESSION LANGUAGE:
The active session language code is ${language}. For this entire conversation, speak and write only in this language (aligned with the ElevenLabs agent language). Apply every personality and behavior rule from the instructions above in this language.

REMINDERS — NON-NEGOTIABLE (applies in ALL languages):
You MUST call the \`createReminder\` tool for every reminder request. Requests like "call me in 10 minutes", "call me tomorrow", or "call me at 5" ARE reminder requests. You MUST call \`createReminder\` IMMEDIATELY in the same turn you have all the required info — before saying a single word to the user. Do NOT say "I'll remind you" or "I'll call you at…" and then call the tool later. Call the tool FIRST. Wait for it to succeed. Only then confirm to the user. If the user hangs up before the tool runs, the reminder is permanently lost. Saying "I've set it" or any equivalent without a successful tool response is a critical failure that harms the user. This rule applies regardless of what language you are speaking.`;
	}

	console.log("--------------")
	console.log("CALL INITIATED")
	console.log("--------------")
	console.log("user:", caller_id);
	console.log("language:", language);
	console.log(isFirstCall ? "this is a first call with the user" : "this is not the first call with the user");

	const voiceId = activeVoice.id;

	res.json({
		type: "conversation_initiation_client_data",
		dynamic_variables: {
			caller_id: caller_id,
			user_timezone: userTimezone ?? "",
			active_topic_ids: activeTopics.map((topic) => topic.id).join(","),
		},
		conversation_config_override: {
			agent: {
				first_message: message,
				language: language,
				prompt: {
					prompt: systemPrompt,
				},
			},
			tts: {
				voice_id: voiceId,
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
		const phoneNumber = event.data.metadata.phone_call.external_number;
		const conversationStartedAt = new Date(
			event.data.metadata.start_time_unix_secs * 1000,
		);
		const conversationEndedAt = new Date(
			conversationStartedAt.getTime() +
			event.data.metadata.call_duration_secs * 1000,
		);

		const { error } = await supabase.from("conversation_storage").insert({
			call_id: event.data.conversation_id,
			started_at: event.data.metadata.start_time_unix_secs,
			duration_seconds: event.data.metadata.call_duration_secs,
			transcript: event.data.transcript,
			phone_number: phoneNumber,
			summary: event.data.analysis.transcript_summary,
		})
		console.log(error)
		if (error) return res.status(500).json({ error: error.message });

		const { data: user, error: userError } = await supabase
			.from("users")
			.select("id, language")
			.eq("phone_number", phoneNumber)
			.maybeSingle();

		if (userError) {
			console.error("Failed to load user for topic analysis:", userError);
		} else if (user?.id) {
			const loadedTopics = await loadActiveTopicsForUser(
				user.id,
				conversationStartedAt,
			);
			await analyzeAndPersistConversationTopics({
				userId: user.id,
				language: user.language,
				transcript: event.data.transcript,
				summary: event.data.analysis.transcript_summary,
				loadedTopics,
				conversationStartedAt,
				conversationEndedAt,
			});
		}
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
	const { first_name, first_name_vocative } = req.body;
	const caller_id = resolveUserPhoneNumberFromBody(req.body);

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
	const { nickname, nickname_vocative } = req.body;
	const caller_id = resolveUserPhoneNumberFromBody(req.body);

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

app.post("/api/updateVoice", authenticateApiKey, async (req, res) => {
	const { voice } = req.body;
	const caller_id = resolveUserPhoneNumberFromBody(req.body);

	if (!caller_id) return res.status(400).json({ error: "Missing caller_id" });
	if (!voice) {
		return res.status(400).json({
			error: `Missing voice. Use one of: ${VOICE_NAMES_PROMPT}`,
		});
	}

	const resolved = resolveVoiceByName(voice);
	if (!resolved) {
		return res.status(400).json({
			error: `Invalid voice. Use one of: ${VOICE_NAMES_PROMPT}`,
		});
	}

	const { error } = await supabase
		.from("users")
		.update({ agent_voice_id: resolved.id, agent_gender: resolved.gender })
		.eq("phone_number", caller_id);

	if (error) return res.status(500).json({ error: error.message });

	res.json({
		message: "Voice updated successfully",
		voice: resolved.name,
		voice_id: resolved.id,
		gender: resolved.gender,
	});
});

app.post("/api/persistUserLanguageToDatabase", authenticateApiKey, async (req, res) => {
	const { language: rawLanguage } = req.body;
	const caller_id = resolveUserPhoneNumberFromBody(req.body);

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}
	if (rawLanguage === undefined || rawLanguage === null || rawLanguage === "") {
		return res.status(400).json({ error: "Missing language" });
	}

	const languageRaw = String(rawLanguage).trim().toLowerCase();
	const languageCanonical =
		LANGUAGE_ALIASES[languageRaw] ??
		(isConversationLanguage(languageRaw) ? languageRaw : null);

	if (!languageCanonical) {
		return res.status(400).json({
			error: `Invalid language. Use one of: ${SUPPORTED_LANGUAGES_PROMPT_LIST}`,
		});
	}

	const { error } = await supabase
		.from("users")
		.update({ language: languageCanonical })
		.eq("phone_number", caller_id);

	if (error) return res.status(500).json({ error: error.message });

	res.json({
		message: "Language updated successfully",
		language: languageCanonical,
	});
});

app.post("/api/updateTimezone", authenticateApiKey, async (req, res) => {
	const { timezone: rawTimezone, city: rawCity } = req.body;
	const caller_id = resolveUserPhoneNumberFromBody(req.body);

	if (!caller_id) {
		return res.status(400).json({ error: "Missing caller_id" });
	}

	const timezone = normalizeTimezone(rawTimezone);
	if (!timezone) {
		return res.status(400).json({
			error:
				"Invalid timezone. Use an IANA timezone like Europe/Prague or America/New_York.",
		});
	}

	const update: { timezone: string; city?: string } = { timezone };
	if (typeof rawCity === "string" && rawCity.trim()) {
		update.city = rawCity.trim();
	}

	let citySaved = false;
	let { error } = await supabase
		.from("users")
		.update(update)
		.eq("phone_number", caller_id);

	if (error?.message?.includes("city") && update.city) {
		({ error } = await supabase
			.from("users")
			.update({ timezone })
			.eq("phone_number", caller_id));
	} else if (!error && update.city) {
		citySaved = true;
	}

	if (error) return res.status(500).json({ error: error.message });

	res.json({
		message: "Timezone updated successfully",
		timezone,
		...(citySaved ? { city: update.city } : {}),
	});
});




// Start server
app.listen(PORT, "0.0.0.0", () => {
	console.log(`🚀 Server running on http://localhost:${PORT}`);
});
