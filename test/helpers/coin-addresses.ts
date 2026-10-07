import { COINS, type CoinId } from "../../src/core/coins.js";

/**
 * The first receiving address of the public test phrase "abandon … about" in each coin besides
 * Bitcoin, m/44'/<coin type>'/0'/0/0: the vectors of test/coins.test.ts, which say where they come
 * from.
 */
const FIRST_RECEIVING: Readonly<Record<Exclude<CoinId, "bitcoin">, string>> = {
  "bitcoin-cash": "bitcoincash:qqyx49mu0kkn9ftfj6hje6g2wfer34yfnq5tahq3q6",
  cosmos: "cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4",
  dash: "XoJA8qE3N2Y3jMLEtZ3vcN42qseZ8LvFf5",
  dogecoin: "DBus3bamQjgJULBJtYXpEzDWQRwF5iwxgC",
  ethereum: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  "ethereum-classic": "0xFA22515E43658ce56A7682B801e9B5456f511420",
  injective: "inj1npvwllfr9dqr8erajqqr6s0vxnk2ak55re90dz",
  litecoin: "LUWPbpM43E2p7ZSh8cyTBEkvpHmr3cB8Ez",
  tron: "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
  xrp: "rHsMGQEkVNJmpGWs8XUBoTBiAAbwxZN5v3",
  zcash: "t1XVXWCvpMgBvUaed4XDqWtgQgJSu1Ghz7F",
};

/**
 * The answers to the menu's address question of each coin besides Bitcoin, by its prompt, such
 * as "Address (Dash, one of the first receiving ones)".
 */
export const COIN_ADDRESS_ANSWERS: Readonly<Record<string, string>> = Object.fromEntries(
  COINS.filter((coin) => coin.id !== "bitcoin").map((coin) => [
    `Address (${coin.name}, one of the first receiving ones)`,
    FIRST_RECEIVING[coin.id as Exclude<CoinId, "bitcoin">],
  ]),
);
