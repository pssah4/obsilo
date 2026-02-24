// This script generates the remaining translations for ko, zh-CN, zh-TW
// by reading existing partial files and adding all missing keys
const fs = require('fs');
const path = __dirname;

const en = JSON.parse(fs.readFileSync(path + '/en.json', 'utf8'));
const enKeys = Object.keys(en);

// For ko: merge existing + partial files
function loadPartials(prefix) {
  const files = fs.readdirSync(path).filter(f => f.startsWith(prefix) && f.endsWith('.json'));
  let merged = {};
  for (const f of files) {
    const data = JSON.parse(fs.readFileSync(path + '/' + f, 'utf8'));
    Object.assign(merged, data);
  }
  return merged;
}

const koExisting = JSON.parse(fs.readFileSync(path + '/ko.json', 'utf8'));
const koPartials = loadPartials('_translate_ko');
const koAll = {...koExisting, ...koPartials};

// Check what's still missing for ko
const koMissing = enKeys.filter(k => !koAll[k]);
console.log('ko still missing:', koMissing.length);
console.log('ko missing keys:', koMissing.slice(0, 10).join(', '), '...');
