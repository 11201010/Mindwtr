import { describe, expect, it } from 'vitest';
import { matchesHierarchicalToken, normalizePrefixedToken, taskMatchesContextOrTagSelection } from './hierarchy-utils';
import type { Task } from './types';

describe('hierarchy utils', () => {
    it('matches exact tokens and slash-delimited descendants', () => {
        expect(matchesHierarchicalToken('@work', '@work')).toBe(true);
        expect(matchesHierarchicalToken('@work', '@work/meetings')).toBe(true);
        expect(matchesHierarchicalToken('#ops', '#ops/oncall')).toBe(true);
    });

    it('does not match siblings or plain prefixes', () => {
        expect(matchesHierarchicalToken('@work', '@home/meetings')).toBe(false);
        expect(matchesHierarchicalToken('@work', '@workshop')).toBe(false);
        expect(matchesHierarchicalToken('#ops', '#operations')).toBe(false);
    });

    it('normalizes missing token prefixes', () => {
        expect(normalizePrefixedToken('work/meetings', '@')).toBe('@work/meetings');
        expect(normalizePrefixedToken('#ops/oncall', '#')).toBe('#ops/oncall');
    });

    it('matches combined contexts and tags once per task with All and Any', () => {
        const tasks = [
            { contexts: ['@alice'], tags: [] },
            { contexts: [], tags: ['#bob'] },
            { contexts: ['@alice/office'], tags: ['#bob/work'] },
            { contexts: ['@other'], tags: [] },
        ] as Task[];
        const selected = ['@alice', '#bob'];
        expect(tasks.map((task) => taskMatchesContextOrTagSelection(task, selected, 'all')))
            .toEqual([false, false, true, false]);
        expect(tasks.map((task) => taskMatchesContextOrTagSelection(task, selected, 'any')))
            .toEqual([true, true, true, false]);
    });
});
