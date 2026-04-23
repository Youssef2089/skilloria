import { NextRequest } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export async function DELETE(request: NextRequest): Promise<Response> {
  let auth
  try {
    auth = await requireAuth(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    console.error('[cv DELETE] auth error', err)
    return json({ error: 'Auth failed', code: 'auth_error' }, 500)
  }

  const { supabaseAdmin, user } = auth

  const { data: profile, error: fetchErr } = await supabaseAdmin
    .from('profiles')
    .select('id, cv_file_path')
    .eq('user_id', user.id)
    .maybeSingle()
  if (fetchErr || !profile) {
    return json({ error: 'Profile not found', code: 'profile_missing' }, 404)
  }

  if (profile.cv_file_path) {
    const { error: rmErr } = await supabaseAdmin.storage
      .from('cv')
      .remove([profile.cv_file_path])
    if (rmErr) {
      console.error('[cv DELETE] storage remove failed', {
        path: profile.cv_file_path,
        msg: rmErr.message,
      })
    }
  }

  const { error: updErr } = await supabaseAdmin
    .from('profiles')
    .update({
      cv_file_path: null,
      cv_hash: null,
      cv_uploaded_at: null,
      cv_parsing_status: null,
      cv_parsed_at: null,
      cv_parsing_error: null,
    })
    .eq('id', profile.id)
  if (updErr) {
    console.error('[cv DELETE] profile update failed', updErr)
    return json({ error: 'Update failed', code: 'db_error' }, 500)
  }

  await supabaseAdmin.from('audit_logs').insert({
    user_id: user.id,
    domain_id: user.domain_id,
    action: 'cv_delete',
    entity_type: 'profile',
    entity_id: profile.id,
    detail: { had_file: !!profile.cv_file_path },
  })

  return json({ success: true })
}
