import { buildSomedaySectionsSettingsUpdate, flushPendingSave, planSomedaySectionCreate, useTaskStore } from '@mindwtr/core';

/** The one mobile write path used by every Someday section creation picker. */
export async function createSomedaySection(title: string): Promise<string | null> {
  const taskState = useTaskStore.getState();
  const settings = taskState.settings;
  // Core's plan keeps every stored entry as it is, in stored order, and appends the new one.
  const plan = planSomedaySectionCreate(settings?.gtd?.viewSections?.someday, title);
  if (plan.kind === 'blank') return null;
  if (plan.kind === 'existing') {
    if (useTaskStore.getState().persistenceFailure) {
      await useTaskStore.getState().retryPersistence();
    }
    await flushPendingSave();
    if (useTaskStore.getState().persistenceFailure) throw new Error('Someday section save incomplete');
    return plan.id;
  }

  await taskState.updateSettings(buildSomedaySectionsSettingsUpdate(settings, plan.sections));
  await flushPendingSave();
  if (useTaskStore.getState().persistenceFailure) throw new Error('Someday section save incomplete');
  return plan.id;
}
