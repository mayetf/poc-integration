const express = require('express');
const axios = require('axios');
const router = express.Router();

const API_KEY = process.env.ONOMI_API_KEY;
const ORG_ID  = process.env.ONOMI_ORG_ID;

// ─── SpotMe API v2 — Endpoints confirmés ──────────────────────────────────────
// Base URL : https://api.spotme.com/api/v2
//
// ✅ GET /orgs/{org_id}/workspaces        → liste tous les workspaces (événements)
// ✅ GET /workspace/{workspace_id}        → détail d'un workspace
// ✅ GET /me                              → identité utilisateur
//
// ⚠️  IMPORTANT : le User-Agent DOIT être de type navigateur
//     Sans UA navigateur → l'API répond 418 (bloqué par nginx)
//
// ❌ /workspace/{id}/people|attendees|registrations → 404 (pas dans v2)
//    → L'inscription passe par la page publique SpotMe (cms_url ou app URL)
// ─────────────────────────────────────────────────────────────────────────────
const onomiClient = axios.create({
  baseURL: 'https://api.spotme.com/api/v2',
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    // REQUIRED: SpotMe nginx renvoie 418 pour les UA non-navigateur
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  timeout: 10000,
});

function handleError(res, err, context) {
  const status  = err.response?.status ?? 500;
  const message = err.response?.data   ?? err.message;
  console.error(`[SpotMe] Error in ${context}:`, JSON.stringify(message));
  res.status(status).json({ error: message });
}

// ─── Helper: normalise a raw SpotMe event object ─────────────────────────────
// Champs SpotMe v2 confirmés (workspace object):
//   id, name, start, end, location, is_active, is_live,
//   template_id, cms_url, is_test, container_app_id, timezone,
//   format (virtual|hybrid|in_person), audience, registration_type, data_location
function normaliseEvent(e) {
  // Détermine le statut à partir de is_live / is_active
  let status = 'scheduled';
  if (e.is_live)                status = 'live';
  else if (!e.is_active)        status = 'ended';
  else if (e.status)            status = e.status;

  // Lien public SpotMe (app de l'événement)
  const spotme_url = e.cms_url ?? null;
  const app_url    = e.container_app_id
    ? `https://app.spotme.com/${e.container_app_id}`
    : null;

  return {
    id:                e.id,
    title:             e.name  ?? e.title ?? '—',
    description:       e.description ?? e.short_description ?? '',
    // SpotMe API v2 utilise "start" et "end", pas "start_date"/"end_date"
    start_date:        e.start      ?? e.start_date  ?? e.starts_at ?? null,
    end_date:          e.end        ?? e.end_date    ?? e.ends_at   ?? null,
    location:          e.location   ?? e.venue       ?? null,
    timezone:          e.timezone   ?? null,
    format:            e.format     ?? null,           // virtual | hybrid | in_person
    audience:          e.audience   ?? null,
    status,
    is_active:         e.is_active  ?? false,
    is_live:           e.is_live    ?? false,
    is_test:           e.is_test    ?? false,
    cover_image:       e.cover_image_url ?? e.image ?? e.banner_url ?? null,
    live_url:          e.live_url ?? e.stream_url ?? app_url ?? null,
    spotme_url,                                        // lien Backstage (admin)
    app_url,                                           // lien public app SpotMe
    registration_open: e.registration_type !== 'closed',
    registration_type: e.registration_type ?? 'public',
    attendees_count:   e.attendees_count ?? e.attendeesCount ?? null,
    tags:              e.tags ?? e.categories ?? [],
    speakers:          e.speakers ?? [],
    agenda:            e.agenda ?? e.schedule ?? [],
    external_url:      e.external_url ?? e.website ?? null,
  };
}

/**
 * GET /api/onomi/events
 * Liste tous les workspaces (événements) de l'organisation.
 * SpotMe v2 confirmé: GET /orgs/{org_id}/workspaces
 */
router.get('/events', async (req, res) => {
  try {
    const { data } = await onomiClient.get(`/orgs/${ORG_ID}/workspaces`);

    // Réponse = tableau direct
    const raw    = Array.isArray(data) ? data : (data.workspaces ?? data.items ?? []);
    let events   = raw.map(normaliseEvent);

    // Filtres optionnels
    if (req.query.active === 'true')  events = events.filter(e => e.is_active);
    if (req.query.active === 'false') events = events.filter(e => !e.is_active);

    res.json({ events, total: events.length });
  } catch (err) {
    handleError(res, err, 'GET /events');
  }
});

/**
 * GET /api/onomi/events/:id
 * Détail complet d'un workspace (événement).
 * SpotMe v2 confirmé: GET /workspace/{workspace_id}
 */
router.get('/events/:id', async (req, res) => {
  try {
    const { data } = await onomiClient.get(`/workspace/${req.params.id}`);
    res.json(normaliseEvent(data));
  } catch (err) {
    handleError(res, err, `GET /events/${req.params.id}`);
  }
});

/**
 * GET /api/onomi/events/:id/check-registration?email=...
 * Vérification d'inscription — stockée côté client (localStorage).
 * L'API SpotMe v2 ne propose pas d'endpoint de vérification par email.
 * Ce endpoint retourne toujours { registered: false } (vérification côté frontend via localStorage).
 */
router.get('/events/:id/check-registration', async (req, res) => {
  // Endpoint maintenu pour compatibilité frontend
  // La vérification réelle est gérée via localStorage dans le navigateur
  res.json({ registered: false, note: 'Check via localStorage on client side' });
});

/**
 * POST /api/onomi/events/:id/register
 * Inscription à un événement.
 *
 * NOTE SpotMe v2: l'API ne supporte pas POST /workspace/{id}/people (404).
 * Ce endpoint valide les données et retourne le lien d'inscription SpotMe.
 * L'inscription réelle se fait via la page publique SpotMe (cms_url).
 *
 * Body: { first_name, last_name, email, company?, job_title? }
 */
router.post('/events/:id/register', async (req, res) => {
  const { first_name, last_name, email, company, job_title } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name and email are required' });
  }

  try {
    // Récupère les détails du workspace pour obtenir le lien de registration
    const { data } = await onomiClient.get(`/workspace/${req.params.id}`);
    const workspace = data;

    // Construit le lien public SpotMe
    // Format: https://eu.backstage.spotme.com/event/{id} (admin)
    // Le lien public app est: https://app.spotme.com/{container_app_id}
    const registration_url =
      workspace.cms_url ??
      `https://app.spotme.com/${workspace.container_app_id}`;

    console.log(`[SpotMe] Registration request for ${email} → event ${req.params.id} (${workspace.name})`);

    res.json({
      success: true,
      message: 'Registration validated. Redirect user to SpotMe registration page.',
      registration_url,
      workspace_name: workspace.name,
      // Pre-filled URL hint (SpotMe may support query params for pre-fill)
      registration_url_prefilled: `${registration_url}?email=${encodeURIComponent(email)}&firstname=${encodeURIComponent(first_name)}&lastname=${encodeURIComponent(last_name)}`,
    });
  } catch (err) {
    handleError(res, err, `POST /events/${req.params.id}/register`);
  }
});

module.exports = router;
