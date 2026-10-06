import { parseArgs } from 'node:util';
import { importPlaces } from '../lib/leads/places-import';
import { dataDir } from '../lib/paths';
async function main() {
  const { values } = parseArgs({ options: { file: { type: 'string' }, bbox: { type: 'string' }, 'release-date': { type: 'string' } } });
  if (!values.file || !values.bbox || !values['release-date']) throw new Error('Usage: npm run places:import -- --file <authorized-local.parquet> --bbox=<west,south,east,north> --release-date <YYYY-MM-DD>');
  const report = await importPlaces({ file: values.file, bbox: values.bbox.split(',').map(Number), releaseDate: values['release-date'], dataRoot: dataDir() });
  console.log(JSON.stringify(report));
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Import failed'); process.exitCode = 1; });
