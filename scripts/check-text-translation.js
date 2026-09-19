// Explicit, paid smoke check. Does not start Telegram polling or send messages.
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { createTextTranslator } = require('../text-translator');
const { readFile } = require('node:fs/promises');

async function main() {
  const dictionary = JSON.parse(await readFile(path.join(__dirname, '..', 'words.json'), 'utf8'));
  const translator = createTextTranslator({ loadDictionary: async () => dictionary });
  for (const [userId, target, text] of [[1, 'crh', 'Я читаю книгу.'], [2, 'ru', 'Men kitap oquyım.']]) {
    const result = await translator.translate({ userId, target, text });
    console.log(JSON.stringify({ target, text, result }));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
