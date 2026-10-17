export function pageInfo(total: number, requestedPage: number, pageSize: number) {
  const size = Math.max(1, Math.floor(pageSize) || 20);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(totalPages, Math.max(1, Math.floor(requestedPage) || 1));
  const offset = (page - 1) * size;
  const pages = [...new Set([1, page - 1, page, page + 1, totalPages])]
    .filter((number) => number >= 1 && number <= totalPages).sort((a, b) => a - b);
  return { page, totalPages, pages, offset, size,
    start: total ? offset + 1 : 0, end: Math.min(total, offset + size) };
}

export function paginateItems<T>(items: readonly T[], requestedPage: number, pageSize: number) {
  const info = pageInfo(items.length, requestedPage, pageSize);
  return { ...info, items: items.slice(info.offset, info.offset + info.size) };
}
