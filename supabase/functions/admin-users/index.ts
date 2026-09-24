// Supabase Edge Function: admin-users
// Lets Studio admins set a temporary password for a teammate (no email needed).
//
// Deploy: Supabase Dashboard → Edge Functions → "Deploy a new function" → name it
// `admin-users` → paste this file → Deploy. Keep "Verify JWT" ON.
// Uses the auto-provided SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // Identify the caller with their own JWT
  const asCaller = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401);

  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data: me } = await admin.from('q-quiz-profiles').select('role,is_active').eq('id', userData.user.id).maybeSingle();
  if (!me || !me.is_active || me.role !== 'admin') return json({ error: 'Admins only' }, 403);

  let body: { action?: string; user_id?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  if (body.action === 'set_password') {
    if (!body.user_id || !body.password || body.password.length < 10) {
      return json({ error: 'user_id and a password of at least 10 characters are required' }, 400);
    }
    const { data: target } = await admin.from('q-quiz-profiles').select('id').eq('id', body.user_id).maybeSingle();
    if (!target) return json({ error: 'That user is not a Studio user' }, 404);
    const { error } = await admin.auth.admin.updateUserById(body.user_id, { password: body.password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: `Unknown action "${body.action}"` }, 400);
});
