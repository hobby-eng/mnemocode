# Formal construction of checksum-valid Seedshift

This document states the transformation described in the [README](../README.md#how-checksum-valid-seedshift-works) precisely and proves that it is reversible. It is not needed to use MnemoCode.

Let `n` be the mnemonic word count, where `n` is one of `12, 15, 18, 21, 24`. For BIP39,

$$
\mathrm{ENT}=\frac{32n}{3},\qquad
\mathrm{CS}=\frac{\mathrm{ENT}}{32}=\frac{n}{3}.
$$

Define the number of entropy bits carried by the final word as

$$
r=\mathrm{ENT}-11(n-1)=11-\mathrm{CS}=\mathrm{ENT}\bmod 11.
$$

Thus `r` is respectively `7, 6, 5, 4, 3`. Interpret the entropy as

$$
x=(x_1,\ldots,x_{n-1},t)
\in G_n=(\mathbb Z_{2048})^{n-1}\times\mathbb Z_{2^r},
$$

where every `x_i` is one complete 11-bit entropy block and `t` is the `r`-bit entropy tail. The cardinality is

$$
|G_n|=2048^{n-1}2^r
=2^{11(n-1)+r}
=2^{\mathrm{ENT}},
$$

so this decomposition covers the entire BIP39 entropy space exactly. For example, a 24-word mnemonic has `r = 3` and uses

$$
G_{24}=(\mathbb Z_{2048})^{23}\times\mathbb Z_8.
$$

After sorting the dates and expanding them into the repeating year/month/day schedule, let

$$
s=(s_1,\ldots,s_n)
$$

be the resulting fixed shift vector. MnemoCode applies the group translation

$$
T_s(x_1,\ldots,x_{n-1},t)=
\left(
(x_1+s_1)\bmod 2048,\ldots,
(x_{n-1}+s_{n-1})\bmod 2048,
(t+s_n)\bmod 2^r
\right).
$$

Its inverse is subtraction in the same product group:

$$
T_s^{-1}(y_1,\ldots,y_{n-1},u)=
\left(
(y_1-s_1)\bmod 2048,\ldots,
(y_{n-1}-s_{n-1})\bmod 2048,
(u-s_n)\bmod 2^r
\right).
$$

Therefore `T_s` is a bijection for every shift vector `s`. No search is involved.

Let the BIP39 checksum function be

$$
c(e)=\mathrm{MSB}_{\mathrm{CS}}(\mathrm{SHA256}(e)),
$$

and let `B_n(e)` append `c(e)` to the entropy and split the result into `n` 11-bit word indexes. `B_n` is a bijection between the `2^ENT` entropy values and the set of checksum-valid `n`-word BIP39 mnemonics. The complete MnemoCode transformation on valid mnemonics is therefore

$$
F_s=B_n\circ T_s\circ B_n^{-1},
$$

with inverse

$$
F_s^{-1}=B_n\circ T_s^{-1}\circ B_n^{-1}.
$$

This proves three properties: every valid input has exactly one output, every output is a checksum-valid BIP39 mnemonic, and the same dates recover the original exactly.

The proof concerns correctness, not cryptographic strength. A fixed translation derived from memorable dates is not a keyed pseudorandom permutation; [SECURITY.md](../SECURITY.md#cryptographic-and-recovery-limits) lists the limits.
