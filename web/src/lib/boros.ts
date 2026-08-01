/** Deep link into the Boros app: the market's trade page with the order form
 * prepopulated to the given direction, so "Short ETH funding @ Hyperliquid"
 * lands the visitor one confirm away from that exact leg. */
export const borosMarketUrl = (marketId: number, direction: 'long' | 'short'): string =>
  `https://boros.pendle.finance/markets/${marketId}?form=market&direction=${direction}`;
