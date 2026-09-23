/**
 * A task can render as several rows at once — Focus grouped by tags shows a
 * multi-tag task once per tag group. The inline editor is driven by the global
 * editingTaskId, so without a claim every row instance of that task opens its
 * own editor, and the untouched duplicates then treat clicks inside the real
 * editor as outside clicks and tear the whole session down. The claim keeps
 * an editing session on exactly one row instance per task.
 */
const activeSessions = new Map<string, object>();
let activeExitRequest: ((action: () => void) => void) | null = null;

export function registerTaskEditExitRequest(request: (action: () => void) => void): () => void {
    activeExitRequest = request;
    return () => {
        if (activeExitRequest === request) activeExitRequest = null;
    };
}

export function runAfterTaskEditExit(action: () => void): void {
    if (activeExitRequest) activeExitRequest(action);
    else action();
}

export function tryClaimTaskEditSession(taskId: string, owner: object): boolean {
    const current = activeSessions.get(taskId);
    if (current && current !== owner) return false;
    activeSessions.set(taskId, owner);
    return true;
}

export function releaseTaskEditSession(taskId: string, owner: object): void {
    if (activeSessions.get(taskId) === owner) {
        activeSessions.delete(taskId);
    }
}
