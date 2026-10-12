// check-data-device.mjs's expected exports: core's own bytes for the library the phone exported. It loads a copy of the
// phone's database through core's store, then runs core's export serializers (RN's and the native host's getDataBackup) over
// the in-memory snapshot. Run with bun (core is TypeScript):
//   bun apps/android-native/scripts/data-export-expected.ts <a copy of the phone's mindwtr.db>
// Prints `{ "json": "...", "csv": "...", "tasknotes": [{ "path": "...", "content": "..." }] }`.
import { serializeBackupData } from '../../../packages/core/src/backup-transfer';
import { serializeMindwtrCsv } from '../../../packages/core/src/mindwtr-csv-export';
import { openScratchSqlite } from '../../../packages/core/src/screen-parity.replay';
import { SqliteAdapter } from '../../../packages/core/src/sqlite-adapter';
import { setStorageAdapter, useTaskStore } from '../../../packages/core/src/store';
import { getInMemoryAppDataSnapshot } from '../../../packages/core/src/sync-client-helpers';
import { serializeTaskNotesExport } from '../../../packages/core/src/tasknotes-export';

const sql = openScratchSqlite(process.argv[2]);
try {
    setStorageAdapter(new SqliteAdapter(sql.client));
    // A recovery load reads the rows as they are: no maintenance writes into the copy, no clock-dependent changes.
    await useTaskStore.getState().fetchData({ throwOnError: true, recoveryLoad: true });
    const data = getInMemoryAppDataSnapshot();
    process.stdout.write(JSON.stringify({ json: serializeBackupData(data), csv: serializeMindwtrCsv(data), tasknotes: serializeTaskNotesExport(data).files }));
} finally {
    sql.close();
}
