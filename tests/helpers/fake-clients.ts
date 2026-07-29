/**
 * The one-line fake `Clients` that no-network unit tests inject: a bag of
 * stubbed crossEx methods cast to the real client shape.
 */
import type { Clients } from '../../src/core/clients';

export function clientsWith(crossEx: unknown): Clients {
  return { crossEx } as unknown as Clients;
}
