import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const routerMocks = vi.hoisted(() => ({
    navigate: vi.fn(),
}));

vi.mock('expo-router', () => ({
    router: routerMocks,
}));

let openContextsScreen: typeof import('./task-meta-navigation').openContextsScreen;
let openProjectScreen: typeof import('./task-meta-navigation').openProjectScreen;

describe('task-meta-navigation', () => {
    beforeAll(async () => {
        ({ openContextsScreen, openProjectScreen } = await import('./task-meta-navigation'));
    });

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('navigates to the project screen', () => {
        openProjectScreen('project-1');

        expect(routerMocks.navigate).toHaveBeenCalledWith({
            pathname: '/projects-screen',
            params: { projectId: 'project-1' },
        });
    });

    it('navigates to the contexts screen', () => {
        openContextsScreen('@health');

        expect(routerMocks.navigate).toHaveBeenCalledWith({
            pathname: '/contexts',
            params: { token: '@health' },
        });
    });

    it('ignores empty navigation inputs', () => {
        openProjectScreen('');
        openContextsScreen('');

        expect(routerMocks.navigate).not.toHaveBeenCalled();
    });
});
