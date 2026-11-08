/**
 * Gran Questões Plus — interceptor da API no mundo MAIN.
 *
 * Não usa APIs da extensão (indisponíveis no mundo MAIN). A ponte para o
 * content script isolado é feita exclusivamente por window.postMessage.
 */
(function () {
  'use strict';

  if (window.__granQuestoesPlusApiInterceptor) return;
  window.__granQuestoesPlusApiInterceptor = true;

  const API_HOST = 'rota-api.grancursosonline.com.br';
  const SEARCH_PATH = '/v1/elastic/questao';

  function isGranApi(url) {
    try {
      return new URL(url, location.href).hostname === API_HOST;
    } catch (error) {
      return String(url || '').includes(API_HOST);
    }
  }

  function post(type, payload) {
    window.postMessage({
      source: 'GRAN_PLUS_API',
      type,
      ...payload
    }, '*');
  }

  function parseJson(text) {
    if (!text || typeof text !== 'string') return null;
    try {
      return JSON.parse(text);
    } catch (error) {
      return null;
    }
  }

  function collectObjects(value, output) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectObjects(item, output));
      return;
    }
    output.push(value);
    Object.values(value).forEach((item) => collectObjects(item, output));
  }

  function firstValue(object, keys) {
    if (!object || typeof object !== 'object') return '';
    const normalized = keys.map((key) => key.toLowerCase());
    const key = Object.keys(object).find((item) => normalized.includes(item.toLowerCase()));
    return key ? object[key] : '';
  }

  function readableFilters(data) {
    const objects = [];
    collectObjects(data, objects);
    const values = {
      disciplinas: new Set(),
      assuntos: new Set(),
      bancas: new Set()
    };

    objects.forEach((object) => {
      const discipline = firstValue(object, ['disciplina', 'discipline', 'nome_disciplina']);
      const subject = firstValue(object, ['assunto', 'subject', 'nome_assunto', 'topico', 'topic']);
      const banca = firstValue(object, ['banca', 'nome_banca', 'agency']);
      if (typeof discipline === 'string' && discipline.trim()) values.disciplinas.add(discipline.trim());
      if (typeof subject === 'string' && subject.trim()) values.assuntos.add(subject.trim());
      if (typeof banca === 'string' && banca.trim()) values.bancas.add(banca.trim());
    });

    return Object.fromEntries(Object.entries(values).map(([key, set]) => [key, Array.from(set).slice(0, 30)]));
  }

  function queryFilters(url) {
    const query = new URL(url, location.href).searchParams;
    return {
      assuntoIds: query.getAll('assunto[]'),
      bancaIds: query.getAll('banca[]'),
      anoIds: query.getAll('ano[]'),
      resolucao: query.get('resolucao') || ''
    };
  }

  function parseAnswer(data) {
    const objects = [];
    collectObjects(data, objects);
    const answer = objects.find((object) => {
      const keys = Object.keys(object).map((key) => key.toLowerCase());
      return keys.some((key) => /questao.?id|question.?id|acert|correct|gabarito|resposta|resultado/.test(key));
    }) || objects.find((object) => Object.keys(object).some((key) => key.toLowerCase() === 'status'));
    if (!answer) return null;

    const id = firstValue(answer, ['questaoId', 'questao_id', 'questionId', 'question_id', 'id']);
    const gabarito = firstValue(answer, ['gabarito', 'correctAnswer', 'correct_answer', 'respostaCorreta']);
    const respostaUsuario = firstValue(answer, ['respostaUsuario', 'resposta_usuario', 'userAnswer', 'user_answer', 'resposta']);
    const rawCorrect = firstValue(answer, ['acertou', 'acerto', 'correct', 'isCorrect', 'is_correct', 'resultado']);
    const text = JSON.stringify(answer).toLowerCase();
    const rawText = String(rawCorrect).toLowerCase();
    const acertou = typeof rawCorrect === 'boolean'
      ? rawCorrect
      : /^(false|0|nao|não|errad|incorret)/.test(rawText)
        ? false
        : /^(true|1|sim|acert|corret|certo)/.test(rawText) ||
          (!rawText && /acert|corret|certo/.test(text) && !/errad|incorret/.test(text));

    const hasOutcome = rawCorrect !== '' && rawCorrect !== null && rawCorrect !== undefined;
    // Evita contar respostas sem resultado explícito como erro por engano.
    if (!hasOutcome) return null;
    return { acertou, questaoId: id || '', gabarito: gabarito || '', respostaUsuario: respostaUsuario || '' };
  }

  // O Gran pode usar fetch em vez de XMLHttpRequest. Observa somente as
  // respostas do domínio Gran, sem consumir nem modificar a Response original.
  if (typeof window.fetch === 'function') {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : input && input.url;
      const method = String(
        (init && init.method) || (input && input.method) || 'GET'
      ).toUpperCase();
      const requestIsGran = isGranApi(url);
      const result = originalFetch.apply(this, arguments);
      if (requestIsGran) {
        try {
          const headers = new Headers((init && init.headers) || (input && input.headers) || {});
          const token = headers.get('authorization');
          if (token && /^Bearer\s+\S+/i.test(token)) post('AUTH_TOKEN', { token });
        } catch (error) {
          // A leitura de cabeçalhos é opcional.
        }
        result.then((response) => {
          if (!response.ok) return;
          response.clone().json().then((data) => {
            if (method === 'GET' && String(url).includes(SEARCH_PATH)) {
              post('FILTERS_UPDATED', {
                searchUrl: String(url),
                ...queryFilters(String(url)),
                ...readableFilters(data)
              });
            } else if (method === 'POST') {
              const answer = parseAnswer(data);
              if (answer) post('QUESTION_ANSWERED', answer);
            }
          }).catch(() => {});
        }).catch(() => {});
      }
      return result;
    };
  }

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__gqpApi = isGranApi(url)
      ? { method: String(method || 'GET').toUpperCase(), url: String(url) }
      : null;
    return originalOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__gqpApi && String(name).toLowerCase() === 'authorization') {
      const token = String(value || '').trim();
      if (/^Bearer\s+\S+/i.test(token)) post('AUTH_TOKEN', { token });
    }
    return originalSetRequestHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    const request = this.__gqpApi;
    if (request) {
      const isSearch = request.method === 'GET' && request.url.includes(SEARCH_PATH);
      this.addEventListener('load', function () {
        let responseText = '';
        try {
          responseText = this.responseText;
        } catch (error) {
          responseText = '';
        }
        const data = parseJson(responseText);
        if (isSearch) {
          post('FILTERS_UPDATED', {
            searchUrl: request.url,
            ...queryFilters(request.url),
            ...readableFilters(data)
          });
          return;
        }

        if (request.method === 'POST') {
          const answer = parseAnswer(data);
          if (answer) post('QUESTION_ANSWERED', answer);
        }
      });
    }
    return originalSend.apply(this, arguments);
  };
})();
