import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ReviewView } from './ReviewView';
import { LanguageProvider } from '../../contexts/language-context';

const renderWithProviders = (ui: React.ReactElement) => {
    return render(
        <LanguageProvider>
            {ui}
        </LanguageProvider>
    );
};

// Mock TaskItem to simplify testing
vi.mock('../TaskItem', () => ({
    TaskItem: ({ task }: { task: { title: string } }) => <div data-testid="task-item">{task.title}</div>,
}));

// Avoid async state updates from calendar fetch effects in review modals.
vi.mock('../../lib/external-calendar-events', () => ({
    fetchExternalCalendarEvents: vi.fn(() => new Promise(() => {})),
}));

describe('ReviewView', () => {
    it('renders the review list with a guide button', () => {
        const { getByText } = renderWithProviders(<ReviewView />);
        expect(getByText('review.title')).toBeInTheDocument();
        expect(getByText('review.openGuide')).toBeInTheDocument();
    });

    it('navigates through the wizard steps', () => {
        const { getByText, getAllByText, queryByText } = renderWithProviders(<ReviewView />);

        // Open guide
        fireEvent.click(getByText('review.openGuide'));
        expect(getByText('review.timeFor')).toBeInTheDocument();

        // Intro -> Inbox
        fireEvent.click(getByText('review.startReview'));
        expect(getByText('review.inboxStep')).toBeInTheDocument();
        expect(getByText('review.inboxZero')).toBeInTheDocument();

        // Inbox -> AI or Calendar (AI step is hidden when AI is disabled)
        fireEvent.click(getByText('review.nextStepBtn'));
        const aiVisible = queryByText('review.aiStep');
        if (aiVisible) {
            expect(aiVisible).toBeInTheDocument();
            fireEvent.click(getByText('review.nextStepBtn'));
        }

        // -> Calendar
        expect(getAllByText('review.calendarStep').length).toBeGreaterThan(0);
        expect(getByText('calendar.events')).toBeInTheDocument();
        expect(getByText('review.upcoming14Desc')).toBeInTheDocument();

        // Calendar -> Waiting For
        fireEvent.click(getByText('review.nextStepBtn'));
        expect(getByText('review.waitingStep')).toBeInTheDocument();

        // Waiting For -> Projects
        fireEvent.click(getByText('review.nextStepBtn'));
        expect(getByText('review.projectsStep')).toBeInTheDocument();

        // Projects -> Someday/Maybe
        fireEvent.click(getByText('review.nextStepBtn'));
        expect(getByText('review.somedayStep')).toBeInTheDocument();

        // Someday/Maybe -> Completed
        fireEvent.click(getByText('review.nextStepBtn'));
        expect(getByText('review.complete')).toBeInTheDocument();
        expect(getByText('review.finish')).toBeInTheDocument();
    });

    it('can navigate back', () => {
        const { getByText } = renderWithProviders(<ReviewView />);

        // Open guide
        fireEvent.click(getByText('review.openGuide'));
        expect(getByText('review.timeFor')).toBeInTheDocument();

        // Go to Inbox
        fireEvent.click(getByText('review.startReview'));
        expect(getByText('review.inboxStep')).toBeInTheDocument();

        // Go back to Intro
        fireEvent.click(getByText('review.back'));
        expect(getByText('review.timeFor')).toBeInTheDocument();
    });
});
