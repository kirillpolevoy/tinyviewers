#!/usr/bin/env node
// Print the Jev-first schema section (lib/schema-jevfirst.js), or with --write regenerate
// schema-jevfirst.sql from it. The API applies the same SQL by itself on a cold start
// (lib/ensure-schema.js), so this is for reading it, or applying it by hand:
//
//   node scripts/emit-schema.mjs            > jevfirst.sql      # the SQL, to stdout
//   node scripts/emit-schema.mjs --write                         # rewrite schema-jevfirst.sql
//   node scripts/emit-schema.mjs --full                          # schema.sql + the Jev-first section
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JEVFIRST_SCHEMA_SQL } from '../lib/schema-jevfirst.js';
import { schemaSql } from '../lib/db.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(root, 'schema-jevfirst.sql'), JEVFIRST_SCHEMA_SQL);
  console.error('wrote schema-jevfirst.sql');
} else {
  process.stdout.write(process.argv.includes('--full') ? schemaSql() : JEVFIRST_SCHEMA_SQL);
}
