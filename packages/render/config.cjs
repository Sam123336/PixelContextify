/* The one place @contextifly/render knows about the app it compiles.
   The TS compiler API resolves from the monorepo; the oracle harness must run
   inside the target app (for its node_modules), so its location lives here too. */
const path = require('path');
let ts;
try { ts = require('typescript'); }                                            // monorepo's typescript
catch { ts = require('/Users/sambit/Belivmart/belivmart-admin/node_modules/typescript'); }
module.exports = {
  ts,
  TARGET_APP: '/Users/sambit/Belivmart/belivmart-admin',
  ORACLE_DEPLOY: '/Users/sambit/Belivmart/belivmart-admin/.rcx-oracle', // harness runs here (needs the app's React/Radix)
  ORACLE_MODELS: path.join(__dirname, 'oracle'),                        // real.K*.json land here for diff.cjs
  HOME: __dirname,
};
