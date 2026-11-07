/**
 * Gran Questões Plus — service worker.
 *
 * Responsabilidades:
 *  - Abrir o side panel quando o content script solicitar.
 *  - Abrir o ChatGPT em uma nova aba quando solicitado.
 *  - Configurar o clique no ícone da extensão para abrir o side panel.
 */
importScripts('/utils/storage.js');
importScripts('/utils/updater.js');

const BADGE_CLEAR_DELAY_MS = 4000;

async function configurePanelBehavior() {
  if (!chrome.sidePanel || !chrome.sidePanel.setPanelBehavior) return;

  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.warn('[Gran Questões Plus] Não foi possível configurar o side panel:', error);
  }
}

async function openSidePanel(options) {
  if (!chrome.sidePanel || !chrome.sidePanel.open) {
    throw new Error('A API chrome.sidePanel não está disponível neste Chrome.');
  }

  await chrome.sidePanel.open(options || {});
}

async function showBadge(tabId) {
  if (!Number.isInteger(tabId) || !chrome.action || !chrome.action.setBadgeText) return;

  try {
    await chrome.action.setBadgeText({ tabId, text: '✓' });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#7c3aed' });

    setTimeout(() => {
      try {
        const result = chrome.action.setBadgeText({ tabId, text: '' });
        if (result && typeof result.catch === 'function') result.catch(() => {});
      } catch (error) {
        // Badge é apenas um detalhe visual.
      }
    }, BADGE_CLEAR_DELAY_MS);
  } catch (error) {
    // Badge é apenas um detalhe visual.
  }
}

async function openChatGPT(url) {
  await chrome.tabs.create({ url });
}

async function fallbackToChatGPT(question) {
  const settings = await GranStorage.getSettings();
  const prompt = GranStorage.buildPrompt(question);
  const url = GranStorage.buildChatGPTUrl(settings.gptUrl, prompt);

  await GranStorage.setPendingChatGPT({
    prompt,
    createdAt: Date.now(),
    autoSend: settings.autoSendChatGPT !== false
  });

  await openChatGPT(url);
  return { url, prompt };
}

async function handleOpenSidePanel(message, sender) {
  const question = message && message.question ? message.question : null;
  const tab = sender && sender.tab ? sender.tab : null;
  const openOptions = tab && Number.isInteger(tab.id)
    ? { tabId: tab.id }
    : (tab && Number.isInteger(tab.windowId) ? { windowId: tab.windowId } : {});

  // Inicia a gravação antes de abrir, mas sem await, para que o side panel
  // encontre a questão assim que carregar.
  const savePromise = question ? GranStorage.setLastQuestion(question) : Promise.resolve(null);

  try {
    // IMPORTANTE: chrome.sidePanel.open() é chamado antes de qualquer await
    // para aproveitar o gesto do usuário (clique no botão do Gran).
    await openSidePanel(openOptions);
  } catch (error) {
    console.warn('[Gran Questões Plus] sidePanel.open falhou:', error);

    // Em alguns contextos o Chrome exige um gesto do usuário para abrir o
    // side panel. Nesse caso, abrimos o ChatGPT diretamente.
    if (question) {
      try {
        await savePromise;
      } catch (saveError) {
        console.warn('[Gran Questões Plus] Falha ao salvar a questão capturada:', saveError);
      }

      try {
        await fallbackToChatGPT(question);
        return {
          ok: true,
          opened: 'chatgpt',
          warning: error.message
        };
      } catch (fallbackError) {
        return {
          ok: false,
          error: fallbackError.message
        };
      }
    }

    return {
      ok: false,
      error: error.message
    };
  }

  try {
    await savePromise;
  } catch (error) {
    console.warn('[Gran Questões Plus] Falha ao salvar a questão capturada:', error);
  }

  if (question) {
    try {
      await chrome.runtime.sendMessage({
        type: 'QUESTION_READY',
        question
      });
    } catch (error) {
      // O painel pode ainda não ter terminado de carregar; o storage é o fallback.
    }
  }

  if (tab && Number.isInteger(tab.id)) {
    showBadge(tab.id);
  }

  return { ok: true, opened: 'sidepanel' };
}

async function handleOpenChatGPT(message) {
  if (!message || !message.url) {
    return { ok: false, error: 'URL do ChatGPT não informada.' };
  }

  try {
    await openChatGPT(message.url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function handleCheckForUpdates(message) {
  return GranUpdater.checkForUpdates({ force: Boolean(message && message.force) });
}

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await GranStorage.ensureDefaults();
  } catch (error) {
    console.warn('[Gran Questões Plus] Falha ao criar configurações padrão:', error);
  }

  await configurePanelBehavior();
});

chrome.runtime.onStartup.addListener(() => {
  configurePanelBehavior();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'OPEN_SIDE_PANEL') {
    handleOpenSidePanel(message, sender)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'OPEN_CHATGPT') {
    handleOpenChatGPT(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === 'CHECK_FOR_UPDATE') {
    handleCheckForUpdates(message)
      .then(sendResponse)
      .catch((error) => sendResponse({
        status: 'error',
        message: 'Servidor de atualização indisponível no momento.'
      }));
    return true;
  }

  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// Fallback para versões em que setPanelBehavior não estiver disponível.
if (chrome.action && chrome.action.onClicked) {
  chrome.action.onClicked.addListener(async (tab) => {
    try {
      const options = tab && Number.isInteger(tab.windowId)
        ? { windowId: tab.windowId }
        : {};
      await openSidePanel(options);
    } catch (error) {
      console.warn('[Gran Questões Plus] Clique no ícone não abriu o side panel:', error);
    }
  });
}

// Garante que o painel esteja habilitado também após atualizações da extensão.
configurePanelBehavior();
