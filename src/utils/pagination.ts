export interface PaginationMeta {
  total?: number; // Optional: Only populated if count is explicitly requested
  page: number;
  limit: number;
  pages?: number; // Optional: Only populated if count is explicitly requested
  hasNextPage: boolean;
  hasPrevPage: boolean;
  nextCursor?: string;
}

export interface IPagination {
  page: number;
  limit: number;
  skip: number;
  lastSeenId?: string;
}

export const parsePagination = (
  query: Record<string, unknown>
): IPagination => {
  const page = Math.max(1, parseInt((query.page as string) ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt((query.limit as string) ?? '20', 10)));
  const lastSeenId = query.lastSeenId as string | undefined;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
    lastSeenId,
  };
};

/**
 * Builds metadata for high-scale feeds.
 * At 1M+ MAU, we avoid countDocuments for every request.
 * Instead, we fetch limit+1 and check hasNextPage.
 */
export const buildMeta = (
  opts: {
    page: number;
    limit: number;
    hasNextPage: boolean;
    nextCursor?: string;
    total?: number;
  }
): PaginationMeta => ({
  total: opts.total,
  page: opts.page,
  limit: opts.limit,
  pages: opts.total ? Math.ceil(opts.total / opts.limit) : undefined,
  hasNextPage: opts.hasNextPage,
  hasPrevPage: opts.page > 1,
  nextCursor: opts.nextCursor,
});
