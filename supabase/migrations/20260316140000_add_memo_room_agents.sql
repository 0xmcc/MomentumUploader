create table public.agents (
  id            uuid         primary key default gen_random_uuid(),
  owner_user_id text         not null references public.users(id) on delete cascade,
  name          text         not null,
  description   text,
  status        text         not null default 'active' check (status in ('active', 'disabled')),
  created_at    timestamptz  not null default now(),
  updated_at    timestamptz  not null default now()
);

create index agents_owner_created_idx
  on public.agents (owner_user_id, created_at desc);

alter table public.memo_room_participants
  add constraint memo_room_participants_agent_id_fkey
    foreign key (agent_id)
    references public.agents(id)
    on delete cascade;

create table public.agent_room_state (
  id                          uuid         primary key default gen_random_uuid(),
  agent_id                    uuid         not null references public.agents(id) on delete cascade,
  memo_room_id                uuid         not null references public.memo_rooms(id) on delete cascade,
  last_seen_message_id        uuid         references public.memo_messages(id) on delete set null,
  last_seen_transcript_segment_id bigint   references public.memo_transcript_segments(id) on delete set null,
  last_processed_invocation_id uuid,
  default_visibility          text         not null default 'owner_only'
                                           check (default_visibility in ('public', 'owner_only', 'restricted')),
  created_at                  timestamptz  not null default now(),
  updated_at                  timestamptz  not null default now(),
  unique (agent_id, memo_room_id)
);

create index agent_room_state_room_idx
  on public.agent_room_state (memo_room_id, agent_id);

create table public.agent_invocations (
  id                    uuid         primary key default gen_random_uuid(),
  agent_id              uuid         not null references public.agents(id) on delete cascade,
  memo_room_id          uuid         not null references public.memo_rooms(id) on delete cascade,
  memo_id               uuid         not null references public.memos(id) on delete cascade,
  request_message_id    uuid         not null references public.memo_messages(id) on delete cascade,
  response_message_id   uuid         references public.memo_messages(id) on delete set null,
  invoked_by_user_id    text         not null references public.users(id) on delete cascade,
  status                text         not null default 'pending'
                                     check (status in ('pending', 'processing', 'completed', 'failed')),
  failure_reason        text,
  anchor_start_ms       integer,
  anchor_end_ms         integer,
  anchor_segment_ids    bigint[],
  created_at            timestamptz  not null default now(),
  updated_at            timestamptz  not null default now(),
  completed_at          timestamptz,
  constraint agent_invocations_unique_request
    unique (agent_id, request_message_id),
  constraint agent_invocations_room_memo_fkey
    foreign key (memo_room_id, memo_id)
    references public.memo_room_memos (memo_room_id, memo_id)
    on delete cascade,
  constraint agent_invocations_anchor_bounds_check check (
    (
      anchor_start_ms is null
      and anchor_end_ms is null
    ) or (
      anchor_start_ms is not null
      and anchor_end_ms is not null
      and anchor_start_ms >= 0
      and anchor_end_ms > anchor_start_ms
    )
  )
);

create index agent_invocations_agent_status_idx
  on public.agent_invocations (agent_id, status, created_at desc);

create index agent_invocations_room_created_idx
  on public.agent_invocations (memo_room_id, created_at desc);

alter table public.agent_room_state
  add constraint agent_room_state_last_processed_invocation_id_fkey
    foreign key (last_processed_invocation_id)
    references public.agent_invocations(id)
    on delete set null;

alter table public.agents enable row level security;
alter table public.agent_room_state enable row level security;
alter table public.agent_invocations enable row level security;
