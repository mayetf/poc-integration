# POC Integration Hub

Deux POCs démontrant l'intégration de SurveySparrow (formulaire de contact) et Onomi/SpotMe (webinars) dans un site web.

## Structure

```
poc-integration/
├── server.js                  # Backend Express — webhook SS + proxy API Onomi
├── routes/
│   ├── surveysparrow.js       # Réception et vérification des webhooks SS
│   └── onomi.js               # Proxy vers l'API Onomi (liste, détail, inscription, live link)
├── public/
│   ├── poc1a-iframe.html      # POC 1A — iFrame embed
│   ├── poc1b-sdk-inline.html  # POC 1B — JS SDK inline
│   ├── poc1c-sdk-popup.html   # POC 1C — JS SDK popup / side tab
│   └── poc2-webinar.html      # POC 2 — Webinars Onomi
├── .env.example
├── render.yaml                # Config déploiement Render.com
└── README.md
```

---

## Prérequis

- Node.js 18+
- Compte SurveySparrow (plan permettant les webhooks et l'embed)
- Compte Onomi / SpotMe avec accès API

---

## Installation locale

```bash
cd poc-integration
npm install
cp .env.example .env
# Éditer .env avec vos credentials
npm run dev
```

Ouvrir : http://localhost:3000

---

## Configuration

### 1. Copier et remplir `.env`

```bash
cp .env.example .env
```

Remplir toutes les variables (voir `.env.example` pour les descriptions).

---

### POC 1 — SurveySparrow

#### Tokens d'embed (POC 1A, 1B, 1C)

Dans SurveySparrow :
1. Ouvrir votre Survey → **Share** → **Embed**
2. Copier le token `tt-xxxxxxxxxx` depuis l'URL ou le code d'embed
3. Le coller dans `.env` : `SURVEYSPARROW_TOKEN_POC1A`, etc.
4. Dans chaque fichier HTML, remplacer `YOUR_TOKEN` et `YOUR_DOMAIN`

#### Webhook (pour les 3 variantes)

Dans SurveySparrow → **Settings** → **Integrations** → **Webhooks** :
- URL : `https://votre-url.onrender.com/webhook/surveysparrow`
- Events : `survey_submit`
- Copier le **Secret** → `SURVEYSPARROW_WEBHOOK_SECRET` dans `.env`

#### Email de confirmation

Dans SurveySparrow → **Survey Settings** → **Email Notifications** :
- Activer "Send email to respondent"
- Personnaliser le template (objet, corps, expéditeur)
- SurveySparrow gère l'envoi — aucun code backend nécessaire

#### Theming marque blanche

- **iFrame (1A)** : Survey → **Design** → Theme Builder (couleurs, polices, logo)
- **SDK (1B, 1C)** : objet `customStyle` dans le JS (CSS variables injectées dans le widget)
- Retirer le branding SurveySparrow : **Settings** → **White Label** (selon votre plan)

---

### POC 2 — Onomi / SpotMe

#### Credentials API

Renseigner dans `.env` :
```
ONOMI_API_BASE_URL=https://api.onomi.io/v1    # ou votre endpoint SpotMe
ONOMI_API_KEY=votre_clé_api
ONOMI_ORG_ID=votre_org_id                     # si requis par votre plan
```

#### Endpoints proxy exposés

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/onomi/webinars` | Liste des webinars publiés |
| GET | `/api/onomi/webinars/:id` | Détail d'un webinar |
| POST | `/api/onomi/webinars/:id/register` | Inscription + retour du `personal_link` |
| GET | `/api/onomi/webinars/:id/live-link` | URL de streaming public (si event live) |

#### Adapter les champs API

Les noms de champs varient selon votre version de l'API Onomi/SpotMe.  
Ajuster les mappings dans `routes/onomi.js` (commentés avec les alternatives connues).

---

## Déploiement sur Render.com (free tier)

> **Durée estimée : 5 minutes**

1. Créer un compte sur [render.com](https://render.com) (gratuit)
2. Pousser ce dossier sur un repo GitHub (public ou privé)
3. Dans Render → **New** → **Web Service** → connecter le repo
4. Render détecte `render.yaml` automatiquement
5. Dans **Environment** → ajouter toutes les variables de `.env`
6. Cliquer **Deploy** → Render fournit une URL publique `https://poc-integration-xxxx.onrender.com`
7. Mettre à jour l'URL du webhook SurveySparrow avec cette URL

---

## Comparatif POC 1 — Choix d'intégration SurveySparrow

| Critère | 1A iFrame | 1B SDK inline | 1C SDK popup |
|---------|-----------|--------------|-------------|
| Complexité setup | ⭐ Minimale | ⭐⭐ Faible | ⭐⭐ Faible |
| Contrôle design | Moyen (theme builder) | Fort (CSS vars + JS) | Fort (CSS vars + JS) |
| Événements JS | ❌ Non | ✅ Oui | ✅ Oui |
| Auto-resize | Partiel (postMessage) | ✅ Natif | N/A (overlay) |
| Pré-remplissage champs | ❌ Non | ✅ `defaultAnswers` | ✅ `defaultAnswers` |
| UX | Formulaire intégré | Formulaire intégré | Overlay déclenché |
| Logique conditionnelle SS | ✅ Complète | ✅ Complète | ✅ Complète |
| Idéal pour Uniform | Prototype rapide | **Recommandé** | CTA secondaires |
