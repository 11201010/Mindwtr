import {
    ensureDeviceId,
    getNextDataChangeAt,
    nextRevision,
    persist,
    replaceEntitiesInArray,
} from '../store-helpers';
import { logWarn } from '../logger';
import { clearDerivedCache } from '../store-settings';
import { getPersonNameKey, normalizePersonName, normalizePersonNote, normalizePersonReferenceLink } from '../people';
import { taskEditValuesEqual } from '../json-value-equality';
import { personToSqliteRow } from '../person-sync-schema';
import { planManageEditorSave } from '../manage-settings-model';
import type { PreparedTaskEditResult } from '../store-types';
import { generateUUID as uuidv4 } from '../uuid';
import type { PeopleActions, Person, ProjectActionContext } from './shared';
import { actionFail, actionOk, mutateEntities } from './shared';

export const resolvePersonAddition = (people: readonly Person[], name: string): Person | null => {
    const key = getPersonNameKey(name);
    const matches = (person: Person) => getPersonNameKey(person.name) === key;
    return people.find((person) => !person.deletedAt && matches(person))
        ?? people.find((person) => person.deletedAt && matches(person)) ?? null;
};

/** The RN addPerson policy, retaining arbitrary initialProps and omitted metadata. */
export function planPersonAddition(people: readonly Person[], name: string, props: Partial<Person> | undefined,
    id: string, deviceId: string, now: string):
    { kind: 'live' | 'fresh' | 'restored'; before: Person | null; person: Person } | null {
    const normalizedName = normalizePersonName(name);
    if (!normalizedName) return null;
    const before = resolvePersonAddition(people, normalizedName);
    if (before && !before.deletedAt) return { kind: 'live', before, person: before };
    const person: Person = before ? {
        ...before, ...props, name: normalizedName, deletedAt: undefined,
        note: Object.prototype.hasOwnProperty.call(props ?? {}, 'note') ? normalizePersonNote(props?.note) : before.note,
        referenceLink: Object.prototype.hasOwnProperty.call(props ?? {}, 'referenceLink')
            ? normalizePersonReferenceLink(props?.referenceLink) : before.referenceLink,
        rev: nextRevision(before.rev), revBy: deviceId, updatedAt: now,
    } : {
        id, ...props, name: normalizedName,
        note: normalizePersonNote(props?.note), referenceLink: normalizePersonReferenceLink(props?.referenceLink),
        rev: 1, revBy: deviceId, createdAt: props?.createdAt ?? now, updatedAt: now,
    };
    return { kind: before ? 'restored' : 'fresh', before, person };
}

/** Reuse the Manage editor's omission of blank fields, especially on restoration. */
export function personCreateProps(request: { name: string; note: string; referenceLink: string }): Partial<Person> | undefined {
    const write = planManageEditorSave({ type: 'newPerson' }, { ...request, color: '' }, {})?.[0];
    return write?.kind === 'addPerson' ? write.props : undefined;
}

export const samePersonAdditionRow = (left: Person, right: Person): boolean =>
    taskEditValuesEqual(personToSqliteRow(left, left.updatedAt), personToSqliteRow(right, right.updatedAt));

export const createPeopleActions = ({
    set,
    debouncedSave,
}: ProjectActionContext): PeopleActions => ({
    addPerson: async (name: string, initialProps?: Partial<Person>) => {
        if (!normalizePersonName(name)) return null;
        const now = new Date().toISOString();
        let person: Person | null = null;
        set((state) => {
            const live = resolvePersonAddition(state._allPeople, name);
            if (live && !live.deletedAt) { person = live; return state; }
            const device = ensureDeviceId(state.settings);
            const planned = planPersonAddition(state._allPeople, name, initialProps, uuidv4(), device.deviceId, now);
            if (!planned || planned.kind === 'live') return state;
            const people = planned.before
                ? replaceEntitiesInArray(state._allPeople, [planned.person])
                : [...state._allPeople, planned.person];
            // Retain the previous restore result when initialProps changes the row's ID.
            person = planned.before && planned.before.id !== planned.person.id ? null : planned.person;
            persist(set, debouncedSave, state, { people, ...(device.updated ? { settings: device.settings } : {}) });
            return { _allPeople: people, lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt),
                ...(device.updated ? { settings: device.settings } : {}) };
        });
        return person;
    },

    commitPreparedPersonCreate: async (input): Promise<PreparedTaskEditResult> => {
        let result: PreparedTaskEditResult = { success: false, reason: 'conflict', error: 'Prepared Person conflicts with current data' };
        set((state) => {
            const { request, effect } = input;
            const target = state._allPeople.find((person) => person.id === request.expectedPersonId);
            if (target && (!input.deviceIdToInitialize || state.settings.deviceId === input.deviceIdToInitialize)
                && samePersonAdditionRow(target, effect.person.after)) {
                result = { success: true, id: target.id, outcome: 'replayed' };
                return state;
            }
            if ((input.kind === 'fresh' && target) || (state.settings.deviceId ?? null) !== input.deviceIdBefore
                || (input.deviceIdBefore === null ? !input.deviceIdToInitialize : input.deviceIdToInitialize !== null)) return state;
            const selected = resolvePersonAddition(state._allPeople, request.name);
            if (selected ? !input.scope.person || selected.id !== request.expectedPersonId
                || !samePersonAdditionRow(selected, input.scope.person) : input.scope.person !== null) return state;
            const planned = planPersonAddition(state._allPeople, request.name, personCreateProps(request), request.requestId,
                input.deviceIdBefore ?? input.deviceIdToInitialize!, input.updateAt);
            if (!planned || planned.kind !== input.kind || planned.person.id !== request.expectedPersonId
                || !samePersonAdditionRow(planned.person, effect.person.after)) return state;
            const people = planned.before
                ? state._allPeople.map((person) => person.id === planned.before!.id ? planned.person : person)
                : [...state._allPeople, planned.person];
            const settings = input.deviceIdToInitialize ? { ...state.settings, deviceId: input.deviceIdToInitialize } : state.settings;
            persist(set, debouncedSave, state, { people, ...(settings !== state.settings ? { settings } : {}) });
            result = { success: true, id: planned.person.id, outcome: 'applied' };
            return { _allPeople: people, settings, lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt) };
        });
        return result;
    },

    updatePerson: async (id: string, updates: Partial<Person>) => {
        let invalidName = false;
        const result = await mutateEntities({ set, debouncedSave }, {
            collection: 'people',
            select: (state) => state._allPeople.filter((person) => person.id === id),
            buildUpdates: (person) => {
                const nextName = updates.name !== undefined ? normalizePersonName(updates.name) : person.name;
                if (!nextName) {
                    invalidName = true;
                    return null;
                }
                const hasNoteUpdate = Object.prototype.hasOwnProperty.call(updates, 'note');
                const hasReferenceLinkUpdate = Object.prototype.hasOwnProperty.call(updates, 'referenceLink');
                const normalizedUpdates: Partial<Person> = {
                    ...updates,
                    name: nextName,
                    note: hasNoteUpdate ? normalizePersonNote(updates.note) : person.note,
                    referenceLink: hasReferenceLinkUpdate ? normalizePersonReferenceLink(updates.referenceLink) : person.referenceLink,
                };
                return normalizedUpdates;
            },
            missingMessage: 'Person not found',
        });
        if (!result.success) {
            const message = result.error ?? 'Person not found';
            logWarn('updatePerson skipped: person not found', {
                scope: 'store',
                category: 'validation',
                context: { id },
            });
            set({ error: message });
            return actionFail(message);
        }
        if (invalidName) {
            const message = 'Person name is required';
            set({ error: message });
            return actionFail(message);
        }
        return result;
    },

    renamePerson: async (id: string, name: string, options?: { updateTasks?: boolean }) => {
        const nextName = normalizePersonName(name);
        if (!nextName) {
            const message = 'Person name is required';
            set({ error: message });
            return actionFail(message);
        }
        const now = new Date().toISOString();
        const changeAt = Date.now();
        let missingPerson = false;
        set((state) => {
            const person = state._allPeople.find((item) => item.id === id);
            if (!person) {
                missingPerson = true;
                return state;
            }
            const oldKey = getPersonNameKey(person.name);
            const nextKey = getPersonNameKey(nextName);
            if (oldKey === nextKey && person.name === nextName) return state;
            const deviceState = ensureDeviceId(state.settings);
            const existingTarget = state._allPeople.find((item) => item.id !== id && !item.deletedAt && getPersonNameKey(item.name) === nextKey);
            let nextAllPeople: Person[];
            if (existingTarget) {
                const deletedPerson: Person = {
                    ...person,
                    deletedAt: now,
                    updatedAt: now,
                    rev: nextRevision(person.rev),
                    revBy: deviceState.deviceId,
                };
                const mergedPerson: Person = {
                    ...existingTarget,
                    note: existingTarget.note ?? person.note,
                    referenceLink: existingTarget.referenceLink ?? person.referenceLink,
                    updatedAt: now,
                    rev: nextRevision(existingTarget.rev),
                    revBy: deviceState.deviceId,
                };
                nextAllPeople = state._allPeople.map((item) => {
                    if (item.id === id) return deletedPerson;
                    if (item.id === existingTarget.id) return mergedPerson;
                    return item;
                });
            } else {
                nextAllPeople = state._allPeople.map((item) => (
                    item.id === id
                        ? {
                            ...item,
                            name: nextName,
                            updatedAt: now,
                            rev: nextRevision(item.rev),
                            revBy: deviceState.deviceId,
                        }
                        : item
                ));
            }

            let nextAllTasks = state._allTasks;
            if (options?.updateTasks !== false) {
                nextAllTasks = state._allTasks.map((task) => {
                    if (task.deletedAt || getPersonNameKey(task.assignedTo) !== oldKey) return task;
                    return {
                        ...task,
                        assignedTo: nextName,
                        updatedAt: now,
                        rev: nextRevision(task.rev),
                        revBy: deviceState.deviceId,
                    };
                });
            }

            clearDerivedCache();
            persist(set, debouncedSave, state, {
                people: nextAllPeople,
                tasks: nextAllTasks,
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            });
            return {
                _allPeople: nextAllPeople,
                _allTasks: nextAllTasks,
                lastDataChangeAt: getNextDataChangeAt(state.lastDataChangeAt, changeAt),
                ...(deviceState.updated ? { settings: deviceState.settings } : {}),
            };
        });
        if (missingPerson) {
            const message = 'Person not found';
            set({ error: message });
            return actionFail(message);
        }
        return actionOk();
    },

    deletePerson: async (id: string) => {
        const result = await mutateEntities({ set, debouncedSave }, {
            collection: 'people',
            select: (state) => state._allPeople.filter((person) => person.id === id && !person.deletedAt),
            buildUpdates: (_person, { now }) => ({ deletedAt: now }),
            missingMessage: 'Person not found',
        });
        if (!result.success) {
            const message = result.error ?? 'Person not found';
            set({ error: message });
            return actionFail(message);
        }
        return result;
    },

    restorePerson: async (id: string) => {
        let duplicateActivePerson = false;
        const result = await mutateEntities({ set, debouncedSave }, {
            collection: 'people',
            select: (state) => state._allPeople.filter((person) => person.id === id),
            buildUpdates: (person, { state }) => {
                if (!person.deletedAt) return null;
                const restoredNameKey = getPersonNameKey(person.name);
                if (state._allPeople.some((item) => (
                    item.id !== id
                    && !item.deletedAt
                    && getPersonNameKey(item.name) === restoredNameKey
                ))) {
                    duplicateActivePerson = true;
                    return null;
                }
                return { deletedAt: undefined };
            },
            missingMessage: 'Person not found',
        });
        if (!result.success) {
            const message = result.error ?? 'Person not found';
            set({ error: message });
            return actionFail(message);
        }
        if (duplicateActivePerson) {
            const message = 'A person with this name already exists';
            set({ error: message });
            return actionFail(message);
        }
        return result;
    },
});
