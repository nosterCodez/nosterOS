import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb } from '@/lib/data';
import { ROLLUP_ID } from '@/lib/businesses';
import { getMetric } from '@/lib/metrics/registry';
import { metricSeries } from '@/lib/metrics/series';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const Query = z.object({ metric: z.string().min(1), business: z.string().min(1), from: z.string().datetime(), to: z.string().datetime(), bucket: z.enum(['day', 'week']) }).refine(q => Date.parse(q.from) <= Date.parse(q.to), 'from must not be after to');
export async function GET(request: Request) {
  const parsed = Query.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const q = parsed.data;
  const metric = getMetric(q.metric);
  if (!metric) return NextResponse.json({ error: 'Unknown metric' }, { status: 400 });
  if (q.business === ROLLUP_ID && metric.rollup === 'none') return NextResponse.json({ error: 'This metric does not support a parent rollup' }, { status: 400 });
  if (q.business !== ROLLUP_ID && !metric.businesses.some(b => b === q.business)) return NextResponse.json({ error: 'Business not allowed for this metric' }, { status: 400 });
  return NextResponse.json(metricSeries(getDb(), metric, q.business, q.from, q.to, q.bucket));
}
