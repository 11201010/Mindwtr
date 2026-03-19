import { router } from 'expo-router';

const navigateToTaskMetaScreen = (
    pathname: '/projects-screen' | '/contexts',
    params: { projectId?: string; token?: string }
) => {
    // Use public NAVIGATE semantics so repeated same-screen taps update params
    // without building an unbounded back stack.
    router.navigate({ pathname, params });
};

export function openProjectScreen(projectId: string) {
    if (!projectId) return;
    navigateToTaskMetaScreen('/projects-screen', { projectId });
}

export function openContextsScreen(token: string) {
    if (!token) return;
    navigateToTaskMetaScreen('/contexts', { token });
}
