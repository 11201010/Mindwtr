
import type { Task } from '@focus-gtd/core';

// Order: todo -> next -> in-progress -> done
const STATUS_ORDER: Record<string, number> = {
    'todo': 0,
    'next': 1,
    'waiting': 1, // Treat waiting same level as next? Or lower?
    'someday': 1,
    'in-progress': 2,
    'done': 3,
    'archived': 4
};

// User requested: "todo-next-inprogress-done"
// And "done task should be in the bottom".
// If we follow literally: todo(0) < next(1) < in-progress(2) < done(3).
// This means Todo shows up first? 
// Valid GTD order usually puts Next actions above Todo (Backlog).
// But user explicitly said "following the order todo-next-inprogress-done".
// I will implement this literal order.

export function sortTasks(tasks: Task[]): Task[] {
    return [...tasks].sort((a, b) => {
        // 1. Sort by Status
        const statusA = STATUS_ORDER[a.status] ?? 99;
        const statusB = STATUS_ORDER[b.status] ?? 99;

        if (statusA !== statusB) {
            return statusA - statusB;
        }

        // 2. Sort by Due Date (with due dates first)
        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;
        if (a.dueDate && b.dueDate) {
            const timeA = new Date(a.dueDate).getTime();
            const timeB = new Date(b.dueDate).getTime();
            if (timeA !== timeB) return timeA - timeB;
        }

        // 3. Created At (newest first? or oldest first?)
        // Usually oldest first (FIFO) for tasks
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
}
