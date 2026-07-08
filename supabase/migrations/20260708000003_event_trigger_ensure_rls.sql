-- Recable l'event trigger ensure_rls (non capturable par db dump).
-- Fonction public.rls_auto_enable() presente dans la baseline (audit 3e) : elle active RLS sur toute nouvelle table du schema public.
-- La fonction filtre elle-meme command_tag (CREATE TABLE...) -> pas de clause WHEN necessaire sur le trigger.
-- create-if-not-exists : sur staging l'event trigger existe deja -> SKIP (on ne droppe jamais le trigger vivant) ; sur base vierge -> cree.
-- NOTE : CREATE EVENT TRIGGER exige un role eleve ; cette capacite est sondee sur staging avant push (procedure de deploiement).

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    create event trigger ensure_rls
      on ddl_command_end
      execute function public.rls_auto_enable();
  end if;
end
$$;
