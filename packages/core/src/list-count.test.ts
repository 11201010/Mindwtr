import { describe, expect, it } from 'vitest';
import { formatListItemCountNoun } from './list-count';

describe('list count noun', () => {
    it('chooses the singular noun for one task', () => {
        const t = (key: string) => ({ 'list.countTaskSingular': 'task', 'common.tasks': 'tasks' }[key] ?? key);
        expect(formatListItemCountNoun(1, 'task', t)).toBe('task');
        expect(formatListItemCountNoun(2, 'task', t)).toBe('tasks');
    });
});
