import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APPROVED_EXTENSIONS, PORTAL_ENDPOINT, PORTAL_TABLE, runPortalImport, type DuckConnection, type DuckFactory } from '@/lib/leads/places-portal';
import { placesImportSettled, placesImportView, startPlacesImport, STALE_LOCK_MS } from '@/lib/leads/places-portal-job';
import { OVERPASS_USER_AGENT } from '@/lib/leads/sources/overpass';

// No live calls: every DuckDB instance here is a fake that records statements.
const TOKEN = 'fixture-portal-token-0123456789abcdef';
const FIXTURE = path.resolve('tests/fixtures/places/places.parquet');
const roots: string[] = [];
const root = () => roots[roots.push(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-portal-root-'))) - 1];
const tmpBase = () => roots[roots.push(fs.mkdtempSync(path.join(os.tmpdir(), 'omega-portal-tmp-'))) - 1];

type Fake = { statements: string[]; configs: Record<string, string>[]; closed: { connection: number; instance: number }; interrupted: number };
function fakeDuck(options: { count?: number; fail?: RegExp; failMessage?: string; hang?: RegExp; copyFixture?: string | null } = {}): { factory: DuckFactory; fake: Fake } {
  const fake: Fake = { statements: [], configs: [], closed: { connection: 0, instance: 0 }, interrupted: 0 };
  let release: (() => void) | undefined;
  const connection: DuckConnection = {
    async run(sql) {
      fake.statements.push(sql);
      if (options.fail?.test(sql)) throw new Error(options.failMessage ?? `Catalog error near ${sql}`);
      if (options.hang?.test(sql)) await new Promise<void>((_, reject) => { release = () => reject(new Error(`INTERRUPT ${sql}`)); });
      const copy = sql.match(/^COPY .* TO '(.+)' \(FORMAT parquet/s);
      if (copy && options.copyFixture !== null) fs.copyFileSync(options.copyFixture ?? FIXTURE, copy[1].replace(/''/g, "'"));
      return undefined;
    },
    async runAndReadAll(sql) {
      fake.statements.push(sql);
      if (options.fail?.test(sql)) throw new Error(options.failMessage ?? `Catalog error near ${sql}`);
      return { getRowObjectsJS: () => [{ n: BigInt(options.count ?? 2) }] };
    },
    interrupt() { fake.interrupted++; release?.(); },
    closeSync() { fake.closed.connection++; },
  };
  return { fake, factory: async config => { fake.configs.push(config); return { connect: async () => connection, closeSync: () => { fake.closed.instance++; } }; } };
}
function leaks(fake: Fake, extra: unknown[] = []) {
  const others = fake.statements.filter(s => !s.startsWith('CREATE TEMPORARY SECRET'));
  return [...others, ...fake.configs.map(c => JSON.stringify(c)), ...extra.map(v => JSON.stringify(v ?? null))].some(s => s.includes(TOKEN));
}

beforeEach(() => { vi.stubEnv('OMEGA_FOURSQUARE_PLACES_TOKEN', TOKEN); });
afterEach(async () => {
  await placesImportSettled(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('imports the RGV extract with locked config, approved extensions only and the token only in the secret', async () => {
  const { factory, fake } = fakeDuck(); const dataRoot = root(), tmpDir = tmpBase();
  const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'info'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
  const result = await runPortalImport({ dataRoot, replace: false, openDuck: factory, tmpDir, now: () => new Date('2026-10-07T12:00:00Z') });
  expect(result).toMatchObject({ count: 1, releaseDate: '2026-10-07', replaced: false, extractRows: 2 });
  expect(fake.configs).toEqual([expect.objectContaining({ memory_limit: '512MB', threads: '2', allow_unsigned_extensions: 'false', allow_community_extensions: 'false', autoinstall_known_extensions: 'false', autoload_known_extensions: 'false' })]);
  expect(fake.configs[0].extension_directory.startsWith(tmpDir)).toBe(true);
  const installs = fake.statements.filter(s => /^(INSTALL|LOAD) /.test(s));
  expect(installs).toEqual(APPROVED_EXTENSIONS.flatMap(e => [`INSTALL ${e}`, `LOAD ${e}`]));
  const secrets = fake.statements.filter(s => s.includes(TOKEN));
  expect(secrets).toEqual([`CREATE TEMPORARY SECRET omega_portal (TYPE ICEBERG, TOKEN '${TOKEN}')`]);
  expect(fake.statements.some(s => /PERSISTENT/i.test(s))).toBe(false);
  expect(fake.statements).toContain(`ATTACH 'places' AS places (TYPE iceberg, SECRET omega_portal, ENDPOINT '${PORTAL_ENDPOINT}')`);
  const order = (re: RegExp) => fake.statements.findIndex(s => re.test(s));
  expect(order(/lock_configuration/)).toBeLessThan(order(/^SELECT count/));
  expect(order(/^SELECT count/)).toBeLessThan(order(/^COPY/));
  const copy = fake.statements.find(s => s.startsWith('COPY'))!;
  expect(copy).toContain(PORTAL_TABLE); expect(copy).toMatch(/country = 'US' AND region = 'TX'/);
  expect(copy).toMatch(/latitude BETWEEN 25.84 AND 26.8 AND longitude BETWEEN -99.2 AND -97.1/);
  expect(copy).not.toMatch(/\bemail\b|instagram|twitter|facebook_id|placemaker_url|SELECT \*/);
  expect(fake.statements).toContain('DROP TEMPORARY SECRET omega_portal');
  expect(fake.closed).toEqual({ connection: 1, instance: 1 });
  expect(leaks(fake, [result, ...logs.flatMap(l => l.mock.calls)])).toBe(false);
  expect(fs.readdirSync(tmpDir)).toEqual([]);
  expect(fs.existsSync(path.join(dataRoot, 'shared', 'places.db'))).toBe(true);
});

test('provider errors echoing the token become a fixed code, and the secret is dropped and DuckDB closed', async () => {
  const { factory, fake } = fakeDuck({ fail: /^ATTACH/, failMessage: `HTTP 401 for token ${TOKEN}` });
  const tmpDir = tmpBase(), dataRoot = root();
  const error = await runPortalImport({ dataRoot, replace: false, openDuck: factory, tmpDir }).catch(e => e);
  expect(error.code).toBe('provider'); expect(error.message).toBe('provider');
  expect(JSON.stringify({ message: error.message, stack: error.stack })).not.toContain(TOKEN);
  expect(fake.statements).toContain('DROP TEMPORARY SECRET omega_portal');
  expect(fake.closed).toEqual({ connection: 1, instance: 1 });
  expect(fs.readdirSync(tmpDir)).toEqual([]); expect(fs.existsSync(path.join(dataRoot, 'shared', 'places.db'))).toBe(false);
});

test.each([
  [{ count: 250_000 }, 'too_large'],
  [{ count: 0 }, 'empty'],
])('COUNT dry run refuses %j before exporting anything', async (input, code) => {
  const { factory, fake } = fakeDuck(input);
  await expect(runPortalImport({ dataRoot: root(), replace: false, openDuck: factory, tmpDir: tmpBase() })).rejects.toMatchObject({ code });
  expect(fake.statements.some(s => s.startsWith('COPY'))).toBe(false);
  expect(fake.closed).toEqual({ connection: 1, instance: 1 });
});

test('missing or malformed token and storage guard refuse before DuckDB opens', async () => {
  const factory = vi.fn<DuckFactory>();
  vi.stubEnv('OMEGA_FOURSQUARE_PLACES_TOKEN', '');
  await expect(runPortalImport({ dataRoot: root(), replace: false, openDuck: factory })).rejects.toMatchObject({ code: 'setup' });
  vi.stubEnv('OMEGA_FOURSQUARE_PLACES_TOKEN', "bad'token; DROP");
  await expect(runPortalImport({ dataRoot: root(), replace: false, openDuck: factory })).rejects.toMatchObject({ code: 'setup' });
  vi.stubEnv('OMEGA_FOURSQUARE_PLACES_TOKEN', TOKEN);
  const full = root(); fs.writeFileSync(path.join(full, 'big.bin'), ''); fs.truncateSync(path.join(full, 'big.bin'), 400 * 1024 * 1024);
  await expect(runPortalImport({ dataRoot: full, replace: false, openDuck: factory })).rejects.toMatchObject({ code: 'storage' });
  expect(factory).not.toHaveBeenCalled();
});

test('an export over 60 MiB is rejected without publishing', async () => {
  const big = path.join(tmpBase(), 'big.parquet'); fs.writeFileSync(big, ''); fs.truncateSync(big, 61 * 1024 * 1024);
  const { factory } = fakeDuck({ copyFixture: big }); const dataRoot = root();
  await expect(runPortalImport({ dataRoot, replace: false, openDuck: factory, tmpDir: tmpBase() })).rejects.toMatchObject({ code: 'too_large' });
  expect(fs.existsSync(path.join(dataRoot, 'shared', 'places.db'))).toBe(false);
});

test('timeout interrupts DuckDB, cleans up and changes nothing', async () => {
  const { factory, fake } = fakeDuck({ hang: /^COPY/ }); const dataRoot = root(), tmpDir = tmpBase();
  await expect(runPortalImport({ dataRoot, replace: false, openDuck: factory, tmpDir, timeoutMs: 50 })).rejects.toMatchObject({ code: 'timeout' });
  expect(fake.interrupted).toBe(1); expect(fake.closed).toEqual({ connection: 1, instance: 1 });
  expect(fs.readdirSync(tmpDir)).toEqual([]); expect(fs.existsSync(path.join(dataRoot, 'shared', 'places.db'))).toBe(false);
});

test('replacement needs confirmation and swaps atomically; a failed replacement keeps the old import', async () => {
  const dataRoot = root(), output = path.join(dataRoot, 'shared', 'places.db');
  await runPortalImport({ dataRoot, replace: false, openDuck: fakeDuck().factory, tmpDir: tmpBase(), now: () => new Date('2026-09-01T00:00:00Z') });
  const before = fs.readFileSync(output);
  await expect(runPortalImport({ dataRoot, replace: false, openDuck: fakeDuck().factory, tmpDir: tmpBase() })).rejects.toMatchObject({ code: 'exists' });
  await expect(runPortalImport({ dataRoot, replace: true, openDuck: fakeDuck({ fail: /^COPY/ }).factory, tmpDir: tmpBase() })).rejects.toMatchObject({ code: 'provider' });
  expect(fs.readFileSync(output)).toEqual(before);
  const replaced = await runPortalImport({ dataRoot, replace: true, openDuck: fakeDuck().factory, tmpDir: tmpBase(), now: () => new Date('2026-10-07T00:00:00Z') });
  expect(replaced).toMatchObject({ replaced: true, releaseDate: '2026-10-07', count: 1 });
  expect(placesImportView(dataRoot).current).toMatchObject({ releaseDate: '2026-10-07', count: 1 });
  expect(fs.readdirSync(path.join(dataRoot, 'shared')).filter(f => f.endsWith('.tmp'))).toEqual([]);
});

test('single-flight lock refuses a second start, records fixed-code status and recovers stale locks', async () => {
  const dataRoot = root(); let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const { factory } = fakeDuck();
  const slow: DuckFactory = async config => { await gate; return factory(config); };
  expect(startPlacesImport({ dataRoot, replace: false, openDuck: slow, tmpDir: tmpBase() })).toEqual({ ok: true });
  expect(startPlacesImport({ dataRoot, replace: false, openDuck: slow, tmpDir: tmpBase() })).toEqual({ ok: false, reason: 'busy' });
  expect(placesImportView(dataRoot)).toMatchObject({ running: true, last: { state: 'running' } });
  open(); await placesImportSettled();
  expect(placesImportView(dataRoot)).toMatchObject({ running: false, last: { state: 'succeeded', count: 1 }, current: { count: 1 } });
  expect(startPlacesImport({ dataRoot, replace: false, openDuck: factory })).toEqual({ ok: false, reason: 'exists' });

  vi.stubEnv('OMEGA_FOURSQUARE_PLACES_TOKEN', '');
  expect(startPlacesImport({ dataRoot, replace: true, openDuck: factory, tmpDir: tmpBase() })).toEqual({ ok: true });
  await placesImportSettled();
  const failed = placesImportView(dataRoot).last!;
  expect(failed).toMatchObject({ state: 'failed', code: 'setup' }); expect(failed.message).toMatch(/not configured/);

  // Another process's lock blocks a start until it is stale.
  const lock = path.join(dataRoot, 'shared', 'places-import.lock'); fs.writeFileSync(lock, '');
  vi.stubEnv('OMEGA_FOURSQUARE_PLACES_TOKEN', TOKEN);
  expect(startPlacesImport({ dataRoot, replace: true, openDuck: factory, tmpDir: tmpBase() })).toEqual({ ok: false, reason: 'busy' });
  const old = (Date.now() - STALE_LOCK_MS - 1000) / 1000; fs.utimesSync(lock, old, old);
  expect(startPlacesImport({ dataRoot, replace: true, openDuck: factory, tmpDir: tmpBase() })).toEqual({ ok: true });
  await placesImportSettled(); expect(fs.existsSync(lock)).toBe(false);
});

test('Overpass identifies itself with an inbox Noe receives', () => {
  expect(OVERPASS_USER_AGENT).toContain('noster@nostermarketing.com');
});
