// Usage: npm run backup  — writes a consistent copy of the database to ./backups (or BACKUP_DIR).
// Also: npx tsx server/scripts/backup.ts hash-password "<password>"  — prints APP_PASSWORD_HASH.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, backupDb } from "../db.ts";
import { hashPassword } from "../security.ts";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
if (process.argv[2] === "hash-password") {
  if (!process.argv[3]) throw new Error("Provide a password");
  console.log(hashPassword(process.argv[3]));
} else {
  const db = openDb(process.env.DB_PATH || path.join(root, "data", "portfolio.db"));
  console.log(backupDb(db, process.env.BACKUP_DIR || path.join(root, "backups")));
}
