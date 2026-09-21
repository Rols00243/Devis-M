/**
 * Edge Function `delete-account` — suppression définitive du compte et de ses
 * données, comme l'exige le droit à l'effacement.
 *
 * Déploiement : supabase functions deploy delete-account
 * (la clé de service est fournie automatiquement à la fonction par Supabase)
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: auth, error } = await userClient.auth.getUser();
  if (error || !auth?.user) return json({ error: 'Authentification requise.' }, 401);
  const userId = auth.user.id;

  // La clé de service est nécessaire pour effacer le compte lui-même ; elle ne
  // sert qu'ici, et uniquement sur l'utilisateur qui vient de s'authentifier.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: files } = await admin.storage.from('card-images').list(userId);
  if (files?.length) {
    await admin.storage.from('card-images').remove(files.map((f) => `${userId}/${f.name}`));
  }

  await admin.from('business_cards').delete().eq('owner_id', userId);

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return json({ error: 'La suppression du compte a échoué.' }, 500);

  return json({ deleted: true });
});
