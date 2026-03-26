#!/usr/bin/env node
/**
 * Browserless BQL executor.
 * Usage: node bql.js <query> [--vars '{"key":"val"}'] [--stealth] [--endpoint <region>]
 * 
 * Env: BROWSERLESS_API_TOKEN (required)
 * 
 * Endpoints: sfo (default), lon, ams
 */

const args = process.argv.slice(2);
if (!args.length || args[0] === '--help') {
  console.log(`Usage: node bql.js '<BQL mutation>' [--vars '{}'] [--stealth] [--endpoint sfo|lon|ams] [--save <file>]`);
  process.exit(0);
}

const token = process.env.BROWSERLESS_API_TOKEN;
if (!token) { console.error('Error: BROWSERLESS_API_TOKEN env var not set'); process.exit(1); }

let query = '';
let variables = null;
let stealth = false;
let endpoint = 'sfo';
let saveFile = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--vars' && args[i + 1]) { variables = JSON.parse(args[++i]); }
  else if (args[i] === '--stealth') { stealth = true; }
  else if (args[i] === '--endpoint' && args[i + 1]) { endpoint = args[++i]; }
  else if (args[i] === '--save' && args[i + 1]) { saveFile = args[++i]; }
  else if (!query) { query = args[i]; }
}

const regions = {
  sfo: 'production-sfo.browserless.io',
  lon: 'production-lon.browserless.io',
  ams: 'production-ams.browserless.io',
};
const host = regions[endpoint] || regions.sfo;
const path = stealth ? '/stealth/bql' : '/chromium/bql';
const url = `https://${host}${path}?token=${token}`;

const body = { query };
if (variables) body.variables = variables;

(async () => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(`HTTP ${res.status}: ${text}`);
      process.exit(1);
    }

    const json = await res.json();

    // If response contains screenshot base64, optionally save to file
    if (saveFile && json.data) {
      const findBase64 = (obj) => {
        if (!obj || typeof obj !== 'object') return null;
        if (obj.base64) return obj.base64;
        for (const v of Object.values(obj)) {
          const found = findBase64(v);
          if (found) return found;
        }
        return null;
      };
      const b64 = findBase64(json.data);
      if (b64) {
        const fs = require('fs');
        fs.writeFileSync(saveFile, Buffer.from(b64, 'base64'));
        console.log(`Screenshot saved to ${saveFile}`);
        // Remove base64 from output to keep it clean
        const clean = JSON.parse(JSON.stringify(json));
        const clearBase64 = (obj) => {
          if (!obj || typeof obj !== 'object') return;
          if (obj.base64) { obj.base64 = `[saved to ${saveFile}]`; return; }
          for (const v of Object.values(obj)) clearBase64(v);
        };
        clearBase64(clean.data);
        console.log(JSON.stringify(clean, null, 2));
        return;
      }
    }

    console.log(JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
