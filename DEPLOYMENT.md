# PhotoGigs Backend — Free Tier Deployment Guide

## Stack (100% free for MVP)

| Service       | Provider           | Free Limits                        |
|---------------|--------------------|------------------------------------|
| App hosting   | Railway.app        | 512MB RAM, sleeps on inactivity    |
| PostgreSQL    | Neon.tech          | 0.5 GB, 1 compute unit             |
| MongoDB       | Atlas M0           | 512 MB shared cluster              |
| Redis         | Upstash            | 10K commands/day, 256 MB           |
| File uploads  | Cloudinary         | 25 GB storage, 25 GB/mo bandwidth  |
| Email         | Resend             | 3,000 emails/month                 |
| Push (FCM)    | Firebase           | Free (no hard limit for basic use) |

---

## Step-by-step

### 1. Neon (PostgreSQL)

1. Sign up at https://neon.tech
2. Create a new project → copy the connection string
3. Open the Neon SQL editor → paste and run `src/models/postgres/schema.sql`
4. Your `DATABASE_URL` looks like:
   `postgresql://user:pass@ep-xxx.us-east-2.aws.neon.tech/photogigs?sslmode=require`

### 2. MongoDB Atlas (M0 free cluster)

1. Sign up at https://cloud.mongodb.com
2. Create a free M0 cluster (choose a region close to your users)
3. Network access → Add IP → `0.0.0.0/0` (allow all — Railway IPs are dynamic)
4. Database access → Create user with read/write to `photogigs` DB
5. Connect → Drivers → copy the connection string
6. Your `MONGODB_URI` looks like:
   `mongodb+srv://user:pass@cluster0.abc.mongodb.net/photogigs?retryWrites=true&w=majority`

### 3. Upstash Redis

1. Sign up at https://upstash.com
2. Create a Redis database → choose the same region as Railway
3. Copy the **TLS** connection URL (`rediss://...`)
4. Your `REDIS_URL` looks like:
   `rediss://default:password@xxxx.upstash.io:6379`

### 4. Cloudinary

1. Sign up at https://cloudinary.com
2. Dashboard → copy `Cloud Name`, `API Key`, `API Secret`

### 5. Resend (email)

1. Sign up at https://resend.com
2. Add and verify your domain (or use `onboarding@resend.dev` for testing)
3. API Keys → Create key → copy it

### 6. Firebase (push notifications — optional but recommended)

1. Go to https://console.firebase.google.com
2. Create a project → Add an Android/iOS app
3. Project Settings → Service Accounts → Generate new private key
4. Download the JSON file
5. Minify it to one line: `cat serviceAccount.json | python3 -m json.tool --compact`
6. Paste the minified JSON as the value of `FIREBASE_SERVICE_ACCOUNT_JSON`

### 7. Railway (app hosting)

1. Sign up at https://railway.app
2. New Project → Deploy from GitHub repo
3. Add all environment variables from `.env.example` in the Railway dashboard
4. Railway auto-detects Node.js. It will run `npm run build` then `npm start`.
   If it doesn't, set these in Railway settings:
   - **Build command:** `npm run build`
   - **Start command:** `npm start`
5. Deploy → copy the Railway-generated URL (e.g. `https://photogigs-backend.up.railway.app`)
6. Add `FRONTEND_URL` = your frontend's deployed URL

---

## When free limits run out (upgrade path)

| Bottleneck                        | Fix                                             | Cost        |
|-----------------------------------|-------------------------------------------------|-------------|
| Railway sleeps (dev tier)         | Upgrade to Railway Hobby                        | $5/month    |
| Upstash 10K cmd/day cap           | Upstash Pay-as-you-go                           | ~$0.20/100K |
| Neon 0.5GB storage full           | Neon Launch tier                                | $19/month   |
| Atlas M0 512MB full               | Atlas M2                                        | $9/month    |
| Multi-pod needed (>10K DAU)       | Already fixed: Redis rate limiter + Socket adapter | Already done |

---

## Environment variables checklist

Copy `.env.example` → `.env` and fill in every value before deploying.

```
DATABASE_URL          ← from Neon
MONGODB_URI           ← from Atlas
REDIS_URL             ← from Upstash (use rediss:// TLS URL)
JWT_ACCESS_SECRET     ← generate: openssl rand -hex 32
JWT_REFRESH_SECRET    ← generate: openssl rand -hex 32
RESEND_API_KEY        ← from Resend dashboard
CLOUDINARY_CLOUD_NAME ← from Cloudinary dashboard
CLOUDINARY_API_KEY    ← from Cloudinary dashboard
CLOUDINARY_API_SECRET ← from Cloudinary dashboard
PHONEPE_MERCHANT_ID   ← from PhonePe merchant dashboard
PHONEPE_API_KEY       ← from PhonePe merchant dashboard
FIREBASE_SERVICE_ACCOUNT_JSON ← optional, for push notifications
```

---

## Useful commands

```bash
# Generate strong JWT secrets locally
openssl rand -hex 32

# Run schema on Neon
psql $DATABASE_URL -f src/models/postgres/schema.sql

# Build and start locally
npm run build && npm start

# Dev mode (hot reload)
npm run dev
```
