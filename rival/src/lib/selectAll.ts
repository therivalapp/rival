// PostgREST quietly stops at 1,000 rows, and a long `in (...)` list makes a
// request URL too long to send. These two helpers get around both, so a big
// team still counts every member and every activity.

const PAGE = 1000;
const CHUNK = 150; // ids per `in (...)` list; ~5.5 KB of URL

/** Every row of a query, fetched a page at a time. `page(from, to)` must
 *  return the query with `.range(from, to)` and a stable order applied. */
export async function selectAll<T = any>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error || !data) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return all;
}

/** Runs `run` once per slice of `ids`, in parallel, and joins the rows. */
export async function inChunks<T = any>(ids: string[], run: (slice: string[]) => Promise<T[]>): Promise<T[]> {
  if (ids.length === 0) return [];
  const slices: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) slices.push(ids.slice(i, i + CHUNK));
  return (await Promise.all(slices.map(run))).flat();
}
