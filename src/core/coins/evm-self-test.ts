// The self-test of the addresses of Ethereum, Ethereum Classic and Tron (evm.ts), for a host that
// builds them in, through core/coins-self-test.ts. The vectors' sources are in coin-self-test.ts.
//
// Host-neutral: it imports only evm.ts and coin-self-test.ts.

import { coinFamilySelfTest } from "./coin-self-test.js";
import { ETHEREUM, ETHEREUM_CLASSIC, TRON } from "./evm.js";

/** The checks of the addresses of Ethereum, Ethereum Classic and Tron. */
export const EVM_ADDRESS_SELF_TEST = coinFamilySelfTest({
  name: "Ethereum, Ethereum Classic and Tron addresses",
  vectors: [
    {
      coin: ETHEREUM,
      passphrase: "",
      path: "m/44'/60'/0'/0/0",
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    },
    {
      coin: ETHEREUM,
      passphrase: "",
      path: "m/44'/60'/3'/1/7",
      address: "0xc1A30611797762aea209daC2aC7E900f0cE95f9e",
    },
    {
      coin: ETHEREUM_CLASSIC,
      passphrase: "",
      path: "m/44'/61'/0'/0/0",
      address: "0xFA22515E43658ce56A7682B801e9B5456f511420",
    },
    // A wallet on the coin type of the chain it forked from, found on the second path.
    {
      coin: ETHEREUM_CLASSIC,
      passphrase: "",
      path: "m/44'/60'/0'/0/0",
      address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
    },
    {
      coin: TRON,
      passphrase: "",
      path: "m/44'/195'/0'/0/0",
      address: "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH",
    },
    {
      coin: TRON,
      passphrase: "",
      path: "m/44'/195'/3'/1/7",
      address: "TTD7MudE8L26nvnrEf2LHzXm6stKRpFZH1",
    },
  ],
  startup: [0],
  elsewhere: 1,
  refused: [
    // The EIP-55 vector with one letter's case changed.
    {
      coin: ETHEREUM,
      address: "0x9858efFD232B4033E47d90003D41EC34EcaEda94",
      because: /EIP-55 checksum/u,
    },
  ],
});
