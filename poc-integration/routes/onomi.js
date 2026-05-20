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
 * GET /api/onomi/events/:id/check-registration?user_uuid=...
 * Vérifie si un utilisateur est déjà inscrit à un événement.
 * SpotMe v2 confirmé: GET /workspace/{eid}/global/docs/person/{ws_id}_{user_uuid}
 * Returns: { registered: bool, login_url: string|null, person: {...}|null }
 */
router.get('/events/:id/check-registration', async (req, res) => {
  const { user_uuid } = req.query;
  if (!user_uuid) return res.status(400).json({ error: 'user_uuid query param required' });

  const personId = `${req.params.id}_${user_uuid}`;

  try {
    const { data } = await onomiClient.get(`/workspace/${req.params.id}/global/docs/person/${personId}`);
    // Log full person object so we can identify the correct field for deactivation
    console.log(`[SpotMe] person ${personId}:`, JSON.stringify({
      is_activated:       data.is_activated,
      attendance_status:  data.attendance_status,
      status:             data.status,
      is_active:          data.is_active,
      disabled:           data.disabled,
      deleted:            data.deleted,
    }));
    res.json({
      registered: true,
      login_url: data.login_url ?? null,
      person: {
        id: data._id,
        fname: data.fname,
        lname: data.lname,
        email: data.email,
        attendance_status: data.attendance_status,
        is_activated: data.is_activated,
        status: data.status,
        is_active: data.is_active,
      },
    });
  } catch (err) {
    if (err.response?.status === 404) {
      return res.json({ registered: false, login_url: null, person: null });
    }
    handleError(res, err, `GET /events/${req.params.id}/check-registration`);
  }
});

/**
 * POST /api/onomi/events/:id/register
 * Crée une "personne" dans SpotMe et retourne le magic link.
 * SpotMe v2 confirmé: POST /workspace/{eid}/global/docs/person
 *
 * Body: { fname, lname, email, user_uuid }
 * _id format: {workspace_id}_{user_uuid}
 *
 * Réponses SpotMe:
 *   - status "created"   → login_url présent (magic link)
 *   - status "unchanged" → utilisateur déjà inscrit, faire un GET pour le magic link
 *   - status "updated"   → login_url présent
 */
router.post('/events/:id/register', async (req, res) => {
  const { fname, lname, email, user_uuid } = req.body;

  if (!fname || !lname || !email || !user_uuid) {
    return res.status(400).json({ error: 'fname, lname, email and user_uuid are required' });
  }

  const workspaceId = req.params.id;
  const personId    = `${workspaceId}_${user_uuid}`;

  try {
    const { data } = await onomiClient.post(
      `/workspace/${workspaceId}/global/docs/person`,
      { fname, lname, email, _id: personId }
    );

    console.log(`[SpotMe] Person ${data.status} → ${personId} (${email})`);

    // Si "unchanged", SpotMe ne renvoie pas le login_url — on le récupère via GET
    if (data.status === 'unchanged') {
      const { data: person } = await onomiClient.get(
        `/workspace/${workspaceId}/global/docs/person/${personId}`
      );
      return res.json({
        success: true,
        status: 'already_registered',
        login_url: person.login_url ?? null,
        person_id: personId,
      });
    }

    res.json({
      success: true,
      status: data.status,        // "created" | "updated"
      login_url: data.login_url ?? null,
      person_id: data.id,
    });

  } catch (err) {
    handleError(res, err, `POST /events/${req.params.id}/register`);
  }
});

module.exports = router;
