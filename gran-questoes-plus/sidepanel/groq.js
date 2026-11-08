(() => {
  const api = 'https://tjpb.jangustavo.me';
  const panel = document.getElementById('groqPanel');
  const login = document.getElementById('groqLogin');
  const form = document.getElementById('groqForm');
  const input = document.getElementById('groqInput');
  const log = document.getElementById('groqMessages');
  const status = document.getElementById('groqStatus');
  let token = '';
  let history = [];
  let busy = false;
  async function readApiResponse(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw Error('O servidor enviou uma página em vez da resposta da IA (HTTP ' + response.status + '). Tente novamente em instantes.');
    }
    try {
      return await response.json();
    } catch {
      throw Error('A resposta do servidor veio incompleta. Tente novamente.');
    }
  }
  const readToken = async () => (await chrome.storage.local.get('gqp_tjpb_token')).gqp_tjpb_token || '';
  const showAuth = () => { login.hidden = Boolean(token); form.hidden = !token; };
  function inline(parent, text) {
    const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(document.createTextNode(text.slice(last, match.index)));
      const token = match[0];
      const element = document.createElement(token.startsWith('**') ? 'strong' : 'code');
      element.textContent = token.startsWith('**') ? token.slice(2, -2) : token.slice(1, -1);
      parent.append(element);
      last = match.index + token.length;
    }
    parent.append(document.createTextNode(text.slice(last)));
  }
  function renderMarkdown(parent, text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    let index = 0;
    while (index < lines.length) {
      const line = lines[index].trim();
      if (!line) { index++; continue; }
      if (line.includes('|') && index + 1 < lines.length && /^\s*\|?[\s:-]+(?:\|[\s:-]+)+\|?\s*$/.test(lines[index + 1])) {
        const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
        const headers = cells(line);
        const table = document.createElement('table');
        const head = table.createTHead().insertRow();
        headers.forEach(value => { const th = document.createElement('th'); inline(th, value); head.append(th); });
        const body = table.createTBody();
        index += 2;
        while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
          const row = body.insertRow();
          cells(lines[index]).forEach(value => { const td = row.insertCell(); inline(td, value); });
          index++;
        }
        const scroll = document.createElement('div');
        scroll.className = 'groq-table-scroll';
        scroll.append(table);
        parent.append(scroll);
        continue;
      }
      const heading = line.match(/^#{1,3}\s+(.+)$/);
      if (heading) {
        const title = document.createElement('h3');
        inline(title, heading[1]);
        parent.append(title);
        index++;
        continue;
      }
      const list = line.match(/^(?:[-*]\s+|\d+\.\s+)/);
      if (list) {
        const ordered = /^\d/.test(line);
        const element = document.createElement(ordered ? 'ol' : 'ul');
        while (index < lines.length && (ordered ? /^\d+\.\s+/ : /^[-*]\s+/).test(lines[index].trim())) {
          const item = document.createElement('li');
          inline(item, lines[index].trim().replace(ordered ? /^\d+\.\s+/ : /^[-*]\s+/, ''));
          element.append(item);
          index++;
        }
        parent.append(element);
        continue;
      }
      const paragraph = document.createElement('p');
      const content = [];
      while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+/.test(lines[index]) && !/^(?:[-*]\s+|\d+\.\s+)/.test(lines[index])) {
        content.push(lines[index].trim());
        index++;
      }
      inline(paragraph, content.join(' '));
      parent.append(paragraph);
    }
  }
  const message = (role, text) => {
    const item = document.createElement('article');
    item.className = 'groq-message groq-message--' + role;
    const author = document.createElement('strong');
    author.className = 'groq-message__author';
    author.textContent = role === 'user' ? 'Você' : 'Groq';
    item.append(author);
    if (role === 'assistant') renderMarkdown(item, text);
    else {
      const content = document.createElement('p');
      content.textContent = text;
      item.append(content);
    }
    log.append(item);
    item.scrollIntoView({ block: 'nearest' });
  };
  document.getElementById('openGroqBtn').addEventListener('click', async () => {
    panel.hidden = false;
    token = await readToken();
    showAuth();
    {
      const question = window.GranStorage && window.GranStorage.buildPrompt && window.groqQuestion;
      if (question) input.value = GranStorage.buildPrompt(window.groqQuestion).slice(0, 16000);
    }
    (token ? input : document.getElementById('groqUsername')).focus();
  });
  document.getElementById('groqCloseBtn').addEventListener('click', () => { panel.hidden = true; });
  login.addEventListener('submit', async event => {
    event.preventDefault();
    status.textContent = 'Entrando…';
    try {
      const response = await fetch(api + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: document.getElementById('groqUsername').value, password: document.getElementById('groqPassword').value }) });
      const data = await readApiResponse(response);
      if (!response.ok || !data.user?.token) throw Error(data.error || 'Não foi possível entrar.');
      token = data.user.token;
      await chrome.storage.local.set({ gqp_tjpb_token: token });
      document.getElementById('groqPassword').value = '';
      showAuth();
      status.textContent = '';
      input.focus();
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('groqLogoutBtn').addEventListener('click', async () => {
    token = '';
    history = [];
    log.replaceChildren();
    await chrome.storage.local.remove('gqp_tjpb_token');
    showAuth();
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const prompt = input.value.trim();
    if (!prompt || busy) return;
    busy = true;
    document.getElementById('groqSendBtn').disabled = true;
    status.textContent = 'Preparando resposta…';
    try {
      const messages = [...history.slice(-6), { role: 'user', content: prompt }];
      const response = await fetch(api + '/api/ai/chat', { method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ messages }) });
      const data = await readApiResponse(response);
      if (response.status === 401) { token = ''; await chrome.storage.local.remove('gqp_tjpb_token'); showAuth(); throw Error('Sessão expirada. Entre novamente.'); }
      if (!response.ok) throw Error(data.error || 'A Groq não respondeu.');
      history = messages.concat({ role: 'assistant', content: data.answer }).slice(-8);
      message('user', prompt);
      message('assistant', data.answer);
      input.value = '';
      status.textContent = '';
    } catch (error) { status.textContent = error.message; }
    finally { busy = false; document.getElementById('groqSendBtn').disabled = false; }
  });
})();
