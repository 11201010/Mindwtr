import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GettingStartedActions } from './GettingStartedActions';
import { subscribeNavigateEvent } from '../lib/navigation-events';

describe('GettingStartedActions', () => {
    it('opens the existing capture and navigation paths without changing tasks', () => {
        const capture = vi.fn();
        const navigate = vi.fn();
        window.addEventListener('mindwtr:quick-add', capture);
        const unsubscribe = subscribeNavigateEvent(navigate);
        render(<GettingStartedActions t={(key) => key} />);
        fireEvent.click(screen.getByRole('button', { name: 'onboarding.captureAction' }));
        fireEvent.click(screen.getByRole('button', { name: 'starter.processInbox.check1' }));
        fireEvent.click(screen.getByRole('button', { name: 'starter.focus.check1' }));
        expect(capture).toHaveBeenCalledOnce();
        expect(navigate.mock.calls).toEqual([[{ view: 'inbox' }], [{ view: 'agenda' }]]);
        unsubscribe();
        window.removeEventListener('mindwtr:quick-add', capture);
    });
});
