export type Bucket = 'day' | 'week';

/** UTC dates; weeks start on Monday, including across calendar years. */
export function bucketStart(iso: string, bucket: Bucket): string {
  const date = new Date(iso);
  date.setUTCHours(0, 0, 0, 0);
  if (bucket === 'week') date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}

export function rangeBuckets(from: string, to: string, bucket: Bucket): string[] {
  const result: string[] = [];
  const cursor = new Date(`${bucketStart(from, bucket)}T00:00:00.000Z`);
  const end = bucketStart(to, bucket);
  while (cursor.toISOString().slice(0, 10) <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + (bucket === 'week' ? 7 : 1));
  }
  return result;
}
