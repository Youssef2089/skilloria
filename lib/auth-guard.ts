import { NextRequest } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

export type AuthUser = {
  id: string
  last_session_token: string | null
  domain_id: string
  status: string | null
}

export type AuthDomain = {
  id: string
  slug: string
}

export type AuthContext = {
  user: AuthUser
  domain: AuthDomain
  supabaseAdmin: SupabaseClient
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: { error: string; code?: string },
  ) {
    super(body.error)
  }

  toResponse(): Response {
    return new Response(JSON.stringify(this.body), {
      status: this.status,
      headers: { 'content-type': 'application/json' },
    })
  }
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[auth-guard] Missing Supabase env vars (URL or SERVICE_ROLE_KEY)')
    throw new AuthError(500, { error: 'Server misconfigured', code: 'missing_env' })
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const authHeader =
    request.headers.get('authorization') ?? request.headers.get('Authorization')
  const accessToken = authHeader?.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : null

  if (!accessToken) {
    throw new AuthError(401, { error: 'Not authenticated', code: 'no_token' })
  }

  const supabaseAdmin = getSupabaseAdmin()

  const { data: userInfo, error: sessionError } =
    await supabaseAdmin.auth.getUser(accessToken)
  if (sessionError || !userInfo?.user) {
    throw new AuthError(401, { error: 'Not authenticated', code: 'invalid_token' })
  }

  const { data: userRow, error: userErr } = await supabaseAdmin
    .from('users')
    .select('id, last_session_token, domain_id, status, domains(id, slug)')
    .eq('id', userInfo.user.id)
    .maybeSingle()

  if (userErr) {
    console.error('[auth-guard] user lookup error', {
      userId: userInfo.user.id,
      msg: userErr.message,
    })
    throw new AuthError(403, { error: 'User not found', code: 'user_lookup_failed' })
  }
  if (!userRow) {
    throw new AuthError(403, { error: 'User not found', code: 'user_missing' })
  }

  if (userRow.last_session_token) {
    const headerToken = request.headers.get('x-session-token')
    if (headerToken !== userRow.last_session_token) {
      throw new AuthError(403, {
        error: 'Session invalidated',
        code: 'session_token_mismatch',
      })
    }
  }

  const headerSubdomain = request.headers.get('x-subdomain') ?? 'microsoft'
  const domainRow = Array.isArray(userRow.domains)
    ? userRow.domains[0]
    : userRow.domains
  if (!domainRow || (domainRow as any).slug !== headerSubdomain) {
    throw new AuthError(403, { error: 'Domain mismatch', code: 'domain_mismatch' })
  }

  return {
    user: {
      id: userRow.id,
      last_session_token: userRow.last_session_token,
      domain_id: userRow.domain_id,
      status: (userRow.status ?? null) as string | null,
    },
    domain: {
      id: (domainRow as any).id,
      slug: (domainRow as any).slug,
    },
    supabaseAdmin,
  }
}
