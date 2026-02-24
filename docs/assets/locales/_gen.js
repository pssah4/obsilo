// Usage: node _gen.js <lang> <translations-file>
// Merges translations into existing locale, ordered by en.json keys
const fs = require('fs');
const lang = process.argv[2];
const trFile = process.argv[3];
const en = JSON.parse(fs.readFileSync(__dirname + '/en.json', 'utf8'));
const existing = JSON.parse(fs.readFileSync(__dirname + '/' + lang + '.json', 'utf8'));
const tr = JSON.parse(fs.readFileSync(trFile, 'utf8'));
const merged = {};
let fallback = 0;
for (const key of Object.keys(en)) {
  if (tr[key]) merged[key] = tr[key];
  else if (existing[key]) merged[key] = existing[key];
  else { merged[key] = en[key]; fallback++; }
}
fs.writeFileSync(__dirname + '/' + lang + '.json', JSON.stringify(merged, null, 2) + '\n');
console.log(lang + '.json: ' + Object.keys(merged).length + ' keys written, ' + fallback + ' English fallbacks');
