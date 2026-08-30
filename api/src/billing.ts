import { app } from "./app";
import { authenticateApiKey } from "./middleware/auth";
import { normalizePhoneNumber } from "./lib/callParticipants";
import { consumeVerificationCode } from "./lib/phoneVerification";
import { supabase } from "./lib/supabase";
import {
	activateSubscription,
	getAccountForBuyer,
	mapStripeStatus,
	setSeniorPhone,
	syncStripeSubscription,
	type SubscriptionStatus,
} from "./lib/subscriptions";

function periodEndFromUnknown(value: unknown): string | null {
	if (typeof value === "number" && Number.isFinite(value)) {
		const ms = value > 1_000_000_000_000 ? value : value * 1000;
		return new Date(ms).toISOString();
	}
	if (typeof value === "string" && value.trim()) {
		const date = new Date(value);
		if (!Number.isNaN(date.getTime())) return date.toISOString();
	}
	return null;
}

function accountPayload(
	subscription: {
		buyer_phone_number: string;
		senior_phone_number: string | null;
		email: string | null;
		status: string;
		current_period_end: string | null;
		stripe_customer_id: string | null;
	},
	seniorFirstName: string | null,
) {
	return {
		buyer_phone_number: subscription.buyer_phone_number,
		senior_phone_number: subscription.senior_phone_number,
		using_own_number:
			Boolean(subscription.senior_phone_number) &&
			subscription.senior_phone_number === subscription.buyer_phone_number,
		email: subscription.email,
		status: subscription.status,
		current_period_end: subscription.current_period_end,
		senior_first_name: seniorFirstName,
		stripe_customer_id: subscription.stripe_customer_id,
	};
}

app.post("/api/verifyCallCode", authenticateApiKey, async (req, res) => {
	const code = String(req.body?.code ?? "").replace(/\s/g, "");
	if (!/^\d{6}$/.test(code)) {
		return res.status(400).json({ error: "Enter the 6-digit code." });
	}

	try {
		const redeemed = await consumeVerificationCode(code);
		if (!redeemed) {
			return res.status(400).json({ error: "That code didn't match. Try again." });
		}

		const { data: user } = await supabase
			.from("users")
			.select("first_name, nickname")
			.eq("phone_number", redeemed.phone_number)
			.maybeSingle();

		return res.json({
			ok: true,
			phone: redeemed.phone_number,
			buyer_name: user?.nickname || user?.first_name || null,
		});
	} catch (error) {
		console.error("verifyCallCode failed", error);
		return res.status(500).json({ error: "Could not check that code." });
	}
});

app.post("/api/activateSubscription", authenticateApiKey, async (req, res) => {
	const buyerPhone = normalizePhoneNumber(req.body?.buyer_phone);
	if (!buyerPhone) {
		return res.status(400).json({ error: "Missing buyer_phone" });
	}

	const statusRaw = String(req.body?.status ?? "active");
	const status: SubscriptionStatus =
		statusRaw === "active" ||
		statusRaw === "past_due" ||
		statusRaw === "canceled" ||
		statusRaw === "pending_payment"
			? statusRaw
			: mapStripeStatus(statusRaw);

	try {
		const subscription = await activateSubscription({
			buyerPhone,
			email: typeof req.body?.email === "string" ? req.body.email : null,
			stripeCustomerId:
				typeof req.body?.stripe_customer_id === "string"
					? req.body.stripe_customer_id
					: null,
			stripeSubscriptionId:
				typeof req.body?.stripe_subscription_id === "string"
					? req.body.stripe_subscription_id
					: null,
			status,
			currentPeriodEnd: periodEndFromUnknown(req.body?.current_period_end),
		});
		return res.json({ ok: true, subscription });
	} catch (error) {
		console.error("activateSubscription failed", error);
		return res.status(500).json({
			error: error instanceof Error ? error.message : "Could not activate plan.",
		});
	}
});

app.post("/api/syncStripeSubscription", authenticateApiKey, async (req, res) => {
	const stripeSubscriptionId =
		typeof req.body?.stripe_subscription_id === "string"
			? req.body.stripe_subscription_id
			: "";
	if (!stripeSubscriptionId) {
		return res.status(400).json({ error: "Missing stripe_subscription_id" });
	}

	const statusRaw = String(req.body?.status ?? "");
	const status = mapStripeStatus(statusRaw || undefined);

	try {
		const subscription = await syncStripeSubscription({
			stripeSubscriptionId,
			stripeCustomerId:
				typeof req.body?.stripe_customer_id === "string"
					? req.body.stripe_customer_id
					: null,
			buyerPhone: normalizePhoneNumber(req.body?.buyer_phone),
			email: typeof req.body?.email === "string" ? req.body.email : null,
			status,
			currentPeriodEnd: periodEndFromUnknown(req.body?.current_period_end),
		});
		if (!subscription) {
			return res.status(404).json({ error: "No matching subscription." });
		}
		return res.json({ ok: true, subscription });
	} catch (error) {
		console.error("syncStripeSubscription failed", error);
		return res.status(500).json({
			error: error instanceof Error ? error.message : "Could not sync plan.",
		});
	}
});

app.get("/api/account", authenticateApiKey, async (req, res) => {
	const phone = normalizePhoneNumber(String(req.query.phone ?? ""));
	if (!phone) {
		return res.status(400).json({ error: "Missing phone" });
	}

	try {
		const account = await getAccountForBuyer(phone);
		if (!account) {
			return res.status(404).json({ error: "No MyFriend account for this number." });
		}
		return res.json(accountPayload(account.subscription, account.seniorFirstName));
	} catch (error) {
		console.error("get account failed", error);
		return res.status(500).json({ error: "Could not load account." });
	}
});

app.post("/api/account/senior-phone", authenticateApiKey, async (req, res) => {
	const buyerPhone = normalizePhoneNumber(req.body?.buyer_phone);
	const forMyself = Boolean(req.body?.for_myself);
	const seniorPhone = forMyself
		? buyerPhone
		: normalizePhoneNumber(req.body?.senior_phone);

	if (!buyerPhone || !seniorPhone) {
		return res.status(400).json({ error: "Missing buyer_phone or senior_phone" });
	}

	try {
		const subscription = await setSeniorPhone({ buyerPhone, seniorPhone });
		const account = await getAccountForBuyer(buyerPhone);
		return res.json(
			accountPayload(subscription, account?.seniorFirstName ?? null),
		);
	} catch (error) {
		const status = (error as Error & { status?: number }).status ?? 500;
		console.error("set senior phone failed", error);
		return res.status(status).json({
			error:
				error instanceof Error
					? error.message
					: "Could not save that phone number.",
		});
	}
});
