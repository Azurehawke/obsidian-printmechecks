# Print Me Checks for Obsidian

Your check register, inside Obsidian. Works with the `.xlsx` register written
by the [Print Me Checks](https://github.com/Azurehawke/printmechecks) desktop
app, on desktop and mobile.

## Features

- **Write and print checks**, just like the desktop app (*Write a check*
  command or the pen icon in the ribbon). Ribbon tabs (Home, Text, Layout,
  Accounts), a tool rail, the check itself, and a details panel:
  - Saved bank accounts, each with its own next check number in any format
    (`100`, `100-0001`, …). Numbering continues from the register, so checks
    saved from the desktop app on another computer are accounted for.
  - One font and size for the whole check; move any field with the arrow keys;
    shift the whole check to line up with your printer.
  - **Print…** opens a preview of the exact page, then the Windows print
    dialog. **Save PDF** saves the check into the vault (Settings → PDF
    folder) or anywhere you choose.
  - **Save to Register** adds the check to the `.xlsx` register.
  - The printed page is identical to the desktop app's, so alignment on your
    check stock carries over.
  - Printing needs Obsidian on a computer; on mobile you can still fill in
    checks and save them to the register.
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
3. Import your accounts from the desktop app, or add them under
   **Accounts → New** in the check editor.
4. Write checks with the pen icon (*Write a check*); see the register with the
   bank icon (*Open check register*).

## Accounts and privacy

Printing needs your full account and routing numbers. By default the plugin
keeps them **on this device only** (Obsidian's local storage, not in the
vault), so they never sync. **Settings → Where to keep bank accounts → In the
vault** syncs them to your other devices with the vault instead.

To bring accounts over from the desktop app: there, **Accounts → Export…**;
here, **Accounts → Import…** (or Settings → Import). Font and alignment
settings come along. The export file contains full account numbers, so delete
it after importing.

The register file never contains full account or routing numbers, only the
last 4 digits.

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
