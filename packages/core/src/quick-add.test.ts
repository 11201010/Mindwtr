import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from './quick-add';

describe('quick-add', () => {
    it('parses status, due, note, tags, contexts', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const result = parseQuickAdd('Call mom @phone #family /next /due:tomorrow 5pm /note:ask about trip', undefined, now);

        expect(result.title).toBe('Call mom');
        expect(result.props.status).toBe('next');
        expect(result.props.contexts).toEqual(['@phone']);
        expect(result.props.tags).toEqual(['#family']);
        expect(result.props.description).toBe('ask about trip');
        const expectedLocal = new Date(2025, 0, 2, 17, 0, 0, 0).toISOString();
        expect(result.props.dueDate).toBe(expectedLocal);
    });

    it('parses /start and /review with the same natural date parser as /due', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const result = parseQuickAdd(
            'Review proposal /start:tomorrow /review:friday /due:next week',
            undefined,
            now
        );

        expect(result.title).toBe('Review proposal');
        expect(result.props.startTime).toBe(new Date(2025, 0, 2, 0, 0, 0, 0).toISOString());
        expect(result.props.reviewAt).toBe(new Date(2025, 0, 3, 0, 0, 0, 0).toISOString());
        const expectedHour = now.getHours();
        const expectedMinute = now.getMinutes();
        expect(result.props.dueDate).toBe(new Date(2025, 0, 8, expectedHour, expectedMinute, 0, 0).toISOString());
    });

    it('parses abbreviated weekday commands like /start:mon', () => {
        const now = new Date('2026-02-27T09:40:00Z');
        const result = parseQuickAdd('Task /start:mon', undefined, now);
        expect(result.props.startTime).toBe(new Date(2026, 2, 2, 0, 0, 0, 0).toISOString());
        expect(result.invalidDateCommands).toBeUndefined();
    });

    it('reports invalid date commands instead of silently dropping them', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const result = parseQuickAdd('Task /start:monx /due:tomorrow', undefined, now);
        expect(result.invalidDateCommands).toEqual(['/start:monx']);
        expect(result.props.startTime).toBeUndefined();
        expect(result.props.dueDate).toBe(new Date(2025, 0, 2, now.getHours(), now.getMinutes(), 0, 0).toISOString());
    });

    it('matches project by title when provided', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const projects = [
            {
                id: 'p1',
                title: 'MyProject',
                status: 'active',
                color: '#000000',
                tagIds: [],
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            },
        ];

        const result = parseQuickAdd('Write spec +MyProject', projects as any, now);
        expect(result.title).toBe('Write spec');
        expect(result.props.projectId).toBe('p1');
        expect(result.projectTitle).toBeUndefined();
    });

    it('captures project title when project is missing', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const projects = [
            {
                id: 'p1',
                title: 'Existing',
                status: 'active',
                color: '#000000',
                tagIds: [],
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            },
        ];

        const result = parseQuickAdd('Draft outline +NewProject', projects as any, now);
        expect(result.title).toBe('Draft outline');
        expect(result.props.projectId).toBeUndefined();
        expect(result.projectTitle).toBe('NewProject');
    });

    it('captures multi-word project titles', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const projects = [
            {
                id: 'p1',
                title: 'Project Name',
                status: 'active',
                color: '#000000',
                tagIds: [],
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
            },
        ];

        const result = parseQuickAdd('Plan roadmap +Project Name /next', projects as any, now);
        expect(result.title).toBe('Plan roadmap');
        expect(result.props.projectId).toBe('p1');
        expect(result.projectTitle).toBeUndefined();
    });

    it('matches area by name when provided', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const areas = [
            { id: 'a1', name: 'Work', color: '#111111', order: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() },
            { id: 'a2', name: 'Personal', color: '#222222', order: 1, createdAt: now.toISOString(), updatedAt: now.toISOString() },
        ];

        const result = parseQuickAdd('Draft report !Work /next', undefined, now, areas as any);
        expect(result.title).toBe('Draft report');
        expect(result.props.areaId).toBe('a1');

        const explicitResult = parseQuickAdd('Plan budget /area:Personal /next', undefined, now, areas as any);
        expect(explicitResult.title).toBe('Plan budget');
        expect(explicitResult.props.areaId).toBe('a2');
    });

    it('supports unicode tags and contexts', () => {
        const now = new Date('2025-01-01T10:00:00Z');
        const result = parseQuickAdd('计划 @工作 #项目 /next', undefined, now);

        expect(result.title).toBe('计划');
        expect(result.props.contexts).toEqual(['@工作']);
        expect(result.props.tags).toEqual(['#项目']);
        expect(result.props.status).toBe('next');
    });
});
