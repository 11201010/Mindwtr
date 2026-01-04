export const SQLITE_SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT,
  taskMode TEXT,
  startTime TEXT,
  dueDate TEXT,
  recurrence TEXT,
  pushCount INTEGER,
  tags TEXT,
  contexts TEXT,
  checklist TEXT,
  description TEXT,
  attachments TEXT,
  location TEXT,
  projectId TEXT,
  isFocusedToday INTEGER,
  timeEstimate TEXT,
  reviewAt TEXT,
  completedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  color TEXT NOT NULL,
  tagIds TEXT,
  isSequential INTEGER,
  isFocused INTEGER,
  supportNotes TEXT,
  attachments TEXT,
  reviewAt TEXT,
  areaId TEXT,
  areaTitle TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  deletedAt TEXT
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  orderNum INTEGER NOT NULL,
  createdAt TEXT,
  updatedAt TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_tasks_deletedAt ON tasks(deletedAt);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
CREATE INDEX IF NOT EXISTS idx_projects_areaId ON projects(areaId);
`;
