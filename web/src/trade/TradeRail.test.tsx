import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { baseHandlers } from '../test/fixtures';
import { server } from '../test/server';
import { renderWithClient } from '../test/utils';
import { TradeRail } from './TradeRail';

describe('TradeRail', () => {
  it('defaults a fresh session to the Pair ticket, toggle ordered [Pair | Single]', () => {
    server.use(...baseHandlers()); // the ticket + ExecuteControl poll account + positions
    renderWithClient(<TradeRail />);

    const toggle = within(screen.getByRole('radiogroup', { name: 'Ticket mode' }));
    expect(toggle.getAllByRole('radio').map((r) => r.textContent)).toEqual(['Pair', 'Single']);
    expect(toggle.getByRole('radio', { name: 'Pair' })).toHaveAttribute('aria-checked', 'true');

    // Pair ticket body renders (coin-first picker), not the single ticket.
    expect(screen.getByLabelText('Coin search')).toBeInTheDocument();
    expect(screen.queryByLabelText('Symbol search')).not.toBeInTheDocument();
  });
});
