import { supabase } from "./supabase";
import { normalizePhoneNumber } from "./callParticipants";
import { requiresPaidAccess } from "./paidAccess";
import { inferLanguageCodeFromE164 } from "./phoneLanguagePrefix";

export type CallMode =
	| "full"
	| "intro_verify"
	| "informatory"
	| "payment_required";

export type SubscriptionStatus =
	| "pending_payment"
	| "active"
	| "past_due"
	| "canceled";

export type SubscriptionRow = {
	id: string;
	buyer_phone_number: string;
	senior_phone_number: string | null;
	buyer_user_id: string | null;
	senior_user_id: string | null;
	email: string | null;
	stripe_customer_id: string | null;
	stripe_subscription_id: string | null;
	status: SubscriptionStatus;
	current_period_end: string | null;
};

export type CallAccess = {
	mode: CallMode;
	role: "buyer" | "senior" | "none";
	subscription: SubscriptionRow | null;
	seniorName: string | null;
	seniorPhone: string | null;
	lastSeniorCallAt: string | null;
};

const SUBSCRIPTION_COLUMNS =
	"id, buyer_phone_number, senior_phone_number, buyer_user_id, senior_user_id, email, stripe_customer_id, stripe_subscription_id, status, current_period_end";

function isActiveStatus(status: string | null | undefined): boolean {
	return status === "active";
}

function isUnpaidStatus(status: string | null | undefined): boolean {
	return status === "past_due" || status === "canceled";
}

export function mapStripeStatus(status: string | null | undefined): SubscriptionStatus {
	switch (status) {
		case "active":
		case "trialing":
			return "active";
		case "past_due":
		case "unpaid":
			return "past_due";
		case "canceled":
		case "incomplete_expired":
			return "canceled";
		default:
			return "pending_payment";
	}
}

export async function findSubscriptionByPhone(
	phoneNumber: string,
): Promise<SubscriptionRow | null> {
	const phone = normalizePhoneNumber(phoneNumber);
	if (!phone) return null;

	const { data: asBuyer, error: buyerError } = await supabase
		.from("subscriptions")
		.select(SUBSCRIPTION_COLUMNS)
		.eq("buyer_phone_number", phone)
		.maybeSingle();

	if (buyerError) throw new Error(buyerError.message);
	if (asBuyer) return asBuyer as SubscriptionRow;

	const { data: asSenior, error: seniorError } = await supabase
		.from("subscriptions")
		.select(SUBSCRIPTION_COLUMNS)
		.eq("senior_phone_number", phone)
		.maybeSingle();

	if (seniorError) throw new Error(seniorError.message);
	return (asSenior as SubscriptionRow | null) ?? null;
}

export async function findSubscriptionByStripeId(
	stripeSubscriptionId: string,
): Promise<SubscriptionRow | null> {
	const { data, error } = await supabase
		.from("subscriptions")
		.select(SUBSCRIPTION_COLUMNS)
		.eq("stripe_subscription_id", stripeSubscriptionId)
		.maybeSingle();
	if (error) throw new Error(error.message);
	return (data as SubscriptionRow | null) ?? null;
}

async function loadSeniorCallContext(seniorPhone: string | null): Promise<{
	seniorName: string | null;
	lastSeniorCallAt: string | null;
}> {
	if (!seniorPhone) return { seniorName: null, lastSeniorCallAt: null };

	const { data: senior } = await supabase
		.from("users")
		.select("first_name, nickname, first_name_vocative, nickname_vocative")
		.eq("phone_number", seniorPhone)
		.maybeSingle();

	const seniorName =
		senior?.nickname ||
		senior?.first_name ||
		senior?.nickname_vocative ||
		senior?.first_name_vocative ||
		null;

	const { data: lastCall } = await supabase
		.from("conversation_storage")
		.select("started_at")
		.eq("phone_number", seniorPhone)
		.order("created_at", { ascending: false })
		.limit(1)
		.maybeSingle();

	const lastSeniorCallAt =
		typeof lastCall?.started_at === "number"
			? new Date(lastCall.started_at * 1000).toISOString()
			: null;

	return { seniorName, lastSeniorCallAt };
}

export async function resolveCallAccess(params: {
	phoneNumber: string;
	grandfathered?: boolean | null;
}): Promise<CallAccess> {
	const phone = normalizePhoneNumber(params.phoneNumber) ?? params.phoneNumber;
	const empty: CallAccess = {
		mode: "full",
		role: "none",
		subscription: null,
		seniorName: null,
		seniorPhone: null,
		lastSeniorCallAt: null,
	};

	if (params.grandfathered) {
		return empty;
	}

	const subscription = await findSubscriptionByPhone(phone);
	if (subscription) {
		const isBuyer = subscription.buyer_phone_number === phone;
		const isSenior = subscription.senior_phone_number === phone;
		const role: CallAccess["role"] = isBuyer ? "buyer" : isSenior ? "senior" : "none";
		const seniorContext = await loadSeniorCallContext(
			subscription.senior_phone_number,
		);

		if (isUnpaidStatus(subscription.status)) {
			return {
				mode: "payment_required",
				role,
				subscription,
				seniorPhone: subscription.senior_phone_number,
				...seniorContext,
			};
		}

		if (isActiveStatus(subscription.status)) {
			const usingOwnNumber =
				Boolean(subscription.senior_phone_number) &&
				subscription.senior_phone_number === subscription.buyer_phone_number;
			if (isSenior || (isBuyer && usingOwnNumber)) {
				return {
					mode: "full",
					role: isSenior ? "senior" : "buyer",
					subscription,
					seniorPhone: subscription.senior_phone_number,
					...seniorContext,
				};
			}
			if (isBuyer) {
				return {
					mode: "informatory",
					role: "buyer",
					subscription,
					seniorPhone: subscription.senior_phone_number,
					...seniorContext,
				};
			}
		}
	}

	if (requiresPaidAccess(phone)) {
		return {
			...empty,
			mode: "intro_verify",
			subscription,
		};
	}

	return { ...empty, subscription };
}

async function ensureUserForPhone(phone: string): Promise<string | null> {
	const { data: existing, error } = await supabase
		.from("users")
		.select("id")
		.eq("phone_number", phone)
		.maybeSingle();
	if (error) throw new Error(error.message);
	if (existing?.id) return existing.id;

	const language = inferLanguageCodeFromE164(phone);
	const { data: created, error: insertError } = await supabase
		.from("users")
		.insert({
			phone_number: phone,
			language,
			grandfathered: false,
		})
		.select("id")
		.maybeSingle();
	if (insertError) throw new Error(insertError.message);
	return created?.id ?? null;
}

export async function activateSubscription(input: {
	buyerPhone: string;
	email?: string | null;
	stripeCustomerId?: string | null;
	stripeSubscriptionId?: string | null;
	status?: SubscriptionStatus;
	currentPeriodEnd?: string | null;
}): Promise<SubscriptionRow> {
	const buyerPhone = normalizePhoneNumber(input.buyerPhone);
	if (!buyerPhone) {
		throw new Error("Invalid buyer phone number");
	}

	const buyerUserId = await ensureUserForPhone(buyerPhone);
	const status = input.status ?? "active";
	const now = new Date().toISOString();
	const patch = {
		buyer_phone_number: buyerPhone,
		buyer_user_id: buyerUserId,
		email: input.email ?? null,
		stripe_customer_id: input.stripeCustomerId ?? null,
		stripe_subscription_id: input.stripeSubscriptionId ?? null,
		status,
		current_period_end: input.currentPeriodEnd ?? null,
		updated_at: now,
	};

	const existing =
		(input.stripeSubscriptionId
			? await findSubscriptionByStripeId(input.stripeSubscriptionId)
			: null) ?? (await findSubscriptionByPhone(buyerPhone));

	if (existing) {
		const { data, error } = await supabase
			.from("subscriptions")
			.update(patch)
			.eq("id", existing.id)
			.select(SUBSCRIPTION_COLUMNS)
			.single();
		if (error) throw new Error(error.message);
		return data as SubscriptionRow;
	}

	const { data, error } = await supabase
		.from("subscriptions")
		.insert(patch)
		.select(SUBSCRIPTION_COLUMNS)
		.single();
	if (error) throw new Error(error.message);
	return data as SubscriptionRow;
}

export async function syncStripeSubscription(input: {
	stripeSubscriptionId: string;
	stripeCustomerId?: string | null;
	buyerPhone?: string | null;
	email?: string | null;
	status: SubscriptionStatus;
	currentPeriodEnd?: string | null;
}): Promise<SubscriptionRow | null> {
	const existing =
		(await findSubscriptionByStripeId(input.stripeSubscriptionId)) ??
		(input.buyerPhone ? await findSubscriptionByPhone(input.buyerPhone) : null);

	if (!existing) {
		if (!input.buyerPhone) return null;
		return activateSubscription({
			buyerPhone: input.buyerPhone,
			email: input.email,
			stripeCustomerId: input.stripeCustomerId,
			stripeSubscriptionId: input.stripeSubscriptionId,
			status: input.status,
			currentPeriodEnd: input.currentPeriodEnd,
		});
	}

	const { data, error } = await supabase
		.from("subscriptions")
		.update({
			status: input.status,
			current_period_end: input.currentPeriodEnd ?? existing.current_period_end,
			stripe_customer_id: input.stripeCustomerId ?? existing.stripe_customer_id,
			stripe_subscription_id: input.stripeSubscriptionId,
			email: input.email ?? existing.email,
			updated_at: new Date().toISOString(),
		})
		.eq("id", existing.id)
		.select(SUBSCRIPTION_COLUMNS)
		.single();
	if (error) throw new Error(error.message);
	return data as SubscriptionRow;
}

export async function setSeniorPhone(params: {
	buyerPhone: string;
	seniorPhone: string;
}): Promise<SubscriptionRow> {
	const buyerPhone = normalizePhoneNumber(params.buyerPhone);
	const seniorPhone = normalizePhoneNumber(params.seniorPhone);
	if (!buyerPhone || !seniorPhone) {
		throw new Error("Invalid phone number");
	}

	const subscription = await findSubscriptionByPhone(buyerPhone);
	if (!subscription || subscription.buyer_phone_number !== buyerPhone) {
		throw new Error("No subscription for this phone number");
	}

	const { data: taken } = await supabase
		.from("subscriptions")
		.select("id, buyer_phone_number")
		.eq("senior_phone_number", seniorPhone)
		.neq("id", subscription.id)
		.maybeSingle();
	if (taken) {
		const conflict = new Error("That phone number is already linked to another MyFriend plan.");
		(conflict as Error & { status?: number }).status = 409;
		throw conflict;
	}

	if (seniorPhone !== buyerPhone) {
		const { data: otherBuyer } = await supabase
			.from("subscriptions")
			.select("id")
			.eq("buyer_phone_number", seniorPhone)
			.neq("id", subscription.id)
			.maybeSingle();
		if (otherBuyer) {
			const conflict = new Error("That phone number already has its own MyFriend plan.");
			(conflict as Error & { status?: number }).status = 409;
			throw conflict;
		}
	}

	const seniorUserId = await ensureUserForPhone(seniorPhone);
	const { data, error } = await supabase
		.from("subscriptions")
		.update({
			senior_phone_number: seniorPhone,
			senior_user_id: seniorUserId,
			updated_at: new Date().toISOString(),
		})
		.eq("id", subscription.id)
		.select(SUBSCRIPTION_COLUMNS)
		.single();
	if (error) throw new Error(error.message);
	return data as SubscriptionRow;
}

export async function getAccountForBuyer(buyerPhone: string): Promise<{
	subscription: SubscriptionRow;
	seniorFirstName: string | null;
} | null> {
	const phone = normalizePhoneNumber(buyerPhone);
	if (!phone) return null;
	const subscription = await findSubscriptionByPhone(phone);
	if (!subscription || subscription.buyer_phone_number !== phone) {
		return null;
	}
	const { seniorName } = await loadSeniorCallContext(
		subscription.senior_phone_number,
	);
	return { subscription, seniorFirstName: seniorName };
}
