// Tiny paginator. Pure helper used by the Library & Learning tabs. Clamps
// page to a valid range, handles empty/short input gracefully.

export function paginate(items, page = 1, perPage = 10) {
  const arr = Array.isArray(items) ? items : [];
  const totalItems = arr.length;
  const totalPages = perPage > 0 ? Math.max(1, Math.ceil(totalItems / perPage)) : 1;
  const safe = Math.min(Math.max(1, Math.floor(Number(page) || 1)), totalPages);
  const start = (safe - 1) * perPage;
  return {
    rows: arr.slice(start, start + perPage),
    page: safe,
    totalPages,
    totalItems
  };
}
