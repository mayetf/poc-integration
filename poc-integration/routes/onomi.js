const express = require('express');
const axios = require('axios');
const router = express.Router();

const BASE_URL = process.env.ONOMI_API_BASE_URL;
const API_KEY = process.env.ONOMI_API_KEY;
const ORG_ID = process.env.ONOMI_ORG_ID;

// Shared Axios instance for Onomi/SpotMe API
const onomiClient = axios.create({
  baseURL: BASE_URL,
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
    // SpotMe sometimes uses X-Api-Key instead — adjust per your plan
    'X-Api-Key': API_KEY,
    ...(ORG_ID && { 'X-Organization-Id': ORG_ID }),
  },
  timeout: 10000,
});

function handleError(res, err, context) {
  const status = err.response?.status ?? 500;
  const message = err.response?.data ?? err.message;
  console.error(`[Onomi] Error in ${context}:`, message);
  res.status(status).json({ error: message });
}

/**
 * GET /api/onomi/webinars
 * Returns the list of published webinars/events.
 *
 * SpotMe endpoint: GET /events  (or /webinars depending on your plan)
 * Docs: https://developer.spotme.com  or your Onomi API reference
 */
router.get('/webinars', async (req, res) => {
  try {
    const { data } = await onomiClient.get('/events', {
      params: {
        status: 'published',       // only show published events
        type: 'webinar',           // filter to webinar type (adjust to your taxonomy)
        page: req.query.page ?? 1,
        per_page: 20,
      },
    });

    // Normalise the response to a predictable shape for the frontend
    // Adapt field names to match the actual API response keys
    const webinars = (data.events ?? data.items ?? data).map((event) => ({
      id: event.id,
      title: event.name ?? event.title,
      description: event.description ?? event.short_description ?? '',
      start_date: event.start_date ?? event.starts_at,
      end_date: event.end_date ?? event.ends_at,
      status: event.status,                                   // scheduled | live | ended
      cover_image: event.cover_image_url ?? event.image ?? null,
      // live_url is the direct streaming link — available once event goes live
      live_url: event.live_url ?? event.stream_url ?? null,
      registration_open: event.registration_open ?? true,
      attendees_count: event.attendees_count ?? null,
    }));

    res.json({ webinars });
  } catch (err) {
    handleError(res, err, 'GET /webinars');
  }
});

/**
 * GET /api/onomi/webinars/:id
 * Returns a single webinar with full details.
 */
router.get('/webinars/:id', async (req, res) => {
  try {
    const { data } = await onomiClient.get(`/events/${req.params.id}`);

    const event = data.event ?? data;
    res.json({
      id: event.id,
      title: event.name ?? event.title,
      description: event.description ?? '',
      start_date: event.start_date ?? event.starts_at,
      end_date: event.end_date ?? event.ends_at,
      status: event.status,
      cover_image: event.cover_image_url ?? event.image ?? null,
      live_url: event.live_url ?? event.stream_url ?? null,
      agenda: event.agenda ?? [],
      speakers: event.speakers ?? [],
      registration_open: event.registration_open ?? true,
    });
  } catch (err) {
    handleError(res, err, `GET /webinars/${req.params.id}`);
  }
});

/**
 * POST /api/onomi/webinars/:id/register
 * Registers an attendee to a webinar.
 *
 * Body: { first_name, last_name, email, company?, job_title? }
 *
 * SpotMe endpoint: POST /events/:id/attendees
 * On success returns the attendee record which includes the personal access link.
 */
router.post('/webinars/:id/register', async (req, res) => {
  const { first_name, last_name, email, company, job_title } = req.body;

  if (!first_name || !last_name || !email) {
    return res.status(400).json({ error: 'first_name, last_name and email are required' });
  }

  try {
    const { data } = await onomiClient.post(`/events/${req.params.id}/attendees`, {
      first_name,
      last_name,
      email,
      company: company ?? '',
      job_title: job_title ?? '',
      // send_confirmation_email instructs SpotMe to send its own branded invite
      send_confirmation_email: true,
    });

    const attendee = data.attendee ?? data;

    // personal_link is the unique URL for this attendee to join the live stream
    // It can also be used before the event to add to calendar
    const personal_link =
      attendee.personal_link ??
      attendee.access_link ??
      attendee.join_url ??
      null;

    res.json({
      success: true,
      attendee_id: attendee.id,
      personal_link,
      // Also return the public live URL as fallback
      live_url: attendee.event?.live_url ?? null,
      message: personal_link
        ? 'Registration successful. Use personal_link to join the event.'
        : 'Registration successful. The live link will be emailed to you.',
    });
  } catch (err) {
    // SpotMe returns 422 when already registered
    if (err.response?.status === 422) {
      return res.status(409).json({ error: 'already_registered', message: 'This email is already registered for this event.' });
    }
    handleError(res, err, `POST /webinars/${req.params.id}/register`);
  }
});

/**
 * GET /api/onomi/webinars/:id/live-link
 * Returns the public live streaming URL for an event.
 * Use this to show a "Join Live" button when the event is ongoing.
 */
router.get('/webinars/:id/live-link', async (req, res) => {
  try {
    const { data } = await onomiClient.get(`/events/${req.params.id}`);
    const event = data.event ?? data;

    const live_url = event.live_url ?? event.stream_url ?? null;
    const status = event.status;

    if (status !== 'live' && status !== 'published') {
      return res.status(404).json({ error: 'Event is not currently live.' });
    }

    res.json({ live_url, status });
  } catch (err) {
    handleError(res, err, `GET /webinars/${req.params.id}/live-link`);
  }
});

module.exports = router;
