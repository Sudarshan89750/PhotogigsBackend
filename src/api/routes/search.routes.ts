import { Router, Request, Response, NextFunction } from 'express';
import { Container } from 'typedi';
import { Pool } from 'pg';
import { buildGeoNearFilter } from '../../utils/geo';
import { parsePagination, buildMeta } from '../../utils/pagination';
import { optionalAuthenticate, authenticate } from '../middlewares/auth.middleware';
import { searchLimiter } from '../middlewares/rate-limit.middleware';

const router = Router();

export default (app: Router): void => {
  app.use('/search', router);

  router.get('/freelancers', searchLimiter, optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = Container.get<Pool>('pgPool');
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);

      const conditions = [`status IN ('approved', 'pending_otp')`];
      const values: unknown[] = [];
      let idx = 1;

      if (req.query.city) {
        conditions.push(`city ILIKE $${idx++}`);
        values.push(`%${req.query.city}%`);
      }
      if (req.query.state) {
        conditions.push(`state ILIKE $${idx++}`);
        values.push(`%${req.query.state}%`);
      }
      if (req.query.minRating) {
        conditions.push(`average_rating >= $${idx++}`);
        values.push(Number(req.query.minRating));
      }
      if (req.query.availability) {
        conditions.push(`availability_status = $${idx++}`);
        values.push(req.query.availability);
      }
      if (req.query.skills && typeof req.query.skills === 'string') {
        const skillList = req.query.skills
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        if (skillList.length > 0) {
          conditions.push(`EXISTS (
            SELECT 1 FROM unnest(skills) AS skill
            WHERE lower(skill) = ANY($${idx++}::text[])
          )`);
          values.push(skillList);
        }
      }
      if (req.query.q && typeof req.query.q === 'string') {
        const searchTerm = req.query.q.trim();
        if (searchTerm.length > 0) {
          const tsIdx = idx++;
          values.push(searchTerm);
          const likeIdx = idx++;
          values.push(`%${searchTerm}%`);
          conditions.push(`(
            to_tsvector('english', first_name || ' ' || last_name || ' ' || COALESCE(bio, '') || ' ' || array_to_string(skills, ' '))
              @@ plainto_tsquery('english', $${tsIdx})
            OR first_name ILIKE $${likeIdx}
            OR last_name ILIKE $${likeIdx}
            OR COALESCE(bio, '') ILIKE $${likeIdx}
            OR city ILIKE $${likeIdx}
            OR EXISTS (
              SELECT 1 FROM unnest(skills) AS skill
              WHERE skill ILIKE $${likeIdx}
            )
          )`);
        }
      }

      // Geo sort params
      const latRaw = Number(req.query.latitude);
      const lngRaw = Number(req.query.longitude);
      const lat = !isNaN(latRaw) && req.query.latitude ? latRaw : null;
      const lng = !isNaN(lngRaw) && req.query.longitude ? lngRaw : null;

      const where = conditions.join(' AND ');
      
      let distanceCol = '';
      let orderBy = 'created_at DESC';

      if (lat !== null && lng !== null) {
        // Haversine distance in KM
        distanceCol = `, (6371 * acos(cos(radians($${idx})) * cos(radians(latitude)) * cos(radians(longitude) - radians($${idx + 1})) + sin(radians($${idx})) * sin(radians(latitude)))) AS distance`;
        values.push(lat, lng);
        idx += 2;
      }

      switch (req.query.sortBy) {
        case 'name_asc': orderBy = 'first_name ASC, last_name ASC'; break;
        case 'name_desc': orderBy = 'first_name DESC, last_name DESC'; break;
        case 'rating': orderBy = 'average_rating DESC'; break;
        case 'reviews': orderBy = 'total_reviews DESC'; break;
        case 'distance': 
          if (lat !== null && lng !== null) orderBy = 'distance ASC';
          break;
      }

      const { rows } = await db.query(
        `SELECT id, first_name, last_name, city, state, country, avatar_url,
                bio, skills, hourly_rate, average_rating, total_reviews, latitude, longitude, availability_status
                ${distanceCol}
         FROM users WHERE ${where}
         ORDER BY ${orderBy}
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...values, limit + 1, skip]
      );

      const hasNextPage = rows.length > limit;
      if (hasNextPage) rows.pop();

      res.json({ success: true, data: rows, meta: buildMeta({ page, limit, hasNextPage }) });
    } catch (e) { next(e); }
  });

  router.get('/jobs', searchLimiter, optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobModel = Container.get<any>('jobModel');
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
      const filter: Record<string, unknown> = { status: 'open' };

      if (req.query.category && typeof req.query.category === 'string' && req.query.category.toLowerCase() !== 'all') {
        filter.category = { $regex: new RegExp(req.query.category, 'i') };
      }
      if (req.query.city && typeof req.query.city === 'string') {
        filter.city = { $regex: new RegExp(req.query.city, 'i') };
      }
      if (req.query.q && typeof req.query.q === 'string') {
        // Regex fallback keeps search working even when text indexes are missing/outdated.
        const q = req.query.q.trim();
        if (q.length > 0) {
          const qRegex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          filter.$or = [
            { title: { $regex: qRegex } },
            { description: { $regex: qRegex } },
            { category: { $regex: qRegex } },
            { city: { $regex: qRegex } },
          ];
        }
      }

      const radius = Number(req.query.radiusKm);
      const latRaw = Number(req.query.latitude);
      const lngRaw = Number(req.query.longitude);
      if (!isNaN(latRaw) && !isNaN(lngRaw) && !isNaN(radius) && req.query.latitude && req.query.longitude && req.query.radiusKm) {
        Object.assign(
          filter,
          buildGeoNearFilter(latRaw, lngRaw, radius)
        );
      }

      const data = await jobModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit + 1)
        .lean();

      const hasNextPage = data.length > limit;
      if (hasNextPage) data.pop();

      res.json({ success: true, data, meta: buildMeta({ page, limit, hasNextPage }) });
    } catch (e) { next(e); }
  });

  // Search users (for autocomplete and user discovery)
  router.get('/users', searchLimiter, optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = Container.get<Pool>('pgPool');
      const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
      const q = (req.query.q as string || '').trim();

      if (!q || q.length < 2) {
        res.json({ success: true, data: [], meta: buildMeta({ page, limit, hasNextPage: false }) });
        return;
      }

      const { rows } = await db.query(
        `SELECT id, first_name, last_name, avatar_url, bio, skills, average_rating, city
         FROM users
         WHERE status IN ('approved', 'pending_otp')
           AND (first_name ILIKE $1 OR last_name ILIKE $1 OR CONCAT(first_name, ' ', last_name) ILIKE $1)
         ORDER BY average_rating DESC NULLS LAST
         LIMIT $2 OFFSET $3`,
        [`%${q}%`, limit + 1, skip]
      );

      const hasNextPage = rows.length > limit;
      if (hasNextPage) rows.pop();

      res.json({ success: true, data: rows, meta: buildMeta({ page, limit, hasNextPage }) });
    } catch (e) { next(e); }
  });

  router.get('/map/photographers', searchLimiter, optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = Container.get<Pool>('pgPool');
      const limit = Math.min(Number(req.query.limit ?? 200), 200);

      let query = `
        SELECT id, first_name, last_name, avatar_url, bio, skills, average_rating,
               hourly_rate, city, state, latitude, longitude, availability_status
        FROM users
        WHERE status = 'approved'
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
      `;
      const params: any[] = [];
      let idx = 1;

      if (req.query.availability) {
        params.push(req.query.availability);
        query += ` AND availability_status = $${idx++}`;
      }

      query += ` ORDER BY average_rating DESC NULLS LAST LIMIT $${idx} OFFSET $${idx + 1}`;
      params.push(limit, 0);

      const { rows } = await db.query(query, params);

      res.json({ success: true, data: rows });
    } catch (e) { next(e); }
  });

  // Global/Universal search - searches across all content types
  router.get('/', searchLimiter, optionalAuthenticate, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const db = Container.get<Pool>('pgPool');
      const jobModel = Container.get<any>('jobModel');
      const communityModel = Container.get<any>('postModel');
      const q = (req.query.q as string || '').trim();
      const type = req.query.type as string || 'all'; // all, users, jobs, posts, listings
      const limit = Math.min(20, Number(req.query.limit) || 10);

      if (!q || q.length < 2) {
        res.json({ success: true, data: { users: [], jobs: [], posts: [], listings: [] }, meta: { count: 0 } });
        return;
      }

      const results: any = { users: [], jobs: [], posts: [], listings: [] };
      const qRegex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      // Search users
      if (type === 'all' || type === 'users') {
        const { rows: users } = await db.query(
          `SELECT id, first_name, last_name, avatar_url, bio, average_rating, city
           FROM users 
           WHERE status IN ('approved', 'pending_otp')
             AND (first_name ILIKE $1 OR last_name ILIKE $1 OR CONCAT(first_name, ' ', last_name) ILIKE $1)
           LIMIT $2`,
          [`%${q}%`, limit]
        );
        results.users = users;
      }

      // Search jobs
      if (type === 'all' || type === 'jobs') {
        const jobs = await jobModel
          .find({ 
            status: 'open',
            $or: [
              { title: { $regex: qRegex } },
              { description: { $regex: qRegex } },
              { category: { $regex: qRegex } },
            ]
          })
          .select('_id title category budget city status createdAt')
          .limit(limit)
          .lean();
        results.jobs = jobs;
      }

      // Search posts
      if (type === 'all' || type === 'posts') {
        const posts = await communityModel
          .find({
            $or: [
              { content: { $regex: qRegex } },
              { hashtags: { $regex: qRegex } },
            ]
          })
          .select('_id content authorId images likesCount createdAt')
          .limit(limit)
          .lean();
        results.posts = posts;
      }

      // Search marketplace listings
      if (type === 'all' || type === 'listings') {
        const listingModel = Container.get<any>('listingModel');
        const listings = await listingModel
          .find({
            status: 'active',
            $or: [
              { title: { $regex: qRegex } },
              { description: { $regex: qRegex } },
              { category: { $regex: qRegex } },
            ]
          })
          .select('_id title price images category listingType')
          .limit(limit)
          .lean();
        results.listings = listings;
      }

      res.json({ 
        success: true, 
        data: results, 
        meta: { 
          count: results.users.length + results.jobs.length + results.posts.length + results.listings.length,
          query: q 
        }
      });
    } catch (e) { next(e); }
  });
};
