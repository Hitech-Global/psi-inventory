'use strict';

/**
 * Inject a GitHub PAT into the WorkBuddy GitHub connector.
 * ============================================================================================
 * The connector's server-side OAuth grant for the GitHub MCP server only carries read
 * scopes, so every write endpoint answers 403 "Resource not accessible by integration"
 * even though the account itself has WRITE on the repository. A personal access token
 * with the `repo` scope can be injected instead, which restores both the MCP write tools
 * and `git push`.
 *
 * The token is stored in the connector state file using the same envelope the app uses:
 *   - AES-256-GCM, iv 12 bytes, tag 16 bytes
 *   - key = HKDF-SHA256(ikm = masterKey || userId, salt = encryption.salt,
 *                        info = "workbuddy-oauth-credentials-v1", len = 32)
 *   - aad  = `${userId}|connector-states:headerOverrides:github|Authorization`
 *
 * Usage:
 *   node scripts/inject-github-pat.js <path-to-pat-file>
 *
 * The PAT file must contain only the token text. The file is read, never echoed.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const USER_ID = '12aa45ef-0cb8-4390-b193-421ffc1ba038';
const CONNECTOR_DIR = path.join(os.homedir(), '.workbuddy', 'connectors', USER_ID);
const STATES_FILE = path.join(CONNECTOR_DIR, 'connector-states.json');
const MASTER_KEY_FILE = path.join(CONNECTOR_DIR, '.master.key');

const INFO = 'workbuddy-oauth-credentials-v1';
const SERVER_KEY = 'connector-states:headerOverrides';
const FIELD_NAME = 'Authorization';

function fail(message) {
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function main() {
  const patFile = process.argv[2];
  if (!patFile) {
    fail('Usage: node scripts/inject-github-pat.js <path-to-pat-file>');
    return;
  }
  if (!fs.existsSync(patFile)) {
    fail(`PAT file not found: ${patFile}`);
    return;
  }
  if (!fs.existsSync(STATES_FILE) || !fs.existsSync(MASTER_KEY_FILE)) {
    fail('Connector credential store not found under ~/.workbuddy/connectors');
    return;
  }

  // Read the token without echoing it.
  const raw = fs.readFileSync(patFile, 'utf8').trim();
  if (!raw) {
    fail('PAT file is empty');
    return;
  }
  if (!/^gh[pousr]_[A-Za-z0-9_]{20,}$|^github_pat_[A-Za-z0-9_]{20,}$/.test(raw)) {
    fail('PAT file does not look like a GitHub token (expected ghp_/gho_/ghu_/ghs_/ghr_ or github_pat_)');
    return;
  }

  const masterKey = fs.readFileSync(MASTER_KEY_FILE);
  const states = JSON.parse(fs.readFileSync(STATES_FILE, 'utf8'));
  const salt = Buffer.from(states.encryption.salt, 'base64');

  const aesKey = Buffer.from(crypto.hkdfSync(
    'sha256',
    Buffer.concat([masterKey, Buffer.from(USER_ID, 'utf8')]),
    salt,
    Buffer.from(INFO, 'utf8'),
    32,
  ));

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(Buffer.from(`${USER_ID}|${SERVER_KEY}:github|${FIELD_NAME}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);

  const envelope = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ciphertext.toString('base64'),
  };

  states.headerOverrides = states.headerOverrides || {};
  states.headerOverrides.github = states.headerOverrides.github || {};
  states.headerOverrides.github[FIELD_NAME] = envelope;

  // Preserve the original file mode (0600).
  fs.writeFileSync(STATES_FILE, `${JSON.stringify(states, null, 2)}\n`, { mode: 0o600 });

  console.log(`Injected PAT into ${STATES_FILE}`);
  console.log('The connector picks the credential up on its next request; restart WorkBuddy if it stays cached.');
}

try {
  main();
} catch (error) {
  fail(error && error.message ? error.message : String(error));
}
