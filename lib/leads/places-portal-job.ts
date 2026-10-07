import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { PORTAL_ERROR_TEXT, PortalImportError, runPortalImport, type DuckFactory, type PortalErrorCode } from './places-portal';

/** A run older than this is treated as interrupted (the 10-minute timeout plus import time). */
export const STALE_LOCK_MS = 20 * 60 * 1000;
const Code = z.enum(Object.keys(PORTAL_ERROR_TEXT) as [PortalErrorCode, ...PortalErrorCode[]]);
export const ImportStatus = z.object({
  state: z.enum(['running', 'succeeded', 'failed', 'interrupted']),
  startedAt: z.string(), finishedAt: z.string().optional(),
  replace: z.boolean(), code: Code.optional(),
  count: z.number().int().nonnegative().optional(), bytes: z.number().int().nonnegative().optional(),
  releaseDate: z.string().optional(),
}).strict();
export type ImportStatus = z.infer<typeof ImportStatus>;
export type CurrentImport = { releaseDate: string; count: number; bytes: number; attribution: string } | null;
export type PlacesImportView = { current: CurrentImport; last: (ImportStatus & { message?: string }) | null; running: boolean };

const files = (dataRoot: string) => {
  const shared = path.join(path.resolve(dataRoot), 'shared');
  return { shared, db: path.join(shared, 'places.db'), lock: path.join(shared, 'places-import.lock'), status: path.join(shared, 'places-import-status.json') };
};
let inFlight: Promise<void> | null = null;

function writeStatus(file: string, status: ImportStatus) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(/*turbopackIgnore: true*/ temporary, JSON.stringify(ImportStatus.parse(status)));
  fs.renameSync(/*turbopackIgnore: true*/ temporary, file);
}
function readStatus(file: string): ImportStatus | null {
  try { return ImportStatus.parse(JSON.parse(fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'))); } catch { return null; }
}
function lockAge(lock: string, now: number): number | null {
  try { return now - fs.statSync(/*turbopackIgnore: true*/ lock).mtimeMs; } catch { return null; }
}

/** Current import metadata, read-only. Never includes secrets or row contents. */
export function currentImport(dataRoot: string): CurrentImport {
  const { db: file } = files(dataRoot);
  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null;
  let db: Database.Database | undefined;
  try {
    db = new Database(/*turbopackIgnore: true*/ file, { readonly: true, fileMustExist: true });
    const meta = db.prepare('SELECT release_date AS releaseDate, attribution FROM metadata LIMIT 1').get() as { releaseDate: string; attribution: string } | undefined;
    const { n } = db.prepare('SELECT count(*) AS n FROM places').get() as { n: number };
    return meta ? { releaseDate: meta.releaseDate, attribution: meta.attribution, count: n, bytes: fs.statSync(/*turbopackIgnore: true*/ file).size } : null;
  } catch { return null; }
  finally { db?.close(); }
}

export function placesImportView(dataRoot: string, now = Date.now()): PlacesImportView {
  const paths = files(dataRoot);
  let last = readStatus(paths.status);
  const age = lockAge(paths.lock, now);
  const running = inFlight !== null || (age !== null && age < STALE_LOCK_MS);
  if (last?.state === 'running' && !running) last = { ...last, state: 'interrupted' };
  return { current: currentImport(dataRoot), running, last: last && { ...last, ...(last.code ? { message: PORTAL_ERROR_TEXT[last.code] } : {}) } };
}

export type StartResult = { ok: true } | { ok: false; reason: 'busy' | 'exists' };

/**
 * Single-flight: one in-process run plus an exclusive lock file shared by every process on the
 * volume. Starts in the background and returns at once; callers poll placesImportView().
 */
export function startPlacesImport(options: { dataRoot: string; replace: boolean; openDuck?: DuckFactory; timeoutMs?: number; tmpDir?: string; now?: () => Date }): StartResult {
  const paths = files(options.dataRoot);
  if (fs.existsSync(/*turbopackIgnore: true*/ paths.db) && !options.replace) return { ok: false, reason: 'exists' };
  if (inFlight) return { ok: false, reason: 'busy' };
  fs.mkdirSync(/*turbopackIgnore: true*/ paths.shared, { recursive: true });
  const clock = options.now ?? (() => new Date());
  const age = lockAge(paths.lock, clock().getTime());
  if (age !== null && age >= STALE_LOCK_MS) fs.rmSync(/*turbopackIgnore: true*/ paths.lock, { force: true });
  let handle: number;
  try { handle = fs.openSync(/*turbopackIgnore: true*/ paths.lock, 'wx'); } catch { return { ok: false, reason: 'busy' }; }
  fs.closeSync(handle);
  const startedAt = clock().toISOString();
  writeStatus(paths.status, { state: 'running', startedAt, replace: options.replace });
  inFlight = (async () => {
    try {
      const result = await runPortalImport(options);
      writeStatus(paths.status, { state: 'succeeded', startedAt, finishedAt: clock().toISOString(), replace: options.replace, count: result.count, bytes: result.bytes, releaseDate: result.releaseDate });
      console.info('[places-import]', { state: 'succeeded', count: result.count, bytes: result.bytes, extractRows: result.extractRows, replaced: result.replaced });
    } catch (error) {
      const code: PortalErrorCode = error instanceof PortalImportError ? error.code : 'failed';
      writeStatus(paths.status, { state: 'failed', startedAt, finishedAt: clock().toISOString(), replace: options.replace, code });
      // Only the fixed code is logged; error objects and messages are never printed.
      console.warn('[places-import]', { state: 'failed', code });
    } finally {
      fs.rmSync(/*turbopackIgnore: true*/ paths.lock, { force: true });
      inFlight = null;
    }
  })();
  return { ok: true };
}

/** Test hook: wait for the current background run. */
export function placesImportSettled(): Promise<void> { return inFlight ?? Promise.resolve(); }
