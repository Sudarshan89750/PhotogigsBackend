# PhotoGigs Enterprise Architecture

## Overview

Every capability is built to **enterprise maturity** - handling millions of users, like Amazon/Flipkart/Netflix level features.

---

## Infrastructure Layer (Core)

| Component | Purpose | Features |
|-----------|---------|----------|
| **CacheManager** | Multi-layer caching | L1 (in-memory) + L2 (Redis), cache-aside, write-through |
| **MessageQueue** | Async processing | Priority queues, retry, dead-letter, bulk enqueue |
| **CircuitBreaker** | Fault tolerance | Auto-recovery, half-open state, metrics |
| **RateLimiter** | Traffic control | Token bucket, per-user limits, blocking |

---

## Capability Maturity Matrix

### 1. User Management → Amazon Level

| Feature | Implementation |
|---------|---------------|
| **Authentication** | Multi-method (email, Google, Apple, Facebook) |
| **Sessions** | Device tracking, concurrent sessions, revoke all |
| **MFA** | TOTP, SMS, Email verification |
| **Password Security** | bcrypt with salt, change history, expiry |
| **Account Recovery** | Token-based reset, rate limited |
| **Verification** | Email → Phone → Identity (3 levels) |
| **Fraud Detection** | Failed attempt tracking, lockouts, alerts |
| **Security Events** | Login from new device, password changed, etc. |

### 2. Marketplace → Amazon/Flipkart Level

| Feature | Implementation |
|---------|---------------|
| **Listings** | SEO optimization, inventory tracking, SKU |
| **Search** | Text + Geo + Faceted navigation, relevance scoring |
| **Recommendations** | Collaborative filtering, "Frequently bought together" |
| **Shopping Cart** | Persistent cart, quantity management |
| **Orders** | Lifecycle management (pending → confirmed → shipped → delivered) |
| **Payments** | Multiple methods (card, UPI, wallet, COD) |
| **Escrow** | Platform holds payment until delivery confirmed |
| **Returns** | 7-day window, approval workflow, refund processing |
| **Disputes** | Open → Evidence → Resolution → Appeals |
| **Reviews** | Rating, photos, verified purchase badge |
| **Analytics** | Revenue, orders, conversion rate, top listings |

### 3. Community/Social → Instagram/TikTok Level

| Feature | Implementation |
|---------|---------------|
| **Posts** | Images, videos, hashtags, location |
| **Stories** | 24h expiry, views, replies |
| **Reels** | Short-form video, trending algorithm |
| **Live Streaming** | Real-time, viewer count, reactions |
| **Highlights** | Archive stories, cover images |
| **Follow System** | Followers/following, notifications |
| **Engagement** | Likes, comments, saves, shares |
| **Feed Algorithm** | Chronological, following, trending mix |
| **Hashtags** | Trending, suggested, discovery |

### 4. Messaging → WhatsApp Level

| Feature | Implementation |
|---------|---------------|
| **Real-time** | WebSocket + Socket.io |
| **E2E Encryption** | Client-side encryption, key exchange |
| **Media** | Images, videos, documents, voice |
| **Delivery** | Sent → Delivered → Read receipts |
| **Groups** | Admin, members, mute, pinned |
| **Status** | Typing indicator, online/offline |
| **Blocking** | Report, block, spam detection |
| **Search** | Message search, media search |

### 5. Jobs/Marketplace → Upwork/Fiverr Level

| Feature | Implementation |
|---------|---------------|
| **Job Posting** | Categories, budget, location, timeline |
| **Proposals** | Cover letter, portfolio, terms |
| **Hiring** | Accept proposal, start job |
| **Milestones** | Phase-based payments |
| **Work Submission** | Files, notes, revisions |
| **Payments** | Escrow, release on completion |
| **Disputes** | Evidence, mediation, resolution |
| **Reviews** | Both sides, rating + feedback |

### 6. Search → Elasticsearch Level

| Feature | Implementation |
|---------|---------------|
| **Text Search** | Full-text, fuzzy matching |
| **Geo Search** | Radius, boundaries, nearby |
| **Filters** | Category, price, rating, date |
| **Facets** | Dynamic filter counts |
| **Autocomplete** | Real-time suggestions |
| **Recommendations** | "Similar items", "You may like" |
| **Ranking** | Relevance, popularity, recency |

### 7. Notifications → Enterprise Level

| Feature | Implementation |
|---------|---------------|
| **Channels** | Push (FCM), Email, SMS, In-app |
| **Batching** | Digest, instant, scheduled |
| **Personalization** | User preferences, timing |
| **A/B Testing** | Variant testing, conversion tracking |
| **Templates** | Rich templates, variables |
| **Priority** | Urgent, normal, low |
| **Delivery** | Retry, fallback, click tracking |

### 8. Analytics → Mixpanel/Amplitude Level

| Feature | Implementation |
|---------|---------------|
| **Events** | Custom events, properties |
| **Funnels** | Conversion steps, drop-off |
| **Cohorts** | Behavioral segments |
| **Retention** | Day 1, 7, 30 retention |
| **Revenue** | LTV, ARPU, subscription metrics |
| **Dashboards** | Real-time, scheduled reports |
| **Export** | CSV, API, integrations |

### 9. Admin Panel → Enterprise Level

| Feature | Implementation |
|---------|---------------|
| **User Management** | CRUD, approve, block, roles |
| **Content Moderation** | Flagged content, bulk actions |
| **Dispute Resolution** | Evidence review, rulings |
| **Financial** | Payouts, refunds, reports |
| **Analytics** | Platform-wide metrics |
| **Automation** | Auto-approve, triggers |
| **Audit Logs** | Action history, export |

---

## Code Patterns

### Ultra-Light Routes

```typescript
// Route only does: validate + buildDto + call service + return response
router.post('/jobs', validate(createJobSchema), async (req, res, next) => {
  try {
    const dto = jobService.buildCreateJobDto(req);  // buildDto in service
    const result = await jobService.createJob(dto);
    return res.status(201).json({ success: true, data: result });
  } catch (e) { next(e); }
});
```

### Fatty Services

```typescript
@Service()
export class JobService {
  // All buildDto methods here
  public buildCreateJobDto(req: any): CreateJobDto { /* ... */ }
  public buildListJobDto(req: any): JobQueryDto { /* ... */ }

  // All business logic here
  async createJob(dto: CreateJobDto) { /* ... */ }
  async listJobs(dto: JobQueryDto) { /* ... */ }

  // All external service calls here
  // All complex queries here
}
```

---

## Scalability Features

| Pattern | Use Case |
|---------|----------|
| **Cursor Pagination** | Handle millions of records |
| **Redis Caching** | Hot data, reduce DB load |
| **Message Queues** | Async processing, decoupling |
| **Circuit Breaker** | External API resilience |
| **Rate Limiting** | Traffic protection |
| **Connection Pooling** | DB efficiency |
| **Read Replicas** | Query scaling |
| **Sharding** | Data distribution |

---

## Feature Flags

All new features behind flags:
- `marketplace_escrow`
- `mfa_enabled`
- `live_streaming`
- `stories_enabled`
- `cod_enabled`
- `dispute_auto_resolve`

---

## Monitoring & Alerts

| Metric | Threshold |
|--------|------------|
| Error Rate | > 1% |
| P99 Latency | > 500ms |
| CPU Usage | > 80% |
| Memory | > 85% |
| Queue Depth | > 10000 |
| Circuit Open | > 5 min |

---

## Files Structure

```
Backend/src/
├── infrastructure/     # Caching, Queue, CircuitBreaker, RateLimiter
├── core/              # BaseService, BaseController, Pagination
├── plugins/           # Plugin system for extensibility
├── services/          # All services (enterprise-grade)
├── api/routes/        # Ultra-light routes
└── interfaces/        # DTOs and interfaces
```