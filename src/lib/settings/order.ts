/**
 * Move one item up or down a sorted list and return the new sort values
 * (10, 20, 30…) for every item whose value changes.
 */
export function reorder<T extends { id: string; sort: number }>(
  items: T[],
  id: string,
  delta: -1 | 1,
): { id: string; sort: number }[] {
  const list = [...items];
  const i = list.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return [];
  [list[i], list[j]] = [list[j], list[i]];
  return list
    .map((x, k) => ({ id: x.id, sort: (k + 1) * 10, before: x.sort }))
    .filter((x) => x.sort !== x.before)
    .map(({ id: itemId, sort }) => ({ id: itemId, sort }));
}
