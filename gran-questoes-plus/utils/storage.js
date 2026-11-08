/**
 * Gran Questões Plus — camada de armazenamento e formatação.
 *
 * Este arquivo é carregado no content script, no service worker e no side panel.
 * Ele expõe o objeto global `GranStorage` com métodos assíncronos.
 */
(function (global) {
  'use strict';

  const KEYS = Object.freeze({
    settings: 'gqp_settings',
    lastQuestion: 'gqp_last_question',
    history: 'gqp_history',
    bizus: 'gqp_bizus',
    pendingChatGPT: 'gqp_pending_chatgpt',
    granAuthToken: 'granAuthToken',
    currentFilters: 'currentFilters',
    sessionStats: 'sessionStats',
    historyLog: 'historyLog'
  });

  const DEFAULT_SETTINGS = Object.freeze({
    gptUrl: 'https://chatgpt.com/',
    autoSendChatGPT: true
  });

  const HISTORY_LIMIT = 30;
  const BIZU_LIMIT = 100;
  const BIZU_CONTENT_LIMIT = 10000;
  const ANSWER_HISTORY_LIMIT = 1000;

  // Prompts muito longos não cabem bem na URL. Nesse caso, o injector do
  // ChatGPT usa o prompt salvo em chrome.storage.local como fallback.
  const MAX_PROMPT_URL_LENGTH = 6000;

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  }

  function localStorageKeys(keys) {
    if (Array.isArray(keys)) return keys;
    if (typeof keys === 'string') return [keys];
    if (keys && typeof keys === 'object') return Object.keys(keys);
    return [];
  }

  /**
   * Wrapper de chrome.storage.local.get com fallback para localStorage.
   * O fallback serve apenas para abrir o side panel fora do contexto da extensão
   * durante o desenvolvimento.
   */
  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      if (!hasChromeStorage()) {
        const result = {};
        localStorageKeys(keys).forEach((key) => {
          try {
            const raw = global.localStorage && global.localStorage.getItem(key);
            if (raw != null) result[key] = JSON.parse(raw);
          } catch (error) {
            // Ignora valores inválidos no fallback.
          }
        });
        resolve(result);
        return;
      }

      chrome.storage.local.get(keys, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(result || {});
      });
    });
  }

  function storageSet(values) {
    return new Promise((resolve, reject) => {
      if (!hasChromeStorage()) {
        try {
          Object.entries(values).forEach(([key, value]) => {
            if (global.localStorage) {
              global.localStorage.setItem(key, JSON.stringify(value));
            }
          });
          resolve();
        } catch (error) {
          reject(error);
        }
        return;
      }

      chrome.storage.local.set(values, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise((resolve, reject) => {
      if (!hasChromeStorage()) {
        try {
          localStorageKeys(keys).forEach((key) => {
            if (global.localStorage) global.localStorage.removeItem(key);
          });
          resolve();
        } catch (error) {
          reject(error);
        }
        return;
      }

      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function normalizeGptUrl(value) {
    let raw = String(value || '').trim();
    if (!raw) return DEFAULT_SETTINGS.gptUrl;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

    try {
      const url = new URL(raw);
      if (!/^https?:$/.test(url.protocol)) return DEFAULT_SETTINGS.gptUrl;
      return url.toString();
    } catch (error) {
      return DEFAULT_SETTINGS.gptUrl;
    }
  }

  function buildPrompt(question) {
    if (!question) return '';

    const meta = [];
    const subject = [question.discipline, question.topic].filter(Boolean).join(' / ');

    if (subject) meta.push(`**Disciplina/Assunto:** ${subject}`);
    if (question.banca) meta.push(`**Banca:** ${question.banca}`);
    if (question.year) meta.push(`**Ano:** ${question.year}`);
    if (question.prova) meta.push(`**Prova:** ${question.prova}`);

    const options = (question.options || [])
      .map((option) => `${option.label}) ${option.text}`)
      .join('\n');

    const userAnswer = question.userAnswer
      ? `${question.userAnswer}${question.isWrong ? ' (incorreta)' : ' (correta)'}`
      : 'Não respondida';

    const isCorrect =
      !question.isWrong && Boolean(question.userAnswer || question.resultText);
    const reviewSteps = isCorrect
      ? [
          '2. Explique por que a minha resposta está correta e por que as demais alternativas estão erradas.',
          '3. Aponte qual detalhe poderia gerar dúvida mesmo em uma resposta correta.'
        ]
      : [
          '2. Aponte exatamente o erro da minha resposta.',
          '3. Explique por que as demais alternativas estão erradas.'
        ];

    return [
      'Você é um professor especialista em concursos públicos. Explique a questão abaixo de forma didática, objetiva e aprofundada, com foco no aprendizado para a prova.',
      '',
      `**Questão:** ${question.code || 'Não identificada'}`,
      ...meta,
      '',
      '**Enunciado:**',
      question.statement || '(Enunciado não capturado)',
      '',
      '**Alternativas:**',
      options || '(Alternativas não capturadas)',
      '',
      `**Minha resposta:** ${userAnswer}`,
      `**Gabarito:** ${question.correctAnswer || 'Não identificado'}`,
      ...(isCorrect
        ? ['', '**Observação:** Acertei, mas quero revisar porque fiquei em dúvida.']
        : []),
      '',
      'Por favor:',
      '1. Explique o raciocínio para chegar à alternativa correta.',
      ...reviewSteps,
      '4. Resuma o conteúdo cobrado e dê dicas para não errar novamente.',
      '5. Sugira um bizu ou mnemônico curto para memorizar o ponto principal.'
    ].join('\n');
  }

  function buildBizuPrompt(context) {
    const data = context || {};
    const subject = [data.discipline, data.topic].filter(Boolean).join(' / ');
    const lines = [
      'Você é um professor de concursos públicos especialista em técnicas de memorização.',
      `Crie de 3 a 5 bizus curtos e práticos${subject ? ` sobre ${subject}` : ''}.`,
      'Cada bizu deve ter um título curto, uma regra ou mnemônico e um exemplo rápido.',
      'Priorize pegadinhas de prova e diferenças que costumam confundir.',
      ''
    ];

    if (data.statement) {
      lines.push('Contexto da questão:', data.statement, '');
    }

    lines.push(
      'Formato sugerido:',
      '1. **Título:** ...',
      '   **Bizu:** ...',
      '   **Exemplo:** ...'
    );

    return lines.join('\n');
  }

  function buildCopyText(question) {
    if (!question) return '';

    const header = [question.code, question.banca, question.year].filter(Boolean).join(' • ');
    const subject = [question.discipline, question.topic].filter(Boolean).join(' / ');
    const lines = [];

    if (header) lines.push(header);
    if (subject) lines.push(subject);
    if (question.prova) lines.push(question.prova);

    lines.push('', 'Enunciado:', question.statement || '(não capturado)');
    lines.push('', 'Alternativas:');
    (question.options || []).forEach((option) => {
      lines.push(`${option.label}) ${option.text}`);
    });

    lines.push('', `Sua resposta: ${question.userAnswer || '—'}`);
    lines.push(`Gabarito: ${question.correctAnswer || '—'}`);

    return lines.join('\n').trim();
  }

  function buildChatGPTUrl(baseUrl, prompt) {
    let raw = String(baseUrl || DEFAULT_SETTINGS.gptUrl).trim();
    if (!raw) raw = DEFAULT_SETTINGS.gptUrl;
    if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

    let url;
    try {
      url = new URL(raw);
    } catch (error) {
      url = new URL(DEFAULT_SETTINGS.gptUrl);
    }

    if (prompt && String(prompt).length <= MAX_PROMPT_URL_LENGTH) {
      url.searchParams.set('q', prompt);
    }

    return url.toString();
  }

  async function copyText(text) {
    const value = String(text == null ? '' : text);

    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        await global.navigator.clipboard.writeText(value);
        return true;
      }
    } catch (error) {
      // Tenta o fallback abaixo.
    }

    try {
      const doc = global.document;
      if (!doc || !doc.body) return false;

      const textarea = doc.createElement('textarea');
      textarea.value = value;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.top = '-9999px';
      textarea.style.left = '-9999px';
      textarea.style.opacity = '0';
      doc.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);

      const copied = doc.execCommand('copy');
      textarea.remove();
      return copied;
    } catch (error) {
      return false;
    }
  }

  async function ensureDefaults() {
    const stored = await storageGet([
      KEYS.settings, KEYS.history, KEYS.bizus, KEYS.currentFilters,
      KEYS.sessionStats, KEYS.historyLog
    ]);
    const currentSettings = stored[KEYS.settings] || {};
    const settings = {
      ...DEFAULT_SETTINGS,
      ...currentSettings,
      gptUrl: normalizeGptUrl(currentSettings.gptUrl || DEFAULT_SETTINGS.gptUrl),
      autoSendChatGPT: currentSettings.autoSendChatGPT !== false
    };

    const values = { [KEYS.settings]: settings };
    if (!Array.isArray(stored[KEYS.history])) values[KEYS.history] = [];
    if (!Array.isArray(stored[KEYS.bizus])) values[KEYS.bizus] = [];
    if (!Array.isArray(stored[KEYS.historyLog])) values[KEYS.historyLog] = [];

    await storageSet(values);
  }

  function hashFilter(value) {
    const text = JSON.stringify(value || {});
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  function normalizeFilters(filters) {
    const value = filters || {};
    return {
      searchUrl: String(value.searchUrl || ''),
      assuntoIds: Array.isArray(value.assuntoIds) ? value.assuntoIds.map(String) : [],
      bancaIds: Array.isArray(value.bancaIds) ? value.bancaIds.map(String) : [],
      anoIds: Array.isArray(value.anoIds) ? value.anoIds.map(String) : [],
      resolucao: String(value.resolucao || ''),
      disciplinas: Array.isArray(value.disciplinas) ? value.disciplinas.map(String) : [],
      assuntos: Array.isArray(value.assuntos) ? value.assuntos.map(String) : [],
      bancas: Array.isArray(value.bancas) ? value.bancas.map(String) : []
    };
  }

  async function saveCurrentFilters(filters) {
    const normalized = normalizeFilters(filters);
    const filterKey = hashFilter({
      assuntoIds: normalized.assuntoIds,
      bancaIds: normalized.bancaIds,
      anoIds: normalized.anoIds
    });
    const current = await storageGet([KEYS.currentFilters, KEYS.sessionStats]);
    const previous = current[KEYS.currentFilters] || {};
    const previousStats = current[KEYS.sessionStats] || {};
    const stats = previousStats.filterKey === filterKey
      ? { total: Number(previousStats.total) || 0, acertos: Number(previousStats.acertos) || 0, erros: Number(previousStats.erros) || 0, filterKey }
      : { total: 0, acertos: 0, erros: 0, filterKey };

    await storageSet({
      [KEYS.currentFilters]: { ...normalized, filterKey },
      [KEYS.sessionStats]: stats
    });
    return { ...normalized, filterKey, changed: previous.filterKey !== filterKey };
  }

  let pendingAnswerWrite = Promise.resolve();

  function recordQuestionAnswered(answer) {
    const write = pendingAnswerWrite.then(() => recordQuestionAnsweredNow(answer));
    pendingAnswerWrite = write.catch(() => {});
    return write;
  }

  async function recordQuestionAnsweredNow(answer) {
    const current = await storageGet([KEYS.currentFilters, KEYS.sessionStats, KEYS.historyLog]);
    const filters = current[KEYS.currentFilters] || {};
    const filterKey = filters.filterKey || hashFilter({});
    const previousStats = current[KEYS.sessionStats] || {};
    const stats = previousStats.filterKey === filterKey
      ? { total: Number(previousStats.total) || 0, acertos: Number(previousStats.acertos) || 0, erros: Number(previousStats.erros) || 0, filterKey }
      : { total: 0, acertos: 0, erros: 0, filterKey };
    const history = Array.isArray(current[KEYS.historyLog]) ? current[KEYS.historyLog] : [];
    const id = String(answer && (answer.questaoId || answer.id) || `sem-id-${Date.now()}`);
    const entry = {
      id,
      timestamp: Date.now(),
      disciplina: answer.disciplina || (filters.disciplinas || [])[0] || '',
      assunto: answer.assunto || (filters.assuntos || []).join(' / '),
      banca: answer.banca || (filters.bancas || [])[0] || '',
      acertou: Boolean(answer && answer.acertou),
      filterKey
    };
    const index = history.findIndex((item) => item && item.id === id && item.filterKey === filterKey);
    if (index >= 0) {
      const old = history[index];
      if (old.acertou !== entry.acertou) {
        stats.acertos += entry.acertou ? 1 : -1;
        stats.erros += entry.acertou ? -1 : 1;
      }
      // A mesma questão pode ser capturada pela API e pelo DOM.
      // Preserva a data original e evita duplicar a questão na série histórica.
      entry.timestamp = old.timestamp;
      history[index] = entry;
    } else {
      history.unshift(entry);
      stats.total += 1;
      if (entry.acertou) stats.acertos += 1;
      else stats.erros += 1;
    }

    await storageSet({
      [KEYS.sessionStats]: stats,
      [KEYS.historyLog]: history.slice(0, ANSWER_HISTORY_LIMIT)
    });
    return { entry, stats, history: history.slice(0, ANSWER_HISTORY_LIMIT) };
  }

  async function getPerformanceData() {
    const result = await storageGet([KEYS.currentFilters, KEYS.sessionStats, KEYS.historyLog]);
    return {
      currentFilters: result[KEYS.currentFilters] || null,
      sessionStats: result[KEYS.sessionStats] || { total: 0, acertos: 0, erros: 0, filterKey: '' },
      historyLog: Array.isArray(result[KEYS.historyLog]) ? result[KEYS.historyLog] : []
    };
  }

  async function clearSessionStats() {
    const filters = (await storageGet(KEYS.currentFilters))[KEYS.currentFilters] || {};
    const stats = { total: 0, acertos: 0, erros: 0, filterKey: filters.filterKey || hashFilter({}) };
    await storageSet({ [KEYS.sessionStats]: stats });
    return stats;
  }

  async function getSettings() {
    const result = await storageGet(KEYS.settings);
    const stored = result[KEYS.settings] || {};
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      gptUrl: normalizeGptUrl(stored.gptUrl || DEFAULT_SETTINGS.gptUrl),
      autoSendChatGPT: stored.autoSendChatGPT !== false
    };
  }

  async function saveSettings(partial) {
    const current = await getSettings();
    const next = {
      ...current,
      ...(partial || {})
    };

    next.gptUrl = normalizeGptUrl(next.gptUrl);
    next.autoSendChatGPT = next.autoSendChatGPT !== false;

    await storageSet({ [KEYS.settings]: next });
    return next;
  }

  async function getLastQuestion() {
    const result = await storageGet(KEYS.lastQuestion);
    return result[KEYS.lastQuestion] || null;
  }

  async function setLastQuestion(question) {
    if (!question) return null;
    const value = {
      ...question,
      capturedAt: question.capturedAt || Date.now()
    };
    await storageSet({ [KEYS.lastQuestion]: value });
    return value;
  }

  async function getHistory() {
    const result = await storageGet(KEYS.history);
    return Array.isArray(result[KEYS.history]) ? result[KEYS.history] : [];
  }

  async function addToHistory(question) {
    if (!question) return [];

    const history = await getHistory();
    const entry = {
      ...question,
      savedAt: Date.now()
    };

    const filtered = history.filter((item) => {
      if (!item || !item.code) return true;
      return item.code !== entry.code;
    });

    const next = [entry, ...filtered].slice(0, HISTORY_LIMIT);
    await storageSet({ [KEYS.history]: next });
    return next;
  }

  async function clearHistory() {
    await storageSet({ [KEYS.history]: [] });
    return [];
  }

  async function getBizus() {
    const result = await storageGet(KEYS.bizus);
    return Array.isArray(result[KEYS.bizus]) ? result[KEYS.bizus] : [];
  }

  async function saveBizu(bizu) {
    if (!bizu || !String(bizu.content || '').trim()) {
      return getBizus();
    }

    const bizus = await getBizus();
    const now = Date.now();
    const id = bizu.id || `bizu_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const entry = {
      id,
      title: cleanText(bizu.title || '').slice(0, 120),
      content: bizu.contentFormat === 'html'
        ? String(bizu.content || '').trim().slice(0, BIZU_CONTENT_LIMIT)
        : cleanText(bizu.content).slice(0, 2000),
      contentFormat: bizu.contentFormat === 'html' ? 'html' : 'text',
      discipline: cleanText(bizu.discipline || '').slice(0, 80),
      topic: cleanText(bizu.topic || '').slice(0, 120),
      createdAt: bizu.createdAt || now,
      updatedAt: now
    };

    const filtered = bizus.filter((item) => item && item.id !== id);
    const next = [entry, ...filtered].slice(0, BIZU_LIMIT);
    await storageSet({ [KEYS.bizus]: next });
    return next;
  }

  async function deleteBizu(id) {
    const bizus = await getBizus();
    const next = bizus.filter((item) => item && item.id !== id);
    await storageSet({ [KEYS.bizus]: next });
    return next;
  }

  async function setPendingChatGPT(payload) {
    if (!payload || !payload.prompt) return null;
    const value = {
      ...payload,
      createdAt: payload.createdAt || Date.now()
    };
    await storageSet({ [KEYS.pendingChatGPT]: value });
    return value;
  }

  async function getPendingChatGPT() {
    const result = await storageGet(KEYS.pendingChatGPT);
    return result[KEYS.pendingChatGPT] || null;
  }

  async function clearPendingChatGPT() {
    await storageRemove(KEYS.pendingChatGPT);
  }

  global.GranStorage = {
    KEYS,
    DEFAULT_SETTINGS,
    HISTORY_LIMIT,
    BIZU_LIMIT,
    BIZU_CONTENT_LIMIT,
    ANSWER_HISTORY_LIMIT,
    storageGet,
    storageSet,
    storageRemove,
    cleanText,
    normalizeGptUrl,
    buildPrompt,
    buildBizuPrompt,
    buildCopyText,
    buildChatGPTUrl,
    copyText,
    ensureDefaults,
    getSettings,
    saveSettings,
    getLastQuestion,
    setLastQuestion,
    getHistory,
    addToHistory,
    clearHistory,
    getBizus,
    saveBizu,
    deleteBizu,
    setPendingChatGPT,
    getPendingChatGPT,
    clearPendingChatGPT,
    hashFilter,
    normalizeFilters,
    saveCurrentFilters,
    recordQuestionAnswered,
    getPerformanceData,
    clearSessionStats
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
