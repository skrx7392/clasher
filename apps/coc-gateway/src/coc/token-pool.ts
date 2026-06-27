/**
 * Pool of official Clash of Clans API keys. The gateway is the ONLY place these
 * keys exist (DESIGN §1/§9). Live rotation across multiple IP-bound keys lands
 * with real calls in M2; the pilot uses a single key.
 */
export interface TokenPool {
  /** The next key to use for an outbound call (round-robins when multiple). */
  next(): string;
}

export class SingleKeyTokenPool implements TokenPool {
  constructor(private readonly key: string) {}

  next(): string {
    return this.key;
  }
}
