import { describe, expect, it } from 'vitest';
import {
    buildPersonSearchQuery,
    getPersonOptionNames,
    getPersonSuggestionNames,
    getPersonTaskCounts,
    normalizePeopleForLoad,
    taskMatchesPerson,
} from './people';
import { mergeAppDataWithStats } from './sync';
import { validateMergedSyncData } from './sync-normalization';
import type { AppData, Person, Task } from './types';

const task = (overrides: Partial<Task>): Task => ({
    id: overrides.id ?? 'task-1',
    title: overrides.title ?? 'Task',
    status: overrides.status ?? 'next',
    tags: [],
    contexts: [],
    createdAt: overrides.createdAt ?? '2026-04-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-01T00:00:00.000Z',
    ...overrides,
});

const person = (overrides: Partial<Person>): Person => ({
    id: overrides.id ?? 'person-1',
    name: overrides.name ?? 'Alex',
    createdAt: overrides.createdAt ?? '2026-04-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-04-01T00:00:00.000Z',
    ...overrides,
});

const appDataWithPeople = (people: Person[]): AppData => ({
    tasks: [],
    projects: [],
    sections: [],
    areas: [],
    people,
    settings: {},
});

describe('people helpers', () => {
    it('matches assignments and exact person contexts once with normalized names', () => {
        const tasks = [
            task({ id: 'assigned', assignedTo: '  Alex   Smith  ' }),
            task({ id: 'context', contexts: ['@ALEX SMITH'] }),
            task({ id: 'both', assignedTo: 'Alex Smith', contexts: ['@alex smith'] }),
            task({ id: 'similar', assignedTo: 'Alex', contexts: ['@Alex Smith/Office', '@Alexandra Smith'] }),
            task({ id: 'ordinary-context', contexts: ['Alex Smith'] }),
            task({ id: 'deleted', assignedTo: 'Alex Smith', deletedAt: '2026-04-02T00:00:00.000Z' }),
            task({ id: 'purged', contexts: ['@Alex Smith'], purgedAt: '2026-04-02T00:00:00.000Z' }),
        ];

        expect(tasks.map((item) => taskMatchesPerson(item, ' alex smith '))).toEqual([
            true, true, true, false, false, false, false,
        ]);
        expect(getPersonTaskCounts(tasks).get('alex smith')).toBe(3);
    });

    it('builds an escaped quoted person search without accepting an empty match', () => {
        expect(buildPersonSearchQuery('  Alex "OR" \\ Ops  ')).toBe('person:"Alex \\"OR\\" \\\\ Ops"');
        expect(taskMatchesPerson(task({ assignedTo: '' }), '   ')).toBe(false);
    });

    it('backfills unique people from task assignments and honors deleted-person tombstones', () => {
        const result = normalizePeopleForLoad(
            [
                person({ id: 'person-alex', name: 'Alex' }),
                person({ id: 'person-sam', name: 'Sam', deletedAt: '2026-04-02T00:00:00.000Z' }),
            ],
            [
                task({ id: 'task-1', assignedTo: 'alex' }),
                task({ id: 'task-2', assignedTo: 'Jordan' }),
                task({ id: 'task-3', assignedTo: 'Sam' }),
                task({ id: 'task-4', assignedTo: 'Casey', deletedAt: '2026-04-02T00:00:00.000Z' }),
            ],
            '2026-04-03T00:00:00.000Z',
            'device-a',
        );

        expect(result.didChange).toBe(true);
        expect(result.people.map((item) => item.name).sort()).toEqual(['Alex', 'Jordan', 'Sam']);
        const jordan = result.people.find((item) => item.name === 'Jordan');
        expect(jordan).toMatchObject({
            createdAt: '2026-04-03T00:00:00.000Z',
            updatedAt: '2026-04-03T00:00:00.000Z',
            rev: 1,
            revBy: 'device-a',
        });
    });

    it('tombstones duplicate active people by name instead of dropping synced ids', () => {
        const result = normalizePeopleForLoad(
            [
                person({
                    id: 'person-alex-original',
                    name: ' Alex ',
                    rev: 2,
                    revBy: 'device-old',
                    updatedAt: '2026-04-02T00:00:00.000Z',
                }),
                person({
                    id: 'person-alex-duplicate',
                    name: 'alex',
                    note: 'Remote note',
                    referenceLink: ' https://example.com/alex ',
                    rev: 4,
                    revBy: 'device-remote',
                    createdAt: '2026-04-02T00:00:00.000Z',
                    updatedAt: '2026-04-04T00:00:00.000Z',
                }),
            ],
            [],
            '2026-04-05T00:00:00.000Z',
            'device-local',
        );

        expect(result.didChange).toBe(true);
        expect(result.people).toHaveLength(2);
        expect(result.people.filter((item) => !item.deletedAt).map((item) => item.id)).toEqual(['person-alex-original']);
        expect(result.people.find((item) => item.id === 'person-alex-original')).toMatchObject({
            id: 'person-alex-original',
            name: 'Alex',
            note: 'Remote note',
            referenceLink: 'https://example.com/alex',
            rev: 4,
            revBy: 'device-old',
            updatedAt: '2026-04-04T00:00:00.000Z',
        });
        expect(result.people.find((item) => item.id === 'person-alex-duplicate')).toMatchObject({
            id: 'person-alex-duplicate',
            name: 'alex',
            deletedAt: '2026-04-05T00:00:00.000Z',
            updatedAt: '2026-04-05T00:00:00.000Z',
            rev: 5,
            revBy: 'device-local',
        });

        const stableReload = normalizePeopleForLoad(
            result.people,
            [],
            '2026-04-05T00:00:00.000Z',
            'device-local',
        );
        expect(stableReload.didChange).toBe(false);
        expect(stableReload.people).toEqual(result.people);
    });

    it('tombstones a blank-name person once without dropping its synced identity', () => {
        const malformedPerson = person({
            id: 'person-blank',
            name: '   ',
            note: ' Preserve this note ',
            referenceLink: ' https://example.com/blank ',
            rev: 7,
            revBy: 'device-remote',
        });
        const firstLoad = normalizePeopleForLoad(
            [malformedPerson],
            [],
            '2026-04-05T00:00:00.000Z',
            'device-local',
        );

        expect(firstLoad.didChange).toBe(true);
        expect(firstLoad.people).toEqual([
            expect.objectContaining({
                id: 'person-blank',
                name: '__mindwtr_deleted_person__:person-blank',
                note: 'Preserve this note',
                referenceLink: 'https://example.com/blank',
                deletedAt: '2026-04-05T00:00:00.000Z',
                updatedAt: '2026-04-05T00:00:00.000Z',
                rev: 8,
                revBy: 'device-local',
            }),
        ]);

        const stableReload = normalizePeopleForLoad(
            firstLoad.people,
            [],
            '2026-04-06T00:00:00.000Z',
            'device-local',
        );
        expect(stableReload.didChange).toBe(false);
        expect(stableReload.people).toEqual(firstLoad.people);

        const firstMerge = mergeAppDataWithStats(
            appDataWithPeople(firstLoad.people),
            appDataWithPeople([malformedPerson]),
            { nowIso: '2026-04-06T00:00:00.000Z' },
        );
        expect(firstMerge.data.people).toEqual(firstLoad.people);
        expect(validateMergedSyncData(firstMerge.data)).toEqual([]);

        const peerConvergenceMerge = mergeAppDataWithStats(
            appDataWithPeople([malformedPerson]),
            firstMerge.data,
            { nowIso: '2026-04-06T00:00:00.000Z' },
        );
        expect(peerConvergenceMerge.data.people).toEqual(firstLoad.people);

        const stableMerge = mergeAppDataWithStats(
            firstMerge.data,
            peerConvergenceMerge.data,
            { nowIso: '2026-04-06T00:00:00.000Z' },
        );
        expect(stableMerge.stats.people?.conflicts).toBe(0);
        expect(stableMerge.data.people).toEqual(firstLoad.people);
    });

    it('converges after one load normalization across people shapes', () => {
        const firstNow = '2026-04-05T00:00:00.000Z';
        const secondNow = '2026-04-06T00:00:00.000Z';
        const scenarios: Array<{
            name: string;
            people?: Person[];
            tasks: Task[];
            expectFirstChange: boolean;
        }> = [
            {
                name: 'managed person already present',
                people: [person({ id: 'person-alex', name: 'Alex', rev: 2, revBy: 'device-a' })],
                tasks: [task({ id: 'task-alex', assignedTo: 'Alex' })],
                expectFirstChange: false,
            },
            {
                name: 'people field absent with no assignments',
                people: undefined,
                tasks: [task({ id: 'task-unassigned' })],
                expectFirstChange: false,
            },
            {
                name: 'duplicate people by name',
                people: [
                    person({ id: 'person-alex-original', name: 'Alex', rev: 2, revBy: 'device-a' }),
                    person({ id: 'person-alex-duplicate', name: ' alex ', note: 'Remote note', rev: 4, revBy: 'device-b' }),
                ],
                tasks: [],
                expectFirstChange: true,
            },
            {
                name: 'backfilled from assignedTo',
                people: [],
                tasks: [task({ id: 'task-jordan', assignedTo: ' Jordan ' })],
                expectFirstChange: true,
            },
            {
                name: 'malformed timestamps repaired once',
                people: [person({
                    id: 'person-bad-timestamp',
                    name: 'Taylor',
                    createdAt: 42 as unknown as string,
                    updatedAt: null as unknown as string,
                })],
                tasks: [],
                expectFirstChange: true,
            },
        ];

        for (const scenario of scenarios) {
            const firstLoad = normalizePeopleForLoad(scenario.people, scenario.tasks, firstNow, 'device-local');
            expect(firstLoad.didChange, scenario.name).toBe(scenario.expectFirstChange);

            const secondLoad = normalizePeopleForLoad(firstLoad.people, scenario.tasks, secondNow, 'device-local');
            expect(secondLoad.didChange, scenario.name).toBe(false);
            expect(secondLoad.people, scenario.name).toEqual(firstLoad.people);
        }
    });

    it('prefers managed people in options and suggestions while keeping ad hoc task names', () => {
        const people = [
            person({ id: 'person-jordan', name: 'Jordan', updatedAt: '2026-04-01T00:00:00.000Z' }),
        ];
        const tasks = [
            task({ id: 'task-1', assignedTo: 'Alex', updatedAt: '2026-04-04T00:00:00.000Z' }),
            task({ id: 'task-2', assignedTo: 'Jordan', updatedAt: '2026-04-02T00:00:00.000Z' }),
        ];

        expect(getPersonOptionNames(people, tasks)).toEqual(['Jordan', 'Alex']);
        expect(getPersonSuggestionNames(people, tasks, 'jo', 5)).toEqual(['Jordan']);
    });
});
