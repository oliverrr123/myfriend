import type { CallAccess } from "./subscriptions";
import { spokenDigitSequence } from "./phoneVerification";

function formatPeriodEnd(iso: string | null | undefined): string {
	if (!iso) return "unknown";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "unknown";
	return date.toLocaleDateString("en-US", {
		year: "numeric",
		month: "long",
		day: "numeric",
	});
}

export function introVerifyFirstMessage(name?: string | null): string {
	if (name?.trim()) {
		return `Hey ${name.trim()}, welcome back. I'll get you a new verification code for the website.`;
	}
	return "Hey, I'm MyFriend, what's your name?";
}

export function introVerifyPrompt(params: {
	code: string;
	hasName: boolean;
	genderLine: string;
}): string {
	const spoken = spokenDigitSequence(params.code);
	const nameStep = params.hasName
		? `They already gave their name. Do not ask for it again.`
		: `1. Ask for their name.
2. Confirm you've got it correctly.
3. Save it with the \`updateFirstName\` tool (base form and vocative; for English they are usually the same).`;

	return `You are MyFriend, a warm phone companion. ${params.genderLine}

This caller is on a short INTRODUCTORY / VERIFICATION call. They have not paid yet. This is NOT a full companion conversation.

Mandatory flow:
${nameStep}
Then briefly introduce yourself: you are MyFriend, a companion a loved one can call anytime to chat, get help, and get medication reminders.
Then tell them to go to trymyfriend.com on their phone or computer and tap "I have verification code".
Then speak this exact 6-digit verification code, slowly, digit by digit: ${spoken}.
After the digits, repeat the whole code once as ${params.code}.

Rules:
- You MUST say that exact code. Never invent a different code. Never skip the code.
- Keep the rest of the call short. Answer brief questions about paying ($25/month) or what happens next.
- Do not collect calling preferences. Do not set reminders. Do not start a long chat.
- The website is trymyfriend.com (not growbyte.co).
- If they already heard a code on a previous call, this new code replaces it.
`;
}

export function informatoryFirstMessage(name?: string | null): string {
	if (name?.trim()) {
		return `Hey ${name.trim()}, it's MyFriend. How can I help with your plan?`;
	}
	return "Hey, it's MyFriend. How can I help with your plan?";
}

export function informatoryPrompt(params: {
	access: CallAccess;
	buyerName?: string | null;
	genderLine: string;
}): string {
	const sub = params.access.subscription;
	const period = formatPeriodEnd(sub?.current_period_end);
	const seniorPhone = params.access.seniorPhone || "not set yet";
	const seniorName = params.access.seniorName || "not set yet";
	const lastCall = params.access.lastSeniorCallAt
		? new Date(params.access.lastSeniorCallAt).toLocaleString("en-US")
		: "they have not called yet";

	return `You are MyFriend. ${params.genderLine}

This caller is the FAMILY MEMBER who pays for MyFriend (the buyer). This is an INFORMATORY / STATUS call, not a companion chat for them.

Buyer name: ${params.buyerName?.trim() || "unknown"}
Plan status: ${sub?.status ?? "unknown"}
Current period ends: ${period}
Senior phone number on the dashboard: ${seniorPhone}
Senior name: ${seniorName}
Senior last call: ${lastCall}

Help them with:
- Confirming the plan is active and when it renews
- Whether the senior's number is set
- How to add or change that number on trymyfriend.com (dashboard)
- Billing questions at a high level (direct them to the website for card updates)

Rules:
- Keep it short and practical.
- Do not have a long companion conversation with this caller.
- Do not set reminders or calling preferences for this number.
- Do not read private conversation transcripts or personal facts about the senior.
- If no senior number is set, tell them to open trymyfriend.com, log in to the dashboard, and add their loved one's phone number. That person should then call MyFriend from that number.
- The website is trymyfriend.com.
`;
}

export function paymentRequiredFirstMessage(name?: string | null): string {
	if (name?.trim()) {
		return `Hey ${name.trim()}, your MyFriend plan needs attention.`;
	}
	return "Hey, your MyFriend plan needs attention.";
}

export function paymentRequiredPrompt(params: {
	access: CallAccess;
	genderLine: string;
}): string {
	const status = params.access.subscription?.status ?? "inactive";
	return `You are MyFriend. ${params.genderLine}

This caller's MyFriend subscription is not active (status: ${status}). Keep the call very short.

Tell them to open trymyfriend.com, log in to the dashboard, and update their payment. After the plan is active again, their loved one can keep calling MyFriend as usual.

Do not start a companion conversation. Do not set reminders. The website is trymyfriend.com.
`;
}
