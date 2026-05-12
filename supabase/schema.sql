-- Weekly Meeting Prep Agent — Supabase Schema
-- Run this in your Supabase SQL editor to set up the database.

-- ============================================================
-- memo_requests
-- Stores each meeting prep request submitted by Patrick.
-- ============================================================
create table if not exists memo_requests (
  id                uuid primary key default gen_random_uuid(),
  meeting_title     text not null,
  meeting_datetime  timestamptz,
  company_name      text not null,
  company_website   text,
  meeting_type      text,  -- prospect_intro | client_meeting | partner_meeting | internal_strategy | other
  attendees         jsonb, -- Array of { name, title, email, raw }
  known_context     text,
  internal_context  text,
  memo_depth        text default 'standard',  -- bare | standard | detailed
  status            text default 'draft',      -- draft | approved | needs_review
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ============================================================
-- research_sources
-- Stores web search results collected during memo generation.
-- ============================================================
create table if not exists research_sources (
  id                uuid primary key default gen_random_uuid(),
  memo_request_id   uuid references memo_requests(id) on delete cascade,
  source_type       text,    -- web | mock
  title             text,
  url               text,
  snippet           text,
  summary           text,
  relevance_score   numeric,
  created_at        timestamptz default now()
);

-- ============================================================
-- generated_memos
-- Stores each version of the generated memo markdown.
-- Multiple versions can exist per memo_request (regeneration).
-- ============================================================
create table if not exists generated_memos (
  id                uuid primary key default gen_random_uuid(),
  memo_request_id   uuid references memo_requests(id) on delete cascade,
  memo_markdown     text,
  confidence_level  text,    -- low | medium | high
  review_status     text default 'draft',  -- draft | approved | needs_review
  patrick_feedback  text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- ============================================================
-- Row-level security (optional — no auth in MVP)
-- ============================================================
-- Enable RLS but allow all access for the MVP (no auth).
-- Tighten this when you add authentication.

alter table memo_requests    enable row level security;
alter table research_sources enable row level security;
alter table generated_memos  enable row level security;

-- Allow all operations from anon key (MVP — no auth)
create policy "allow all memo_requests"    on memo_requests    for all using (true) with check (true);
create policy "allow all research_sources" on research_sources for all using (true) with check (true);
create policy "allow all generated_memos"  on generated_memos  for all using (true) with check (true);

-- ============================================================
-- Indexes
-- ============================================================
create index if not exists idx_research_sources_memo_request_id
  on research_sources (memo_request_id);

create index if not exists idx_generated_memos_memo_request_id
  on generated_memos (memo_request_id);

create index if not exists idx_memo_requests_created_at
  on memo_requests (created_at desc);

-- ============================================================
-- Apollo enrichment cache tables
-- Caches person and org lookups for 30 days to avoid
-- redundant Apollo API calls and conserve plan credits.
-- ============================================================

create table if not exists apollo_people_cache (
  id          uuid primary key default gen_random_uuid(),
  lookup_key  text unique not null,  -- e.g. "email:chris@acme.com" or "namedomain:chris|marcus|acme.com"
  input_email text,
  full_name   text,
  company_domain text,
  response_json  jsonb,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists apollo_organization_cache (
  id            uuid primary key default gen_random_uuid(),
  domain        text unique not null,
  response_json jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table apollo_people_cache       enable row level security;
alter table apollo_organization_cache enable row level security;

create policy "allow all apollo_people_cache"
  on apollo_people_cache for all using (true) with check (true);

create policy "allow all apollo_organization_cache"
  on apollo_organization_cache for all using (true) with check (true);

create index if not exists idx_apollo_people_cache_lookup_key
  on apollo_people_cache (lookup_key);

create index if not exists idx_apollo_organization_cache_domain
  on apollo_organization_cache (domain);
