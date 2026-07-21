-- Trace du scope du dernier run de matching (permet au serveur de deriver le sens
-- d'un changement de scope : retreci -> prune-only SQL, elargi -> run IA complet).
alter table public.profiles
  add column if not exists last_matching_scope jsonb;
