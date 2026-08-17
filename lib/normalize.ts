// Canonical name normalization, shared by every table that dedupes on a
// human-typed name (customers, catalogue items).
//
// This MUST stay byte-identical to the expression used in the SQL backfill in
// prisma/migrations/20260817094425_customers_catalog_quotations/migration.sql
//   lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))
// otherwise a row created by the app and a row created by the backfill could
// produce two different keys for the same name and defeat the unique index.
export function normName(value: string): string {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
