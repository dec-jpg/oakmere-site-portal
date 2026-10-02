// Manual schema run. The server also does this on every boot, so this is only
// needed if you want to check the database before deploying.
// Usage: DATABASE_URL=<Railway DATABASE_PUBLIC_URL> node scripts/migrate.js
const { pool, migrate } = require('../lib/db');
migrate().then(() => { console.log('Schema up to date.'); return pool.end(); })
  .catch(e => { console.error(e); process.exit(1); });
