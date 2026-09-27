# Card identity defaults

The person and the company printed on business cards are invented. When you give no details, MnemoCode picks them once per export from its own lists of 20 employers, 26 roles and 60 names. Every page, individual file and Shamir share of that export shows the same person. The choice does not depend on your phrase.

| Field     | Default                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| Employer  | A company from a field that suits the template: IT, architecture, property or consulting    |
| Role      | A role that fits the field, or a general one such as sales, management or business analysis |
| Full name | A name in Latin letters from an international list                                          |
| Email     | `contact@<company-name>.example`                                                            |
| Website   | `<company-name>.example`                                                                    |
| Phone     | `+44 20 7946 0281`, from the London numbers that the UK regulator reserves for fiction      |
| Location  | `International`                                                                             |

The email and the website are decoration. They end in `.example`, a domain reserved for examples, so they can never be the contacts of a real company.

## Studio on collection sheets

The design studio named on a collection sheet is picked separately from the employer, also once per export. MnemoCode has 37 studio names, 30 slogans, five subtitles and six footers.

## Your own details

The README lists the options that replace these defaults: [personal details](../README.md#cards-and-qr-codes) and [sheet text](../README.md#collection-sheet-identity).
