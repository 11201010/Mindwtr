/**
 * Recovery snapshot names as mobile writes them (apps/mobile/lib/recovery-snapshot.ts): the file name for an instant and its
 * clash number, the newest-first order, which names a prune removes (only the 5 newest stay), and the label Settings shows.
 * Pure: the hosts do the file work (React Native through expo-file-system, the native Android app in RecoverySnapshots.kt).
 * Imports nothing, so the capture path that writes a snapshot loads no import parser.
 */
export const RECOVERY_SNAPSHOT_FILE_PATTERN = /^data\.(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})(?:\.(\d{3})(?:\.(\d+))?)?\.snapshot\.json$/u;
export const MAX_RECOVERY_SNAPSHOTS = 5;

/** `data.<UTC instant, colons as dashes>[.<clash>].snapshot.json`. */
export const buildRecoverySnapshotFileName = (date: Date = new Date(), collisionIndex = 0): string => {
    const iso = date.toISOString();
    const [datePart, timePartWithZone] = iso.split('T');
    const safeTime = String(timePartWithZone || '00:00:00.000Z')
        .replace(/Z$/u, '')
        .replace(/:/gu, '-');
    const collisionSuffix = collisionIndex > 0 ? `.${collisionIndex}` : '';
    return `data.${datePart}T${safeTime}${collisionSuffix}.snapshot.json`;
};

/** The snapshot names among [names], newest first by instant, then by clash number; other names are left out. */
export const sortRecoverySnapshotNames = (names: readonly string[]): string[] => names
    .map((name) => {
        const match = name.match(RECOVERY_SNAPSHOT_FILE_PATTERN);
        if (!match) return null;
        return {
            name,
            timestampKey: `${match[1]}.${match[2] ?? '000'}`,
            collisionIndex: Number(match[3] ?? 0),
        };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((left, right) =>
        right.timestampKey.localeCompare(left.timestampKey)
        || right.collisionIndex - left.collisionIndex
    )
    .map(({ name }) => name);

/** The names a prune deletes: every snapshot after the newest [MAX_RECOVERY_SNAPSHOTS]. */
export const recoverySnapshotNamesToPrune = (names: readonly string[]): string[] =>
    sortRecoverySnapshotNames(names).slice(MAX_RECOVERY_SNAPSHOTS);

/** Settings' label for a snapshot: its instant as a local date and time (hours and minutes); another name stays as it is. */
export const formatRecoverySnapshotLabel = (fileName: string): string => {
    const match = fileName.match(
        /^data\.(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:\.(\d{3})(?:\.\d+)?)?\.snapshot\.json$/i,
    );
    if (!match) return fileName;
    const [, datePart, hour, minute, second, milliseconds = '000'] = match;
    const localDate = new Date(`${datePart}T${hour}:${minute}:${second}.${milliseconds}Z`);
    return `${localDate.toLocaleDateString()} ${localDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};
