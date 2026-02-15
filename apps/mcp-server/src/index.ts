#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod';

import { createService } from './service.js';

type LogLevel = 'info' | 'error';
type LogEntry = {
  ts: string;
  level: LogLevel;
  scope: 'mcp';
  message: string;
  context?: Record<string, unknown>;
};

const writeLog = (entry: LogEntry) => {
  const line = `${JSON.stringify(entry)}\n`;
  if (entry.level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
};

const logError = (message: string, error?: unknown) => {
  const context: Record<string, unknown> = {};
  if (error instanceof Error) {
    context.error = error.message;
    if (error.stack) context.stack = error.stack;
  } else if (error !== undefined) {
    context.error = String(error);
  }
  writeLog({
    ts: new Date().toISOString(),
    level: 'error',
    scope: 'mcp',
    message,
    context: Object.keys(context).length ? context : undefined,
  });
};

const args = process.argv.slice(2);

const parseArgs = (argv: string[]) => {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || !arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
};

const flags = parseArgs(args);

const dbPath = typeof flags.db === 'string' ? flags.db : undefined;
const allowWrite = Boolean(flags.write || flags.allowWrite || flags.allowWrites);
const readonly = Boolean(flags.readonly) || !allowWrite;
const keepAlive = !(flags.nowait || flags.noWait);
const service = createService({ dbPath, readonly });
const closeService = () => {
  void service.close().catch((error) => {
    logError('Failed to close database connection', error);
  });
};

process.on('exit', () => {
  closeService();
});
process.on('SIGINT', () => {
  closeService();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeService();
  process.exit(0);
});

const server = new McpServer({
  name: 'mindwtr-mcp-server',
  version: '0.1.0',
});

const taskStatusSchema = z.enum(['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived']);
const taskStatusOrAllSchema = z.enum(['inbox', 'next', 'waiting', 'someday', 'reference', 'done', 'archived', 'all']);

const listTasksSchema = z.object({
  status: taskStatusOrAllSchema.optional(),
  projectId: z.string().optional(),
  includeDeleted: z.boolean().optional(),
  limit: z.number().int().optional(),
  offset: z.number().int().optional(),
  search: z.string().optional(),
  dueDateFrom: z.string().optional(),
  dueDateTo: z.string().optional(),
  sortBy: z.enum(['updatedAt', 'createdAt', 'dueDate', 'title', 'priority']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
});

// Note: Don't use .refine() as it breaks MCP SDK's JSON schema conversion
const addTaskSchema = z.object({
  title: z.string().optional().describe('Task title'),
  quickAdd: z.string().optional().describe('Quick-add string with natural language parsing (e.g. "Buy milk @errands #shopping /due:tomorrow +ProjectName")'),
  status: taskStatusSchema.optional().describe('Task status: inbox, next, waiting, someday, reference, done, archived'),
  projectId: z.string().optional().describe('Project ID to assign the task to'),
  dueDate: z.string().optional().describe('Due date in ISO format'),
  startTime: z.string().optional().describe('Start time in ISO format'),
  contexts: z.array(z.string()).optional().describe('Context tags (e.g. ["@home", "@work"])'),
  tags: z.array(z.string()).optional().describe('Tags (e.g. ["#urgent", "#personal"])'),
  description: z.string().optional().describe('Task description/notes'),
  priority: z.string().optional().describe('Priority level'),
  timeEstimate: z.string().optional().describe('Time estimate (e.g. "30m", "2h")'),
});
const validateAddTask = (data: z.infer<typeof addTaskSchema>) => {
  if (!data.title && !data.quickAdd) {
    throw new Error('Either title or quickAdd is required');
  }
};

const completeTaskSchema = z.object({
  id: z.string(),
});
const updateTaskSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  status: taskStatusSchema.optional(),
  projectId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  startTime: z.string().nullable().optional(),
  contexts: z.array(z.string()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  description: z.string().nullable().optional(),
  priority: z.string().nullable().optional(),
  timeEstimate: z.string().nullable().optional(),
  reviewAt: z.string().nullable().optional(),
  isFocusedToday: z.boolean().optional(),
});

const deleteTaskSchema = z.object({
  id: z.string(),
});

const getTaskSchema = z.object({
  id: z.string(),
  includeDeleted: z.boolean().optional(),
});

const restoreTaskSchema = z.object({
  id: z.string(),
});

const listProjectsSchema = z.object({});

server.registerTool(
  'mindwtr.list_tasks',
  {
    description: 'List tasks from the local Mindwtr SQLite database. Supports filtering by status, project, date range, and search. Supports sorting by various fields.',
    inputSchema: listTasksSchema,
  },
  async (input) => {
    const tasks = await service.listTasks({
      ...input,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify({ tasks }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.list_projects',
  {
    description: 'List projects from the local Mindwtr SQLite database.',
    inputSchema: listProjectsSchema,
  },
  async () => {
    const projects = await service.listProjects();
    return {
      content: [{ type: 'text', text: JSON.stringify({ projects }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.add_task',
  {
    description: 'Add a task to the local Mindwtr SQLite database.',
    inputSchema: addTaskSchema,
  },
  async (input) => {
    if (readonly) throw new Error('Database opened read-only. Start the server with --write to enable edits.');
    validateAddTask(input);
    const task = await service.addTask({
      ...input,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.update_task',
  {
    description: 'Update a task in the local Mindwtr SQLite database.',
    inputSchema: updateTaskSchema,
  },
  async (input) => {
    if (readonly) throw new Error('Database opened read-only. Start the server with --write to enable edits.');
    const task = await service.updateTask({
      ...input,
    });
    return {
      content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.complete_task',
  {
    description: 'Mark a task as done in the local Mindwtr SQLite database.',
    inputSchema: completeTaskSchema,
  },
  async (input) => {
    if (readonly) throw new Error('Database opened read-only. Start the server with --write to enable edits.');
    const task = await service.completeTask(input.id);
    return {
      content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.delete_task',
  {
    description: 'Soft-delete a task in the local Mindwtr SQLite database.',
    inputSchema: deleteTaskSchema,
  },
  async (input) => {
    if (readonly) throw new Error('Database opened read-only. Start the server with --write to enable edits.');
    const task = await service.deleteTask(input.id);
    return {
      content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.get_task',
  {
    description: 'Get a single task by ID from the local Mindwtr SQLite database.',
    inputSchema: getTaskSchema,
  },
  async (input) => {
    const task = await service.getTask({ id: input.id, includeDeleted: input.includeDeleted });
    return {
      content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    };
  },
);

server.registerTool(
  'mindwtr.restore_task',
  {
    description: 'Restore a soft-deleted task in the local Mindwtr SQLite database.',
    inputSchema: restoreTaskSchema,
  },
  async (input) => {
    if (readonly) throw new Error('Database opened read-only. Start the server with --write to enable edits.');
    const task = await service.restoreTask(input.id);
    return {
      content: [{ type: 'text', text: JSON.stringify({ task }, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  if (keepAlive) {
    process.stdin.resume();
    process.stdin.on('end', () => process.exit(0));
    setInterval(() => {}, 1 << 30);
  }
}

main().catch((error) => {
  logError('Failed to start server', error);
  process.exit(1);
});
