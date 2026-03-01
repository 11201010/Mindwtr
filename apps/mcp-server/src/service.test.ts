import { describe, expect, test } from 'bun:test';

import { createService } from './service.js';

describe('mcp service', () => {
  test('delegates read operations through query deps', async () => {
    const fakeDb = {} as any;
    const deps = {
      openMindwtrDb: async () => ({ db: fakeDb }),
      closeDb: () => undefined,
      listTasks: () => [{ id: 't1', title: 'Task', status: 'inbox', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
      listProjects: () => [{ id: 'p1', title: 'Project' }],
      getTask: () => ({ id: 't1', title: 'Task', status: 'inbox', createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
      parseQuickAdd: () => ({ title: '', props: {} }),
      runCoreService: async (_options: any, fn: any) =>
        fn({
          addTask: async () => ({ id: 't1' }),
          updateTask: async () => ({ id: 't1' }),
          completeTask: async () => ({ id: 't1' }),
          deleteTask: async () => ({ id: 't1' }),
          restoreTask: async () => ({ id: 't1' }),
        }),
    };
    const service = createService({ readonly: true }, deps as any);

    const tasks = await service.listTasks({});
    const projects = await service.listProjects();
    const task = await service.getTask({ id: 't1' });

    expect(tasks).toHaveLength(1);
    expect(projects).toHaveLength(1);
    expect(task.id).toBe('t1');
  });

  test('uses quick-add parser and forwards merged props to core addTask', async () => {
    let receivedAddTaskInput: any = null;
    let quickAddCalls = 0;
    const fakeDb = {} as any;
    const deps = {
      openMindwtrDb: async () => ({ db: fakeDb }),
      closeDb: () => undefined,
      listTasks: () => [],
      listProjects: () => [{ id: 'p1', title: 'Home' }],
      getTask: () => {
        throw new Error('not used');
      },
      parseQuickAdd: () => {
        quickAddCalls += 1;
        return {
          title: 'Buy milk',
          props: { projectId: 'p1', contexts: ['@errands'] },
        };
      },
      runCoreService: async (_options: any, fn: any) =>
        fn({
          addTask: async (input: any) => {
            receivedAddTaskInput = input;
            return {
              id: 'created',
              title: input.title,
              status: input.props?.status ?? 'inbox',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            };
          },
          updateTask: async () => ({ id: 't1' }),
          completeTask: async () => ({ id: 't1' }),
          deleteTask: async () => ({ id: 't1' }),
          restoreTask: async () => ({ id: 't1' }),
        }),
    };
    const service = createService({ readonly: false }, deps as any);

    await service.addTask({
      quickAdd: 'Buy milk +Home',
      status: 'next',
      tags: ['#weekly'],
    });

    expect(quickAddCalls).toBe(1);
    expect(receivedAddTaskInput.title).toBe('Buy milk');
    expect(receivedAddTaskInput.props.status).toBe('next');
    expect(receivedAddTaskInput.props.projectId).toBe('p1');
    expect(receivedAddTaskInput.props.contexts).toEqual(['@errands']);
    expect(receivedAddTaskInput.props.tags).toEqual(['#weekly']);
  });

  test('maps updateTask inputs and closes shared db handle', async () => {
    let closedDbCount = 0;
    let receivedUpdateInput: any = null;
    const fakeDb = {} as any;
    const deps = {
      openMindwtrDb: async () => ({ db: fakeDb }),
      closeDb: () => {
        closedDbCount += 1;
      },
      listTasks: () => [],
      listProjects: () => [],
      getTask: () => ({ id: 't1', title: 'Task', status: 'inbox', createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
      parseQuickAdd: () => ({ title: '', props: {} }),
      runCoreService: async (_options: any, fn: any) =>
        fn({
          addTask: async () => ({ id: 't1' }),
          updateTask: async (input: any) => {
            receivedUpdateInput = input;
            return {
              id: input.id,
              title: 'Updated',
              status: 'next',
              createdAt: '2026-01-01',
              updatedAt: '2026-01-02',
            };
          },
          completeTask: async () => ({ id: 't1' }),
          deleteTask: async () => ({ id: 't1' }),
          restoreTask: async () => ({ id: 't1' }),
        }),
    };
    const service = createService({ readonly: false }, deps as any);

    await service.listTasks({});
    await service.updateTask({
      id: 't1',
      status: 'next',
      contexts: null,
      tags: null,
      projectId: null,
      dueDate: null,
      startTime: null,
    } as any);
    await service.close();

    expect(receivedUpdateInput).toBeTruthy();
    expect(receivedUpdateInput.id).toBe('t1');
    expect(receivedUpdateInput.updates.status).toBe('next');
    expect(receivedUpdateInput.updates.contexts).toEqual([]);
    expect(receivedUpdateInput.updates.tags).toEqual([]);
    expect(receivedUpdateInput.updates.projectId).toBeUndefined();
    expect(closedDbCount).toBe(1);
  });

  test('rejects addTask input when both title and quickAdd are provided', async () => {
    const fakeDb = {} as any;
    const deps = {
      openMindwtrDb: async () => ({ db: fakeDb }),
      closeDb: () => undefined,
      listTasks: () => [],
      listProjects: () => [],
      getTask: () => ({ id: 't1', title: 'Task', status: 'inbox', createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
      parseQuickAdd: () => ({ title: '', props: {} }),
      runCoreService: async (_options: any, fn: any) =>
        fn({
          addTask: async () => ({ id: 't1' }),
          updateTask: async () => ({ id: 't1' }),
          completeTask: async () => ({ id: 't1' }),
          deleteTask: async () => ({ id: 't1' }),
          restoreTask: async () => ({ id: 't1' }),
        }),
    };
    const service = createService({ readonly: false }, deps as any);

    await expect(service.addTask({ title: 'Task', quickAdd: 'Task /next' } as any)).rejects.toThrow(
      'Provide either title or quickAdd, not both'
    );
  });

  test('rejects addTask title when length exceeds max bound', async () => {
    const fakeDb = {} as any;
    const deps = {
      openMindwtrDb: async () => ({ db: fakeDb }),
      closeDb: () => undefined,
      listTasks: () => [],
      listProjects: () => [],
      getTask: () => ({ id: 't1', title: 'Task', status: 'inbox', createdAt: '2026-01-01', updatedAt: '2026-01-01' }),
      parseQuickAdd: () => ({ title: '', props: {} }),
      runCoreService: async (_options: any, fn: any) =>
        fn({
          addTask: async () => ({ id: 't1' }),
          updateTask: async () => ({ id: 't1' }),
          completeTask: async () => ({ id: 't1' }),
          deleteTask: async () => ({ id: 't1' }),
          restoreTask: async () => ({ id: 't1' }),
        }),
    };
    const service = createService({ readonly: false }, deps as any);
    const longTitle = 'x'.repeat(501);

    await expect(service.addTask({ title: longTitle } as any)).rejects.toThrow(
      'Task title too long (max 500 characters)'
    );
  });
});
