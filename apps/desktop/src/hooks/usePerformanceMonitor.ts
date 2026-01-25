import { useEffect, useRef } from 'react';
import { logWarn } from '../lib/app-log';

export interface PerformanceMetrics {
    mountTime: number;
    firstRenderTime: number;
    updateCount: number;
    lastUpdateTime: number;
    useMemoCount: number;
    useEffectCount: number;
}

const shouldEnable = (enabled?: boolean) => {
    if (typeof enabled === 'boolean') return enabled;
    return Boolean(import.meta.env?.DEV);
};

export function usePerformanceMonitor(componentName: string, enabled?: boolean) {
    const isEnabled = shouldEnable(enabled);
    const metricsRef = useRef<PerformanceMetrics>({
        mountTime: 0,
        firstRenderTime: 0,
        updateCount: 0,
        lastUpdateTime: 0,
        useMemoCount: 0,
        useEffectCount: 0,
    });
    const mountTimeRef = useRef(performance.now());
    const renderCountRef = useRef(0);

    useEffect(() => {
        if (!isEnabled) return;

        const mountDuration = performance.now() - mountTimeRef.current;
        if (renderCountRef.current === 0) {
            metricsRef.current.firstRenderTime = mountDuration;
            metricsRef.current.mountTime = mountDuration;
            if (mountDuration > 50) {
                void logWarn(`[Perf] ${componentName} slow mount: ${mountDuration.toFixed(2)}ms`, {
                    scope: 'perf',
                });
            }
        } else {
            metricsRef.current.updateCount += 1;
            metricsRef.current.lastUpdateTime = performance.now();
        }

        renderCountRef.current += 1;
    });

    const trackUseMemo = () => {
        if (!isEnabled) return;
        metricsRef.current.useMemoCount += 1;
    };

    const trackUseEffect = () => {
        if (!isEnabled) return;
        metricsRef.current.useEffectCount += 1;
    };

    const measure = <T,>(label: string, fn: () => T): T => {
        if (!isEnabled) return fn();
        const start = performance.now();
        const result = fn();
        const duration = performance.now() - start;
        if (duration > 10) {
            void logWarn(`[Perf] ${componentName}.${label}: ${duration.toFixed(2)}ms`, {
                scope: 'perf',
            });
        }
        return result;
    };

    return {
        enabled: isEnabled,
        measure,
        trackUseMemo,
        trackUseEffect,
        metrics: metricsRef.current,
    };
}
