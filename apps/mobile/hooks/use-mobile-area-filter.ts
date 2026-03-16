import { useCallback, useEffect, useMemo } from 'react';
import { useTaskStore } from '@mindwtr/core';

import { AREA_FILTER_ALL, AREA_FILTER_NONE, resolveAreaFilter, type AreaFilterValue } from '../lib/area-filter';

let staleAreaFilterResetInFlight: string | null = null;

export function useMobileAreaFilter() {
  const areas = useTaskStore((state) => state.areas);
  const settings = useTaskStore((state) => state.settings);
  const updateSettings = useTaskStore((state) => state.updateSettings);

  const sortedAreas = useMemo(() => (
    [...areas]
      .filter((area) => !area.deletedAt)
      .sort((a, b) => {
        if (a.order !== b.order) return a.order - b.order;
        return a.name.localeCompare(b.name);
      })
  ), [areas]);

  const areaById = useMemo(
    () => new Map(sortedAreas.map((area) => [area.id, area])),
    [sortedAreas],
  );

  const resolvedAreaFilter = useMemo(
    () => resolveAreaFilter(settings?.filters?.areaId, sortedAreas),
    [settings?.filters?.areaId, sortedAreas],
  );
  const didResetDeletedAreaFilter = useMemo(() => {
    const savedAreaFilter = settings?.filters?.areaId;
    if (!savedAreaFilter || savedAreaFilter === AREA_FILTER_ALL || savedAreaFilter === AREA_FILTER_NONE) {
      return false;
    }
    return !sortedAreas.some((area) => area.id === savedAreaFilter);
  }, [settings?.filters?.areaId, sortedAreas]);

  useEffect(() => {
    const staleAreaFilter = settings?.filters?.areaId;
    if (!didResetDeletedAreaFilter || !staleAreaFilter) return;
    if (staleAreaFilterResetInFlight === staleAreaFilter) return;
    staleAreaFilterResetInFlight = staleAreaFilter;
    void updateSettings({
      filters: {
        ...(settings?.filters ?? {}),
        areaId: AREA_FILTER_ALL,
      },
    }).finally(() => {
      if (staleAreaFilterResetInFlight === staleAreaFilter) {
        staleAreaFilterResetInFlight = null;
      }
    });
  }, [didResetDeletedAreaFilter, settings?.filters, updateSettings]);

  const setAreaFilter = useCallback((value: AreaFilterValue) => {
    void updateSettings({
      filters: {
        ...(settings?.filters ?? {}),
        areaId: value,
      },
    });
  }, [settings?.filters, updateSettings]);

  const selectedAreaIdForNewTasks = useMemo(() => (
    resolvedAreaFilter !== AREA_FILTER_ALL && resolvedAreaFilter !== AREA_FILTER_NONE
      ? resolvedAreaFilter
      : undefined
  ), [resolvedAreaFilter]);

  return {
    areaById,
    didResetDeletedAreaFilter,
    resolvedAreaFilter,
    selectedAreaIdForNewTasks,
    setAreaFilter,
    sortedAreas,
  };
}
