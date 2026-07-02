-- =============================================================================
-- IAMS — Add super_admin to the user_role enum
-- Must run OUTSIDE a transaction (Supabase applies each migration file in its
-- own transaction by default, so putting the ALTER TYPE in a separate file is
-- the safest way to satisfy the Postgres "no new enum value in same tx" rule).
-- =============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin';
