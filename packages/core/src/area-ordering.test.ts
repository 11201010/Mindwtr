import { describe, expect, it } from 'vitest';
import { areaOrderIdsForIntent } from './area-ordering';

const areas = [
    { id: 'a', name: 'Zulu', color: undefined },
    { id: 'b', name: 'alpha', color: '#FF0000' },
    { id: 'c', name: 'Alpha', color: '#ff0000' },
    { id: 'd', name: 'Beta', color: '#00ff00' },
];

describe('Area manager ordering', () => {
    it('sorts with the RN name and color comparators, retaining stable ties', () => {
        expect(areaOrderIdsForIntent(areas, { kind: 'sortName' }))
            .toEqual([...areas].sort((a, b) => a.name.localeCompare(b.name)).map((row) => row.id));
        expect(areaOrderIdsForIntent(areas, { kind: 'sortColor' })).toEqual(['d', 'b', 'c', 'a']);
    });

    it('moves one displayed Area up and refuses the first row or unknown ID', () => {
        expect(areaOrderIdsForIntent(areas, { kind: 'moveUp', areaId: 'c' })).toEqual(['a', 'c', 'b', 'd']);
        expect(areaOrderIdsForIntent(areas, { kind: 'moveUp', areaId: 'a' })).toBeNull();
        expect(areaOrderIdsForIntent(areas, { kind: 'moveUp', areaId: 'missing' })).toBeNull();
    });
});
