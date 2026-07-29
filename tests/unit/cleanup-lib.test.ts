/**
 * Unit coverage for the real-money emergency cleanup primitives (tests/live/cleanup-lib.ts),
 * which previously had ZERO tests. A fake Clients (stubbed crossEx methods) is injected —
 * nothing hits the network. closeTestPositions() sleeps 1.5s between escalation rounds via
 * the module-private `sleep`, so those cases drive fake timers to stay fast + deterministic.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Clients } from '../../src/core/clients';
import { clientsWith } from '../helpers/fake-clients';
import { cancelByTag, closeTestPositions, positionOn, verifyFlat } from '../live/cleanup-lib';

// ---- fakes ---------------------------------------------------------------

type AnyObj = Record<string, unknown>;

interface FakeCrossEx {
  listCrossexPositions?: (opts?: AnyObj) => Promise<{ body: AnyObj[] }>;
  listCrossexOpenOrders?: (opts?: AnyObj) => Promise<{ body: AnyObj[] }>;
  cancelCrossexOrder?: (id: string) => Promise<unknown>;
  listCrossexRuleSymbols?: (opts?: AnyObj) => Promise<{ body: AnyObj[] }>;
  createCrossexOrder?: (req: { crossexOrderRequest: AnyObj }) => Promise<{ body: AnyObj }>;
}

/** clientsWith, narrowed so the stub literals stay checked against FakeCrossEx. */
const fakeClients = (crossEx: FakeCrossEx): Clients => clientsWith(crossEx);

const longPos = (symbol: string, over: AnyObj = {}): AnyObj => ({
  symbol,
  positionSide: 'LONG',
  positionQty: '0.5',
  markPrice: '100',
  entryPrice: '100',
  ...over,
});

const ethRule: AnyObj = {
  symbol: 'GATE_FUTURE_ETH_USDT',
  exchangeType: 'GATE',
  businessType: 'FUTURE',
  state: 'live',
  lotSize: '0.01',
  tickSize: '0.01',
  minSize: '0.01',
  minNotional: '5',
};

/** Drive an in-flight closeTestPositions() promise across its faked 1.5s sleeps. */
async function pump(p: Promise<void>): Promise<void> {
  let done = false;
  void p.then(() => (done = true), () => (done = true));
  for (let i = 0; i < 20 && !done; i++) {
    await vi.advanceTimersByTimeAsync(1500);
  }
  await p;
}

afterEach(() => {
  vi.useRealTimers();
});

// ---- positionOn ----------------------------------------------------------

describe('positionOn', () => {
  it('returns the first position with nonzero qty', async () => {
    const clients = fakeClients({
      listCrossexPositions: async () => ({ body: [longPos('GATE_FUTURE_ETH_USDT')] }),
    });
    const pos = await positionOn(clients, 'GATE_FUTURE_ETH_USDT');
    expect(pos?.positionQty).toBe('0.5');
  });

  it('treats a zero-qty row (and an empty body) as no position', async () => {
    const zero = fakeClients({
      listCrossexPositions: async () => ({ body: [longPos('GATE_FUTURE_ETH_USDT', { positionQty: '0' })] }),
    });
    expect(await positionOn(zero, 'GATE_FUTURE_ETH_USDT')).toBeUndefined();
    const empty = fakeClients({ listCrossexPositions: async () => ({ body: [] }) });
    expect(await positionOn(empty, 'GATE_FUTURE_ETH_USDT')).toBeUndefined();
  });
});

// ---- cancelByTag ---------------------------------------------------------

describe('cancelByTag', () => {
  it('cancels ONLY orders whose text startsWith the tag; leaves foreign orders untouched', async () => {
    const canceled: string[] = [];
    const clients = fakeClients({
      listCrossexOpenOrders: async () => ({
        body: [
          { orderId: '1', text: 'lt123_abc_0' },
          { orderId: '2', text: 'someone_else_order' }, // NOT ours — must be left alone
          { orderId: '3', text: 'lt123_abc_1' },
          { orderId: '4', text: undefined }, // no text — never matches
        ],
      }),
      cancelCrossexOrder: async (id) => {
        canceled.push(id);
        return { body: {} };
      },
    });

    const result = await cancelByTag(clients, ['GATE_FUTURE_ETH_USDT'], 'lt123');
    expect(result).toEqual(['1', '3']);
    expect(canceled).toEqual(['1', '3']); // '2' and '4' never touched
  });

  it('a failed cancel is swallowed (logged) and NOT reported as canceled', async () => {
    const steps: string[] = [];
    const clients = fakeClients({
      listCrossexOpenOrders: async () => ({
        body: [
          { orderId: '1', text: 'lt123_a_0' },
          { orderId: '3', text: 'lt123_a_1' },
        ],
      }),
      cancelCrossexOrder: async (id) => {
        if (id === '3') throw new Error('order already gone');
        return { body: {} };
      },
    });

    const result = await cancelByTag(clients, ['GATE_FUTURE_ETH_USDT'], 'lt123', (m) => steps.push(m));
    expect(result).toEqual(['1']); // only the successful cancel
    expect(steps.some((s) => /cancel 3.*failed/.test(s))).toBe(true);
  });
});

// ---- closeTestPositions --------------------------------------------------

describe('closeTestPositions', () => {
  it('sends a reduce-only IOC marketable limit; SELL closes a long at mark×(1-slip)', async () => {
    vi.useFakeTimers();
    const orders: AnyObj[] = [];
    let positionsCall = 0;
    const clients = fakeClients({
      listCrossexRuleSymbols: async () => ({ body: [ethRule] }),
      // open on round 1, flat afterwards (proves it re-checks between attempts)
      listCrossexPositions: async () => ({ body: positionsCall++ === 0 ? [longPos('GATE_FUTURE_ETH_USDT')] : [] }),
      createCrossexOrder: async ({ crossexOrderRequest }) => {
        orders.push(crossexOrderRequest);
        return { body: { orderId: String(orders.length) } };
      },
    });

    await pump(closeTestPositions(clients, ['GATE_FUTURE_ETH_USDT']));

    expect(orders).toHaveLength(1); // round 2 saw no position → stopped escalating
    const o = orders[0];
    expect(String(o.side)).toBe('SELL');
    expect(String(o.type)).toBe('LIMIT');
    expect(String(o.timeInForce)).toBe('IOC');
    expect(String(o.reduceOnly)).toBe('true');
    expect(o.qty).toBe('0.50'); // 0.5 floored to lot 0.01
    expect(o.price).toBe('99'); // 100 × (1 − 1%)
  });

  it('escalates slippage 1% → 2% → 4% while the position stays open (prices move further from mark)', async () => {
    vi.useFakeTimers();
    const prices: string[] = [];
    const clients = fakeClients({
      listCrossexRuleSymbols: async () => ({ body: [ethRule] }),
      listCrossexPositions: async () => ({ body: [longPos('GATE_FUTURE_ETH_USDT')] }), // never closes
      createCrossexOrder: async ({ crossexOrderRequest }) => {
        prices.push(String(crossexOrderRequest.price));
        return { body: { orderId: String(prices.length) } };
      },
    });

    await pump(closeTestPositions(clients, ['GATE_FUTURE_ETH_USDT']));

    // SELL at 100×(1−slip): 1%→99, 2%→98, 4%→96
    expect(prices).toEqual(['99', '98', '96']);
  });

  it("skips a symbol with no rule ('cannot auto-close') and sends nothing", async () => {
    vi.useFakeTimers();
    const steps: string[] = [];
    let created = 0;
    const clients = fakeClients({
      listCrossexRuleSymbols: async () => ({ body: [] }), // no rule for the symbol
      listCrossexPositions: async () => ({ body: [longPos('GATE_FUTURE_ETH_USDT')] }),
      createCrossexOrder: async () => {
        created++;
        return { body: { orderId: '1' } };
      },
    });

    await pump(closeTestPositions(clients, ['GATE_FUTURE_ETH_USDT'], (m) => steps.push(m)));

    expect(created).toBe(0);
    expect(steps.some((s) => /no rule for GATE_FUTURE_ETH_USDT/.test(s))).toBe(true);
  });

  it('refuses to price a close when mark and entry are both 0', async () => {
    vi.useFakeTimers();
    const steps: string[] = [];
    let created = 0;
    const clients = fakeClients({
      listCrossexRuleSymbols: async () => ({ body: [ethRule] }),
      listCrossexPositions: async () => ({ body: [longPos('GATE_FUTURE_ETH_USDT', { markPrice: '0', entryPrice: '0' })] }),
      createCrossexOrder: async () => {
        created++;
        return { body: { orderId: '1' } };
      },
    });

    await pump(closeTestPositions(clients, ['GATE_FUTURE_ETH_USDT'], (m) => steps.push(m)));

    expect(created).toBe(0);
    expect(steps.some((s) => /cannot price close/.test(s))).toBe(true);
  });

  it('is a no-op for an empty symbol list', async () => {
    const clients = fakeClients({});
    await expect(closeTestPositions(clients, [])).resolves.toBeUndefined();
  });
});

// ---- verifyFlat ----------------------------------------------------------

describe('verifyFlat', () => {
  it('true only when every symbol has NO position AND NO open order', async () => {
    const flat = fakeClients({
      listCrossexPositions: async () => ({ body: [] }),
      listCrossexOpenOrders: async () => ({ body: [] }),
    });
    expect(await verifyFlat(flat, ['GATE_FUTURE_ETH_USDT'])).toBe(true);
  });

  it('false when a residual position remains', async () => {
    const clients = fakeClients({
      listCrossexPositions: async () => ({ body: [longPos('GATE_FUTURE_ETH_USDT')] }),
      listCrossexOpenOrders: async () => ({ body: [] }),
    });
    expect(await verifyFlat(clients, ['GATE_FUTURE_ETH_USDT'])).toBe(false);
  });

  it('false when a residual open order remains (position already flat)', async () => {
    const clients = fakeClients({
      listCrossexPositions: async () => ({ body: [] }),
      listCrossexOpenOrders: async () => ({ body: [{ orderId: '1', text: 'lt_x_0' }] }),
    });
    expect(await verifyFlat(clients, ['GATE_FUTURE_ETH_USDT'])).toBe(false);
  });
});
