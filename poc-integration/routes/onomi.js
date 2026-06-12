const express = require('express');
const axios   = require('axios');
const crypto  = require('crypto');
const router  = express.Router();

const API_KEY     = process.env.ONOMI_API_KEY;
const ORG_ID      = process.env.ONOMI_ORG_ID;
const LINK_SECRET = process.env.REGISTRATION_LINK_SECRET;

// ─── Secure registration token helpers ───────────────────────────────────────
// Token format: base64url(payload_json).base64url(hmac_sha256(secret, payload_json))
// Payload: { eventId, uuid, fname, lname, email }
// The UUID is never exposed in plain text in the URL.

function signToken(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto.createHmac('sha256', LINK_SECRET).update(raw).digest();
  return `${Buffer.from(raw).toString('base64url')}.${sig.toString('base64url')}`;
}

function verifyToken(token) {
  if (!LINK_SECRET) throw new Error('REGISTRATION_LINK_SECRET not set');
  const [payloadB64, sigB64] = token.split('.');
  if (!payloadB64 || !sigB64) throw new Error('Malformed token');

  const raw         = Buffer.from(payloadB64, 'base64url').toString();
  const expectedSig = crypto.createHmac('sha256', LINK_SECRET).update(raw).digest();
  const decodedSig  = Buffer.from(sigB64, 'base64url');

  // Length guard — timingSafeEqual throws if buffers differ in length
  if (decodedSig.length !== expectedSig.length) throw new Error('Invalid token signature');

  // Constant-time comparison to prevent timing attacks
  if (!crypto.timingSafeEqual(decodedSig, expectedSig)) throw new Error('Invalid token signature');

  return JSON.parse(raw);
}

// ─── SpotMe API v2 ────────────────────────────────────────────────────────────
// Base URL: https://api.spotme.com/api/v2
//
// Confirmed endpoints:
//   GET  /orgs/{org_id}/workspaces              → list all workspaces (events)
//   GET  /workspace/{workspace_id}              → workspace detail
//   GET  /workspace/{id}/global/docs/person/{p} → fetch a person document
//   POST /workspace/{id}/global/docs/person     → create/update a person
//
// NOTE: The User-Agent header MUST look like a browser.
//       SpotMe nginx returns HTTP 418 for non-browser agents.
const onomiClient = axios.create({
  baseURL: 'https://api.spotme.com/api/v2',
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
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

// ─── Normalise a raw SpotMe workspace object ──────────────────────────────────
// Confirmed SpotMe v2 fields:
//   id, name, start, end, location, is_active, is_live,
//   template_id, cms_url, is_test, container_app_id, timezone,
//   format (virtual|hybrid|in_person), audience, registration_type, data_location
function normaliseEvent(e) {
  let status = 'scheduled';
  if (e.is_live)        status = 'live';
  else if (!e.is_active) status = 'ended';
  else if (e.status)    status = e.status;

  const spotme_url = e.cms_url ?? null;
  const app_url    = e.container_app_id
    ? `https://app.spotme.com/${e.container_app_id}`
    : null;

  return {
    id:                e.id,
    title:             e.name  ?? e.title ?? '—',
    description:       e.description ?? e.short_description ?? '',
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
    spotme_url,
    app_url,
    registration_open: e.registration_type !== 'closed',
    registration_type: e.registration_type ?? 'public',
    attendees_count:   e.attendees_count ?? e.attendeesCount ?? null,
    tags:              e.tags ?? e.categories ?? [],
    speakers:          e.speakers ?? [],
    agenda:            e.agenda ?? e.schedule ?? [],
    external_url:      e.external_url ?? e.website ?? null,
  };
}

// ─── Helper: create/update a person and return the login URL ─────────────────
// The SpotMe person _id follows the format {workspace_id}_{uuid}.
// The UUID is our internal identifier (e.g. HCP ID) — kept separate from the
// email so personal data never appears in identity fields.
// We also send lu_hcp_id so the UUID is stored in the dedicated Lundbeck
// custom field (SPOTME_LU_HCP_ID_C) in addition to the backstage_id.
//
// SpotMe POST responses:
//   "created"   → person was created; login_url is present
//   "updated"   → person was updated; login_url is present
//   "unchanged" → no changes detected; SpotMe omits login_url — must GET it
async function registerPerson(workspaceId, uuid, email, fname, lname) {
  const personId = `${workspaceId}_${uuid}`;

  const { data } = await onomiClient.post(
    `/workspace/${workspaceId}/global/docs/person?send_reg_confirmation=true`,
    { fname, lname, email, _id: personId, lu_hcp_id: uuid }
  );

  if (data.status === 'unchanged') {
    const { data: person } = await onomiClient.get(
      `/workspace/${workspaceId}/global/docs/person/${encodeURIComponent(personId)}`
    );
    return { status: 'already_registered', login_url: person.login_url ?? null };
  }

  return { status: data.status, login_url: data.login_url ?? null };
}

/**
 * GET /api/onomi/events
 * List all workspaces (events) for the organisation.
 * SpotMe v2: GET /orgs/{org_id}/workspaces
 */
router.get('/events', async (req, res) => {
  try {
    const { data } = await onomiClient.get(`/orgs/${ORG_ID}/workspaces`);

    const raw  = Array.isArray(data) ? data : (data.workspaces ?? data.items ?? []);
    let events = raw.map(normaliseEvent);

    if (req.query.active === 'true')  events = events.filter(e => e.is_active);
    if (req.query.active === 'false') events = events.filter(e => !e.is_active);

    res.json({ events, total: events.length });
  } catch (err) {
    handleError(res, err, 'GET /events');
  }
});

/**
 * GET /api/onomi/events/:id
 * Full detail for a single workspace (event).
 * SpotMe v2: GET /workspace/{workspace_id}
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
 * GET /api/onomi/events/:id/check-registration?user_uuid=…
 * Check whether a user is already registered for an event.
 * SpotMe v2: GET /workspace/{id}/global/docs/person/{workspace_id}_{uuid}
 *
 * Returns: { registered: boolean, login_url: string|null, person: object|null }
 */
router.get('/events/:id/check-registration', async (req, res) => {
  const { user_uuid } = req.query;
  if (!user_uuid) return res.status(400).json({ error: 'user_uuid query param required' });

  const personId = `${req.params.id}_${user_uuid}`;

  try {
    const { data } = await onomiClient.get(`/workspace/${req.params.id}/global/docs/person/${encodeURIComponent(personId)}`);
    // fp_status === 'active' means the person is registered and not deactivated
    const registered = data.fp_status === 'active';
    res.json({
      registered,
      login_url: registered ? (data.login_url ?? null) : null,
      person: {
        id:           data._id,
        fname:        data.fname,
        lname:        data.lname,
        email:        data.email,
        fp_status:    data.fp_status,
        is_activated: data.is_activated,
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
 * Create a person in SpotMe and return the magic link.
 * SpotMe v2: POST /workspace/{id}/global/docs/person
 *
 * Body:    { fname, lname, email, user_uuid }
 * Returns: { success, status, login_url, person_id }
 */
router.post('/events/:id/register', async (req, res) => {
  const { fname, lname, email, user_uuid } = req.body;

  if (!fname || !lname || !email || !user_uuid) {
    return res.status(400).json({ error: 'fname, lname, email and user_uuid are required' });
  }

  const workspaceId = req.params.id;

  try {
    const result = await registerPerson(workspaceId, user_uuid, email, fname, lname);
    res.json({ success: true, ...result, person_id: `${workspaceId}_${user_uuid}` });
  } catch (err) {
    handleError(res, err, `POST /events/${req.params.id}/register`);
  }
});

/**
 * POST /api/onomi/generate-registration-link
 * Generate a signed pre-registration link to embed in a promotional email.
 * Call this server-side when sending the promo email.
 *
 * Body:    { eventId, uuid, fname, lname, email }
 * Returns: { url, token }
 *
 * Security:
 *  - The UUID is never exposed in plain text in the URL
 *  - Token is HMAC-SHA256 signed using REGISTRATION_LINK_SECRET
 *  - Tokens do not expire (revoke by rotating REGISTRATION_LINK_SECRET)
 */
router.post('/generate-registration-link', (req, res) => {
  if (!LINK_SECRET) {
    return res.status(500).json({ error: 'REGISTRATION_LINK_SECRET not configured' });
  }

  const { eventId, uuid, fname, lname, email } = req.body;
  if (!eventId || !uuid || !fname || !lname || !email) {
    return res.status(400).json({ error: 'eventId, uuid, fname, lname, email are required' });
  }

  const token   = signToken({ eventId, uuid, fname, lname, email });
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const url     = `${baseUrl}/event-detail.html?id=${encodeURIComponent(eventId)}&reg=${encodeURIComponent(token)}`;

  res.json({ url, token });
});

/**
 * POST /api/onomi/events/:id/auto-register
 * Verify a signed token and automatically register the user.
 * Called by the frontend when the user clicks a promo email link.
 *
 * Body:    { token }
 * Returns: { success, status, login_url }
 */
router.post('/events/:id/auto-register', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'token is required' });

  let payload;
  try {
    payload = verifyToken(token);
  } catch (err) {
    return res.status(401).json({ error: err.message });
  }

  if (payload.eventId !== req.params.id) {
    return res.status(401).json({ error: 'Token / event mismatch' });
  }

  const { fname, lname, email, uuid } = payload;
  const workspaceId = req.params.id;

  try {
    const result = await registerPerson(workspaceId, uuid, email, fname, lname);
    res.json({ success: true, ...result });
  } catch (err) {
    handleError(res, err, `POST /events/${req.params.id}/auto-register`);
  }
});

module.exports = router;
