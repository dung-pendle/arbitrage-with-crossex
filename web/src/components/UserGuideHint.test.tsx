/** The first-days nudge toward the user guide: it must appear for a new user,
 * stay out of the way once answered, and never resurface for someone who has
 * been running the terminal for a while. */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HINT_WINDOW_MS, markGuideHintDone, UserGuideHint } from './UserGuideHint';

const FIRST_SEEN_KEY = 'crossex.firstSeenAt';

/** Render and run past the settle delay. */
function show(props: { enabled?: boolean; onOpen?: () => void } = {}) {
  const onOpen = props.onOpen ?? vi.fn();
  render(<UserGuideHint enabled={props.enabled ?? true} onOpen={onOpen} />);
  act(() => void vi.advanceTimersByTime(2_000));
  return onOpen;
}

const hint = () => screen.queryByRole('dialog', { name: 'New here?' });

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('UserGuideHint', () => {
  it('appears for a first-time user, after the terminal has settled', () => {
    render(<UserGuideHint enabled onOpen={vi.fn()} />);
    expect(hint()).toBeNull(); // not instantly — it must not fight the first paint
    act(() => void vi.advanceTimersByTime(2_000));
    expect(hint()).toBeInTheDocument();
  });

  it('stays hidden while the terminal is not usable yet (gate / first-run)', () => {
    show({ enabled: false });
    expect(hint()).toBeNull();
  });

  it('never appears for someone past the window', () => {
    localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(Date.now() - HINT_WINDOW_MS - 1));
    show();
    expect(hint()).toBeNull();
  });

  it('still appears just inside the window', () => {
    localStorage.setItem(FIRST_SEEN_KEY, JSON.stringify(Date.now() - HINT_WINDOW_MS + 60_000));
    show();
    expect(hint()).toBeInTheDocument();
  });

  it('opens the guide and never asks again', () => {
    const onOpen = show();
    act(() => screen.getByRole('button', { name: 'Open the guide' }).click());
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(hint()).toBeNull();

    // A later session (still inside the window) stays quiet.
    show();
    expect(hint()).toBeNull();
  });

  it('dismissal sticks across sessions', () => {
    show();
    act(() => screen.getByRole('button', { name: 'Dismiss' }).click());
    expect(hint()).toBeNull();
    show();
    expect(hint()).toBeNull();
  });

  it('opening the guide by any other route also silences it', () => {
    // The header button calls this directly — a user who found the guide on
    // their own must not then be told where it is.
    markGuideHintDone();
    show();
    expect(hint()).toBeNull();
  });
});
