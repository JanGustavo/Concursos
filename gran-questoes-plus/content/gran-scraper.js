/**
 * Gran Questões Plus — content script do Gran Questões.
 *
 * Responsabilidades:
 *  - Observar o DOM e detectar o bloco de feedback de questões respondidas.
 *  - Extrair os dados da questão (código, disciplina, banca, ano, enunciado,
 *    alternativas, resposta do usuário e gabarito).
 *  - Injetar "✨ Explicar com IA" para erros e "✨ Revisar com IA" para acertos.
 *  - Salvar a questão no chrome.storage.local e pedir a abertura do side panel.
 */
(function () {
  'use strict';

  if (window.__granQuestoesPlusLoaded) return;
  window.__granQuestoesPlusLoaded = true;

  /* ============================================================
   * SELETORES DO GRAN QUESTÕES
   * ------------------------------------------------------------
   * Se o Gran mudar a estrutura HTML, ajuste apenas este bloco.
   * Os nomes seguem as classes atuais do site:
   *   .ds-question
   *   .ds-question__header__top__id
   *   .ds-question__header__top__subject
   *   .ds-question__header__bottom__info
   *   .ds-question__body__statement
   *   .ds-question__body__options__option
   *   .ds-question__body__actions__feedback
   *   .answer-report
   * ============================================================ */
  const SELECTORS = {
    question: '.ds-question',
    questionId: '.ds-question__header__top__id a',
    subjectLinks: '.ds-question__header__top__subject a',
    headerInfo: '.ds-question__header__bottom__info',
    headerInfoKey: '.key',
    headerInfoValue: '.value',
    statement: '.ds-question__body__statement',
    options: '.ds-question__body__options__option',
    optionLabel: '.ds-question__body__options__option__label',
    optionDescription: '.ds-question__body__options__option__description',
    feedback: '.ds-question__body__actions__feedback',
    answerReport: '.answer-report',
    resultSection: 'section[role="status"]',
    correctBadge: '.badge-success',
    selectedClass: 'ds-question__body__options__option--selected',
    correctClass: 'ds-question__body__options__option--right',
    wrongClass: 'ds-question__body__options__option--wrong'
  };

  const WRAP_CLASS = 'gqp-ai-wrap';
  const BUTTON_CLASS = 'gqp-ai-btn';
  const FAB_ID = 'gqp-floating-button';
  const TOAST_ID = 'gqp-toast-root';
  const SCAN_DEBOUNCE_MS = 180;

  let scanTimer = null;
  let toastTimer = null;
  const seenDomAnswers = new Set();

  function handleApiMessage(event) {
    if (event.source !== window || !event.data || event.data.source !== 'GRAN_PLUS_API') return;

    const data = event.data;
    if (data.type === 'AUTH_TOKEN' && /^Bearer\s+\S+/i.test(String(data.token || ''))) {
      GranStorage.storageSet({ [GranStorage.KEYS.granAuthToken]: String(data.token) }).catch((error) => {
        console.warn('[Gran Questões Plus] Não foi possível salvar o token da API:', error);
      });
      return;
    }

    if (data.type === 'FILTERS_UPDATED') {
      GranStorage.saveCurrentFilters(data).catch((error) => {
        console.warn('[Gran Questões Plus] Não foi possível salvar os filtros:', error);
      });
      return;
    }

    if (data.type === 'QUESTION_ANSWERED') {
      GranStorage.recordQuestionAnswered(data).catch((error) => {
        console.warn('[Gran Questões Plus] Não foi possível salvar o desempenho:', error);
      });
    }
  }

  // Registra a ponte imediatamente para não perder buscas disparadas antes
  // da montagem do DOM.
  window.addEventListener('message', handleApiMessage);

  function cleanText(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function textOf(root, selector) {
    const element = root.querySelector(selector);
    if (!element) return '';
    return cleanText(element.innerText || element.textContent);
  }

  function extractHeaderInfo(questionElement) {
    const info = {};

    questionElement.querySelectorAll(SELECTORS.headerInfo).forEach((item) => {
      const keyElement = item.querySelector(SELECTORS.headerInfoKey);
      const valueElement = item.querySelector(SELECTORS.headerInfoValue);

      const key = cleanText(keyElement ? keyElement.textContent : '')
        .replace(/:$/, '')
        .toLowerCase();

      let value = valueElement ? cleanText(valueElement.textContent) : '';
      if (!value) {
        const raw = cleanText(item.textContent);
        const prefix = cleanText(keyElement ? keyElement.textContent : '');
        value = prefix ? cleanText(raw.replace(prefix, '')) : raw;
      }

      if (key && value) info[key] = value;
    });

    return info;
  }

  function extractOptions(questionElement) {
    return Array.from(questionElement.querySelectorAll(SELECTORS.options))
      .map((optionElement) => {
        const label = cleanText(textOf(optionElement, SELECTORS.optionLabel))
          .replace(/\s+/g, ' ')
          .toUpperCase();

        const descriptionElement = optionElement.querySelector(SELECTORS.optionDescription);
        const description = descriptionElement
          ? cleanText(descriptionElement.innerText || descriptionElement.textContent)
          : '';

        return {
          label,
          text: description,
          selected: optionElement.classList.contains(SELECTORS.selectedClass),
          correct: optionElement.classList.contains(SELECTORS.correctClass),
          wrong: optionElement.classList.contains(SELECTORS.wrongClass)
        };
      })
      .filter((option) => option.label);
  }

  function extractQuestion(questionElement) {
    if (!questionElement) return null;

    const report = questionElement.querySelector(SELECTORS.answerReport);
    const resultSection = report
      ? report.querySelector(SELECTORS.resultSection) || report.querySelector('section')
      : null;

    const resultText = cleanText(
      resultSection ? resultSection.innerText || resultSection.textContent : ''
    );
    const reportText = cleanText(report ? report.innerText || report.textContent : '');

    const options = extractOptions(questionElement);
    const selectedOption = options.find((option) => option.selected) || null;
    const correctOption = options.find((option) => option.correct) || null;

    const badgeText = resultSection
      ? cleanText(textOf(resultSection, SELECTORS.correctBadge)).toUpperCase()
      : '';
    const correctFromBadge = /^[A-E]$/.test(badgeText) ? badgeText : '';
    const correctFromText = (
      reportText.match(/(?:Opção|Resposta)\s+correta\s*:?\s*([A-E])/i) || []
    )[1] || '';

    const correctAnswer =
      (correctOption && correctOption.label) ||
      correctFromBadge ||
      correctFromText.toUpperCase();

    const userAnswer = selectedOption ? selectedOption.label : '';

    // A primeira section do answer-report representa o resultado ATUAL.
    // Não usamos o texto inteiro porque ele pode conter "Última resposta: Errada"
    // mesmo quando o usuário acertou na tentativa atual.
    const isWrong = resultText
      ? /errad|errou|incorret/i.test(resultText)
      : options.some((option) => option.wrong);

    const subjectLinks = Array.from(questionElement.querySelectorAll(SELECTORS.subjectLinks))
      .map((link) => cleanText(link.innerText || link.textContent))
      .filter(Boolean);

    const headerInfo = extractHeaderInfo(questionElement);
    const codeLink = questionElement.querySelector(SELECTORS.questionId);
    const code =
      cleanText(codeLink ? codeLink.textContent : '') ||
      (codeLink && codeLink.getAttribute('href')
        ? codeLink.getAttribute('href').split('/').pop()
        : '');

    const statementElement = questionElement.querySelector(SELECTORS.statement);
    const statement = statementElement
      ? cleanText(statementElement.innerText || statementElement.textContent)
      : '';

    return {
      code,
      discipline: subjectLinks[0] || '',
      topic: subjectLinks.slice(1).join(' / '),
      subject: subjectLinks.join(' / '),
      banca: headerInfo.banca || '',
      year: headerInfo.ano || '',
      prova: headerInfo.prova || '',
      statement,
      options,
      userAnswer,
      correctAnswer,
      isWrong,
      resultText,
      url: codeLink && codeLink.href ? codeLink.href : location.href,
      sourceUrl: location.href,
      capturedAt: Date.now()
    };
  }

  function getButtonLabel(question) {
    return question && question.isWrong ? 'Explicar com IA' : 'Revisar com IA';
  }

  function setButtonLoading(button, loading) {
    if (!button) return;

    button.dataset.loading = loading ? 'true' : 'false';
    button.disabled = loading;

    const label = button.querySelector('.gqp-ai-btn__label');
    const spark = button.querySelector('.gqp-ai-btn__spark');
    const existingSpinner = button.querySelector('.gqp-ai-spinner');

    if (loading) {
      if (spark) spark.textContent = '';
      if (!existingSpinner) {
        const spinner = document.createElement('span');
        spinner.className = 'gqp-ai-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        button.insertBefore(spinner, label);
      }
      if (label) label.textContent = 'Capturando...';
      return;
    }

    if (existingSpinner) existingSpinner.remove();
    if (spark) spark.textContent = '✨';
    if (label) label.textContent = button.dataset.idleLabel || 'Explicar com IA';
  }

  function showToast(message, type) {
    let root = document.getElementById(TOAST_ID);

    if (!root) {
      root = document.createElement('div');
      root.id = TOAST_ID;
      root.className = 'gqp-toast';
      document.body.appendChild(root);
    }

    root.textContent = message;
    root.dataset.type = type || 'success';
    root.classList.add('gqp-toast--visible');

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      root.classList.remove('gqp-toast--visible');
    }, 3800);
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
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

  async function handleExplainClick(button, questionElement) {
    const question = extractQuestion(questionElement);

    if (!question || !question.code) {
      showToast('Não foi possível identificar a questão.', 'error');
      return;
    }

    setButtonLoading(button, true);

    try {
      // O service worker salva a questão e abre o side panel. A mensagem é
      // enviada imediatamente para aproveitar o gesto do usuário.
      const response = await sendMessage({
        type: 'OPEN_SIDE_PANEL',
        question
      });

      if (response && response.ok) {
        if (response.opened === 'chatgpt') {
          showToast('Painel lateral indisponível. Abrimos o ChatGPT em uma nova aba.');
        } else {
          showToast(
            question.isWrong
              ? 'Questão capturada! Confira o painel lateral.'
              : 'Questão salva para revisão. Confira o painel lateral.'
          );
        }
        return;
      }

      // Fallback caso o service worker não consiga abrir nem o side panel.
      const settings = await GranStorage.getSettings();
      const prompt = GranStorage.buildPrompt(question);
      const url = GranStorage.buildChatGPTUrl(settings.gptUrl, prompt);

      await GranStorage.setLastQuestion(question);
      await GranStorage.copyText(prompt);
      await GranStorage.setPendingChatGPT({
        prompt,
        createdAt: Date.now(),
        autoSend: settings.autoSendChatGPT !== false
      });
      await sendMessage({ type: 'OPEN_CHATGPT', url, prompt });

      showToast('Painel lateral indisponível. Abrimos o ChatGPT e copiamos o prompt.');
    } catch (error) {
      console.error('[Gran Questões Plus] Falha ao abrir a IA:', error);
      showToast('Erro ao abrir a IA. Tente novamente.', 'error');
    } finally {
      setButtonLoading(button, false);
    }
  }

  function injectButton(feedbackElement, questionElement, question) {
    if (!feedbackElement) return;

    const idleLabel = getButtonLabel(question);
    const existingWrap = feedbackElement.querySelector(`.${WRAP_CLASS}`);

    if (existingWrap) {
      const existingButton = existingWrap.querySelector(`.${BUTTON_CLASS}`);
      if (existingButton) {
        existingButton.dataset.idleLabel = idleLabel;
        existingButton.setAttribute(
          'aria-label',
          question && question.isWrong
            ? 'Explicar esta questão com IA'
            : 'Revisar esta questão com IA'
        );
        if (existingButton.dataset.loading !== 'true') {
          const existingLabel = existingButton.querySelector('.gqp-ai-btn__label');
          if (existingLabel && existingLabel.textContent !== idleLabel) {
            existingLabel.textContent = idleLabel;
          }
        }
      }
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = WRAP_CLASS;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = BUTTON_CLASS;
    button.dataset.idleLabel = idleLabel;
    button.setAttribute(
      'aria-label',
      question && question.isWrong ? 'Explicar esta questão com IA' : 'Revisar esta questão com IA'
    );
    button.innerHTML =
      '<span class="gqp-ai-btn__spark" aria-hidden="true">✨</span>' +
      `<span class="gqp-ai-btn__label">${idleLabel}</span>`;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      handleExplainClick(button, questionElement);
    });

    wrap.appendChild(button);

    const report = feedbackElement.querySelector(SELECTORS.answerReport);

    if (report && report.parentElement === feedbackElement) {
      feedbackElement.insertBefore(wrap, report.nextSibling);
    } else {
      feedbackElement.appendChild(wrap);
    }
  }

  function ensureFloatingButton() {
    if (!document.body || document.getElementById(FAB_ID)) return;

    const button = document.createElement('button');
    button.id = FAB_ID;
    button.type = 'button';
    button.className = 'gqp-fab';
    button.title = 'Abrir Gran Questões Plus';
    button.setAttribute('aria-label', 'Abrir Gran Questões Plus');
    button.innerHTML =
      '<span class="gqp-fab__spark" aria-hidden="true">✨</span>' +
      '<span class="gqp-fab__label">G+</span>';

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      button.dataset.loading = 'true';

      try {
        const response = await sendMessage({ type: 'OPEN_SIDE_PANEL', question: null });
        if (!response || !response.ok) {
          showToast('Não foi possível abrir o painel. Use o ícone da extensão.', 'error');
        }
      } finally {
        button.dataset.loading = 'false';
      }
    });

    document.body.appendChild(button);
  }

  function scan() {
    ensureFloatingButton();

    document.querySelectorAll(SELECTORS.question).forEach((questionElement) => {
      const feedbackElement = questionElement.querySelector(SELECTORS.feedback);
      if (!feedbackElement) return;

      const existingButton = feedbackElement.querySelector(`.${WRAP_CLASS}`);
      const question = extractQuestion(questionElement);
      const hasAnswer = Boolean(
        question && (question.userAnswer || question.correctAnswer || question.resultText)
      );

      if (!hasAnswer) {
        if (existingButton) existingButton.remove();
        return;
      }

      injectButton(feedbackElement, questionElement, question);

      // Fallback da API: o feedback visual também confirma que uma resposta foi corrigida.
      // Não conta a mera seleção de alternativa nem um gabarito sem resultado.
      const result = cleanText(question.resultText).toLowerCase();
      // Considera apenas o resultado confirmado no feedback atual.
      // A alternativa selecionada não é obrigatória: alguns layouts do Gran
      // retiram a classe "--selected" depois da correção.
      const isCorrect = /\b(acertou|acertamos|resposta correta|você acertou|correto|certa)\b/i.test(result) &&
        !/\b(errada|incorreta|você errou|errou)\b/i.test(result);
      const isIncorrect = /\b(errada|incorreta|você errou|errou)\b/i.test(result);
      const id = String(question.code || '').trim();
      if (id && (isCorrect || isIncorrect)) {
        const key = id + ':' + (isCorrect ? '1' : '0');
        if (!seenDomAnswers.has(key)) {
          seenDomAnswers.add(key);
          GranStorage.recordQuestionAnswered({
            questaoId: id,
            acertou: isCorrect,
            disciplina: question.discipline,
            assunto: question.topic,
            banca: question.banca
          }).catch((error) => {
            seenDomAnswers.delete(key);
            console.warn('[Gran Questões Plus] Falha ao salvar resultado do DOM:', error);
          });
        }
      }
    });
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, SCAN_DEBOUNCE_MS);
  }

  function init() {
    if (!document.body) {
      window.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class']
    });

    window.addEventListener('popstate', scheduleScan);
    window.addEventListener('hashchange', scheduleScan);
    window.addEventListener('pageshow', scheduleScan);

    scheduleScan();
  }

  init();
})();
