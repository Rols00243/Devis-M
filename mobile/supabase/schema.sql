-- ---------------------------------------------------------------------------
-- MétréCards — schéma cloud (Supabase / PostgreSQL)
--
-- À exécuter dans le SQL Editor du projet Supabase, ou via `supabase db push`.
--
-- Principe de sécurité : chaque ligne appartient à un utilisateur (`owner_id`)
-- et la sécurité au niveau des lignes (RLS) est activée. Aucune requête ne peut
-- lire ou modifier les cartes d'un autre compte, même avec la clé publique de
-- l'application — c'est le serveur qui applique la règle, pas le client.
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

-- --------------------------------- Table ----------------------------------

create table if not exists public.business_cards (
  id               uuid primary key,
  owner_id         uuid not null references auth.users (id) on delete cascade,

  first_name       text not null default '',
  last_name        text not null default '',
  job_title        text not null default '',
  company          text not null default '',
  phone            text not null default '',
  secondary_phone  text not null default '',
  whatsapp         text not null default '',
  email            text not null default '',
  website          text not null default '',
  address          text not null default '',
  city             text not null default '',
  country          text not null default '',
  linkedin         text not null default '',
  notes            text not null default '',

  raw_text         text not null default '',
  confidence       jsonb not null default '{}'::jsonb,
  status           text not null default 'validated',
  contact_id       text,
  source           text not null default 'camera',
  ocr_engine       text not null default 'mlkit',
  languages        text[] not null default '{}',
  image_path       text,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,

  constraint business_cards_status_check
    check (status in ('draft', 'validated', 'contact_created', 'archived'))
);

-- Index de synchronisation : on lit toujours « mes cartes modifiées depuis X ».
create index if not exists business_cards_owner_updated_idx
  on public.business_cards (owner_id, updated_at desc);

-- Recherche plein texte côté serveur, pour la future version web.
create index if not exists business_cards_search_idx
  on public.business_cards
  using gin (to_tsvector('simple',
    coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
    coalesce(company, '')    || ' ' || coalesce(city, '')));

-- ----------------------------- Règles d'accès ------------------------------

alter table public.business_cards enable row level security;

drop policy if exists "cartes lisibles par leur propriétaire" on public.business_cards;
create policy "cartes lisibles par leur propriétaire"
  on public.business_cards for select
  using (auth.uid() = owner_id);

drop policy if exists "création réservée au propriétaire" on public.business_cards;
create policy "création réservée au propriétaire"
  on public.business_cards for insert
  with check (auth.uid() = owner_id);

drop policy if exists "modification réservée au propriétaire" on public.business_cards;
create policy "modification réservée au propriétaire"
  on public.business_cards for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "suppression réservée au propriétaire" on public.business_cards;
create policy "suppression réservée au propriétaire"
  on public.business_cards for delete
  using (auth.uid() = owner_id);

-- `updated_at` est tenu par le serveur : un client ne peut pas antidater une
-- modification pour gagner un conflit de synchronisation.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := greatest(now(), old.updated_at);
  return new;
end;
$$;

drop trigger if exists business_cards_touch on public.business_cards;
create trigger business_cards_touch
  before update on public.business_cards
  for each row execute function public.touch_updated_at();

-- ------------------------------- Stockage ----------------------------------

insert into storage.buckets (id, name, public)
values ('card-images', 'card-images', false)
on conflict (id) do nothing;

-- Les fichiers sont rangés sous `<user_id>/<card_id>.jpg` : le premier segment
-- du chemin porte la propriété, et les règles s'appuient dessus.
drop policy if exists "images lisibles par leur propriétaire" on storage.objects;
create policy "images lisibles par leur propriétaire"
  on storage.objects for select
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "dépôt d'images par leur propriétaire" on storage.objects;
create policy "dépôt d'images par leur propriétaire"
  on storage.objects for insert
  with check (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "remplacement d'images par leur propriétaire" on storage.objects;
create policy "remplacement d'images par leur propriétaire"
  on storage.objects for update
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "suppression d'images par leur propriétaire" on storage.objects;
create policy "suppression d'images par leur propriétaire"
  on storage.objects for delete
  using (bucket_id = 'card-images' and (storage.foldername(name))[1] = auth.uid()::text);

-- ------------------------- Suppression définitive ---------------------------
-- Appelée par la fonction Edge `delete-account` : efface toutes les données de
-- l'utilisateur courant, y compris ses images.

create or replace function public.purge_my_data()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from storage.objects
   where bucket_id = 'card-images'
     and (storage.foldername(name))[1] = auth.uid()::text;
  delete from public.business_cards where owner_id = auth.uid();
end;
$$;
