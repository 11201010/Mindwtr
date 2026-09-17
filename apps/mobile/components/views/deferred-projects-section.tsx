import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { ChevronDown, ChevronRight, Folder } from 'lucide-react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { projectMatchesAreaFilterSelection, tFallback } from '@mindwtr/core';
import type { Area, AreaFilterSelection, Project } from '@mindwtr/core';

import type { ThemeColors } from '@/hooks/use-theme-colors';

/**
 * Projects parked in the same bucket as the screen's tasks. Someday and Waiting
 * are the two GTD buckets a whole project can sit in, and both screens listed
 * them with the same swipe-to-reactivate row — down to the stylesheet.
 */
export function selectDeferredProjects(
  projects: Project[],
  status: 'someday' | 'waiting',
  resolvedAreaFilter: AreaFilterSelection,
  areaById: Map<string, Area>,
): Project[] {
  return [...projects]
    .filter((project) => (
      !project.deletedAt
      && project.status === status
      && projectMatchesAreaFilterSelection(project, resolvedAreaFilter, areaById)
    ))
    .sort((a, b) => {
      const aOrder = Number.isFinite(a.order) ? (a.order as number) : Number.POSITIVE_INFINITY;
      const bOrder = Number.isFinite(b.order) ? (b.order as number) : Number.POSITIVE_INFINITY;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.title.localeCompare(b.title);
    });
}

export interface DeferredProjectsSectionProps {
  projects: Project[];
  areaById: Map<string, Area>;
  themeColors: ThemeColors;
  t: (key: string) => string;
  onActivateProject: (projectId: string) => void;
  onOpenProject: (projectId: string) => void;
}

/** Renders nothing when there is nothing deferred, so callers can pass it straight to a list header. */
export function DeferredProjectsSection({
  projects,
  areaById,
  themeColors: tc,
  t,
  onActivateProject,
  onOpenProject,
}: DeferredProjectsSectionProps) {
  const [expanded, setExpanded] = useState(true);
  if (projects.length === 0) return null;

  return (
    <View style={[styles.projectSection, !expanded && styles.collapsedProjectSection, { backgroundColor: tc.cardBg, borderColor: tc.border }]}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${tFallback(t, 'projects.title', 'Projects')} (${projects.length})`}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={styles.sectionHeader}
      >
        {expanded ? <ChevronDown size={18} color={tc.secondaryText} /> : <ChevronRight size={18} color={tc.secondaryText} />}
        <Text style={[styles.sectionLabel, { color: tc.secondaryText }]}>
          {tFallback(t, 'projects.title', 'Projects')} ({projects.length})
        </Text>
      </TouchableOpacity>
      {expanded && projects.map((project) => {
        const projectArea = project.areaId ? areaById.get(project.areaId) : undefined;
        return (
          <Swipeable
            key={project.id}
            renderLeftActions={() => (
              <View style={[styles.activateAction, { backgroundColor: tc.tint, borderColor: tc.border }]}>
                <Text style={[styles.activateActionText, { color: tc.onTint }]}>{t('projects.reactivate')}</Text>
              </View>
            )}
            onSwipeableLeftOpen={() => onActivateProject(project.id)}
          >
            <TouchableOpacity
              style={[styles.projectRow, { borderColor: tc.border, backgroundColor: tc.cardBg }]}
              onPress={() => onOpenProject(project.id)}
            >
              <Folder size={18} color={project.color || tc.secondaryText} />
              <View style={styles.projectText}>
                <Text style={[styles.projectTitle, { color: tc.text }]} numberOfLines={1}>
                  {project.title}
                </Text>
                {projectArea && (
                  <Text style={[styles.projectMeta, { color: tc.secondaryText }]} numberOfLines={1}>
                    {projectArea.name}
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          </Swipeable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  projectSection: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    gap: 8,
  },
  sectionLabel: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  collapsedProjectSection: {
    paddingVertical: 0,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    gap: 8,
  },
  projectRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  projectText: {
    flex: 1,
  },
  projectTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  projectMeta: {
    fontSize: 12,
    marginTop: 2,
  },
  activateAction: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
  },
  activateActionText: {
    fontWeight: '600',
  },
});
