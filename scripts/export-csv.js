const fs = require('fs');
const { csvPath, ensureDataDir, loadWords, toCsv } = require('./shared');

function main() {
  const words = loadWords();
  ensureDataDir();
  fs.writeFileSync(csvPath, toCsv(words), 'utf8');
  console.log(`CSV exported: ${csvPath}`);
  console.log(`Rows exported: ${words.length}`);
}

main();