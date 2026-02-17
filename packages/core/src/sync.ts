
import type { AppData, Attachment, Project, Task, Area, SettingsSyncGroup } from './types';
import { normalizeTaskForLoad } from './task-status';
import { logWarn } from './logger';

export interface EntityMergeStats {
    localTotal: number;
    incomingTotal: number;
    mergedTotal: number;
    localOnly: number;
    incomingOnly: number;
    conflicts: number;
    resolvedUsingLocal: number;
    resolvedUsingIncoming: number;
    deletionsWon: number;
    conflictIds: string[];
    maxClockSkewMs: number;
    timestampAdjustments: number;
    timestampAdjustmentIds: string[];
}

export interface MergeStats {
    tasks: EntityMergeStats;
    projects: EntityMergeStats;
    sections: EntityMergeStats;
    areas: EntityMergeStats;
}

export interface MergeResult {
    data: AppData;
    stats: MergeStats;
}

export type SyncHistoryEntry = {
    at: string;
    status: 'success' | 'conflict' | 'error';
    conflicts: number;
    conflictIds: string[];
    maxClockSkewMs: number;
    timestampAdjustments: number;
    error?: string;
};

// Log clock skew warnings if merges show >5 minutes drift.
export const CLOCK_SKEW_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_TOMBSTONE_RETENTION_DAYS = 90;
const MIN_TOMBSTONE_RETENTION_DAYS = 1;
const MAX_TOMBSTONE_RETENTION_DAYS = 3650;

export type SyncStep = 'read-local' | 'read-remote' | 'merge' | 'write-local' | 'write-remote';

export type SyncCycleIO = {
    readLocal: () => Promise<AppData>;
    readRemote: () => Promise<AppData | null | undefined>;
    writeLocal: (data: AppData) => Promise<void>;
    writeRemote: (data: AppData) => Promise<void>;
    tombstoneRetentionDays?: number;
    now?: () => string;
    onStep?: (step: SyncStep) => void;
};

export type SyncCycleResult = {
    data: AppData;
    stats: MergeStats;
    status: 'success' | 'conflict';
};

export const appendSyncHistory = (
    settings: AppData['settings'] | undefined,
    entry: SyncHistoryEntry,
    limit: number = 20
): SyncHistoryEntry[] => {
    const history = Array.isArray(settings?.lastSyncHistory) ? settings?.lastSyncHistory ?? [] : [];
    const items = [entry, ...history];
    const next = items.filter((item) => item && typeof item.at === 'string');
    const dropped = items.length - next.length;
    if (dropped > 0) {
        logWarn('Dropped invalid sync history entries', {
            scope: 'sync',
            context: { dropped },
        });
    }
    return next.slice(0, Math.max(1, limit));
};

export const normalizeAppData = (data: AppData): AppData => ({
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    projects: Array.isArray(data.projects) ? data.projects : [],
    sections: Array.isArray(data.sections) ? data.sections : [],
    areas: Array.isArray(data.areas) ? data.areas : [],
    settings: data.settings ?? {},
});

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const isValidTimestamp = (value: unknown): value is string =>
    typeof value === 'string' && Number.isFinite(Date.parse(value));

type RevisionMetadata = {
    rev?: unknown;
    revBy?: unknown;
};

const normalizeRevisionMetadata = <T extends RevisionMetadata>(item: T): T => {
    const normalized = { ...item };
    const rawRev = normalized.rev;
    if (
        typeof rawRev !== 'number'
        || !Number.isFinite(rawRev)
        || !Number.isInteger(rawRev)
        || rawRev < 0
    ) {
        delete normalized.rev;
    }
    const rawRevBy = normalized.revBy;
    if (typeof rawRevBy === 'string') {
        const trimmed = rawRevBy.trim();
        if (trimmed.length > 0) {
            normalized.revBy = trimmed;
        } else {
            delete normalized.revBy;
        }
    } else {
        delete normalized.revBy;
    }
    return normalized;
};

const validateRevisionFields = (
    item: Record<string, unknown>,
    label: string,
    index: number,
    errors: string[]
) => {
    const rev = item.rev;
    if (rev !== undefined) {
        if (typeof rev !== 'number' || !Number.isFinite(rev) || rev < 0 || !Number.isInteger(rev)) {
            errors.push(`${label}[${index}].rev must be a non-negative integer when present`);
        }
    }
    const revBy = item.revBy;
    if (revBy !== undefined && !isNonEmptyString(revBy)) {
        errors.push(`${label}[${index}].revBy must be a non-empty string when present`);
    }
};

const validateEntityShape = (
    items: unknown[],
    label: 'tasks' | 'projects' | 'sections',
    errors: string[]
) => {
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!isObjectRecord(item)) {
            errors.push(`${label}[${index}] must be an object`);
            continue;
        }
        if (!isNonEmptyString(item.id)) {
            errors.push(`${label}[${index}].id must be a non-empty string`);
        }
        if (item.createdAt !== undefined && !isNonEmptyString(item.createdAt)) {
            errors.push(`${label}[${index}].createdAt must be a non-empty string when present`);
        } else if (isNonEmptyString(item.createdAt) && !isValidTimestamp(item.createdAt)) {
            errors.push(`${label}[${index}].createdAt must be a valid ISO timestamp when present`);
        }
        if (!isNonEmptyString(item.updatedAt)) {
            errors.push(`${label}[${index}].updatedAt must be a non-empty string`);
        } else if (!isValidTimestamp(item.updatedAt)) {
            errors.push(`${label}[${index}].updatedAt must be a valid ISO timestamp`);
        }
        if (isValidTimestamp(item.createdAt) && isValidTimestamp(item.updatedAt)) {
            const createdMs = Date.parse(item.createdAt);
            const updatedMs = Date.parse(item.updatedAt);
            if (updatedMs < createdMs) {
                errors.push(`${label}[${index}].updatedAt must be greater than or equal to createdAt`);
            }
        }
        validateRevisionFields(item, label, index, errors);
    }
};

const validateMergedSyncData = (data: AppData): string[] => {
    const errors: string[] = [];
    if (!Array.isArray(data.tasks)) errors.push('tasks must be an array');
    if (!Array.isArray(data.projects)) errors.push('projects must be an array');
    if (!Array.isArray(data.sections)) errors.push('sections must be an array');
    if (!Array.isArray(data.areas)) errors.push('areas must be an array');
    if (!isObjectRecord(data.settings)) errors.push('settings must be an object');

    if (Array.isArray(data.tasks)) validateEntityShape(data.tasks as unknown[], 'tasks', errors);
    if (Array.isArray(data.projects)) validateEntityShape(data.projects as unknown[], 'projects', errors);
    if (Array.isArray(data.sections)) validateEntityShape(data.sections as unknown[], 'sections', errors);
    if (Array.isArray(data.areas)) {
        for (let index = 0; index < data.areas.length; index += 1) {
            const area = data.areas[index] as unknown;
            if (!isObjectRecord(area)) {
                errors.push(`areas[${index}] must be an object`);
                continue;
            }
            if (!isNonEmptyString(area.id)) {
                errors.push(`areas[${index}].id must be a non-empty string`);
            }
            if (!isNonEmptyString(area.name)) {
                errors.push(`areas[${index}].name must be a non-empty string`);
            }
            if (area.createdAt !== undefined && !isValidTimestamp(area.createdAt)) {
                errors.push(`areas[${index}].createdAt must be a valid ISO timestamp when present`);
            }
            if (area.updatedAt !== undefined && !isValidTimestamp(area.updatedAt)) {
                errors.push(`areas[${index}].updatedAt must be a valid ISO timestamp when present`);
            }
            if (isValidTimestamp(area.createdAt) && isValidTimestamp(area.updatedAt)) {
                const createdMs = Date.parse(area.createdAt);
                const updatedMs = Date.parse(area.updatedAt);
                if (updatedMs < createdMs) {
                    errors.push(`areas[${index}].updatedAt must be greater than or equal to createdAt`);
                }
            }
            validateRevisionFields(area, 'areas', index, errors);
        }
    }
    return errors;
};

const validateSyncPayloadShape = (data: unknown, source: 'local' | 'remote'): string[] => {
    const errors: string[] = [];
    if (!isObjectRecord(data)) {
        errors.push(`${source} payload must be an object`);
        return errors;
    }
    const record = data as Record<string, unknown>;
    if (record.tasks !== undefined && !Array.isArray(record.tasks)) {
        errors.push(`${source} payload field "tasks" must be an array when present`);
    }
    if (record.projects !== undefined && !Array.isArray(record.projects)) {
        errors.push(`${source} payload field "projects" must be an array when present`);
    }
    if (record.sections !== undefined && !Array.isArray(record.sections)) {
        errors.push(`${source} payload field "sections" must be an array when present`);
    }
    if (record.areas !== undefined && !Array.isArray(record.areas)) {
        errors.push(`${source} payload field "areas" must be an array when present`);
    }
    if (record.settings !== undefined && !isObjectRecord(record.settings)) {
        errors.push(`${source} payload field "settings" must be an object when present`);
    }
    return errors;
};

const resolveTombstoneRetentionDays = (value?: number): number => {
    if (!Number.isFinite(value)) return DEFAULT_TOMBSTONE_RETENTION_DAYS;
    const rounded = Math.floor(value as number);
    return Math.min(MAX_TOMBSTONE_RETENTION_DAYS, Math.max(MIN_TOMBSTONE_RETENTION_DAYS, rounded));
};

const parseTimestampOrInfinity = (value?: string): number => {
    if (!value) return Number.POSITIVE_INFINITY;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

const pruneAttachmentTombstones = (
    attachments: Attachment[] | undefined,
    cutoffMs: number
): { next: Attachment[] | undefined; removed: number } => {
    if (!attachments || attachments.length === 0) return { next: attachments, removed: 0 };
    let removed = 0;
    const next = attachments.filter((attachment) => {
        if (!attachment.deletedAt) return true;
        const deletedMs = parseTimestampOrInfinity(attachment.deletedAt);
        if (deletedMs <= cutoffMs) {
            removed += 1;
            return false;
        }
        return true;
    });
    return {
        next: next.length > 0 ? next : undefined,
        removed,
    };
};

export const purgeExpiredTombstones = (
    data: AppData,
    nowIso: string,
    retentionDays?: number
): { data: AppData; removedTaskTombstones: number; removedAttachmentTombstones: number } => {
    const nowMs = Date.parse(nowIso);
    if (!Number.isFinite(nowMs)) {
        return { data, removedTaskTombstones: 0, removedAttachmentTombstones: 0 };
    }
    const keepDays = resolveTombstoneRetentionDays(retentionDays);
    const cutoffMs = nowMs - keepDays * 24 * 60 * 60 * 1000;

    let removedTaskTombstones = 0;
    let removedAttachmentTombstones = 0;
    const nextTasks: Task[] = [];
    for (const task of data.tasks) {
        const tombstoneAt = task.purgedAt ? parseTimestampOrInfinity(task.purgedAt) : Number.POSITIVE_INFINITY;
        if (task.deletedAt && task.purgedAt && tombstoneAt <= cutoffMs) {
            removedTaskTombstones += 1;
            continue;
        }
        const pruned = pruneAttachmentTombstones(task.attachments, cutoffMs);
        removedAttachmentTombstones += pruned.removed;
        if (pruned.removed > 0) {
            nextTasks.push({ ...task, attachments: pruned.next });
            continue;
        }
        nextTasks.push(task);
    }

    const nextProjects: Project[] = data.projects.map((project) => {
        const pruned = pruneAttachmentTombstones(project.attachments, cutoffMs);
        removedAttachmentTombstones += pruned.removed;
        return pruned.removed > 0 ? { ...project, attachments: pruned.next } : project;
    });

    return {
        data: {
            ...data,
            tasks: nextTasks,
            projects: nextProjects,
        },
        removedTaskTombstones,
        removedAttachmentTombstones,
    };
};

const parseSyncTimestamp = (value?: string): number => {
    if (!value) return NaN;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : NaN;
};

const isIncomingNewer = (localAt?: string, incomingAt?: string): boolean => {
    const localTime = parseSyncTimestamp(localAt);
    const incomingTime = parseSyncTimestamp(incomingAt);
    if (!Number.isFinite(incomingTime)) return false;
    if (!Number.isFinite(localTime)) return true;
    return incomingTime > localTime;
};

const sanitizeAiForSync = (
    ai: AppData['settings']['ai'] | undefined,
    localAi?: AppData['settings']['ai']
): AppData['settings']['ai'] | undefined => {
    if (!ai) return ai;
    const sanitized: AppData['settings']['ai'] = {
        ...ai,
        apiKey: undefined,
    };
    if (sanitized.speechToText) {
        sanitized.speechToText = {
            ...sanitized.speechToText,
            offlineModelPath: localAi?.speechToText?.offlineModelPath,
        };
    }
    return sanitized;
};

const mergeSettingsForSync = (localSettings: AppData['settings'], incomingSettings: AppData['settings']): AppData['settings'] => {
    const merged: AppData['settings'] = { ...localSettings };
    const nextSyncUpdatedAt: NonNullable<AppData['settings']['syncPreferencesUpdatedAt']> = {
        ...(localSettings.syncPreferencesUpdatedAt ?? {}),
        ...(incomingSettings.syncPreferencesUpdatedAt ?? {}),
    };

    const localPrefs = localSettings.syncPreferences ?? {};
    const incomingPrefs = incomingSettings.syncPreferences ?? {};
    const localPrefsAt = localSettings.syncPreferencesUpdatedAt?.preferences;
    const incomingPrefsAt = incomingSettings.syncPreferencesUpdatedAt?.preferences;
    const incomingPrefsWins = isIncomingNewer(localPrefsAt, incomingPrefsAt);
    const mergedPrefs = incomingPrefsWins ? incomingPrefs : localPrefs;

    merged.syncPreferences = mergedPrefs;
    if (incomingPrefsWins) {
        if (incomingPrefsAt) nextSyncUpdatedAt.preferences = incomingPrefsAt;
    } else if (localPrefsAt) {
        nextSyncUpdatedAt.preferences = localPrefsAt;
    }

    const isSameValue = (left: unknown, right: unknown): boolean => {
        if (left === right) return true;
        return JSON.stringify(left) === JSON.stringify(right);
    };
    const chooseGroupFieldValue = <T>(localValue: T, incomingValue: T, incomingWins: boolean): T => {
        if (incomingValue === undefined) return localValue;
        if (localValue === undefined) return incomingValue;
        if (isSameValue(localValue, incomingValue)) return localValue;
        return incomingWins ? incomingValue : localValue;
    };
    const mergeRecordFields = <T extends Record<string, unknown>>(localValue: T, incomingValue: T, incomingWins: boolean): T => {
        const mergedValue: Record<string, unknown> = {};
        const localRecord = (localValue ?? {}) as Record<string, unknown>;
        const incomingRecord = (incomingValue ?? {}) as Record<string, unknown>;
        const keys = new Set([...Object.keys(localRecord), ...Object.keys(incomingRecord)]);
        for (const fieldKey of keys) {
            mergedValue[fieldKey] = chooseGroupFieldValue(localRecord[fieldKey], incomingRecord[fieldKey], incomingWins);
        }
        return mergedValue as T;
    };
    const mergeGroup = <T>(
        key: SettingsSyncGroup,
        localValue: T,
        incomingValue: T,
        apply: (value: T, incomingWins: boolean) => void,
        mergeValues?: (localValue: T, incomingValue: T, incomingWins: boolean) => T
    ) => {
        const localAt = localSettings.syncPreferencesUpdatedAt?.[key];
        const incomingAt = incomingSettings.syncPreferencesUpdatedAt?.[key];
        const incomingWins = isIncomingNewer(localAt, incomingAt);
        const resolvedValue = mergeValues
            ? mergeValues(localValue, incomingValue, incomingWins)
            : (incomingWins ? incomingValue : localValue);
        apply(resolvedValue, incomingWins);
        const winnerAt = incomingWins ? incomingAt : localAt;
        if (winnerAt) nextSyncUpdatedAt[key] = winnerAt;
    };

    mergeGroup(
        'appearance',
        {
            theme: localSettings.theme,
            appearance: localSettings.appearance,
            keybindingStyle: localSettings.keybindingStyle,
        },
        {
            theme: incomingSettings.theme,
            appearance: incomingSettings.appearance,
            keybindingStyle: incomingSettings.keybindingStyle,
        },
        (value) => {
            merged.theme = value.theme;
            merged.appearance = value.appearance;
            merged.keybindingStyle = value.keybindingStyle;
        },
        (localValue, incomingValue, incomingWins) => mergeRecordFields(localValue, incomingValue, incomingWins)
    );

    mergeGroup(
        'language',
        { language: localSettings.language, weekStart: localSettings.weekStart, dateFormat: localSettings.dateFormat },
        { language: incomingSettings.language, weekStart: incomingSettings.weekStart, dateFormat: incomingSettings.dateFormat },
        (value) => {
            merged.language = value.language;
            merged.weekStart = value.weekStart;
            merged.dateFormat = value.dateFormat;
        },
        (localValue, incomingValue, incomingWins) => mergeRecordFields(localValue, incomingValue, incomingWins)
    );

    mergeGroup(
        'externalCalendars',
        localSettings.externalCalendars,
        incomingSettings.externalCalendars,
        (value) => {
            merged.externalCalendars = value;
        }
    );

    mergeGroup(
        'ai',
        localSettings.ai,
        incomingSettings.ai,
        (value) => {
            merged.ai = sanitizeAiForSync(value, localSettings.ai);
        },
        (localValue, incomingValue, incomingWins) => chooseGroupFieldValue(localValue, incomingValue, incomingWins)
    );

    merged.syncPreferencesUpdatedAt = Object.keys(nextSyncUpdatedAt).length > 0 ? nextSyncUpdatedAt : merged.syncPreferencesUpdatedAt;
    return merged;
};

/**
 * Merge entities with soft-delete support using Last-Write-Wins (LWW) strategy.
 * 
 * Rules:
 * 1. If an item exists only in one source, include it
 * 2. If an item exists in both, take the one with newer updatedAt
 * 3. Deleted items (deletedAt set) are preserved - deletion syncs across devices
 * 4. If one version is deleted and one is not, the newer version wins
 */
function createEmptyEntityStats(localTotal: number, incomingTotal: number): EntityMergeStats {
    return {
        localTotal,
        incomingTotal,
        mergedTotal: 0,
        localOnly: 0,
        incomingOnly: 0,
        conflicts: 0,
        resolvedUsingLocal: 0,
        resolvedUsingIncoming: 0,
        deletionsWon: 0,
        conflictIds: [],
        maxClockSkewMs: 0,
        timestampAdjustments: 0,
        timestampAdjustmentIds: [],
    };
}

const CONTENT_DIFF_IGNORED_KEYS = new Set(['rev', 'revBy', 'updatedAt', 'createdAt', 'localStatus', 'purgedAt']);

const toComparableValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
        return value.map((item) => toComparableValue(item));
    }
    if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const comparable: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            if (CONTENT_DIFF_IGNORED_KEYS.has(key)) continue;
            if (key === 'uri' && record.kind === 'file') continue;
            comparable[key] = toComparableValue(record[key]);
        }
        return comparable;
    }
    return value;
};

const hasContentDifference = (localItem: unknown, incomingItem: unknown): boolean =>
    JSON.stringify(toComparableValue(localItem)) !== JSON.stringify(toComparableValue(incomingItem));

const toComparableSignature = (value: unknown): string =>
    JSON.stringify(toComparableValue(value));

const chooseDeterministicWinner = <T>(localItem: T, incomingItem: T): T => {
    const localSignature = toComparableSignature(localItem);
    const incomingSignature = toComparableSignature(incomingItem);
    if (localSignature === incomingSignature) return incomingItem;
    return incomingSignature > localSignature ? incomingItem : localItem;
};

const parseMergeTimestamp = (value: unknown): number => {
    if (typeof value !== 'string') return -1;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : -1;
};

function mergeEntitiesWithStats<T extends { id: string; updatedAt: string; deletedAt?: string }>(
    local: T[],
    incoming: T[],
    mergeConflict?: (localItem: T, incomingItem: T, winner: T) => T
): { merged: T[]; stats: EntityMergeStats } {
    const localMap = new Map<string, T>(local.map((item) => [item.id, item]));
    const incomingMap = new Map<string, T>(incoming.map((item) => [item.id, item]));
    const allIds = new Set<string>([...localMap.keys(), ...incomingMap.keys()]);

    const stats = createEmptyEntityStats(local.length, incoming.length);
    const merged: T[] = [];
    let invalidDeletedAtWarnings = 0;
    const normalizeTimestamps = <Item extends { id?: string; updatedAt: string; createdAt?: string }>(item: Item): Item => {
        if (!('createdAt' in item) || !item.createdAt) return item;
        const createdTime = new Date(item.createdAt).getTime();
        const updatedTime = new Date(item.updatedAt).getTime();
        if (!Number.isFinite(createdTime) || !Number.isFinite(updatedTime)) return item;
        if (updatedTime >= createdTime) return item;
        stats.timestampAdjustments += 1;
        if (item.id && stats.timestampAdjustmentIds.length < 20) {
            stats.timestampAdjustmentIds.push(item.id);
        }
        if (stats.timestampAdjustments <= 5) {
            logWarn('Normalized createdAt after updatedAt', {
                scope: 'sync',
                category: 'sync',
                context: { id: item.id, createdAt: item.createdAt, updatedAt: item.updatedAt },
            });
        }
        return { ...item, createdAt: item.updatedAt } as Item;
    };

    for (const id of allIds) {
        const localItem = localMap.get(id);
        const incomingItem = incomingMap.get(id);

        if (localItem && !incomingItem) {
            stats.localOnly += 1;
            stats.resolvedUsingLocal += 1;
            merged.push(normalizeTimestamps(localItem as unknown as { updatedAt: string; createdAt?: string }) as T);
            continue;
        }
        if (incomingItem && !localItem) {
            stats.incomingOnly += 1;
            stats.resolvedUsingIncoming += 1;
            merged.push(normalizeTimestamps(incomingItem as unknown as { updatedAt: string; createdAt?: string }) as T);
            continue;
        }

        if (!localItem || !incomingItem) continue;

        const safeLocalTime = parseMergeTimestamp(localItem.updatedAt);
        const safeIncomingTime = parseMergeTimestamp(incomingItem.updatedAt);
        const localRev = typeof (localItem as any).rev === 'number' && Number.isFinite((localItem as any).rev)
            ? (localItem as any).rev as number
            : 0;
        const incomingRev = typeof (incomingItem as any).rev === 'number' && Number.isFinite((incomingItem as any).rev)
            ? (incomingItem as any).rev as number
            : 0;
        const localRevBy = typeof (localItem as any).revBy === 'string' ? (localItem as any).revBy as string : '';
        const incomingRevBy = typeof (incomingItem as any).revBy === 'string' ? (incomingItem as any).revBy as string : '';
        const hasRevision = localRev > 0 || incomingRev > 0 || !!localRevBy || !!incomingRevBy;
        const localDeleted = !!localItem.deletedAt;
        const incomingDeleted = !!incomingItem.deletedAt;
        const revDiff = localRev - incomingRev;
        const revByDiff = localRevBy !== incomingRevBy;
        const shouldCheckContentDiff = hasRevision && revDiff === 0 && !revByDiff && localDeleted === incomingDeleted;
        const contentDiff = shouldCheckContentDiff ? hasContentDifference(localItem, incomingItem) : false;

        const differs = hasRevision
            ? revDiff !== 0 || revByDiff || localDeleted !== incomingDeleted || contentDiff
            : safeLocalTime !== safeIncomingTime || localDeleted !== incomingDeleted;

        if (differs) {
            stats.conflicts += 1;
            if (stats.conflictIds.length < 20) stats.conflictIds.push(id);
        }

        const timeDiff = safeIncomingTime - safeLocalTime;
        const absoluteSkew = Math.abs(timeDiff);
        if (absoluteSkew > stats.maxClockSkewMs) {
            stats.maxClockSkewMs = absoluteSkew;
        }
        const withinSkew = Math.abs(timeDiff) <= CLOCK_SKEW_THRESHOLD_MS;
        const resolveOperationTime = (item: T): number => {
            const updatedTime = parseMergeTimestamp(item.updatedAt);
            if (!item.deletedAt) return updatedTime;

            const deletedTimeRaw = new Date(item.deletedAt).getTime();
            if (!Number.isFinite(deletedTimeRaw)) {
                const fallbackDeletedTime = updatedTime;
                invalidDeletedAtWarnings += 1;
                if (invalidDeletedAtWarnings <= 5) {
                    logWarn('Invalid deletedAt timestamp during merge; using updatedAt fallback', {
                        scope: 'sync',
                        category: 'sync',
                        context: { id: item.id, deletedAt: item.deletedAt, updatedAt: item.updatedAt, fallbackDeletedTime },
                    });
                }
                return Math.max(updatedTime, fallbackDeletedTime);
            }

            return Math.max(updatedTime, deletedTimeRaw);
        };
        let winner = safeIncomingTime > safeLocalTime ? incomingItem : localItem;
        if (hasRevision) {
            if (localDeleted !== incomingDeleted) {
                const localOpTime = resolveOperationTime(localItem);
                const incomingOpTime = resolveOperationTime(incomingItem);
                if (incomingOpTime > localOpTime) {
                    winner = incomingItem;
                } else if (localOpTime > incomingOpTime) {
                    winner = localItem;
                } else {
                    winner = localDeleted ? localItem : incomingItem;
                }
            } else if (revDiff !== 0) {
                winner = revDiff > 0 ? localItem : incomingItem;
            } else if (safeIncomingTime !== safeLocalTime) {
                // When revisions tie, prefer fresher timestamps before revBy tie-break.
                winner = safeIncomingTime > safeLocalTime ? incomingItem : localItem;
            } else if (revByDiff && localRevBy && incomingRevBy) {
                winner = incomingRevBy > localRevBy ? incomingItem : localItem;
            } else {
                // Preserve deterministic convergence when metadata ties but content differs.
                winner = chooseDeterministicWinner(localItem, incomingItem);
            }
        } else if (localDeleted !== incomingDeleted) {
            const localOpTime = resolveOperationTime(localItem);
            const incomingOpTime = resolveOperationTime(incomingItem);
            if (incomingOpTime > localOpTime) {
                winner = incomingItem;
            } else if (localOpTime > incomingOpTime) {
                winner = localItem;
            } else {
                winner = localDeleted ? localItem : incomingItem;
            }
        } else if (withinSkew && safeIncomingTime === safeLocalTime) {
            winner = chooseDeterministicWinner(localItem, incomingItem);
        }
        if (winner === incomingItem) stats.resolvedUsingIncoming += 1;
        else stats.resolvedUsingLocal += 1;

        if (winner.deletedAt && (!localItem.deletedAt || !incomingItem.deletedAt || differs)) {
            stats.deletionsWon += 1;
        }

        const mergedItem = mergeConflict ? mergeConflict(localItem, incomingItem, winner) : winner;
        merged.push(normalizeTimestamps(mergedItem as unknown as { updatedAt: string; createdAt?: string }) as T);
    }

    stats.mergedTotal = merged.length;

    return { merged, stats };
}

const normalizeAreaForMerge = (area: Area, nowIso: string): Area & { createdAt: string; updatedAt: string } => {
    const createdAt = area.createdAt || area.updatedAt || nowIso;
    const updatedAt = area.updatedAt || area.createdAt || nowIso;
    return {
        ...area,
        createdAt,
        updatedAt,
    };
};

function mergeAreas(local: Area[], incoming: Area[], nowIso: string): { merged: Area[]; stats: EntityMergeStats } {
    const localNormalized = local.map((area) => normalizeAreaForMerge(area, nowIso));
    const incomingNormalized = incoming.map((area) => normalizeAreaForMerge(area, nowIso));
    const result = mergeEntitiesWithStats(localNormalized, incomingNormalized);
    let fallbackOrder = result.merged.reduce((maxOrder, area) => {
        const order = Number.isFinite(area.order) ? area.order : -1;
        return Math.max(maxOrder, order);
    }, -1) + 1;
    const merged = result.merged.map((area) => {
        if (Number.isFinite(area.order)) return area;
        const normalized = { ...area, order: fallbackOrder };
        fallbackOrder += 1;
        return normalized;
    });
    return { merged, stats: result.stats };
}

/**
 * Filter out soft-deleted items for display purposes.
 * Call this when loading data for the UI.
 */
export function filterDeleted<T extends { deletedAt?: string }>(items: T[]): T[] {
    return items.filter(item => !item.deletedAt);
}

/**
 * Merge two AppData objects for synchronization.
 * Uses Last-Write-Wins for tasks and projects.
 * Preserves local settings (device-specific preferences).
 */
export function mergeAppDataWithStats(local: AppData, incoming: AppData): MergeResult {
    const nowIso = new Date().toISOString();
    const localNormalized: AppData = {
        ...local,
        tasks: (local.tasks || []).map((t) => normalizeRevisionMetadata(normalizeTaskForLoad(t, nowIso))),
        projects: (local.projects || []).map((project) => normalizeRevisionMetadata(project)),
        sections: (local.sections || []).map((section) => normalizeRevisionMetadata(section)),
        areas: (local.areas || []).map((area) => normalizeRevisionMetadata(area)),
    };
    const incomingNormalized: AppData = {
        ...incoming,
        tasks: (incoming.tasks || []).map((t) => normalizeRevisionMetadata(normalizeTaskForLoad(t, nowIso))),
        projects: (incoming.projects || []).map((project) => normalizeRevisionMetadata(project)),
        sections: (incoming.sections || []).map((section) => normalizeRevisionMetadata(section)),
        areas: (incoming.areas || []).map((area) => normalizeRevisionMetadata(area)),
    };

    const mergeAttachments = (local?: Attachment[], incoming?: Attachment[]): Attachment[] | undefined => {
        const localList = local || [];
        const incomingList = incoming || [];
        if (localList.length === 0 && incomingList.length === 0) return undefined;
        const localById = new Map(localList.map((item) => [item.id, item]));
        const incomingById = new Map(incomingList.map((item) => [item.id, item]));
        const hasAvailableUri = (attachment?: Attachment): boolean => {
            return attachment?.kind === 'file'
                && attachment.localStatus !== 'missing'
                && typeof attachment.uri === 'string'
                && attachment.uri.trim().length > 0;
        };

        const merged = mergeEntitiesWithStats(localList, incomingList, (localAttachment, incomingAttachment, winner) => {
            if (winner.kind !== 'file' || localAttachment.kind !== 'file' || incomingAttachment.kind !== 'file') {
                return winner;
            }

            const winnerIsIncoming = winner === incomingAttachment;
            const winnerHasUri = hasAvailableUri(winner);
            const localHasUri = hasAvailableUri(localAttachment);
            const incomingHasUri = hasAvailableUri(incomingAttachment);

            let uri = winner.uri;
            let localStatus = winner.localStatus;

            if (winnerHasUri) {
                uri = winner.uri;
                localStatus = winner.localStatus || 'available';
            } else if (winnerIsIncoming && localHasUri) {
                uri = localAttachment.uri;
                localStatus = localAttachment.localStatus || 'available';
            } else if (!winnerIsIncoming && incomingHasUri) {
                uri = incomingAttachment.uri;
                localStatus = incomingAttachment.localStatus || 'available';
            } else if ((localStatus === undefined || localStatus === null) && typeof uri === 'string' && uri.trim().length > 0) {
                localStatus = 'available';
            }

            return {
                ...winner,
                cloudKey: winner.cloudKey || localAttachment.cloudKey || incomingAttachment.cloudKey,
                fileHash: winner.fileHash || localAttachment.fileHash || incomingAttachment.fileHash,
                uri,
                localStatus,
            };
        }).merged;

        const normalized = merged.map((attachment) => {
            if (attachment.kind !== 'file') return attachment;
            const localAttachment = localById.get(attachment.id);
            const incomingAttachment = incomingById.get(attachment.id);
            const localFile = localAttachment?.kind === 'file' ? localAttachment : undefined;
            const incomingFile = incomingAttachment?.kind === 'file' ? incomingAttachment : undefined;
            const uriAvailable = hasAvailableUri(attachment);
            return {
                ...attachment,
                cloudKey: attachment.cloudKey || localFile?.cloudKey || incomingFile?.cloudKey,
                fileHash: attachment.fileHash || localFile?.fileHash || incomingFile?.fileHash,
                localStatus: attachment.localStatus ?? (uriAvailable ? 'available' : undefined),
            };
        });

        return normalized.length > 0 ? normalized : undefined;
    };

    const tasksResult = mergeEntitiesWithStats(localNormalized.tasks, incomingNormalized.tasks, (localTask: Task, incomingTask: Task, winner: Task) => {
        const attachments = mergeAttachments(localTask.attachments, incomingTask.attachments);
        return { ...winner, attachments };
    });

    const projectsResult = mergeEntitiesWithStats(localNormalized.projects, incomingNormalized.projects, (localProject: Project, incomingProject: Project, winner: Project) => {
        const attachments = mergeAttachments(localProject.attachments, incomingProject.attachments);
        return { ...winner, attachments };
    });

    const sectionsResult = mergeEntitiesWithStats(localNormalized.sections, incomingNormalized.sections);

    const areasResult = mergeAreas(localNormalized.areas, incomingNormalized.areas, nowIso);

    return {
        data: {
            tasks: tasksResult.merged,
            projects: projectsResult.merged,
            sections: sectionsResult.merged,
            areas: areasResult.merged,
            settings: mergeSettingsForSync(localNormalized.settings, incomingNormalized.settings),
        },
        stats: {
            tasks: tasksResult.stats,
            projects: projectsResult.stats,
            sections: sectionsResult.stats,
            areas: areasResult.stats,
        },
    };
}

export function mergeAppData(local: AppData, incoming: AppData): AppData {
    return mergeAppDataWithStats(local, incoming).data;
}

export async function performSyncCycle(io: SyncCycleIO): Promise<SyncCycleResult> {
    const nowIso = io.now ? io.now() : new Date().toISOString();

    io.onStep?.('read-local');
    const localDataRaw = await io.readLocal();
    const localShapeErrors = validateSyncPayloadShape(localDataRaw, 'local');
    if (localShapeErrors.length > 0) {
        const sample = localShapeErrors.slice(0, 3).join('; ');
        throw new Error(`Invalid local sync payload: ${sample}`);
    }
    const localNormalized = normalizeAppData(localDataRaw);
    const localData = purgeExpiredTombstones(localNormalized, nowIso, io.tombstoneRetentionDays).data;

    io.onStep?.('read-remote');
    const remoteDataRaw = await io.readRemote();
    if (remoteDataRaw) {
        const remoteShapeErrors = validateSyncPayloadShape(remoteDataRaw, 'remote');
        if (remoteShapeErrors.length > 0) {
            const sample = remoteShapeErrors.slice(0, 3).join('; ');
            logWarn('Invalid remote sync payload shape', {
                scope: 'sync',
                context: {
                    issues: remoteShapeErrors.length,
                    sample,
                },
            });
            throw new Error(`Invalid remote sync payload: ${sample}`);
        }
    }
    const remoteNormalized = normalizeAppData(remoteDataRaw || { tasks: [], projects: [], sections: [], areas: [], settings: {} });
    const remoteData = purgeExpiredTombstones(remoteNormalized, nowIso, io.tombstoneRetentionDays).data;

    io.onStep?.('merge');
    const mergeResult = mergeAppDataWithStats(localData, remoteData);
    const conflictCount = (mergeResult.stats.tasks.conflicts || 0)
        + (mergeResult.stats.projects.conflicts || 0)
        + (mergeResult.stats.sections.conflicts || 0)
        + (mergeResult.stats.areas.conflicts || 0);
    const nextSyncStatus: SyncCycleResult['status'] = conflictCount > 0 ? 'conflict' : 'success';
    const conflictIds = [
        ...(mergeResult.stats.tasks.conflictIds || []),
        ...(mergeResult.stats.projects.conflictIds || []),
        ...(mergeResult.stats.sections.conflictIds || []),
        ...(mergeResult.stats.areas.conflictIds || []),
    ].slice(0, 10);
    const maxClockSkewMs = Math.max(
        mergeResult.stats.tasks.maxClockSkewMs || 0,
        mergeResult.stats.projects.maxClockSkewMs || 0,
        mergeResult.stats.sections.maxClockSkewMs || 0,
        mergeResult.stats.areas.maxClockSkewMs || 0
    );
    if (maxClockSkewMs > CLOCK_SKEW_THRESHOLD_MS) {
        logWarn('Sync merge detected large clock skew', {
            scope: 'sync',
            context: {
                maxClockSkewMs: Math.round(maxClockSkewMs),
                thresholdMs: CLOCK_SKEW_THRESHOLD_MS,
            },
        });
    }
    const timestampAdjustments = (mergeResult.stats.tasks.timestampAdjustments || 0)
        + (mergeResult.stats.projects.timestampAdjustments || 0)
        + (mergeResult.stats.sections.timestampAdjustments || 0)
        + (mergeResult.stats.areas.timestampAdjustments || 0);
    const historyEntry: SyncHistoryEntry = {
        at: nowIso,
        status: nextSyncStatus,
        conflicts: conflictCount,
        conflictIds,
        maxClockSkewMs,
        timestampAdjustments,
    };
    const nextHistory = appendSyncHistory(mergeResult.data.settings, historyEntry);
    const nextMergedData: AppData = {
        ...mergeResult.data,
        settings: {
            ...mergeResult.data.settings,
            lastSyncAt: nowIso,
            lastSyncStatus: nextSyncStatus,
            lastSyncError: undefined,
            lastSyncStats: mergeResult.stats,
            lastSyncHistory: nextHistory,
        },
    };
    const pruned = purgeExpiredTombstones(nextMergedData, nowIso, io.tombstoneRetentionDays);
    if (pruned.removedTaskTombstones > 0 || pruned.removedAttachmentTombstones > 0) {
        logWarn('Purged expired sync tombstones', {
            scope: 'sync',
            context: {
                removedTaskTombstones: pruned.removedTaskTombstones,
                removedAttachmentTombstones: pruned.removedAttachmentTombstones,
            },
        });
    }
    const finalData = pruned.data;
    const validationErrors = validateMergedSyncData(finalData);
    if (validationErrors.length > 0) {
        const sample = validationErrors.slice(0, 3).join('; ');
        logWarn('Sync merge validation failed', {
            scope: 'sync',
            context: {
                issues: validationErrors.length,
                sample,
            },
        });
        throw new Error(`Sync validation failed: ${sample}`);
    }

    io.onStep?.('write-local');
    await io.writeLocal(finalData);

    // Write local first so a local persistence failure cannot leave remote ahead.
    io.onStep?.('write-remote');
    await io.writeRemote(finalData);

    return { data: finalData, stats: mergeResult.stats, status: nextSyncStatus };
}
