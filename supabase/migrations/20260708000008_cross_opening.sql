-- Ouverture croisee des opportunites (opt-in expert, defaut ferme).
-- open_to_cdi : un expert FREELANCE accepte de voir aussi les offres CDI.
-- open_to_freelance : un expert CDI accepte de voir aussi les missions freelance.
alter table public.profiles
  add column if not exists open_to_cdi boolean not null default false,
  add column if not exists open_to_freelance boolean not null default false;
