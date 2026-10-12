// check-data-device.mjs's expected exports: core's Mindwtr CSV and TaskNotes files for the JSON backup the phone exported in the
// same run (the library did not change between the three exports). Run with bun (core is TypeScript):
//   bun apps/android-native/scripts/data-export-expected.ts <exported backup.json>
// Prints `{ "csv": "...", "tasknotes": [{ "path": "...", "content": "..." }] }`.
import { readFileSync } from 'node:fs';
import { serializeMindwtrCsv } from '../../../packages/core/src/mindwtr-csv-export';
import { serializeTaskNotesExport } from '../../../packages/core/src/tasknotes-export';

const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
process.stdout.write(JSON.stringify({ csv: serializeMindwtrCsv(data), tasknotes: serializeTaskNotesExport(data).files }));
