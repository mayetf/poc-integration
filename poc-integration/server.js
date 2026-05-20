require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const surveysparrowRouter = require('./routes/surveysparrow');
const onomiRouter = require('./routes/onomi');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Raw body needed for webhook signature verification — must come before json()
app.use('/webhook/surveysparrow', express.raw({ type: '*/*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/webhook', surveysparrowRouter);
app.use('/api/onomi', onomiRouter);

// Landing page listing all POCs
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>POC Integration Hub</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 720px; margin: 60px auto; padding: 0 20px; color: #1a1a2e; }
    h1 { font-size: 1.6rem; margin-bottom: 4px; }
    p.sub { color: #555; margin-top: 0; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 32px; }
    .card { border: 1px solid #e0e0e0; border-radius: 10px; padding: 20px; text-decoration: none; color: inherit; transition: box-shadow .15s; }
    .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.1); }
    .badge { display: inline-block; font-size: .72rem; font-weight: 600; padding: 2px 8px; border-radius: 20px; margin-bottom: 10px; }
    .ss { background: #e8f4ff; color: #0057b7; }
    .onomi { background: #fff0e8; color: #c04a00; }
    h2 { font-size: 1rem; margin: 0 0 6px; }
    p { font-size: .88rem; color: #555; margin: 0; }
    .status { margin-top: 32px; font-size: .8rem; color: #888; }
  </style>
</head>
<body>
  <h1>POC Integration Hub</h1>
  <p class="sub">SurveySparrow contact form variants &amp; Onomi webinar integration</p>

  <div class="grid">
    <a class="card" href="/poc1a-iframe.html">
      <span class="badge ss">SurveySparrow</span>
      <h2>POC 1A — iFrame embed</h2>
      <p>Intégration via iframe standard + theming SurveySparrow. Zéro JS côté site.</p>
    </a>
    <a class="card" href="/poc1b-sdk-inline.html">
      <span class="badge ss">SurveySparrow</span>
      <h2>POC 1B — JS SDK inline</h2>
      <p>Widget chargé via SDK, rendu inline dans la page. CSS custom + événements JS.</p>
    </a>
    <a class="card" href="/poc1c-sdk-popup.html">
      <span class="badge ss">SurveySparrow</span>
      <h2>POC 1C — JS SDK popup</h2>
      <p>Formulaire déclenché par un bouton, s'ouvre en overlay. Idéal CTA.</p>
    </a>
    <a class="card" href="/poc2-webinar.html">
      <span class="badge onomi">Onomi</span>
      <h2>POC 2 — Webinar Onomi (v1)</h2>
      <p>Liste dynamique des événements, inscription en ligne, lien live personnalisé.</p>
    </a>
    <a class="card" href="/events-list.html">
      <span class="badge onomi">Onomi</span>
      <h2>POC 2B — Liste des événements</h2>
      <p>Tous les événements de l'organisation en tableau. Titre cliquable → page détail.</p>
    </a>
  </div>

  <p class="status">Webhook SurveySparrow : <code>POST /webhook/surveysparrow</code> &nbsp;|&nbsp; API Onomi proxy : <code>/api/onomi/*</code></p>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`\n🚀  POC Integration Hub running on http://localhost:${PORT}\n`);
  console.log('  POC 1A — iFrame embed   →  /poc1a-iframe.html');
  console.log('  POC 1B — JS SDK inline  →  /poc1b-sdk-inline.html');
  console.log('  POC 1C — JS SDK popup   →  /poc1c-sdk-popup.html');
  console.log('  POC 2  — Onomi webinar  →  /poc2-webinar.html\n');
});
