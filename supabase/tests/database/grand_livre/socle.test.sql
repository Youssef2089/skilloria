-- Le socle — le verrou grand_livre_ajout_seul() (GL001 sur UPDATE, DELETE, TRUNCATE), identifiant_derive()
-- (stable, distinct par espace), et ip_effacees — effacer_adresses_ip() : l'effacement et sa ligne,
-- ensemble, sous la pièce qu'elle rend ; l'adresse n'entre pas dans la ligne. Depuis l'ARRÊT 22 : un passage
-- qui n'a RIEN à effacer n'écrit pas de ligne. Relecture du 01/10/2026, point 21 : l'ÉCHEC, lui, s'écrit toujours —
-- la durée de conservation absente (la ligne unique de duree_reglages retirée, dans la transaction annulée) rend
-- l'erreur, n'efface rien, et laisse UNE ligne échouée avec la classe de la panne.
-- Contraintes lues (§G.10) : duree_reglages.conservation_ip_mois NOT NULL, 1..60 — l'absence ne se fabrique qu'en
-- retirant la ligne ; aucune clé étrangère ni déclencheur sur duree_reglages.
begin;
create extension if not exists pgtap with schema extensions;
\ir _fabriques.psql
select plan(14);

create or replace function pg_temp.essai() returns setof text language plpgsql as $$
declare
  v_user  uuid := pg_temp.fab_compte('expert');
  v_audit uuid;
  v_r     jsonb;
  v_id    bigint;
begin
  -- ── exiger_ecriture : le compte attendu passe, tout autre lève EC001 (§E.74) ──
  return next lives_ok($q$select public.exiger_ecriture(1, 'sonde')$q$, 'exiger_ecriture : une ligne attendue, une touchée — passe');
  return next throws_ok($q$select public.exiger_ecriture(0, 'sonde')$q$, 'EC001', null, 'exiger_ecriture : zéro ligne touchée — EC001');
  return next throws_ok($q$select public.exiger_ecriture(2, 'sonde', 3)$q$, 'EC001', null, 'exiger_ecriture : un compte différent de l''attendu — EC001');
  -- ── identifiant_derive ──
  return next ok(public.identifiant_derive('reglage', 'x') = public.identifiant_derive('reglage', 'x')
                 and public.identifiant_derive('reglage', 'x') <> public.identifiant_derive('cron_job', 'x'),
                 'identifiant_derive : stable pour une même clé, distinct d''un espace à l''autre');
  -- ── ip_effacees : une trace d'audit ancienne, écrite comme logAudit l'écrit, avec une adresse ──
  insert into public.audit_logs (user_id, domain_id, action, entity_type, entity_id, ip_address, user_agent, created_at)
  select v_user, u.domain_id, 'sonde', 'user', v_user, '203.0.113.9', 'sonde', now() - interval '20 years'
    from public.users u where u.id = v_user
  returning id into v_audit;
  v_r := public.effacer_adresses_ip();
  return next ok(v_r ? 'piece' and not v_r ? 'erreur', 'effacer_adresses_ip aboutit et rend sa pièce');
  return next ok(exists (select 1 from public.audit_logs a where a.id = v_audit and a.ip_address is null and a.user_agent is null),
                 'l''adresse ancienne est effacée');
  return next is(pg_temp.lignes((v_r ->> 'piece')::uuid), 1::bigint, 'exactement UNE ligne sous la pièce');
  select g.id into v_id from public.grand_livre g
   where g.piece = (v_r ->> 'piece')::uuid and g.type_action = 'ip_effacees' and g.statut = 'reussi'
     and g.sujet_id = public.identifiant_derive('cron_job', 'ip_retention_purge')
     and (g.detail ->> 'audit_logs')::int >= 1 and g.detail::text not like '%203.0.113.9%';
  return next ok(v_id is not null, 'la ligne compte l''effacement, sans l''adresse, sur le sujet dérivé de la tâche');
  -- Le passage suivant n'a plus rien à effacer : il rend sa pièce, et n'écrit rien.
  v_r := public.effacer_adresses_ip();
  return next ok(v_r ? 'piece' and not v_r ? 'erreur' and pg_temp.lignes((v_r ->> 'piece')::uuid) = 0,
                 'rien à effacer : la pièce est rendue, AUCUNE ligne');
  -- ── l'échec : la durée de conservation introuvable — rien d'effacé, UNE ligne échouée ──
  insert into public.audit_logs (user_id, domain_id, action, entity_type, entity_id, ip_address, user_agent, created_at)
  select v_user, u.domain_id, 'sonde', 'user', v_user, '203.0.113.10', 'sonde', now() - interval '20 years'
    from public.users u where u.id = v_user
  returning id into v_audit;
  delete from public.duree_reglages;
  v_r := public.effacer_adresses_ip();
  return next ok(v_r ? 'erreur' and exists (select 1 from public.audit_logs a where a.id = v_audit and a.ip_address = '203.0.113.10'),
                 'la durée de conservation introuvable : l''erreur est rendue, et RIEN n''est effacé');
  return next ok(pg_temp.lignes((v_r ->> 'piece')::uuid) = 1 and exists (select 1 from public.grand_livre g
                   where g.piece = (v_r ->> 'piece')::uuid and g.type_action = 'ip_effacees' and g.statut = 'echoue'
                     and g.detail ->> 'cause' like '%conservation_ip_mois%' and g.detail ? 'sqlstate'),
                 'l''échec s''écrit TOUJOURS : UNE ligne échouée, la cause et sa classe');
  -- ── le verrou : la ligne qu'on vient d'écrire ne se modifie ni ne se supprime ──
  return next throws_ok(format('update public.grand_livre set statut = %L where id = %s', 'echoue', v_id),
                        'GL001', null, 'UPDATE interdit (GL001)');
  return next throws_ok(format('delete from public.grand_livre where id = %s', v_id),
                        'GL001', null, 'DELETE interdit hors nettoyage (GL001)');
  return next throws_ok('truncate public.grand_livre', 'GL001', null, 'TRUNCATE interdit (GL001)');
end $$;

select * from pg_temp.essai();
select * from finish();
rollback;
