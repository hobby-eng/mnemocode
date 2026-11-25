# MnemoCode: what it is for

MnemoCode helps a person keep a BIP39 seed phrase so that it survives and does not give the wallet away. It works on one computer, offline, and turns the phrase into backups that look like something else, then turns them back into the phrase.

## Who it is for

- A person who keeps their own wallet and wants a backup that a finder does not recognise as one.
- Their heirs, who must restore the wallet years later, possibly without MnemoCode: the sheet for heirs and the exported word lists let them do it by hand.
- A person whose backup is damaged: a forgotten word, an unreadable code, a missing digit of a date, a damaged share.

## What it does

- Writes the phrase in another form: word numbers, Unicode codes, colours, printable cards, QR codes (also hidden behind a contact card), a cross-stitch pattern made from a picture.
- Masks the phrase with dates the person remembers (Seedshift), so that a backup found alone gives another phrase, a decoy.
- Splits the phrase into standard SSKR Shamir shares, which can be written as cards, QR codes and patterns too.
- Reads every backup it saves back into the phrase: typed codes, a record, a QR code, a pattern, the files of the cards.
- Finds what is missing in a damaged backup and checks the result against the wallet.

## What it does not do

- It is no wallet: it holds no funds, signs nothing and sends nothing.
- It never uses the network. After it ends, only the files the person chose to save remain; a crash, power loss or a failed cleanup can leave a hidden staging folder beside them, and the program names any it could not remove (`SECURITY.md`).
- It does not keep the dates or the phrase: a backup masked with Seedshift is restored only with the dates.

## Principles

- **Everything offline, every secret protected.** Before any secret is read, the program closes its own network access where the system allows it (Linux and macOS; on Windows the computer itself must be offline), a secret typed in is read on the private screen, and its memory is wiped when its work ends (`SECURITY.md`).
- **Whatever it saves, it reads back.** A new form of backup ships with its reading in Decode or Restore.
- **The same in the browser.** A feature is finished only when the browser tools offer it as the command line does.
- **The person decides, the program explains.** Each screen says only what helps at that step, in plain words; every screen offers a step back and a way out; every kind of text looks the same on every screen.
