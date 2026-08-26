export async function mapWithConcurrency<TItem, TResult>(
  items: TItem[],
  concurrency: number,
  mapper: (item: TItem) => Promise<TResult>,
): Promise<TResult[]> {
  const results: TResult[] = new Array(items.length);
  let currentIndex = 0;

  const worker = async (): Promise<void> => {
    while (currentIndex < items.length) {
      const index = currentIndex;
      currentIndex += 1;
      results[index] = await mapper(items[index]);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());

  await Promise.all(workers);

  return results;
}
