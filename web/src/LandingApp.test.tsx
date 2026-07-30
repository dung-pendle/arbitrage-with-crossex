/** The public shell: live opportunities on the left, the collapsed setup rail on
 * the right. Hitting Execute has nowhere to go on this page, so it nudges the
 * install command instead — which now lives inside a collapsed step. */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LandingApp } from './LandingApp';
import { baseHandlers, makeOpportunitiesResult, opportunitiesHandler } from './test/fixtures';
import { server } from './test/server';
import { renderWithClient } from './test/utils';

describe('LandingApp', () => {
  it('Execute re-opens the install step when the visitor has closed it, and flashes it', async () => {
    server.use(...baseHandlers(), opportunitiesHandler(makeOpportunitiesResult()));
    renderWithClient(<LandingApp />);

    // Step 1 is open by default; close it the way a visitor would.
    const install = await screen.findByRole('button', { name: /^Install the terminal/ });
    expect(install).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(install);
    expect(install).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(await screen.findByRole('button', { name: 'Execute it' }));

    // Nothing to flash unless the step holding the command is re-opened first.
    await waitFor(() => expect(install).toHaveAttribute('aria-expanded', 'true'));
    await waitFor(() => expect(document.querySelector('.flash-ring')).not.toBeNull());
  });

  it('exposes no credential surface anywhere on the public shell', async () => {
    server.use(...baseHandlers(), opportunitiesHandler(makeOpportunitiesResult()));
    renderWithClient(<LandingApp />);
    await screen.findByRole('button', { name: /^Install the terminal/ });

    expect(screen.queryByLabelText(/API key/i)).toBeNull();
    expect(screen.queryByLabelText(/API secret/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Settings/i })).toBeNull();
  });
});
