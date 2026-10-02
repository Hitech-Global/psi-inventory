'use strict';

const { runWorker } = require('../src/ad-group-import-worker');

runWorker().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
