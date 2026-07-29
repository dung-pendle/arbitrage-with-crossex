import { fireEvent, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { DisclaimerGate } from './DisclaimerGate';

describe('DisclaimerGate', () => {
  it('renders nothing once the disclaimer is accepted', async () => {
    server.use(
      http.get('/api/disclaimer', () =>
        HttpResponse.json(env({ version: '1', accepted: true, acceptedVersion: '1' })),
      ),
    );
    renderWithClient(<DisclaimerGate />);
    // Give the query a tick; the gate must never appear.
    await waitFor(() => expect(screen.queryByText('Before you continue')).not.toBeInTheDocument());
  });

  it('blocks until the checkbox is ticked, then accept dismisses it', async () => {
    let accepted = false;
    server.use(
      http.get('/api/disclaimer', () =>
        HttpResponse.json(env({ version: '1', accepted, acceptedVersion: accepted ? '1' : null })),
      ),
      http.post('/api/disclaimer/accept', () => {
        accepted = true;
        return HttpResponse.json(env({ version: '1', accepted: true, acceptedVersion: '1' }));
      }),
    );
    renderWithClient(<DisclaimerGate />);

    expect(await screen.findByText('Before you continue')).toBeInTheDocument();
    const agree = screen.getByRole('button', { name: 'Agree and continue' });
    expect(agree).toBeDisabled(); // gated on the checkbox

    fireEvent.click(screen.getByRole('checkbox'));
    expect(agree).toBeEnabled();

    fireEvent.click(agree);
    await waitFor(() => expect(screen.queryByText('Before you continue')).not.toBeInTheDocument());
  });

  it('Cancel shows a blocking notice and does not accept', async () => {
    server.use(
      http.get('/api/disclaimer', () =>
        HttpResponse.json(env({ version: '1', accepted: false, acceptedVersion: null })),
      ),
    );
    renderWithClient(<DisclaimerGate />);

    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/must accept the disclaimer/i)).toBeInTheDocument();
    // Still blocking — a way back in, but not accepted.
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    expect(await screen.findByText('Before you continue')).toBeInTheDocument();
  });
});
