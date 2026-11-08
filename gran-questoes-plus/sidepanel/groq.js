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
  const readToken = async () => (await chrome.storage.local.get('gqp_tjpb_token')).gqp_tjpb_token || '';
  const showAuth = () => { login.hidden = Boolean(token); form.hidden = !token; };
  const message = (role, text) => {
    const item = document.createElement('p');
    item.className = 'groq-message groq-message--' + role;
    item.textContent = (role === 'user' ? 'Você: ' : 'Groq: ') + text;
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
      const data = await response.json();
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
      const data = await response.json();
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
