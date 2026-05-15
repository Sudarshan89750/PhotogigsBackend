-- ═══════════════════════════════════════════════════════════════════════════════
--  PhotoGigs — PostgreSQL Schema  (Neon.tech / any PG 14+)
-- ═══════════════════════════════════════════════════════════════════════════════
--  Run once on a fresh database:
--    psql $DATABASE_URL -f schema.sql
--
--  This file defines every table that lives in Postgres.
--  MongoDB collections are documented in mongo_collections.js (reference only).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Extensions ──────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pgcrypto";          -- gen_random_uuid()

-- ─── Enums ───────────────────────────────────────────────────────────────────

CREATE TYPE user_status AS ENUM (
  'pending_otp',        -- just signed up, awaiting email verification
  'pending_id',         -- OTP verified, awaiting govt-ID upload
  'pending_approval',   -- ID uploaded, awaiting admin review
  'approved',           -- fully active
  'blocked'             -- suspended by admin
);

CREATE TYPE user_role AS ENUM ('user', 'admin');

-- ═══════════════════════════════════════════════════════════════════════════════
--  TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─── Users ───────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auth
  email           VARCHAR(255)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255),                       -- NULL when logged-in via Google OAuth
  google_id       VARCHAR(255)  UNIQUE,

  -- Profile
  first_name      VARCHAR(100)  NOT NULL,
  last_name       VARCHAR(100)  NOT NULL,
  phone           VARCHAR(20),
  city            VARCHAR(100),
  state           VARCHAR(100),
  country         VARCHAR(100),
  latitude        DECIMAL(10, 8),
  longitude       DECIMAL(11, 8),
  avatar_url      TEXT,
  bio             TEXT,

  -- KYC / Verification
  id_document_url TEXT,                                -- Cloudinary URL for govt-ID image
  status          user_status   NOT NULL DEFAULT 'pending_otp',
  role            user_role     NOT NULL DEFAULT 'user',

  -- Freelancer profile
  skills          TEXT[],                              -- e.g. {'Photography','Videography','Editing'}
  hourly_rate     DECIMAL(10, 2),
  portfolio_urls  TEXT[],

  -- SaaS & Quota
  membership_tier   VARCHAR(20) DEFAULT 'free',
  has_used_trial    BOOLEAN DEFAULT false,
  base_image_limit  INT DEFAULT 0,
  addon_image_limit INT DEFAULT 0,
  used_images       INT DEFAULT 0,

  -- Aggregated stats (maintained by trigger / application)
  average_rating  DECIMAL(3, 2) DEFAULT 0,
  total_reviews   INTEGER       DEFAULT 0,

  -- Timestamps
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── SaaS Modules ────────────────────────────────────────────────────────────

CREATE TABLE membership_plans (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                VARCHAR(50)   NOT NULL UNIQUE,
  price               DECIMAL(10, 2) NOT NULL,
  trial_duration_days INT DEFAULT 0,
  is_active           BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id         UUID NOT NULL REFERENCES membership_plans(id),
  status          VARCHAR(50) NOT NULL CHECK (status IN ('trialing', 'active', 'expired')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE addon_purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity_granted INT NOT NULL,
  phonepe_txn_id   VARCHAR(255) UNIQUE NOT NULL,
  status           VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Refresh Tokens ──────────────────────────────────────────────────────────
--  JWT refresh tokens are stored in Redis for fast lookups, this table is a
--  durable fallback / audit log.

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255)  NOT NULL,
  expires_at  TIMESTAMPTZ   NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ─── FCM Device Tokens ───────────────────────────────────────────────────────
--  One row per (user, device) for Firebase Cloud Messaging push notifications.

CREATE TABLE fcm_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT          NOT NULL,
  device_id   VARCHAR(255)  NOT NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  UNIQUE(user_id, device_id)
);

-- ─── Reviews ─────────────────────────────────────────────────────────────────
--  Written after a job is completed. job_id references MongoDB ObjectId as text.

CREATE TABLE reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        VARCHAR(255)  NOT NULL,                -- MongoDB Job._id
  reviewer_id   UUID          NOT NULL REFERENCES users(id),
  reviewee_id   UUID          NOT NULL REFERENCES users(id),
  rating        INTEGER       NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       TEXT,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);


-- ═══════════════════════════════════════════════════════════════════════════════
--  INDEXES
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users
CREATE INDEX idx_users_status        ON users(status);
CREATE INDEX idx_users_email         ON users(email);
CREATE INDEX idx_users_location      ON users(latitude, longitude) WHERE status = 'approved';
CREATE INDEX idx_users_rating        ON users(average_rating DESC)  WHERE status = 'approved';
CREATE INDEX idx_users_skills        ON users USING GIN(skills);

-- Reviews
CREATE INDEX idx_reviews_reviewee    ON reviews(reviewee_id, created_at DESC);
CREATE INDEX idx_reviews_reviewer    ON reviews(reviewer_id);
CREATE INDEX idx_reviews_job         ON reviews(job_id);

-- Token lookups
CREATE INDEX idx_fcm_tokens_user     ON fcm_tokens(user_id);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);


-- ═══════════════════════════════════════════════════════════════════════════════
--  TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auto-set updated_at on every UPDATE
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Auto-recalculate average_rating & total_reviews after a review is inserted
CREATE OR REPLACE FUNCTION recalc_user_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE users
  SET average_rating = sub.avg_rating,
      total_reviews  = sub.cnt,
      updated_at     = NOW()
  FROM (
    SELECT reviewee_id,
           ROUND(AVG(rating)::NUMERIC, 2) AS avg_rating,
           COUNT(*)::INTEGER AS cnt
    FROM reviews
    WHERE reviewee_id = NEW.reviewee_id
    GROUP BY reviewee_id
  ) sub
  WHERE users.id = sub.reviewee_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reviews_recalc_rating
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION recalc_user_rating();

-- ─── Admin Audit Logs ─────────────────────────────────────────────────────────

CREATE TABLE admin_audit_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id    UUID NOT NULL REFERENCES users(id),
  action         VARCHAR(100) NOT NULL,
  target_user_id  UUID REFERENCES users(id),
  details       JSONB,
  ip_address    VARCHAR(45),
  created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_logs_admin ON admin_audit_logs(admin_user_id, created_at DESC);
CREATE INDEX idx_admin_audit_logs_target ON admin_audit_logs(target_user_id, created_at DESC);
