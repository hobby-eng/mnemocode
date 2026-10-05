# A guide for heirs

You are probably reading this because someone left you a wallet backup made with MnemoCode, together with a sheet called "How to restore this wallet backup". This guide explains in plain words what it all means and how to reach the wallet safely.

Take your time. Nothing here is urgent, and anyone who tries to rush you is a warning sign.

## What a wallet and a seed phrase are

Bitcoin and other cryptocurrencies are not kept at a bank or in a file. They are recorded on a public ledger that thousands of computers share. What gives control over them is a secret: whoever knows it can spend them, and nobody can undo that.

Most wallets keep that secret as a **seed phrase**: a list of 12, 15, 18, 21 or 24 English words, such as "letter advice cage absurd ...". The words come from a standard list of 2048 words (BIP39), so any wallet program that follows this standard can turn the same words back into the same wallet. The words are the wallet; the program is only a tool to use it.

## What MnemoCode did to the seed phrase

A seed phrase written on paper is easy to recognise, and whoever finds it can take everything. So the owner had MnemoCode change how it looks. The sheet says which of these the owner chose:

- **Another form.** The words were written as numbers (each word's place in the list), as short codes of digits and letters, or as color codes such as `#1EAB91`, sometimes printed on cards that look like ordinary design samples.
- **Secret dates (Seedshift).** The words were masked with one or more dates that the owner picked when making the backup: dates that meant something to the owner, such as a birthday or a wedding day. The year, month and day of each date move the words forward along the BIP39 list of 2048 words: with the date 23-09-2026 the first word moves 2026 places, the second 9, the third 23, then again 2026, and so on. "abandon", the first word of the list, becomes "wool". This works like a simple cipher whose key is the dates: only the same dates, typed into MnemoCode, move the words back. Every move gives real words again, so wrong dates give another seed phrase, not an error. The dates have nothing to do with today's date, the day the backup was made, or the day you open the wallet. They are written nowhere; the owner may have left a hint on the sheet.
- **Shamir shares.** The backup was split into several shares, kept in different places. A certain number of them, for example any 3 of 5, restore it; fewer reveal nothing at all.

MnemoCode undoes all of this on your computer, without the internet.

## Before you start

Gather the sheet, the backup or enough of the shares, and the secret dates if the sheet says that they are needed.

Use a computer that you trust, for example your own. Do not do this on a computer at work, in a library, or one that someone else looks after. Do not photograph the backup, the shares or the seed phrase, and do not type them into a phone.

## Getting MnemoCode

Download MnemoCode from its release page, `https://github.com/hobby-eng/mnemocode/releases`, and from nowhere else. Choose the file for your computer: the one ending in `win-x64.exe` for Windows, `macos-arm64` for a Mac with an Apple processor, `linux-x64` for Linux.

The release page also has a file called `SHA256SUMS`. It lets you check that the file you downloaded is exactly the one that was published. The [README](../README.md#one-executable-file) shows how. If this is too technical, ask someone you trust to check it with you; they do not need to see the backup for this.

Then disconnect the computer from the internet: unplug the cable and turn off Wi-Fi.

The first start may need one more step, because the file does not come from an app store:

- **Windows** may show "Windows protected your PC". Choose "More info", then "Run anyway".
- **macOS** may say that it cannot check the file. Open System Settings, then Privacy & Security, and choose "Open Anyway" next to MnemoCode.
- **Linux** needs the file to be marked as a program first: in a terminal, `chmod +x` followed by the file name.

## Turning the backup back into the seed phrase

Start MnemoCode by a double-click. It shows a menu: choose with the arrow keys and Enter, or press the number. Follow the steps on the sheet; it names the menu entries and the answers to choose.

- Shares are typed one after another, separated by a semicolon (`;`).
- When MnemoCode asks for "Dates", type the secret dates as day-month-year, such as `23-09-2026`, separated by spaces.
- What you type is shown so that you can check it. When you press Enter at the end, the screen is cleared again.

If MnemoCode shows an error instead, a code or a word was probably mistyped. Check each one against the paper.

If you know a secret date but one of its digits is unclear, the menu entry "Find a forgotten word of a seed phrase or a date digit" can try every possibility.

## Opening the wallet

You now have the seed phrase: 12 to 24 English words. Write them down on paper, in order.

Install a well-known wallet program, downloaded only from its own official website. If you know which program the owner used, take that one. In the program, choose "Restore", "Recover" or "Import wallet", not "Create a new wallet", and type the words. Once the program has caught up with the ledger, it shows what the wallet holds.

If the wallet looks empty:

- **A secret date may be wrong.** With a wrong date MnemoCode usually shows no error: it gives another valid seed phrase, and the wallet of that phrase is empty. Check the secret dates, and that each is written day-month-year.
- **The owner may have used a BIP39 passphrase**: an extra word or sentence, sometimes called the 25th word. It is not part of the backup, and MnemoCode does not keep it. The hint on the sheet may mention it.
- **The owner may have used another program or another cryptocurrency.** Different programs can look at different parts of the same wallet. Try the program the owner used, if you know it.

## After the wallet is open

Move what the wallet holds to a new wallet of your own, with a new seed phrase that only you know. The old seed phrase has now been typed on a computer, and others may know that the backup exists.

An inheritance can bring legal and tax duties. A lawyer or a tax adviser can tell you which ones apply to you.

## Beware of scams

- Nobody honest ever asks for a seed phrase: not a bank, a wallet maker or its support staff, a lawyer, the police, or a "recovery service". Whoever has the words can take everything, at once and for good.
- Never type the seed phrase, the backup or the secret dates into a website, an email, a chat or a form.
- Paid services that promise to recover a wallet are very often scams.
- If you need help, ask someone you trust to sit beside you, and keep the words in your own hands.
