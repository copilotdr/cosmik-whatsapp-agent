create table if not exists customers (
  id text primary key,
  whatsapp text unique not null,
  name text,
  city text,
  recurring_address text,
  color_preferences text,
  scent_preferences text,
  occasions text,
  notes text,
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists products (
  id text primary key,
  slug text unique not null,
  active boolean default true,
  name text not null,
  category text,
  price_cop integer,
  url text,
  image_url text,
  description text,
  sizes_formats text,
  scents text,
  colors text,
  customizable boolean default true,
  production_time text,
  internal_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists conversations (
  id text primary key,
  whatsapp_message_id text unique,
  customer_id text references customers(id),
  customer_whatsapp text not null,
  customer_name text,
  incoming_text text,
  assistant_reply text,
  raw_type text default 'text',
  intent text,
  order_id text,
  created_at timestamptz default now()
);

create table if not exists orders (
  id text primary key,
  whatsapp_message_id text,
  customer_id text references customers(id),
  customer_whatsapp text not null,
  customer_name text,
  status text default 'nuevo',
  priority text default 'normal',
  product text,
  category text,
  quantity integer,
  color text,
  scent text,
  size_format text,
  personal_message text,
  delivery_address text,
  delivery_city text,
  desired_delivery_date date,
  payment_method text,
  estimated_value_cop integer,
  checkout_url text,
  summary text,
  team_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists manual_overrides (
  customer_whatsapp text primary key,
  active boolean default true,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists conversation_statuses (
  customer_whatsapp text primary key,
  status text default 'activo',
  reason text,
  archived_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists chatwoot_threads (
  customer_whatsapp text primary key,
  contact_identifier text not null,
  conversation_id text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_orders_status on orders(status);
create index if not exists idx_orders_delivery_date on orders(desired_delivery_date);
create index if not exists idx_conversations_customer_whatsapp on conversations(customer_whatsapp);
create index if not exists idx_manual_overrides_active on manual_overrides(active);
create index if not exists idx_conversation_statuses_status on conversation_statuses(status);
create index if not exists idx_chatwoot_threads_conversation_id on chatwoot_threads(conversation_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'conversations_order_fk'
  ) then
    alter table conversations
      add constraint conversations_order_fk
      foreign key (order_id) references orders(id)
      deferrable initially deferred;
  end if;
end $$;

grant usage on schema public to service_role;
grant select, insert, update, delete on customers to service_role;
grant select, insert, update, delete on products to service_role;
grant select, insert, update, delete on conversations to service_role;
grant select, insert, update, delete on orders to service_role;
grant select, insert, update, delete on manual_overrides to service_role;
grant select, insert, update, delete on conversation_statuses to service_role;
grant select, insert, update, delete on chatwoot_threads to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges in schema public
  grant usage, select on sequences to service_role;
