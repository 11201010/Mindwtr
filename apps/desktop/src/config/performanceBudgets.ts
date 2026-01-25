import type { PerformanceMetrics } from '../hooks/usePerformanceMonitor';
import { logWarn } from '../lib/app-log';

export interface PerformanceBudget {
    mountTime: number;
    interactionTime: number;
    maxUseMemo: number;
    maxUseEffect: number;
    maxRenders: number;
}

export const PERFORMANCE_BUDGETS: Record<string, PerformanceBudget> = {
    simple: {
        mountTime: 50,
        interactionTime: 16,
        maxUseMemo: 5,
        maxUseEffect: 3,
        maxRenders: 60,
    },
    complex: {
        mountTime: 100,
        interactionTime: 32,
        maxUseMemo: 10,
        maxUseEffect: 5,
        maxRenders: 30,
    },
    settings: {
        mountTime: 150,
        interactionTime: 50,
        maxUseMemo: 8,
        maxUseEffect: 8,
        maxRenders: 10,
    },
};

export function checkBudget(
    componentName: string,
    metrics: PerformanceMetrics,
    budgetType: keyof typeof PERFORMANCE_BUDGETS,
): boolean {
    const budget = PERFORMANCE_BUDGETS[budgetType];
    const violations: string[] = [];

    if (metrics.mountTime > budget.mountTime) {
        violations.push(`Mount time ${metrics.mountTime.toFixed(2)}ms exceeds budget ${budget.mountTime}ms`);
    }

    if (metrics.useMemoCount > budget.maxUseMemo) {
        violations.push(`${metrics.useMemoCount} useMemo hooks exceeds budget ${budget.maxUseMemo}`);
    }

    if (metrics.useEffectCount > budget.maxUseEffect) {
        violations.push(`${metrics.useEffectCount} useEffect hooks exceeds budget ${budget.maxUseEffect}`);
    }

    if (violations.length > 0) {
        void logWarn(`[Budget] ${componentName} budget violations`, {
            scope: 'perf',
            extra: { violations: violations.join('; ') },
        });
        return false;
    }

    return true;
}
