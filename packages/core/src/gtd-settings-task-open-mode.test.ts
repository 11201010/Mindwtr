import { describe, expect, it } from 'vitest';
import { readGtdTaskOpenMode, resolveTaskOpenTab } from './gtd-settings-model';

describe('shared task opening policy', () => {
    it.each([
        ['automatic', 'task', false, false, 'task'],
        ['automatic', 'view', false, false, 'view'],
        ['preview', 'task', false, false, 'view'],
        ['preview', 'view', false, false, 'view'],
        ['edit', 'task', false, false, 'task'],
        ['edit', 'view', false, false, 'task'],
        ['preview', 'view', false, true, 'task'],
        ['automatic', 'view', false, true, 'task'],
        ['edit', 'task', true, true, 'view'],
        ['edit', 'view', true, false, 'view'],
    ] as const)('%s / %s / readOnly %s / explicitEdit %s -> %s',
        (mode, automaticTab, readOnly, explicitEdit, tab) => {
            expect(resolveTaskOpenTab({ mode, automaticTab, readOnly, explicitEdit })).toBe(tab);
        });

    it.each([null, '', 'unknown', 'Preview', 1])('normalizes invalid raw %s to automatic', (raw) => {
        expect(readGtdTaskOpenMode(raw)).toBe('automatic');
        expect(resolveTaskOpenTab({ mode: readGtdTaskOpenMode(raw), automaticTab: 'task' })).toBe('task');
    });
});
