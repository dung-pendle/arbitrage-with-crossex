import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { CredentialsInput } from '../api/types';
import { env, server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { OnboardingGuide } from './OnboardingGuide';

describe('OnboardingGuide', () => {
  it('renders the five steps, the Gate links and the credentials form', () => {
    renderWithClient(<OnboardingGuide />);

    // Enable (switch the feature on) precedes BOTH funding CrossEx and the key.
    for (const title of ['Fund Gate', 'Enable CrossEx', 'Fund CrossEx', 'Paste your API key', 'Execute']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }

    const signup = screen.getByRole('link', { name: 'gate.com/signup' });
    expect(signup).toHaveAttribute('href', 'https://www.gate.com/signup');
    expect(signup).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'CrossEx' })).toHaveAttribute(
      'href',
      'https://www.gate.com/crossex',
    );
    expect(screen.getByRole('link', { name: 'API Management' })).toHaveAttribute(
      'href',
      'https://www.gate.com/myaccount/api_key_manage',
    );

    expect(screen.getByLabelText('API key')).toBeInTheDocument();
    expect(screen.getByLabelText('API secret')).toBeInTheDocument();
  });

  it('PUTs key+secret from step 3 and shows success on ok:true', async () => {
    let received: CredentialsInput | null = null;
    server.use(
      http.put('/api/credentials', async ({ request }) => {
        received = (await request.json()) as CredentialsInput;
        return HttpResponse.json(env({ configured: true, keyMasked: 'gk_****abcd' }));
      }),
    );
    renderWithClient(<OnboardingGuide />);

    await userEvent.type(screen.getByLabelText('API key'), 'my-key');
    await userEvent.type(screen.getByLabelText('API secret'), 'my-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Save credentials' }));

    expect(await screen.findByText(/Credentials saved/)).toBeInTheDocument();
    expect(received).toEqual({ key: 'my-key', secret: 'my-secret' });
  });
});
