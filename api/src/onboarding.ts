import { app } from "./app";
import { authenticateApiKey } from "./middleware/auth";
import { supabase } from "./lib/supabase";

// Called only by the website server. Answers never go in Stripe metadata.
app.post("/api/onboarding", authenticateApiKey, async (req, res) => {
	const { checkout_session_id, answers, billing_plan, livemode } = req.body ?? {};
	if (typeof checkout_session_id !== "string" || !/^cs_(test_|live_)?[A-Za-z0-9]+$/.test(checkout_session_id) ||
		!answers || typeof answers !== "object" || Array.isArray(answers) ||
		JSON.stringify(answers).length > 12000 || !["monthly", "annual"].includes(billing_plan) || typeof livemode !== "boolean") {
		return res.status(400).json({ error: "Invalid onboarding submission." });
	}
	const { error } = await supabase.from("onboarding_submissions").upsert({
		checkout_session_id, answers, billing_plan, livemode, updated_at: new Date().toISOString(),
	}, { onConflict: "checkout_session_id" });
	if (error) return res.status(503).json({ error: "Could not save your onboarding answers." });
	return res.json({ ok: true });
});

export async function linkOnboardingSubmission(checkoutSessionId: string, subscriptionId: string) {
	const { error } = await supabase.from("onboarding_submissions")
		.update({ subscription_id: subscriptionId, updated_at: new Date().toISOString() })
		.eq("checkout_session_id", checkoutSessionId);
	if (error) throw new Error("Could not link onboarding answers to the subscription.");
}
