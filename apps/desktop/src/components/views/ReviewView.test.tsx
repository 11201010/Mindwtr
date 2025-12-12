import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewView } from './ReviewView';
import { LanguageProvider } from '../../contexts/language-context';

const renderWithProviders = (ui: React.ReactElement) => {
    return render(
        <LanguageProvider>
            {ui}
        </LanguageProvider>
    );
};

const mockUseTaskStore = vi.hoisted(() => vi.fn(() => ({
    tasks: [],
    projects: [],
    settings: {},
    batchMoveTasks: vi.fn(),
    batchDeleteTasks: vi.fn(),
    batchUpdateTasks: vi.fn(),
})));

vi.mock('@mindwtr/core', async () => {
    const actual = await vi.importActual<typeof import('@mindwtr/core')>('@mindwtr/core');
    return {
        ...actual,
        useTaskStore: mockUseTaskStore,
    };
});

// Mock TaskItem to simplify testing
vi.mock('../TaskItem', () => ({
    TaskItem: ({ task }: { task: { title: string } }) => <div data-testid="task-item">{task.title}</div>,
}));

describe('ReviewView', () => {
    it('renders the review list with a guide button', () => {
        renderWithProviders(<ReviewView />);
        expect(screen.getByText('Review')).toBeInTheDocument();
        expect(screen.getByText('Weekly Review Guide')).toBeInTheDocument();
    });

    it('navigates through the wizard steps', () => {
        renderWithProviders(<ReviewView />);

        // Open guide
        fireEvent.click(screen.getByText('Weekly Review Guide'));
        expect(screen.getByText('Time for your Weekly Review')).toBeInTheDocument();

        // Intro -> Inbox
        fireEvent.click(screen.getByText('Start Review'));
        expect(screen.getByText('Process Inbox')).toBeInTheDocument();
        expect(screen.getByText('Inbox Zero Goal')).toBeInTheDocument();

        // Inbox -> Calendar
        fireEvent.click(screen.getByText('Next Step'));
        expect(screen.getByText('Review Calendar')).toBeInTheDocument();
        expect(screen.getByText('Past 14 Days')).toBeInTheDocument();

        // Calendar -> Waiting For
        fireEvent.click(screen.getByText('Next Step'));
        expect(screen.getByText('Waiting For')).toBeInTheDocument();

        // Waiting For -> Projects
        fireEvent.click(screen.getByText('Next Step'));
        expect(screen.getByText('Review Projects')).toBeInTheDocument();

        // Projects -> Someday/Maybe
        fireEvent.click(screen.getByText('Next Step'));
        expect(screen.getByText('Someday/Maybe')).toBeInTheDocument();

        // Someday/Maybe -> Completed
        fireEvent.click(screen.getByText('Next Step'));
        expect(screen.getByText('Review Complete!')).toBeInTheDocument();
        expect(screen.getByText('Finish')).toBeInTheDocument();
    });

    it('can navigate back', () => {
        renderWithProviders(<ReviewView />);

        // Open guide
        fireEvent.click(screen.getByText('Weekly Review Guide'));
        expect(screen.getByText('Time for your Weekly Review')).toBeInTheDocument();

        // Go to Inbox
        fireEvent.click(screen.getByText('Start Review'));
        expect(screen.getByText('Process Inbox')).toBeInTheDocument();

        // Go back to Intro
        fireEvent.click(screen.getByText('Back'));
        expect(screen.getByText('Time for your Weekly Review')).toBeInTheDocument();
    });
});
