import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoldToConfirmButton } from './HoldToConfirmButton';

describe('HoldToConfirmButton', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT fire on a quick click or a short hold', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldToConfirmButton onConfirm={onConfirm}>Execute ▸</HoldToConfirmButton>);
    const btn = screen.getByRole('button', { name: 'Execute ▸' });

    fireEvent.click(btn); // plain click — never fires
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.pointerDown(btn); // released at 300ms — cancels
    act(() => {
      vi.advanceTimersByTime(300);
    });
    fireEvent.pointerUp(btn);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fires exactly once after a full 800ms hold', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldToConfirmButton onConfirm={onConfirm}>Execute ▸</HoldToConfirmButton>);
    const btn = screen.getByRole('button', { name: 'Execute ▸' });

    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(41); // crosses 800ms
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Keeping the pointer down (or releasing) never fires again.
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    fireEvent.pointerUp(btn);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-progress hold the instant it becomes disabled (gate closes mid-hold)', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    const { rerender, container } = render(
      <HoldToConfirmButton onConfirm={onConfirm}>Execute ▸</HoldToConfirmButton>,
    );
    const btn = screen.getByRole('button', { name: 'Execute ▸' });

    // Start a real hold while enabled…
    fireEvent.pointerDown(btn);
    act(() => {
      vi.advanceTimersByTime(400); // ~halfway — ring is filling
    });
    const fillRing = container.querySelectorAll('circle')[1];
    expect(Number(fillRing.getAttribute('stroke-dashoffset'))).toBeLessThan((2 * Math.PI * 7)); // progressed

    // …then a background re-preview flips the gate closed mid-hold.
    rerender(<HoldToConfirmButton onConfirm={onConfirm} disabled>Execute ▸</HoldToConfirmButton>);

    // Advance well past the full holdMs — the aborted timer must NOT fire.
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
    // Progress ring reset to empty (full dash offset == circumference).
    expect(Number(fillRing.getAttribute('stroke-dashoffset'))).toBeCloseTo(2 * Math.PI * 7, 5);
  });

  it('has no keyboard equivalent (Enter is swallowed)', () => {
    vi.useFakeTimers();
    const onConfirm = vi.fn();
    render(<HoldToConfirmButton onConfirm={onConfirm}>Execute ▸</HoldToConfirmButton>);
    const btn = screen.getByRole('button', { name: 'Execute ▸' });
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    fireEvent.keyDown(btn, { key: ' ' });
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
