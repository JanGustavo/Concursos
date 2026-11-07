/**
 * Gran Questões Plus — lógica do side panel.
 */
(function () {
  'use strict';

  const $ = (selector, root) => (root || document).querySelector(selector);

  let els = {};
  let currentQuestion = null;
  let editingBizu = null;
  let settings = { ...GranStorage.DEFAULT_SETTINGS };
  let toastTimer = null;
  let performancePeriod = 'session';

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    cacheElements();
    bindEvents();
    setFooterVersion();
    registerStorageListener();
    registerRuntimeListener();

    try {
      settings = await GranStorage.getSettings();
      fillSettingsForm();

      const lastQuestion = await GranStorage.getLastQuestion();
      if (lastQuestion) {
        renderQuestion(lastQuestion);
      } else {
        showEmpty();
      }

      function setFooterVersion() {
        if (!els.footerVersion || typeof chrome === 'undefined' || !chrome.runtime) return;
        const manifest = chrome.runtime.getManifest();
        if (manifest && manifest.version) {
          els.footerVersion.textContent = `v${manifest.version}`;
        }
      }

      await renderHistory();
      await renderBizus();
      await renderPerformance();
      const performanceData = await GranStorage.getPerformanceData();
      const tokenData = await GranStorage.storageGet(GranStorage.KEYS.granAuthToken);
      if (hasActiveFilter(performanceData.currentFilters) && performanceData.currentFilters.searchUrl && tokenData[GranStorage.KEYS.granAuthToken]) {
        handleSyncTotals(true);
      }
      await checkForUpdates(false);
    } catch (error) {
      console.error('[Gran Questões Plus] Falha ao carregar dados:', error);
      showEmpty();
      showToast('Não foi possível carregar os dados salvos.', 'error');
    }

  }

  function registerStorageListener() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(handleStorageChange);
    }

    function registerRuntimeListener() {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
          if (message && message.type === 'QUESTION_READY' && message.question) {
            renderQuestion(message.question);
            switchTab('question');
          }
        });
      }
    }
  }

  function cacheElements() {
    els = {
      emptyState: $('#emptyState'),
      questionView: $('#questionView'),
      questionCode: $('#questionCode'),
      questionBanca: $('#questionBanca'),
      questionYear: $('#questionYear'),
      questionSubject: $('#questionSubject'),
      questionLink: $('#questionLink'),
      questionProva: $('#questionProva'),
      questionStatement: $('#questionStatement'),
      optionsList: $('#optionsList'),
      userAnswerBox: $('#userAnswerBox'),
      userAnswer: $('#userAnswer'),
      correctAnswer: $('#correctAnswer'),
      openChatGPTBtn: $('#openChatGPTBtn'),
      copyBtn: $('#copyBtn'),
      saveBtn: $('#saveBtn'),
      noteInput: $('#noteInput'),
      historySection: $('#historySection'),
      historyList: $('#historyList'),
      clearHistoryBtn: $('#clearHistoryBtn'),
      questionTabBtn: $('#questionTabBtn'),
      bizusTabBtn: $('#bizusTabBtn'),
      questionTab: $('#questionTab'),
      bizusTab: $('#bizusTab'),
      bizuForm: $('#bizuForm'),
      bizuIdInput: $('#bizuIdInput'),
      bizuDisciplineInput: $('#bizuDisciplineInput'),
      bizuDisciplineOptions: $('#bizuDisciplineOptions'),
      bizuTitleInput: $('#bizuTitleInput'),
      bizuContentInput: $('#bizuContentInput'),
      bizuHtmlInput: $('#bizuHtmlInput'),
      bizuFileInput: $('#bizuFileInput'),
      cancelBizuEditBtn: $('#cancelBizuEditBtn'),
      saveBizuBtn: $('#saveBizuBtn'),
      suggestBizuBtn: $('#suggestBizuBtn'),
      bizusEmpty: $('#bizusEmpty'),
      bizusList: $('#bizusList'),
      openSettingsBtn: $('#openSettingsBtn'),
      closeSettingsBtn: $('#closeSettingsBtn'),
      settingsOverlay: $('#settingsOverlay'),
      gptUrlInput: $('#gptUrlInput'),
      autoSendInput: $('#autoSendInput'),
      resetGptUrlBtn: $('#resetGptUrlBtn'),
      saveSettingsBtn: $('#saveSettingsBtn'),
      toast: $('#toast'),
      performanceCard: $('#performanceCard'),
      activeFilterLabel: $('#activeFilterLabel'),
      performanceScore: $('#performanceScore'),
      performancePercent: $('#performancePercent'),
      performanceBar: $('#performanceBar'),
      clearSessionBtn: $('#clearSessionBtn'),
      syncTotalsBtn: $('#syncTotalsBtn'),
      syncedTotals: $('#syncedTotals'),
      performancePeriods: Array.from(document.querySelectorAll('.performance-period')),
      updateBanner: $('#updateBanner'),
      updateBannerTitle: $('#updateBannerTitle'),
      downloadUpdateBtn: $('#downloadUpdateBtn'),
      checkUpdateBtn: $('#checkUpdateBtn'),
      updateStatus: $('#updateStatus'),
      footerVersion: $('#footerVersion')
    };
  }

  function bindEvents() {
    els.openChatGPTBtn.addEventListener('click', handleOpenChatGPT);
    els.copyBtn.addEventListener('click', handleCopy);
    els.saveBtn.addEventListener('click', handleSave);
    els.clearHistoryBtn.addEventListener('click', handleClearHistory);
    els.clearSessionBtn.addEventListener('click', handleClearSession);
    els.syncTotalsBtn.addEventListener('click', handleSyncTotals);
    els.downloadUpdateBtn.addEventListener('click', handleDownloadUpdate);
    els.checkUpdateBtn.addEventListener('click', () => checkForUpdates(true));
    els.performancePeriods.forEach((button) => {
      button.addEventListener('click', () => {
        performancePeriod = button.dataset.period || 'session';
        els.performancePeriods.forEach((item) => item.classList.toggle('performance-period--active', item === button));
        renderPerformance();
      });
    });

    els.questionTabBtn.addEventListener('click', () => switchTab('question'));
    els.bizusTabBtn.addEventListener('click', () => switchTab('bizus'));
    els.bizuForm.addEventListener('submit', handleSaveBizu);
    els.cancelBizuEditBtn.addEventListener('click', resetBizuForm);
    els.suggestBizuBtn.addEventListener('click', handleSuggestBizu);
    els.bizuFileInput.addEventListener('change', handleBizuFile);

    els.openSettingsBtn.addEventListener('click', openSettings);
    els.closeSettingsBtn.addEventListener('click', closeSettings);
    els.saveSettingsBtn.addEventListener('click', handleSaveSettings);
    els.resetGptUrlBtn.addEventListener('click', handleResetGptUrl);

    els.settingsOverlay.addEventListener('click', (event) => {
      if (event.target === els.settingsOverlay) closeSettings();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !els.settingsOverlay.hidden) {
        closeSettings();
      }

    });
  }

  async function checkForUpdates(force) {
    els.checkUpdateBtn.disabled = true;
    if (force) els.updateStatus.textContent = 'Verificando...';
    const result = await sendMessage({ type: 'CHECK_FOR_UPDATE', force });
    els.checkUpdateBtn.disabled = false;

    if (!result || !result.status) {
      els.updateBanner.hidden = true;
      els.updateStatus.textContent = 'Servidor de atualização indisponível no momento.';
    } else if (result.status === 'update') {
      els.updateBannerTitle.textContent = `Nova versão v${result.remoteVersion} disponível`;
      els.updateBanner.hidden = false;
      els.downloadUpdateBtn.dataset.downloadUrl = result.downloadUrl;
      els.updateStatus.textContent = '';
    } else if (result.status === 'error') {
      els.updateBanner.hidden = true;
      els.updateStatus.textContent = result.message;
    } else {
      els.updateBanner.hidden = true;
      els.updateStatus.textContent = force ? 'Você já está na versão mais recente.' : '';
    }
  }

  function handleDownloadUpdate() {
    const url = els.downloadUpdateBtn.dataset.downloadUrl;
    if (!url || typeof chrome === 'undefined' || !chrome.downloads) {
      showToast('Não foi possível iniciar o download.', 'error');
      return;
    }

    chrome.downloads.download({
      url,
      filename: 'gran-questoes-plus.zip',
      saveAs: true
    }, () => {
      if (chrome.runtime.lastError) {
        showToast('Não foi possível iniciar o download.', 'error');
        return;
      }
      showToast('Baixe o ZIP e recarregue em chrome://extensions.');
    });
  }

  function handleStorageChange(changes, areaName) {
    if (areaName !== 'local') return;

    if (changes[GranStorage.KEYS.lastQuestion]) {
      const question = changes[GranStorage.KEYS.lastQuestion].newValue;
      if (question) {
        renderQuestion(question);
        switchTab('question');
      } else {
        showEmpty();
      }
    }

    if (changes[GranStorage.KEYS.history]) {
      renderHistory(changes[GranStorage.KEYS.history].newValue || []);
      refreshDisciplineOptions();
    }

    if (changes[GranStorage.KEYS.bizus]) {
      renderBizus(changes[GranStorage.KEYS.bizus].newValue || []);
    }

    if (
      changes[GranStorage.KEYS.currentFilters] ||
      changes[GranStorage.KEYS.sessionStats] ||
      changes[GranStorage.KEYS.historyLog]
    ) {
      renderPerformance();
      if (changes[GranStorage.KEYS.currentFilters]) handleSyncTotals(true);
    }

    if (changes[GranStorage.KEYS.settings]) {
      settings = {
        ...GranStorage.DEFAULT_SETTINGS,
        ...(changes[GranStorage.KEYS.settings].newValue || {})
      };
      fillSettingsForm();
    }
  }

  function renderQuestion(question) {
    if (!question) {
      showEmpty();
      return;
    }

    const isNewQuestion = !currentQuestion || currentQuestion.code !== question.code;
    currentQuestion = question;

    els.emptyState.hidden = true;
    els.questionView.hidden = false;

    els.questionCode.textContent = question.code || 'Questão';

    els.questionBanca.textContent = question.banca || '';
    els.questionBanca.hidden = !question.banca;

    els.questionYear.textContent = question.year ? `Ano ${question.year}` : '';
    els.questionYear.hidden = !question.year;

    const subject = [question.discipline, question.topic].filter(Boolean).join(' / ');
    els.questionSubject.textContent = subject || 'Disciplina não identificada';

    els.questionProva.textContent = question.prova ? `Prova: ${question.prova}` : '';
    els.questionProva.hidden = !question.prova;

    els.questionStatement.textContent = question.statement || 'Enunciado não capturado.';

    if (question.url) {
      els.questionLink.href = question.url;
      els.questionLink.hidden = false;
    } else {
      els.questionLink.hidden = true;
    }

    renderOptions(question);

    els.userAnswer.textContent = question.userAnswer || '—';
    els.correctAnswer.textContent = question.correctAnswer || '—';

    const answeredCorrectly =
      !question.isWrong && Boolean(question.userAnswer || question.resultText);
    els.userAnswerBox.classList.toggle('answer-summary__item--correct', answeredCorrectly);
    els.userAnswerBox.classList.toggle('answer-summary__item--wrong', !answeredCorrectly);

    if (isNewQuestion) {
      els.noteInput.value = '';
    }

    refreshDisciplineOptions();
  }

  function renderOptions(question) {
    els.optionsList.textContent = '';

    const options = Array.isArray(question.options) ? question.options : [];

    if (!options.length) {
      const emptyItem = document.createElement('li');
      emptyItem.className = 'option option--empty';
      emptyItem.textContent = 'Alternativas não capturadas.';
      els.optionsList.appendChild(emptyItem);
      return;
    }

    options.forEach((option) => {
      const item = document.createElement('li');
      item.className = 'option';

      if (option.correct) item.classList.add('option--correct');
      if (option.selected && option.wrong) item.classList.add('option--wrong');
      if (option.selected) item.classList.add('option--selected');

      const letter = document.createElement('span');
      letter.className = 'option__letter';
      letter.textContent = option.label || '?';

      const text = document.createElement('span');
      text.className = 'option__text';
      text.textContent = option.text || '';

      item.append(letter, text);

      if (option.correct && option.selected) {
        const tag = document.createElement('span');
        tag.className = 'option__tag option__tag--correct';
        tag.textContent = 'Gabarito / sua resposta';
        item.appendChild(tag);
      } else if (option.correct) {
        const tag = document.createElement('span');
        tag.className = 'option__tag option__tag--correct';
        tag.textContent = 'Gabarito';
        item.appendChild(tag);
      } else if (option.selected && option.wrong) {
        const tag = document.createElement('span');
        tag.className = 'option__tag option__tag--wrong';
        tag.textContent = 'Sua resposta';
        item.appendChild(tag);
      } else if (option.selected) {
        const tag = document.createElement('span');
        tag.className = 'option__tag option__tag--neutral';
        tag.textContent = 'Sua resposta';
        item.appendChild(tag);
      }

      els.optionsList.appendChild(item);
    });
  }

  function showEmpty() {
    currentQuestion = null;
    els.emptyState.hidden = false;
    els.questionView.hidden = true;
    els.noteInput.value = '';
  }

  function createHistoryItem(item) {
    const listItem = document.createElement('li');
    listItem.className = 'history__item';

    const loadButton = document.createElement('button');
    loadButton.type = 'button';
    loadButton.className = 'history__button';
    loadButton.title = 'Carregar esta revisão';

    const code = document.createElement('span');
    code.className = 'history__code';
    code.textContent = item.code || 'Questão';

    const subject = document.createElement('span');
    subject.className = 'history__subject';
    subject.textContent =
      [item.discipline, item.topic].filter(Boolean).join(' / ') || 'Sem disciplina';

    const date = document.createElement('span');
    date.className = 'history__date';
    date.textContent = item.savedAt ? formatDate(item.savedAt) : '';

    loadButton.append(code, subject, date);
    loadButton.addEventListener('click', () => {
      renderQuestion(item);
      if (item.note) els.noteInput.value = item.note;
      showToast('Revisão carregada.');
    });

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'history__remove';
    removeButton.setAttribute('aria-label', 'Remover revisão');
    removeButton.title = 'Remover revisão';
    removeButton.textContent = '×';
    removeButton.addEventListener('click', () => handleRemoveHistory(item.code));

    listItem.append(loadButton, removeButton);
    return listItem;
  }

  async function renderHistory(history) {
    const items = Array.isArray(history) ? history : await GranStorage.getHistory();

    els.historySection.hidden = items.length === 0;
    els.historyList.textContent = '';

    const groups = new Map();

    items.forEach((item) => {
      const discipline = String(item.discipline || '').trim() || 'Sem disciplina';
      if (!groups.has(discipline)) groups.set(discipline, []);
      groups.get(discipline).push(item);
    });

    Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .forEach(([discipline, groupItems]) => {
        const groupItem = document.createElement('li');
        groupItem.className = 'history__group';

        const details = document.createElement('details');
        details.className = 'history__group-details';
        details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'history__group-summary';

        const name = document.createElement('span');
        name.className = 'history__group-name';
        name.textContent = discipline;

        const count = document.createElement('span');
        count.className = 'history__group-count';
        count.textContent = String(groupItems.length);

        summary.append(name, count);

        const groupList = document.createElement('ul');
        groupList.className = 'history__group-list';

        groupItems
          .slice()
          .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
          .forEach((item) => groupList.appendChild(createHistoryItem(item)));

        details.append(summary, groupList);
        groupItem.appendChild(details);
        els.historyList.appendChild(groupItem);
      });

    refreshDisciplineOptions();
  }

  async function handleRemoveHistory(code) {
    const history = await GranStorage.getHistory();
    const next = history.filter((item) => item.code !== code);
    await GranStorage.storageSet({ [GranStorage.KEYS.history]: next });
    renderHistory(next);
    showToast('Revisão removida.');
  }

  async function handleCopy() {
    if (!currentQuestion) return;

    const text = GranStorage.buildCopyText(currentQuestion);
    const copied = await GranStorage.copyText(text);

    showToast(
      copied ? 'Questão + gabarito copiados!' : 'Não foi possível copiar. Tente novamente.',
      copied ? 'success' : 'error'
    );
  }

  async function handleSave() {
    if (!currentQuestion) return;

    const note = els.noteInput.value.trim();
    await GranStorage.addToHistory({ ...currentQuestion, note });
    await renderHistory();

    showToast('Revisão salva no histórico.');
  }

  async function openChatGPTWithPrompt(prompt) {
    if (!prompt) return false;

    const url = GranStorage.buildChatGPTUrl(settings.gptUrl, prompt);
    const copied = await GranStorage.copyText(prompt);

    await GranStorage.setPendingChatGPT({
      prompt,
      createdAt: Date.now(),
      autoSend: settings.autoSendChatGPT !== false
    });

    try {
      const response = await sendMessage({ type: 'OPEN_CHATGPT', url, prompt });
      if (!response || !response.ok) {
        throw new Error(
          response && response.error ? response.error : 'Falha ao abrir o ChatGPT.'
        );
      }

      showToast(
        copied ? 'Prompt copiado. ChatGPT aberto em nova aba.' : 'ChatGPT aberto em nova aba.'
      );
      return true;
    } catch (error) {
      try {
        if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.create) {
          throw new Error('chrome.tabs indisponível.');
        }
        await chrome.tabs.create({ url });
        showToast(
          copied ? 'Prompt copiado. ChatGPT aberto em nova aba.' : 'ChatGPT aberto em nova aba.'
        );
        return true;
      } catch (fallbackError) {
        showToast(
          'Não foi possível abrir o ChatGPT. O prompt foi copiado para a área de transferência.',
          'error'
        );
        return false;
      }
    }
  }

  async function handleOpenChatGPT() {
    if (!currentQuestion) return;

    await openChatGPTWithPrompt(GranStorage.buildPrompt(currentQuestion));
  }

  async function handleClearHistory() {
    const history = await GranStorage.getHistory();
    if (!history.length) return;

    const confirmed = window.confirm('Remover todas as revisões salvas?');
    if (!confirmed) return;

    await GranStorage.clearHistory();
    renderHistory([]);
    showToast('Histórico limpo.');
  }

  function hasActiveFilter(filters) {
    return Boolean(
      filters &&
      ((filters.assuntoIds || []).length ||
        (filters.bancaIds || []).length ||
        (filters.anoIds || []).length ||
        (filters.disciplinas || []).length ||
        (filters.assuntos || []).length ||
        (filters.bancas || []).length)
    );
  }

  function filterHistory(items, filters) {
    if (!hasActiveFilter(filters)) return items;
    return items.filter((item) => item && item.filterKey === filters.filterKey);
  }

  async function renderPerformance() {
    if (!els.performanceScore) return;

    const data = await GranStorage.getPerformanceData();
    const filters = data.currentFilters || {};
    const active = hasActiveFilter(filters);
    const now = Date.now();
    const since = performancePeriod === 'session'
      ? 0
      : now - Number(performancePeriod) * 24 * 60 * 60 * 1000;
    const items = filterHistory(data.historyLog, filters)
      .filter((item) => !since || Number(item.timestamp) >= since);
    const total = performancePeriod === 'session' && data.sessionStats.filterKey === filters.filterKey
      ? Number(data.sessionStats.total) || 0
      : items.length;
    const acertos = performancePeriod === 'session' && data.sessionStats.filterKey === filters.filterKey
      ? Number(data.sessionStats.acertos) || 0
      : items.filter((item) => item.acertou).length;
    const percent = total ? Math.round((acertos / total) * 100) : 0;

    const labels = [
      ...(filters.disciplinas || []),
      ...(filters.assuntos || []),
      ...(filters.bancas || [])
    ];
    els.activeFilterLabel.textContent = labels.length
      ? labels.slice(0, 3).join(' • ')
      : 'Questões respondidas';
    els.performanceScore.textContent = `${acertos} / ${total}`;
    els.performancePercent.textContent = `${percent}%`;
    els.performanceBar.style.width = `${percent}%`;
    els.syncTotalsBtn.hidden = !active || !filters.searchUrl;
    els.clearSessionBtn.hidden = false;
  }

  async function handleClearSession() {
    await GranStorage.clearSessionStats();
    await renderPerformance();
    showToast('Placar da sessão zerado.');
  }

  function getTotalFromResponse(data) {
    if (!data || typeof data !== 'object') return null;
    if (Array.isArray(data)) {
      for (const item of data) {
        const total = getTotalFromResponse(item);
        if (total != null) return total;
      }
      return null;
    }
    for (const [key, value] of Object.entries(data)) {
      if (/^(total|totalcount|total_count)$/i.test(key) && Number.isFinite(Number(value))) {
        return Number(value);
      }
      if (value && typeof value === 'object') {
        const total = getTotalFromResponse(value);
        if (total != null) return total;
      }
    }
    return null;
  }

  async function fetchFilterTotal(filters, resolution, token) {
    const url = new URL(filters.searchUrl);
    url.searchParams.set('perPage', '1');
    url.searchParams.set('resolucao', resolution);
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Authorization: token },
      credentials: 'include'
    });
    if (!response.ok) throw new Error(`Busca ${resolution} retornou HTTP ${response.status}.`);
    const total = getTotalFromResponse(await response.json());
    if (total == null) throw new Error(`A resposta de ${resolution} não informou total.`);
    return total;
  }

  async function handleSyncTotals(silent) {
    const data = await GranStorage.getPerformanceData();
    const tokenResult = await GranStorage.storageGet(GranStorage.KEYS.granAuthToken);
    const token = tokenResult[GranStorage.KEYS.granAuthToken];
    if (!data.currentFilters || !data.currentFilters.searchUrl || !token) {
      if (!silent) showToast('Faça uma busca no Gran para capturar filtro e autenticação.', 'error');
      return;
    }

    els.syncTotalsBtn.disabled = true;
    els.syncTotalsBtn.textContent = 'Sincronizando...';
    try {
      const [acertos, erros] = await Promise.all([
        fetchFilterTotal(data.currentFilters, 'CERTAS', token),
        fetchFilterTotal(data.currentFilters, 'ERRADAS', token)
      ]);
      els.syncedTotals.textContent = `Total da conta neste filtro: ${acertos} certas • ${erros} erradas`;
      els.syncedTotals.hidden = false;
      if (!silent) showToast('Totais do filtro sincronizados.');
    } catch (error) {
      console.error('[Gran Questões Plus] Falha ao sincronizar totais:', error);
      if (!silent) showToast('Não foi possível sincronizar os totais deste filtro.', 'error');
    } finally {
      els.syncTotalsBtn.disabled = false;
      els.syncTotalsBtn.textContent = 'Sincronizar totais do filtro';
    }
  }

  function switchTab(tabName) {
    const isQuestion = tabName !== 'bizus';

    els.questionTab.hidden = !isQuestion;
    els.bizusTab.hidden = isQuestion;
    els.questionTabBtn.classList.toggle('tab--active', isQuestion);
    els.bizusTabBtn.classList.toggle('tab--active', !isQuestion);
    els.questionTabBtn.setAttribute('aria-selected', String(isQuestion));
    els.bizusTabBtn.setAttribute('aria-selected', String(!isQuestion));
  }

  function createBizuCard(bizu) {
    const item = document.createElement('li');
    item.className = 'bizu-card';

    const top = document.createElement('div');
    top.className = 'bizu-card__top';

    const title = document.createElement('h3');
    title.className = 'bizu-card__title';
    title.textContent = bizu.title || 'Bizu';

    const actions = document.createElement('div');
    actions.className = 'bizu-card__actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'icon-button icon-button--small';
    editButton.title = 'Editar bizu';
    editButton.setAttribute('aria-label', 'Editar bizu');
    editButton.textContent = '✎';
    editButton.addEventListener('click', () => handleEditBizu(bizu));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'icon-button icon-button--small bizu-card__delete';
    deleteButton.title = 'Remover bizu';
    deleteButton.setAttribute('aria-label', 'Remover bizu');
    deleteButton.textContent = '×';
    deleteButton.addEventListener('click', () => handleDeleteBizu(bizu));

    actions.append(editButton, deleteButton);
    top.append(title, actions);

    const content = document.createElement('div');
    content.className = 'bizu-card__content';
    if (bizu.contentFormat === 'html') {
      content.classList.add('bizu-card__content--html');
      content.appendChild(createSafeHtmlFragment(bizu.content || ''));
    } else {
      content.textContent = bizu.content || '';
    }

    const meta = document.createElement('div');
    meta.className = 'bizu-card__meta';
    meta.textContent = [
      bizu.discipline,
      bizu.updatedAt ? formatDate(bizu.updatedAt) : ''
    ]
      .filter(Boolean)
      .join(' • ');

    item.append(top, content, meta);
    return item;
  }

  async function renderBizus(bizus) {
    const items = Array.isArray(bizus) ? bizus : await GranStorage.getBizus();

    els.bizusEmpty.hidden = items.length > 0;
    els.bizusList.textContent = '';

    const groups = new Map();

    items.forEach((item) => {
      const discipline = String(item.discipline || '').trim() || 'Sem disciplina';
      if (!groups.has(discipline)) groups.set(discipline, []);
      groups.get(discipline).push(item);
    });

    Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'))
      .forEach(([discipline, groupItems]) => {
        const groupItem = document.createElement('li');
        groupItem.className = 'history__group';

        const details = document.createElement('details');
        details.className = 'history__group-details';
        details.open = true;

        const summary = document.createElement('summary');
        summary.className = 'history__group-summary';

        const name = document.createElement('span');
        name.className = 'history__group-name';
        name.textContent = discipline;

        const count = document.createElement('span');
        count.className = 'history__group-count';
        count.textContent = String(groupItems.length);

        summary.append(name, count);

        const groupList = document.createElement('ul');
        groupList.className = 'history__group-list';

        groupItems
          .slice()
          .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
          .forEach((item) => groupList.appendChild(createBizuCard(item)));

        details.append(summary, groupList);
        groupItem.appendChild(details);
        els.bizusList.appendChild(groupItem);
      });

    refreshDisciplineOptions();
  }

  async function refreshDisciplineOptions() {
    if (!els.bizuDisciplineOptions) return;

    try {
      const [history, bizus] = await Promise.all([
        GranStorage.getHistory(),
        GranStorage.getBizus()
      ]);
      const disciplines = new Set();

      history.forEach((item) => {
        if (item && item.discipline) disciplines.add(item.discipline);
      });
      bizus.forEach((item) => {
        if (item && item.discipline) disciplines.add(item.discipline);
      });
      if (currentQuestion && currentQuestion.discipline) {
        disciplines.add(currentQuestion.discipline);
      }

      els.bizuDisciplineOptions.textContent = '';

      Array.from(disciplines)
        .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        .forEach((discipline) => {
          const option = document.createElement('option');
          option.value = discipline;
          els.bizuDisciplineOptions.appendChild(option);
        });
    } catch (error) {
      // O datalist é apenas uma ajuda; falhas aqui não impedem o uso.
    }
  }

  async function handleSaveBizu(event) {
    event.preventDefault();

    const content = els.bizuContentInput.value.trim();
    if (!content) {
      showToast('Escreva o bizu antes de salvar.', 'error');
      els.bizuContentInput.focus();
      return;
    }

    const id = els.bizuIdInput.value.trim();
    const isEditing = Boolean(id);
    const discipline = els.bizuDisciplineInput.value.trim();

    try {
      await GranStorage.saveBizu({
        id: id || undefined,
        title: els.bizuTitleInput.value.trim(),
        content,
        contentFormat: els.bizuHtmlInput.checked ? 'html' : 'text',
        discipline,
        createdAt:
          editingBizu && editingBizu.id === id ? editingBizu.createdAt : undefined
      });

      resetBizuForm();
      els.bizuDisciplineInput.value = discipline;
      els.bizuTitleInput.focus();
      await renderBizus();
      showToast(isEditing ? 'Bizu atualizado.' : 'Bizu salvo.');
    } catch (error) {
      console.error('[Gran Questões Plus] Falha ao salvar bizu:', error);
      showToast('Não foi possível salvar o bizu.', 'error');
    }
  }

  function resetBizuForm() {
    els.bizuIdInput.value = '';
    els.bizuDisciplineInput.value = '';
    els.bizuTitleInput.value = '';
    els.bizuContentInput.value = '';
    els.bizuHtmlInput.checked = false;
    els.bizuFileInput.value = '';
    els.bizuContentInput.maxLength = 10000;
    els.cancelBizuEditBtn.hidden = true;
    els.saveBizuBtn.textContent = 'Salvar bizu';
    editingBizu = null;
  }

  function handleEditBizu(bizu) {
    if (!bizu) return;

    editingBizu = bizu;
    els.bizuIdInput.value = bizu.id || '';
    els.bizuDisciplineInput.value = bizu.discipline || '';
    els.bizuTitleInput.value = bizu.title || '';
    els.bizuContentInput.value = bizu.content || '';
    els.bizuHtmlInput.checked = bizu.contentFormat === 'html';
    els.cancelBizuEditBtn.hidden = false;
    els.saveBizuBtn.textContent = 'Atualizar bizu';

    switchTab('bizus');
    els.bizuContentInput.focus();
  }

  function handleBizuFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!/\.html?$/i.test(file.name) && file.type !== 'text/html') {
      showToast('Escolha um arquivo .html ou .htm.', 'error');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      els.bizuContentInput.value = String(reader.result || '').slice(0, 10000);
      els.bizuContentInput.maxLength = 10000;
      els.bizuHtmlInput.checked = true;
      showToast('HTML carregado. Revise e salve o conteúdo.');
    };
    reader.onerror = () => showToast('Não foi possível ler o arquivo HTML.', 'error');
    reader.readAsText(file);
  }

  function createSafeHtmlFragment(value) {
    const template = document.createElement('template');
    const parser = new DOMParser();
    const parsed = parser.parseFromString(String(value || ''), 'text/html');

    parsed.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select').forEach((node) => {
      node.remove();
    });

    parsed.querySelectorAll('*').forEach((node) => {
      Array.from(node.attributes).forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const attrValue = attribute.value.trim();
        if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
          node.removeAttribute(attribute.name);
          return;
        }
        if ((name === 'href' || name === 'src') && !/^(https?:|mailto:|#|data:image\/)/i.test(attrValue)) {
          node.removeAttribute(attribute.name);
        }
      });
    });

    template.content.append(...Array.from(parsed.body.childNodes).map((node) => node.cloneNode(true)));
    return template.content;
  }

  async function handleDeleteBizu(bizu) {
    if (!bizu || !bizu.id) return;

    const confirmed = window.confirm('Remover este bizu?');
    if (!confirmed) return;

    try {
      await GranStorage.deleteBizu(bizu.id);
      if (editingBizu && editingBizu.id === bizu.id) resetBizuForm();
      await renderBizus();
      showToast('Bizu removido.');
    } catch (error) {
      console.error('[Gran Questões Plus] Falha ao remover bizu:', error);
      showToast('Não foi possível remover o bizu.', 'error');
    }
  }

  async function handleSuggestBizu() {
    const discipline =
      els.bizuDisciplineInput.value.trim() ||
      (currentQuestion && currentQuestion.discipline) ||
      '';
    const sameQuestion =
      currentQuestion && currentQuestion.discipline === discipline;

    const prompt = GranStorage.buildBizuPrompt({
      discipline,
      topic: sameQuestion ? currentQuestion.topic : '',
      statement: sameQuestion ? currentQuestion.statement : ''
    });

    await openChatGPTWithPrompt(prompt);
  }

  function openSettings() {
    fillSettingsForm();
    els.settingsOverlay.hidden = false;

    requestAnimationFrame(() => {
      els.gptUrlInput.focus();
      els.gptUrlInput.select();
    });
  }

  function closeSettings() {
    els.settingsOverlay.hidden = true;
  }

  function fillSettingsForm() {
    els.gptUrlInput.value = settings.gptUrl || GranStorage.DEFAULT_SETTINGS.gptUrl;
    els.autoSendInput.checked = settings.autoSendChatGPT !== false;
  }

  async function handleSaveSettings() {
    const raw = els.gptUrlInput.value.trim();
    const candidate = raw || GranStorage.DEFAULT_SETTINGS.gptUrl;
    const withProtocol = /^https?:\/\//i.test(candidate)
      ? candidate
      : `https://${candidate}`;

    let normalized;
    try {
      const url = new URL(withProtocol);
      if (!/^https?:$/.test(url.protocol)) throw new Error('Protocolo inválido.');
      normalized = url.toString();
    } catch (error) {
      showToast('Informe uma URL válida, como https://chatgpt.com/', 'error');
      els.gptUrlInput.focus();
      return;
    }

    settings = await GranStorage.saveSettings({
      gptUrl: normalized,
      autoSendChatGPT: els.autoSendInput.checked
    });

    fillSettingsForm();
    closeSettings();
    showToast('Configurações salvas.');
  }

  function handleResetGptUrl() {
    els.gptUrlInput.value = GranStorage.DEFAULT_SETTINGS.gptUrl;
    els.gptUrlInput.focus();
    els.gptUrlInput.select();
  }

  function formatDate(timestamp) {
    try {
      return new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      }).format(new Date(timestamp));
    } catch (error) {
      return new Date(timestamp).toLocaleString('pt-BR');
    }
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
          resolve({ ok: false, error: 'chrome.runtime indisponível.' });
          return;
        }

        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false, error: 'Sem resposta do service worker.' });
        });
      } catch (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  }

  function showToast(message, type) {
    els.toast.textContent = message;
    els.toast.dataset.type = type || 'success';
    els.toast.classList.add('toast--visible');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.classList.remove('toast--visible');
    }, 3400);
  }
})();
