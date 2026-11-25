import type { Database } from "bun:sqlite";
import type { ForgeKind } from "@scuttle/contracts";

export interface StoredForgeAccount {
  readonly forge: ForgeKind;
  readonly host: string;
  readonly authSource: "oauth" | "token";
  readonly token: string;
  readonly username: string | null;
}

interface AccountRow {
  readonly forge: string;
  readonly host: string;
  readonly auth_source: string;
  readonly token: string;
  readonly username: string | null;
}

const toAccount = (row: AccountRow): StoredForgeAccount | null => {
  const forge = row.forge === "github" || row.forge === "gitlab" ? row.forge : null;
  const authSource =
    row.auth_source === "oauth" || row.auth_source === "token" ? row.auth_source : null;
  if (forge === null || authSource === null) return null;
  return { forge, host: row.host, authSource, token: row.token, username: row.username };
};

export const makeForgeAccountStore = (db: Database) => ({
  get: (forge: ForgeKind): StoredForgeAccount | null => {
    const row = db
      .query<AccountRow, [string]>(
        "SELECT forge, host, auth_source, token, username FROM git_forge_accounts WHERE forge = ?",
      )
      .get(forge);
    return row === null ? null : toAccount(row);
  },
  list: (): ReadonlyArray<StoredForgeAccount> =>
    db
      .query<AccountRow, []>(
        "SELECT forge, host, auth_source, token, username FROM git_forge_accounts",
      )
      .all()
      .map(toAccount)
      .filter((account) => account !== null),
  save: (account: StoredForgeAccount): void => {
    const now = new Date().toISOString();
    db.query(
      `INSERT INTO git_forge_accounts (forge, host, auth_source, token, username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(forge) DO UPDATE SET
         host = excluded.host,
         auth_source = excluded.auth_source,
         token = excluded.token,
         username = excluded.username,
         updated_at = excluded.updated_at`,
    ).run(
      account.forge,
      account.host,
      account.authSource,
      account.token,
      account.username,
      now,
      now,
    );
  },
  remove: (forge: ForgeKind): void => {
    db.query("DELETE FROM git_forge_accounts WHERE forge = ?").run(forge);
  },
});

export type ForgeAccountStore = ReturnType<typeof makeForgeAccountStore>;
