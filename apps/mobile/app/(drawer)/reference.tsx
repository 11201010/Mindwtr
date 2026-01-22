import { View, StyleSheet } from 'react-native';

import { TaskList } from '../../components/task-list';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { useLanguage } from '../../contexts/language-context';

export default function ReferenceScreen() {
  const tc = useThemeColors();
  const { t } = useLanguage();
  const title = t('nav.reference');
  const emptyLabel = t('reference.empty');
  const emptyText = emptyLabel === 'reference.empty' ? 'No reference items yet.' : emptyLabel;

  return (
    <View style={[styles.container, { backgroundColor: tc.bg }]}>
      <TaskList
        statusFilter="reference"
        title={title === 'nav.reference' ? 'Reference' : title}
        emptyText={emptyText}
        allowAdd={false}
        showQuickAddHelp={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
