# PhotoGigs Backend — Deployment Guide

## Free-Tier Stack (zero cost to start)

| Service | Provider | Free Limit | Purpose |
|---|---|---|---|
| Node.js app | Railway.app | 500 hrs/month | API server |
| PostgreSQL | Neon.tech | 0.5 GB | Users, reviews, tokens |
| MongoDB | Atlas M0 | 512 MB | Jobs, posts, chat, feed |
| Redis | Upstash | 10K cmds/day | OTP, rate limit, BullMQ, sockets |
| File storage | Cloudinary | 25 GB | Photos, videos, docs |
| Email | Resend | 100/day, 3K/month | OTP, notifications |
| Push (FCM) | Firebase | Free | Mobile push notifications |
| CDN + DDoS | Cloudflare | Free | DNS, TLS, basic protection |

---

## Step-by-Step Setup

### 1. PostgreSQL — Neon.tech

1. Sign up at https://neon.tech
2. Create a new project → copy the connection string
3. Open the **SQL Editor** and paste the entire contents of `src/models/postgres/schema.sql`
4. Run it — tables and indexes are created

### 2. MongoDB — Atlas M0

1. Sign up at https://cloud.mongodb.com
2. Create a free M0 cluster (any region)
3. Database Access → Add user with readWrite role
4. Network Access → Add `0.0.0.0/0` (or Railway's static IP)
5. Connect → copy the `mongodb+srv://...` URI

### 3. Redis — Upstash

1. Sign up at https://upstash.com
2. Create a Redis database (region closest to your Railway deployment)
3. Copy the **TLS** connection string: `rediss://default:xxx@xxx.upstash.io:6379`

### 4. Cloudinary

1. Sign up at https://cloudinary.com
2. Dashboard → copy Cloud Name, API Key, API Secret

### 5. Resend (Email)

1. Sign up at https://resend.com
2. Create an API key
3. Verify your sending domain (or use the sandbox domain for dev)

### 6. Firebase Push Notifications

1. Go to https://console.firebase.google.com
2. Create a project → Add an Android/iOS app
3. Project Settings → Service Accounts → Generate new private key
4. Download the JSON file
5. Copy the **entire JSON content** as a single-line string for `FIREBASE_SERVICE_ACCOUNT_JSON`

> If you skip this, push notifications are disabled (app still works).

### 7. PhonePe

1. Sign up at https://developer.phonepe.com
2. Create a merchant account
3. Get your Merchant ID and API Key from the sandbox dashboard
4. Switch `PHONEPE_BASE_URL` to production URL when going live:
   `https://api.phonepe.com/apis/hermes`

---

## Deploy to Railway

### Option A: Docker (recommended)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create new project
railway new

# Link to project
railway link

# Deploy
railway up
```

### Option B: GitHub auto-deploy

1. Push your code to GitHub
2. Railway Dashboard → New Project → Deploy from GitHub
3. Select your repo → Railway auto-detects the Dockerfile

### Setting Environment Variables

In Railway Dashboard → your service → Variables, add ALL variables from `.env.example`:

```
DATABASE_URL=postgresql://...
MONGODB_URI=mongodb+srv://...
REDIS_URL=rediss://...
JWT_ACCESS_SECRET=<32+ random chars>
JWT_REFRESH_SECRET=<32+ random chars>
RESEND_API_KEY=re_...
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
PHONEPE_MERCHANT_ID=...
PHONEPE_API_KEY=...
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
NODE_ENV=production
FRONTEND_URL=https://your-frontend-domain.com
```

Generate strong JWT secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Custom Domain + HTTPS

1. Railway Dashboard → your service → Settings → Domains
2. Add your domain → follow the CNAME DNS instructions
3. TLS is automatic (Let's Encrypt via Railway)

For best DDoS protection, point your domain through **Cloudflare** first:
- Set Cloudflare nameservers on your domain registrar
- Add a CNAME record in Cloudflare pointing to your Railway domain
- Enable "Proxied" (orange cloud) — free DDoS protection + CDN

---

## Scaling Path

| Users (DAU) | Action Required |
|---|---|
| < 5K | Free tier handles it |
| 5K–20K | Upgrade Upstash to Pay-As-You-Go ($0.20/100K cmds) |
| 20K–50K | Upgrade Railway to Hobby ($5/mo), Neon to Launch ($19/mo) |
| 50K–200K | Add MongoDB Atlas M10 ($57/mo), add pgBouncer |
| 200K+ | Separate Socket.io process, add MongoDB sharding |

---

## Health Check

```bash
curl https://your-api.railway.app/health
```

Expected response (200 OK):
```json
{
  "status": "ok",
  "timestamp": "2025-01-01T00:00:00.000Z",
  "checks": {
    "postgres": "ok",
    "redis": "ok"
  }
}
```

If any check shows "down", Railway will restart the container automatically.
