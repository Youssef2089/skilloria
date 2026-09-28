import { NextRequest } from 'next/server'
import { AuthError } from '@/lib/auth-guard'
import { requireAdmin } from '@/lib/admin-guard'
import { estUuid, type PieceJournal } from '@/lib/journal/lecture'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/journal/piece/[piece] — LA PIÈCE COMPLÈTE depuis une de ses
 * lignes (§D.26, phase B 2.6) : toutes les lignes du geste, les pièces qui la
 * référencent (rejeu, contrepassation), ce que les cinq sous-journaux portent
 * sous elle. Lecture EN BASE, par `lire_piece()` (SECURITY DEFINER, bornée,
 * AD002). Une lecture en panne se dit (503), jamais une pièce vide.
 */

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

type Ctx = { params: Promise<{ piece: string }> }

export async function GET(request: NextRequest, ctx: Ctx): Promise<Response> {
  let auth
  try {
    auth = await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return err.toResponse()
    throw err
  }
  const { piece } = await ctx.params
  if (!estUuid(piece)) {
    return json({ error: 'Invalid piece', code: 'piece_invalide' }, 400)
  }
  const { data, error } = await auth.supabaseAdmin.rpc('lire_piece', {
    p_admin_id: auth.user.id,
    p_piece: piece,
  })
  if (error) {
    console.error('[admin:journal/piece] lecture en panne', error.message)
    return json({ error: 'Journal unreadable', code: 'journal_illisible' }, 503)
  }
  const p = data as PieceJournal
  if (p.lignes.length === 0) {
    return json({ error: 'Unknown piece', code: 'piece_inconnue' }, 404)
  }
  return json(p, 200)
}
