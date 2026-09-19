const { randomUUID } = require('node:crypto');

const HELP = 'Перевод текста (экспериментальный):\n/text crh — русский → крымскотатарский (латиница)\n/text ru — крымскотатарский → русский\nМожно добавить текст после команды.\n/dictionary — вернуться к словарю.\nДо 2000 символов. Текст передаётся OpenAI; перевод может содержать ошибки.';

function registerTextMode({ bot, translator, logReport, pool }) {
  const modes = new Map();
  const reports = new Map();
  const key = message => `${message.chat.id}:${message.from?.id}`;
  const send = (id, text, options) => bot.sendMessage(id, text, options);
  const guard = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(() => {
    console.error('Text mode operation failed.');
  });

  async function translate(message, text, target) {
    try {
      const result = await translator.translate({ text, target, userId: message.from?.id || message.chat.id });
      const id = randomUUID();
      for (const [reportId, entry] of reports) if (entry.expires < Date.now()) reports.delete(reportId);
      if (reports.size >= 500) reports.delete(reports.keys().next().value);
      reports.set(id, { owner: key(message), text, target, result, expires: Date.now() + 86400000 });
      // Split by code point so emoji/surrogate pairs stay intact.
      const chars = Array.from(`Машинный перевод · ${target === 'crh' ? 'крымскотатарский' : 'русский'}\n\n${result}`);
      while (chars.length) {
        const chunk = chars.splice(0, 1800).join('');
        await send(message.chat.id, chunk, chars.length ? {} : {
          reply_markup: { inline_keyboard: [[{ text: '⚠️ Ошибка перевода', callback_data: `text-report:${id}` }]] }
        });
      }
    } catch (error) {
      const { TranslationError } = require('./text-translator');
      await send(message.chat.id, error instanceof TranslationError ? error.message : 'Не удалось отправить перевод. Попробуйте позже.');
    }
  }

  bot.onText(/^\/text(?:@\w+)?(?:\s+(crh|ru))?(?:\s+([\s\S]+))?$/i, guard(async (message, match) => {
    const target = match[1]?.toLowerCase();
    if (!target) return send(message.chat.id, HELP);
    if (modes.size >= 10000) modes.delete(modes.keys().next().value);
    modes.set(key(message), target);
    if (match[2]) return translate(message, match[2], target);
    return send(message.chat.id, `${HELP}\n\nВыбрано: ${target === 'crh' ? 'на крымскотатарский' : 'на русский'}. Отправьте текст.`);
  }));
  bot.onText(/^\/dictionary(?:@\w+)?$/i, guard(async message => {
    modes.delete(key(message));
    await send(message.chat.id, 'Режим словаря. Отправьте слово или используйте /translate <слово>.');
  }));
  bot.on('callback_query', guard(async query => {
    if (!query.data?.startsWith('text-report:') || !query.message) return;
    const id = query.data.slice('text-report:'.length);
    const entry = reports.get(id);
    if (!entry || entry.expires < Date.now() || entry.owner !== `${query.message.chat.id}:${query.from.id}`) {
      return bot.answerCallbackQuery(query.id, { text: 'Кнопка недоступна. Отправьте отзыв через /report.' });
    }
    try {
      await logReport(pool, { chatId: query.message.chat.id, username: query.from.username,
        firstName: query.from.first_name,
        word: `[Перевод текста → ${entry.target}]\nИсходный текст:\n${entry.text}\nПеревод:\n${entry.result}` });
      reports.delete(id);
      await bot.answerCallbackQuery(query.id, { text: 'Спасибо! Ошибка передана администратору.' });
    } catch {
      await bot.answerCallbackQuery(query.id, { text: 'Не удалось сохранить отзыв. Попробуйте позже.' });
    }
  }));
  return {
    handle(message) {
      const target = modes.get(key(message));
      if (!target) return false;
      void guard(translate)(message, message.text, target);
      return true;
    }
  };
}

module.exports = { registerTextMode, HELP };
