-- Cable les triggers d'inscription sur auth.users (absents du db dump --linked).
-- Fonctions public.handle_new_user() / public.handle_email_confirmed() presentes dans la baseline (audit 3c).
-- Idempotent : drop if exists puis create. Sur staging ils existent deja -> recrees a l'identique.

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists on_auth_user_email_confirmed on auth.users;
create trigger on_auth_user_email_confirmed
  after update of email_confirmed_at on auth.users
  for each row execute function public.handle_email_confirmed();
