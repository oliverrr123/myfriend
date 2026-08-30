-- Paid US onboarding: grandfather existing callers, store spoken
-- verification codes, and track Stripe family subscriptions.
-- The API uses the Supabase service role key, which bypasses RLS.

ALTER TABLE IF EXISTS users
  ADD COLUMN IF NOT EXISTS grandfathered BOOLEAN;

-- One-time backfill: rows that existed before this column keep full MyFriend.
-- Re-running is safe because later inserts are already true/false, not NULL.
UPDATE users
SET grandfathered = true
WHERE grandfathered IS NULL;

ALTER TABLE IF EXISTS users
  ALTER COLUMN grandfathered SET DEFAULT false;

ALTER TABLE IF EXISTS users
  ALTER COLUMN grandfathered SET NOT NULL;

CREATE TABLE IF NOT EXISTS phone_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS phone_verifications_phone_active_idx
  ON phone_verifications (phone_number)
  WHERE consumed_at IS NULL;

CREATE INDEX IF NOT EXISTS phone_verifications_code_hash_idx
  ON phone_verifications (code_hash);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_phone_number VARCHAR(20) NOT NULL,
  senior_phone_number VARCHAR(20),
  buyer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  senior_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  email VARCHAR(255),
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  status VARCHAR(32) NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment', 'active', 'past_due', 'canceled')),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_buyer_phone_unique
  ON subscriptions (buyer_phone_number);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_senior_phone_unique
  ON subscriptions (senior_phone_number)
  WHERE senior_phone_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_stripe_subscription_unique
  ON subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscriptions_stripe_customer_idx
  ON subscriptions (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

ALTER TABLE IF EXISTS phone_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS subscriptions ENABLE ROW LEVEL SECURITY;

-- Intentionally no anon/authenticated policies.
-- Add explicit policies later only if a frontend should access Supabase directly.
