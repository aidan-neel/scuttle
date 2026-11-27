export const upsertById = <T extends { readonly id: string }>(
  items: ReadonlyArray<T>,
  next: T,
  prepend = true,
): ReadonlyArray<T> => {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return prepend ? [next, ...items] : [...items, next];
  const copy = [...items];
  copy[index] = next;
  return copy;
};

export const compareIsoDesc = (a: string, b: string): number => (a === b ? 0 : b > a ? 1 : -1);

export const compareIsoAsc = (a: string, b: string): number => (a === b ? 0 : a > b ? 1 : -1);
