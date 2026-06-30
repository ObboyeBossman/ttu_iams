-- =============================================================================
-- IAMS — Industrial Attachment Management System
-- Migration: Payments Table
-- =============================================================================

-- Enums
create type payment_purpose as enum (
  'logbook_access',
  'attachment_report'
);

create type payment_status as enum (
  'confirmed',
  'failed'
);

-- Table: payments
create table public.payments (
  id                 uuid             primary key default gen_random_uuid(),
  student_id         uuid             not null references public.profiles (id) on delete restrict,
  season_id          uuid             not null references public.seasons (id) on delete restrict,
  purpose            payment_purpose  not null,
  amount_pesewas     integer          not null check (amount_pesewas > 0),
  currency           text             not null default 'GHS',
  status             payment_status   not null,
  paystack_reference text             not null unique,
  paid_at            timestamptz,
  created_at         timestamptz      not null default now(),

  constraint payments_one_per_student_per_season_purpose
    unique (student_id, season_id, purpose)
);

comment on table public.payments is
  'Student payments for paid IAMS features (logbook access, AI report generation). Written exclusively by the verify-paystack Edge Function after server-side Paystack verification.';

-- Indexes
create index payments_season_idx  on public.payments (season_id);
create index payments_purpose_idx on public.payments (purpose);

-- =============================================================================
-- RLS Policies for payments
-- =============================================================================

alter table public.payments enable row level security;

-- Student can read their own payments
create policy "payments: student reads own"
  on public.payments for select
  using (student_id = auth.uid());

-- Admin can read all payments
create policy "payments: admin reads all"
  on public.payments for select
  using (public.current_role() = 'admin');

-- No insert/update/delete policies — only service role writes via verify-paystack
