export const databasePageSize = 500;

type PageResult<T> = { data: T[] | null; error: unknown };

export async function collectKeysetPages<T>(
  fetchPage: (after: string | null, limit: number) => PromiseLike<PageResult<T>>,
  cursorOf: (row: T) => string,
  pageSize = databasePageSize,
) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000) {
    throw new Error('Cursor page size must be an integer between 1 and 1000.');
  }

  const rows: T[] = [];
  const seen = new Set<string>();
  let after: string | null = null;

  for (;;) {
    const { data, error } = await fetchPage(after, pageSize);
    if (error) throw error;
    const page = data ?? [];
    if (page.length > pageSize) throw new Error('Cursor query returned more rows than requested.');

    let previous = after;
    for (const row of page) {
      const cursor = cursorOf(row);
      if (typeof cursor !== 'string' || !cursor) throw new Error('Cursor query returned a row without a cursor.');
      if (previous !== null && cursor <= previous) throw new Error('Cursor query did not return strictly increasing cursors.');
      if (seen.has(cursor)) throw new Error('Cursor query returned a duplicate row.');
      seen.add(cursor);
      rows.push(row);
      previous = cursor;
    }

    if (page.length < pageSize) return rows;
    after = cursorOf(page[page.length - 1]);
  }
}

export const collectCursorPages = <T extends { id: string }>(
  fetchPage: (afterId: string | null, limit: number) => PromiseLike<PageResult<T>>,
  pageSize = databasePageSize,
) => collectKeysetPages(fetchPage, (row) => row.id, pageSize);
