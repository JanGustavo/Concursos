/**
 * Gran Questões Plus — injector opcional para o ChatGPT.
 *
 * Estratégia principal: o side panel abre o ChatGPT com o prompt na query string
 * (?q=...). Este script serve como fallback para quando o ChatGPT não preenche
 * o campo automaticamente ou quando o prompt é enviado por mensagem.
 */
(function () {
  'use strict';

  if (window.__granQuestoesPlusChatGPTLoaded) return;
  window.__granQuestoesPlusChatGPTLoaded = true;

  const COMPOSER_TIMEOUT_MS = 20000;
  const PREFILL_WAIT_MS = 4500;
  const PENDING_MAX_AGE_MS = 5 * 60 * 1000;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getComposerText(element) {
    if (!element) return '';
    if (element.tagName === 'TEXTAREA') return element.value || '';
    return element.innerText || element.textContent || '';
  }

  function findComposer() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('div[contenteditable="true"][data-virtualkeyboard="true"]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea[data-id]') ||
      document.querySelector('textarea')
    );
  }

  function findSendButton() {
    return (
      document.querySelector('[data-testid="send-button"]') ||
      document.querySelector('button[data-testid="fruitjuice-send-button"]') ||
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="Enviar"]')
    );
  }

  function waitForComposer(timeout) {
    return new Promise((resolve) => {
      const existing = findComposer();
      if (existing) {
        resolve(existing);
        return;
      }

      const startedAt = Date.now();
      const interval = setInterval(() => {
        const composer = findComposer();
        if (composer) {
          clearInterval(interval);
          resolve(composer);
          return;
        }
        if (Date.now() - startedAt >= timeout) {
          clearInterval(interval);
          resolve(null);
        }
      }, 350);
    });
  }

  function setComposerValue(element, text) {
    if (!element) return;

    element.focus();

    if (element.tagName === 'TEXTAREA') {
      const descriptor = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      );
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, text);
      } else {
        element.value = text;
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // ProseMirror/contenteditable: insertText mantém o estado do React.
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);

      const inserted = document.execCommand('insertText', false, text);
      if (inserted) return;
    } catch (error) {
      // Usa o fallback abaixo.
    }

    element.textContent = text;
    element.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: text
      })
    );
  }

  function submitComposer(composer) {
    const sendButton = findSendButton();
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return true;
    }

    // Fallback: Enter no campo de texto.
    composer.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        keyCode: 13,
        which: 13,
        bubbles: true,
        cancelable: true
      })
    );

    return false;
  }

  async function injectPrompt(prompt, options) {
    const settings = options || {};
    const composer = await waitForComposer(settings.timeout || COMPOSER_TIMEOUT_MS);

    if (!composer) {
      return { ok: false, reason: 'composer-not-found' };
    }

    setComposerValue(composer, prompt);
    await sleep(450);

    if (settings.autoSend === false) {
      return { ok: true, sent: false };
    }

    return { ok: true, sent: submitComposer(composer) };
  }

  function getStorage() {
    if (typeof GranStorage !== 'undefined') return GranStorage;
    if (typeof window !== 'undefined' && window.GranStorage) return window.GranStorage;
    return null;
  }

  async function maybeInjectPending() {
    const storage = getStorage();
    if (!storage) return;

    const pending = await storage.getPendingChatGPT();
    if (!pending || !pending.prompt) return;

    if (Date.now() - (pending.createdAt || 0) > PENDING_MAX_AGE_MS) {
      await storage.clearPendingChatGPT();
      return;
    }

    let hasQueryPrefill = false;
    try {
      hasQueryPrefill = new URL(location.href).searchParams.has('q');
    } catch (error) {
      hasQueryPrefill = false;
    }

    if (hasQueryPrefill) {
      // Dá tempo para o ChatGPT processar o ?q=. Se o campo continuar vazio,
      // injeta o prompt manualmente.
      const startedAt = Date.now();
      const composer = await waitForComposer(PREFILL_WAIT_MS);

      while (
        composer &&
        getComposerText(composer).trim().length === 0 &&
        Date.now() - startedAt < PREFILL_WAIT_MS
      ) {
        await sleep(200);
      }

      if (composer && getComposerText(composer).trim().length > 0) {
        if (pending.autoSend !== false) {
          await sleep(350);
          submitComposer(composer);
        }
        await storage.clearPendingChatGPT();
        return;
      }
    }

    const result = await injectPrompt(pending.prompt, {
      autoSend: pending.autoSend !== false
    });

    if (result.ok) {
      await storage.clearPendingChatGPT();
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== 'INJECT_PROMPT' || !message.prompt) {
      return false;
    }

    injectPrompt(message.prompt, { autoSend: message.autoSend !== false })
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, reason: error.message }));

    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', maybeInjectPending, { once: true });
  } else {
    maybeInjectPending();
  }

  // O ChatGPT é uma SPA; tenta novamente quando a rota muda.
  let lastHref = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      maybeInjectPending();
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
