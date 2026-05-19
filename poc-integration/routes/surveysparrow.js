const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// Verify HMAC-SHA256 signature sent by SurveySparrow
function verifySignature(rawBody, signatureHeader) {
  const secret = process.env.SURVEYSPARROW_WEBHOOK_SECRET;
  if (!secret) return true; // skip verification if secret not configured (dev only)
  if (!signatureHeader) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(expected, 'hex'),
    Buffer.from(signatureHeader, 'hex')
  );
}

/**
 * POST /webhook/surveysparrow
 *
 * SurveySparrow sends a POST request here after each form submission.
 * Configure in SurveySparrow: Settings → Integrations → Webhooks
 *   URL  : https://your-domain.com/webhook/surveysparrow
 *   Events: survey_submit
 */
router.post('/surveysparrow', (req, res) => {
  const signature = req.headers['x-surveysparrow-signature'];

  if (!verifySignature(req.body, signature)) {
    console.warn('[Webhook] Invalid signature — request rejected');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  const { submission_id, survey_id, survey_name, answers, contact } = payload;

  console.log('\n[Webhook] New SurveySparrow submission received');
  console.log('  Survey :', survey_name, `(ID: ${survey_id})`);
  console.log('  Sub ID :', submission_id);
  console.log('  Contact:', contact?.email ?? 'N/A');
  console.log('  Answers:', JSON.stringify(answers, null, 2));

  /*
   * At this point you can:
   *  - Push to a CRM (HubSpot, Salesforce…)
   *  - Write to a database
   *  - Trigger a workflow (Zapier, Make, n8n…)
   *  - Send an internal Slack/Teams notification
   *
   * SurveySparrow already handles:
   *  - Storing the response in its own dashboard
   *  - Sending the thank-you / confirmation email to the respondent
   *    (configured in: Survey → Share → Thank You page + Email notification)
   */

  res.status(200).json({ received: true, submission_id });
});

module.exports = router;
