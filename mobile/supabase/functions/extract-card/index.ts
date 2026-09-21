/**
 * Edge Function `extract-card` — extraction assistée par IA d'une carte de visite.
 *
 * Pourquoi côté serveur : la clé du modèle est un secret. Une application
 * mobile est décompilable, donc toute clé embarquée est une clé publiée. Ici,
 * le téléphone envoie l'image avec son jeton d'utilisateur ; la fonction
 * vérifie ce jeton, appelle le modèle avec sa propre clé, et ne renvoie que des
 * champs structurés.
 *
 * Déploiement :
 *   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
 *   supabase functions deploy extract-card
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.127.0';
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@0.127.0/helpers/zod';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3.25.76';

/** Schéma de sortie : le modèle est contraint de répondre exactement ceci. */
const CardSchema = z.object({
  firstName: z.string().describe('Prénom de la personne, sans civilité'),
  lastName: z.string().describe('Nom de famille, en casse normale'),
  jobTitle: z.string().describe('Fonction ou poste'),
  company: z.string().describe("Nom de l'entreprise, forme juridique incluse"),
  phone: z.string().describe('Téléphone principal au format international E.164, ex. +243810000000'),
  secondaryPhone: z.string().describe('Second numéro au format E.164, sinon chaîne vide'),
  whatsapp: z.string().describe('Numéro WhatsApp au format E.164 s’il est explicitement indiqué'),
  email: z.string().describe('Adresse e-mail en minuscules'),
  website: z.string().describe('Site web sans le protocole, ex. www.exemple.com'),
  address: z.string().describe('Adresse postale sur une ligne'),
  city: z.string().describe('Ville'),
  country: z.string().describe('Pays en toutes lettres, en français'),
  linkedin: z.string().describe('Profil LinkedIn, ex. linkedin.com/in/identifiant'),
  notes: z.string().describe('Mentions utiles non classées ailleurs (fax, slogan, second e-mail)'),
  rawText: z.string().describe('Tout le texte lu sur la carte, ligne par ligne'),
  languages: z.array(z.string()).describe('Codes ISO 639-1 des langues présentes, ex. ["fr","ar"]'),
  confidence: z
    .object({
      firstName: z.number(),
      lastName: z.number(),
      jobTitle: z.number(),
      company: z.number(),
      phone: z.number(),
      email: z.number(),
      address: z.number(),
    })
    .describe('Confiance de 0 à 1 pour chaque champ clé'),
});

const SYSTEM_PROMPT = `Tu extrais les informations d'une photo de carte de visite.

Règles :
- Ne devine jamais : un champ absent de la carte reste une chaîne vide.
- Les numéros sont convertis en format international E.164. Sans indicatif visible,
  déduis-le du pays ou de la ville imprimés sur la carte.
- Distingue la personne de l'entreprise : une forme juridique (SARL, SAS, Ltd, GmbH…)
  ou un logo désigne l'entreprise, jamais le nom de la personne.
- Le nom de famille est souvent imprimé en capitales ; restitue-le en casse normale.
- Les cartes peuvent être bilingues (français, anglais, arabe). Extrais les informations
  dans la langue latine quand les deux sont présentes, et signale les langues vues.
- Ignore les slogans, logos et mentions décoratives, sauf à les placer dans "notes".
- "confidence" reflète ta certitude réelle : 1 pour un champ lu sans ambiguïté,
  0.5 pour une déduction, 0 pour un champ vide.`;

const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' });

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

/** 6 Mo de base64 ≈ 4,5 Mo d'image : au-delà, c'est une erreur d'appel. */
const MAX_BASE64 = 6_000_000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405);

  if (!Deno.env.get('ANTHROPIC_API_KEY')) {
    return json({ error: "Le service d'extraction n'est pas configuré." }, 503);
  }

  // Authentification : seule une session valide peut consommer le service.
  const authHeader = req.headers.get('Authorization') ?? '';
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) return json({ error: 'Authentification requise.' }, 401);

  let payload: { imageBase64?: string; mimeType?: string };
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Corps de requête invalide.' }, 400);
  }

  const imageBase64 = payload.imageBase64 ?? '';
  if (!imageBase64) return json({ error: 'Image manquante.' }, 400);
  if (imageBase64.length > MAX_BASE64) return json({ error: 'Image trop volumineuse.' }, 413);

  const mediaType = ['image/jpeg', 'image/png', 'image/webp'].includes(payload.mimeType ?? '')
    ? (payload.mimeType as 'image/jpeg' | 'image/png' | 'image/webp')
    : 'image/jpeg';

  try {
    const response = await anthropic.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      // L'extraction est une tâche courte et cadrée : un effort faible suffit,
      // pour une réponse rapide et un coût contenu.
      output_config: { effort: 'low', format: zodOutputFormat(CardSchema) },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Extrais les informations de cette carte de visite.' },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return json({ error: "L'image n'a pas pu être analysée." }, 422);
    }

    const parsed = response.parsed_output;
    if (!parsed) return json({ error: 'Extraction illisible.' }, 502);

    const { rawText, languages, confidence, ...fields } = parsed;
    return json({ fields, confidence, rawText, languages });
  } catch (e) {
    // Les erreurs du fournisseur ne sont pas renvoyées telles quelles au client.
    console.error('extract-card', e instanceof Error ? e.message : e);
    if (e instanceof Anthropic.RateLimitError) {
      return json({ error: 'Service momentanément saturé. Réessayez dans un instant.' }, 429);
    }
    return json({ error: "L'extraction a échoué." }, 502);
  }
});
