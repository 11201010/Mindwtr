import { describe, expect, test } from 'bun:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { parseArgs, registerMindwtrTools } from './index.js';

type RegisteredTool = {
  name: string;
  handler: (input: any) => Promise<any>;
};

const createMockServer = () => {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: (name: string, _meta: any, handler: (input: any) => Promise<any>) => {
      tools.set(name, { name, handler });
    },
  } as unknown as McpServer;
  return { server, tools };
};

const createMockService = () => ({
  listTasks: async () => [{ id: 't1' }],
  listProjects: async () => [{ id: 'p1' }],
  getTask: async () => ({ id: 't1' }),
  addTask: async () => ({ id: 't1' }),
  updateTask: async () => ({ id: 't1' }),
  completeTask: async () => ({ id: 't1' }),
  deleteTask: async () => ({ id: 't1' }),
  restoreTask: async () => ({ id: 't1' }),
  close: async () => undefined,
});

describe('mcp server index', () => {
  test('parses CLI flags', () => {
    const flags = parseArgs(['--db', '/tmp/mindwtr.db', '--write', '--noWait']);
    expect(flags.db).toBe('/tmp/mindwtr.db');
    expect(flags.write).toBe(true);
    expect(flags.noWait).toBe(true);
  });

  test('registers all mindwtr tools', () => {
    const { server, tools } = createMockServer();
    registerMindwtrTools(server, createMockService(), false);
    expect(tools.size).toBe(8);
    expect(tools.has('mindwtr.list_tasks')).toBe(true);
    expect(tools.has('mindwtr.add_task')).toBe(true);
    expect(tools.has('mindwtr.restore_task')).toBe(true);
  });

  test('blocks write tools when readonly', async () => {
    const { server, tools } = createMockServer();
    registerMindwtrTools(server, createMockService(), true);

    const addHandler = tools.get('mindwtr.add_task')?.handler;
    const deleteHandler = tools.get('mindwtr.delete_task')?.handler;
    expect(addHandler).toBeTruthy();
    expect(deleteHandler).toBeTruthy();

    await expect(addHandler?.({ title: 'Task' })).rejects.toThrow('read-only');
    await expect(deleteHandler?.({ id: 't1' })).rejects.toThrow('read-only');
  });

  test('validates add_task requires title or quickAdd', async () => {
    const { server, tools } = createMockServer();
    registerMindwtrTools(server, createMockService(), false);
    const addHandler = tools.get('mindwtr.add_task')?.handler;
    expect(addHandler).toBeTruthy();
    await expect(addHandler?.({})).rejects.toThrow('Either title or quickAdd is required');
  });
});
