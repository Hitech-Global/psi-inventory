'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parseInboxFileName, isProductCardFile } = require('../src/product-card-inbox');

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function runImporter({ file, shopId, startDate, endDate }) {
  const script = path.join(__dirname, 'import-product-card.cjs');
  return new Promise((resolve, reject) => {
    let stderr = '';
    const child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        SHOPEE_ANALYTICS_IMPORT_PRODUCT_CARD: 'YES',
        SHOPEE_SHOP_ID: String(shopId),
        SHOPEE_PRODUCT_CARD_FILE: file,
        SHOPEE_PRODUCT_CARD_START_DATE: startDate,
        SHOPEE_PRODUCT_CARD_END_DATE: endDate,
      },
      stdio: ['ignore', 'inherit', 'pipe'],
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Product Card importer exited with code ${code}`));
    });
  });
}

async function moveFile(source, targetDir) {
  await fs.promises.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, path.basename(source));
  try {
    await fs.promises.rename(source, target);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fs.promises.copyFile(source, target);
    await fs.promises.unlink(source);
  }
  return target;
}

async function main() {
  if (process.env.SHOPEE_PRODUCT_CARD_INBOX_ENABLE !== 'YES') {
    throw new Error(
      'Refusing Product Card inbox processing. Set SHOPEE_PRODUCT_CARD_INBOX_ENABLE=YES explicitly.',
    );
  }

  const inbox = required('SHOPEE_PRODUCT_CARD_INBOX_DIR');
  const archive = process.env.SHOPEE_PRODUCT_CARD_ARCHIVE_DIR || path.join(inbox, '..', 'archive');
  const failed = process.env.SHOPEE_PRODUCT_CARD_FAILED_DIR || path.join(inbox, '..', 'failed');

  await fs.promises.mkdir(inbox, { recursive: true });
  const entries = (await fs.promises.readdir(inbox))
    .filter(isProductCardFile)
    .sort();

  const summary = { found: entries.length, imported: 0, failed: 0, files: [] };

  for (const name of entries) {
    const file = path.join(inbox, name);
    const parsed = parseInboxFileName(name);

    if (!parsed) {
      const target = await moveFile(file, failed);
      const message = 'Filename must be shop-<shopId>__...YYYYMMDD_YYYYMMDD.xlsx';
      await fs.promises.writeFile(`${target}.error.txt`, message);
      summary.failed += 1;
      summary.files.push({ name, ok: false, error: message });
      continue;
    }

    try {
      await runImporter({ file, ...parsed });
      await moveFile(file, archive);
      summary.imported += 1;
      summary.files.push({ name, ok: true, ...parsed });
    } catch (error) {
      const target = await moveFile(file, failed);
      const message = error && error.message ? error.message : String(error);
      await fs.promises.writeFile(`${target}.error.txt`, message);
      summary.failed += 1;
      summary.files.push({ name, ok: false, error: message, ...parsed });
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  if (summary.failed) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
