/** The public rail: six steps, an OS-aware install command, and the paste-into-
 * your-own-LLM audit prompt. No key surface may ever appear here. */
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { renderWithClient } from '../test/utils';
import { LandingOnboardingGuide } from './LandingOnboardingGuide';

describe('LandingOnboardingGuide', () => {
  it('leads with install, then the audit step, before anything touching Gate', () => {
    renderWithClient(<LandingOnboardingGuide />);

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(within(steps[0]).getByRole('heading')).toHaveTextContent('Install the terminal');
    // Auditing comes BEFORE the visitor is asked to fund anything or make a key.
    expect(within(steps[1]).getByRole('heading')).toHaveTextContent('Audit it with your own AI');
    expect(within(steps[2]).getByRole('heading')).toHaveTextContent('Fund Gate');
    expect(within(steps[4]).getByRole('heading')).toHaveTextContent('Create your API key');
  });

  it('offers the audit prompt with the repo and the questions that matter for a key-holding tool', () => {
    renderWithClient(<LandingOnboardingGuide />);

    const prompt = screen.getByText(/Audit this open-source tool/);
    expect(prompt).toHaveTextContent('github.com/mrenoon/boros-crossex-terminal');
    expect(prompt).toHaveTextContent(/send my API keys.*off my machine/s);
    expect(prompt).toHaveTextContent(/withdraw funds/);
    expect(prompt).toHaveTextContent(/install\.sh \(macOS\) and install\.ps1 \(Windows\)/);
    expect(screen.getByRole('button', { name: 'Copy audit prompt' })).toBeInTheDocument();
  });

  it('defaults to the macOS install command and swaps to PowerShell on demand', async () => {
    // jsdom's userAgent is not Windows, so detectOs() lands on macOS.
    renderWithClient(<LandingOnboardingGuide />);

    expect(screen.getByText(/\/bin\/bash -c/)).toBeInTheDocument();
    expect(screen.queryByText(/install\.ps1 \| iex/)).toBeNull();

    await userEvent.click(screen.getByRole('radio', { name: 'Windows' }));

    expect(screen.getByText(/install\.ps1 \| iex/)).toBeInTheDocument();
    expect(screen.queryByText(/\/bin\/bash -c/)).toBeNull();
    expect(screen.getByText(/press Win, type PowerShell/)).toBeInTheDocument();
  });

  it('never renders a credential input on the public page', () => {
    renderWithClient(<LandingOnboardingGuide />);

    expect(screen.queryByLabelText(/API key/i)).toBeNull();
    expect(screen.queryByLabelText(/API secret/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /Save credentials/i })).toBeNull();
  });
});
