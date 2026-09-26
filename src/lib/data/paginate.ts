import "server-only";

/** PostgREST returns at most `max_rows` (1000) rows per request. */
export const PAGE_SIZE = 1000;

type PageQuery<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Fetch every row of an ordered query page by page, up to `limit` rows.
 * `truncated` is true when more rows exist than were returned.
 */
export async function fetchAll<T>(
  query: PageQuery<T>,
  limit: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let from = 0; from <= limit; from += PAGE_SIZE) {
    const to = Math.min(from + PAGE_SIZE, limit + 1) - 1;
    const { data, error } = await query(from, to);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < to - from + 1) break;
  }
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}
