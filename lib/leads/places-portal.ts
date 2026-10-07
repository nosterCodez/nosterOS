import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { directoryBytes, importPlaces, MAX_PLACES_BYTES } from './places-import';

/**
 * Import-only Foursquare Places Portal reader (Step 3C). It never runs on a schedule:
 * the platform owner's "Import RGV places" button is the only caller.
 *
 * Security contract:
 * - The Portal token is read here, from OMEGA_FOURSQUARE_PLACES_TOKEN, and only ever placed
 *   in one in-memory CREATE TEMPORARY SECRET statement. It is never logged, returned,
 *   written to disk, passed as an argument or included in an error.
 * - DuckDB runs in memory (384MB, 2 threads) with unsigned/community extensions and auto-install/auto-load off;
 *   only httpfs, iceberg and avro are installed and loaded, explicitly. Configuration is locked
 *   before any query against the catalog.
 * - Every failure becomes a fixed error code. DuckDB/provider messages are discarded because
 *   they can echo statement text.
 */
export const PORTAL_ENDPOINT = 'https://catalog.h3-hub.foursquare.com/iceberg';
export const PORTAL_TABLE = 'places.datasets.places_os';
/** Rio Grande Valley: west, south, east, north. */
export const RGV_BBOX = [-99.2, 25.84, -97.1, 26.8] as const;
/** iceberg reads manifests through the official avro extension (Claude review, Oct 7). */
export const APPROVED_EXTENSIONS = ['httpfs', 'iceberg', 'avro'] as const;
export const PORTAL_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_PORTAL_ROWS = 200_000;
/** Conservative bytes per exported row, used to refuse oversized extracts before exporting. */
export const ESTIMATED_ROW_BYTES = 300;
export const VOLUME_GUARD_BYTES = 400 * 1024 * 1024;

export type PortalErrorCode = 'setup' | 'exists' | 'storage' | 'too_large' | 'empty' | 'timeout' | 'provider' | 'schema' | 'failed';
export const PORTAL_ERROR_TEXT: Record<PortalErrorCode, string> = {
  setup: 'The Places Portal token is not configured on the server.',
  exists: 'An RGV import already exists. Confirm replacement to import again.',
  storage: 'Not enough room on the data volume for this import.',
  too_large: 'The RGV extract is larger than the 60 MiB import limit.',
  empty: 'The Places Portal returned no RGV places. Nothing was changed.',
  timeout: 'The import took longer than 10 minutes and was stopped. Nothing was changed.',
  provider: 'The Places Portal could not be read. Nothing was changed.',
  schema: 'The Places Portal returned an unexpected format. Nothing was changed.',
  failed: 'The import failed. Nothing was changed.',
};
export class PortalImportError extends Error {
  constructor(public readonly code: PortalErrorCode) { super(code); this.name = 'PortalImportError'; }
}

export type DuckRows = { getRowObjectsJS(): Record<string, unknown>[] };
export type DuckConnection = { run(sql: string): Promise<unknown>; runAndReadAll(sql: string): Promise<DuckRows>; interrupt(): void; closeSync(): void };
export type DuckInstance = { connect(): Promise<DuckConnection>; closeSync(): void };
export type DuckFactory = (config: Record<string, string>) => Promise<DuckInstance>;

const defaultFactory: DuckFactory = async config => {
  const { DuckDBInstance } = await import('@duckdb/node-api');
  return await DuckDBInstance.create(':memory:', config) as unknown as DuckInstance;
};

/** SQL string literal. Tokens and paths are also character-checked before use. */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const TOKEN_SHAPE = /^[A-Za-z0-9._~+/=-]{16,4096}$/;

export function duckConfig(extensionDirectory: string): Record<string, string> {
  return {
    memory_limit: '384MB',
    threads: '2',
    allow_unsigned_extensions: 'false',
    allow_community_extensions: 'false',
    autoinstall_known_extensions: 'false',
    autoload_known_extensions: 'false',
    extension_directory: extensionDirectory,
  };
}

const [west, south, east, north] = RGV_BBOX;
/** Open, public, Texas places inside the RGV box. Flagged-closed/nonexistent/private venues are excluded. */
export const PORTAL_FILTER = `country = 'US' AND region = 'TX'
  AND latitude BETWEEN ${south} AND ${north} AND longitude BETWEEN ${west} AND ${east}
  AND date_closed IS NULL
  AND NOT regexp_matches(coalesce(CAST(unresolved_flags AS VARCHAR), ''), 'closed|delete|privatevenue|doesnt_exist')`;
/** Public business fields only: no email, social handles or Placemaker metadata. */
export const PORTAL_COLUMNS = ['fsq_place_id', 'name', 'latitude', 'longitude', 'locality', 'fsq_category_labels', 'address', 'website', 'tel'] as const;

export type PortalImportResult = { count: number; bytes: number; releaseDate: string; replaced: boolean; extractRows: number };

export async function runPortalImport(options: {
  dataRoot: string; replace: boolean; openDuck?: DuckFactory; timeoutMs?: number; tmpDir?: string; now?: () => Date;
}): Promise<PortalImportResult> {
  const token = process.env.OMEGA_FOURSQUARE_PLACES_TOKEN?.trim();
  if (!token || !TOKEN_SHAPE.test(token)) throw new PortalImportError('setup');
  const root = path.resolve(options.dataRoot);
  const output = path.join(root, 'shared', 'places.db');
  if (fs.existsSync(output) && !options.replace) throw new PortalImportError('exists');
  let used: number;
  try { used = directoryBytes(root); } catch { throw new PortalImportError('storage'); }
  if (used >= VOLUME_GUARD_BYTES) throw new PortalImportError('storage');

  // The extract and extensions live in a private temp folder outside live data.
  const tmp = fs.mkdtempSync(path.join(options.tmpDir ?? os.tmpdir(), 'omega-portal-'));
  if (tmp === root || tmp.startsWith(root + path.sep)) { fs.rmSync(tmp, { recursive: true, force: true }); throw new PortalImportError('storage'); }
  const extract = path.join(tmp, 'rgv-places.parquet');
  const deadline = Date.now() + (options.timeoutMs ?? PORTAL_TIMEOUT_MS);
  let timedOut = false, instance: DuckInstance | undefined, connection: DuckConnection | undefined, secret = false, attached = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    let extractRows = 0;
    try {
      instance = await (options.openDuck ?? defaultFactory)(duckConfig(path.join(tmp, 'extensions')));
      connection = await instance.connect();
      const live = connection;
      timer = setTimeout(() => { timedOut = true; try { live.interrupt(); } catch { /* closing below */ } }, Math.max(0, deadline - Date.now()));
      for (const name of APPROVED_EXTENSIONS) { await live.run(`INSTALL ${name}`); await live.run(`LOAD ${name}`); }
      await live.run(`CREATE TEMPORARY SECRET omega_portal (TYPE ICEBERG, TOKEN ${literal(token)})`); secret = true;
      await live.run(`ATTACH 'places' AS places (TYPE iceberg, SECRET omega_portal, ENDPOINT ${literal(PORTAL_ENDPOINT)})`); attached = true;
      await live.run('SET lock_configuration = true');
      // Dry run: count first and refuse anything that would break the size guards.
      const counted = (await live.runAndReadAll(`SELECT count(*)::BIGINT AS n FROM ${PORTAL_TABLE} WHERE ${PORTAL_FILTER}`)).getRowObjectsJS();
      const n = Number(counted[0]?.n);
      if (counted.length !== 1 || !Number.isSafeInteger(n) || n < 0) throw new PortalImportError('schema');
      if (n === 0) throw new PortalImportError('empty');
      if (n > MAX_PORTAL_ROWS || n * ESTIMATED_ROW_BYTES > MAX_PLACES_BYTES) throw new PortalImportError('too_large');
      if (used + n * ESTIMATED_ROW_BYTES * 2 > VOLUME_GUARD_BYTES) throw new PortalImportError('storage');
      extractRows = n;
      await live.run(`COPY (SELECT ${PORTAL_COLUMNS.join(', ')} FROM ${PORTAL_TABLE} WHERE ${PORTAL_FILTER} ORDER BY fsq_place_id) TO ${literal(extract)} (FORMAT parquet, COMPRESSION snappy)`);
    } catch (error) {
      if (timedOut) throw new PortalImportError('timeout');
      if (error instanceof PortalImportError) throw error;
      throw new PortalImportError('provider');
    } finally {
      if (timer) clearTimeout(timer);
      if (connection && secret) { try { await connection.run('DROP TEMPORARY SECRET omega_portal'); } catch { /* destroyed with the instance */ } }
      if (connection && attached) { try { await connection.run('DETACH places'); } catch { /* closed below */ } }
      try { connection?.closeSync(); } catch { /* ignore */ }
      try { instance?.closeSync(); } catch { /* ignore */ }
    }
    if (timedOut || Date.now() > deadline) throw new PortalImportError('timeout');
    let size: number;
    try { size = fs.statSync(extract).size; } catch { throw new PortalImportError('provider'); }
    if (size > MAX_PLACES_BYTES) throw new PortalImportError('too_large');
    const releaseDate = (options.now?.() ?? new Date()).toISOString().slice(0, 10);
    try {
      const result = await importPlaces({ file: extract, bbox: [...RGV_BBOX], releaseDate, dataRoot: root, replace: options.replace, requireRows: true });
      return { count: result.count, bytes: result.bytes, releaseDate, replaced: result.replaced, extractRows };
    } catch (error) {
      if (error instanceof PortalImportError) throw error;
      const message = error instanceof Error ? error.message : '';
      if (/schema/i.test(message)) throw new PortalImportError('schema');
      if (/cap|80 percent/i.test(message)) throw new PortalImportError(/60 MB/.test(message) ? 'too_large' : 'storage');
      if (/Existing import/i.test(message)) throw new PortalImportError('exists');
      if (/No places imported/.test(message)) throw new PortalImportError('empty');
      throw new PortalImportError('failed');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
