# Print Me Checks for Obsidian

Your check register, inside Obsidian. Works with the `.xlsx` register written
by the [Print Me Checks](https://github.com/Azurehawke/printmechecks) desktop
app, on desktop and mobile.

## Features

- **Check register view.** All your checks in a tab, newest first, with
  search, account and status filters, totals, and the outstanding amount.
  Change a check's status (Issued / Cleared / Void) right in the table.
- **Record a check.** The *Record a check* command adds a check you wrote by
  hand. It suggests the next number in the account's series (e.g. `100-0003`
  after `100-0002`) and offers payees you've used before.
- **Embed tables in notes** with a `checks` code block:

  ````markdown
  ```checks
  status: Issued
  account: Business
  columns: date, number, payee, amount
  ```
  ````

  | Option | Example | Meaning |
  |---|---|---|
  | `status` | `Issued, Void` | Only these statuses |
  | `account` | `Business` | Matches account name, bank, or last 4 |
  | `payee` | `Edison` | Payee contains this text |
  | `from` / `to` | `1/1/2026` | Check date range (also `2026-01-01`) |
  | `sort` | `amount asc` | `date` (default), `number`, `amount`, `payee`; add `asc` for ascending |
  | `limit` | `10` | Show at most this many |
  | `columns` | `date, number, payee, amount, memo, status, account` | Columns to show |
  | `total` | `false` | Hide the total row |

  Tables update when the register changes.
- **Stays in sync.** Edits from the desktop app, Excel, or another device
  (Syncthing, Obsidian Sync…) show up automatically.

## Setup

1. Install with [BRAT](https://github.com/TfTHacker/obsidian42-brat):
   *Add beta plugin* → `Azurehawke/obsidian-printmechecks`.
2. **Settings → Print Me Checks → Register file:** pick your register `.xlsx`
   (the one the desktop app writes to), or create a new one there.
3. Open the register from the ribbon (bank icon) or the command
   *Open check register*.

## Privacy

The register file never contains full account or routing numbers, only the
last 4 digits. The plugin doesn't store any account numbers.

## Register file format

One sheet, `Register`, with headers `Date`, `Check #`, `Payee`, `Amount`,
`Memo`, `Status`, `Account`, `Bank`, `Acct (last 4)`, `Saved`, and hidden
`Entry ID` / `Account ID`. Columns are matched by header, so you can add your
own columns or formatting and they're preserved.

## Development

```sh
npm install
npm run dev     # watch build
npm run build   # type-check + production build
```

To release: bump `version` in `manifest.json`, `package.json` and
`versions.json`, then push to `main`. GitHub Actions builds and publishes the
release for BRAT.
