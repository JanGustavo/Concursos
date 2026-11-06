"""Executed through SSH, with keys received exclusively through stdin."""
import fcntl
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

root = Path('/var/www/tjpb')
sys.path.insert(0, str(root))


def validate(key):
    request = Request('https://api.groq.com/openai/v1/models', headers={
        'Authorization': 'Bearer ' + key, 'User-Agent': 'TJPB-Study/1.0',
    })
    with urlopen(request, timeout=15) as response:
        models = json.load(response)
    if 'openai/gpt-oss-20b' not in {item.get('id') for item in models.get('data', [])}:
        raise ValueError('Modelo indisponível')


def configure():
    from ai_service import StudyAssistant
    data = json.load(sys.stdin)
    slot, key = data['slot'], data['key']
    if slot not in (1, 2, 3) or not isinstance(key, str) or not key or not key.isascii() or not all(char.isalnum() or char in '_-' for char in key):
        raise ValueError('Entrada inválida')
    validate(key)
    path = root / '.env'
    with (root / '.groq-env.lock').open('a') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        service = StudyAssistant(root / 'groq-config.json')
        providers = service.providers()
        lines = path.read_text().splitlines() if path.exists() else []
        values = {}
        for line in lines:
            name, separator, value = line.partition('=')
            if separator:
                values[name.strip()] = value.strip().strip('"').strip("'")
        # Migrate the existing key to slot 1 before adding another slot.
        if not any(values.get('GROQ_API_KEY_' + str(i)) for i in range(1, 4)) and providers:
            values['GROQ_API_KEY_1'] = providers[0].api_key
        target = 'GROQ_API_KEY_' + str(slot)
        if any(value == key for name, value in values.items() if name.startswith('GROQ_API_KEY_') and name != target):
            raise ValueError('Chave já cadastrada em outro slot')
        values[target] = key
        managed = {'GROQ_API_KEY_1', 'GROQ_API_KEY_2', 'GROQ_API_KEY_3'}
        lines = [line for line in lines if line.partition('=')[0].strip() not in managed]
        lines += [name + '=' + values[name] for name in sorted(managed) if values.get(name)]
        fd, temporary = tempfile.mkstemp(prefix='.groq-env-', dir=root)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, 'w') as output:
                output.write('\n'.join(lines) + '\n')
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    print('Slot salvo no .env com permissão 600.')


def test():
    from ai_service import StudyAssistant
    service = StudyAssistant(root / 'groq-config.json')
    providers = service.providers()
    if not providers:
        raise ValueError('Nenhuma chave configurada')
    failed = False
    for number, provider in enumerate(providers, 1):
        try:
            validate(provider.api_key)
            print('Chave ' + str(number) + ': autenticação e modelo OK.', flush=True)
        except HTTPError as error:
            print('Chave ' + str(number) + ': Groq retornou HTTP ' + str(error.code) + '.', flush=True)
            failed = True
        except (URLError, TimeoutError):
            print('Chave ' + str(number) + ': falha de conexão com a Groq.', flush=True)
            failed = True
        except ValueError:
            print('Chave ' + str(number) + ': modelo padrão indisponível ou resposta inválida.', flush=True)
            failed = True
    if not hasattr(service.selector, 'index'):
        raise ValueError('Backend sem seletor round robin')
    observed = []
    for _ in range(len(providers) * 2):
        provider = service.selector.select(service.providers())
        observed.append(next(i + 1 for i, item in enumerate(providers) if item.api_key == provider.api_key))
    expected = list(range(1, len(providers) + 1)) * 2
    if observed != expected:
        raise ValueError('Sequência de rotação inesperada')
    print('Rotação do seletor: ' + ' → '.join(map(str, observed)))
    if failed:
        sys.exit('Rotação local conferida, mas há chaves com falha de acesso à Groq.')
    print('Teste passou. Cada número identifica uma chave distinta; teste não gera respostas de chat.', flush=True)


try:
    if sys.argv[1] == 'set':
        configure()
    elif sys.argv[1] == 'test':
        test()
    else:
        raise ValueError('Operação inválida')
except Exception as error:
    print('Etapa interrompida: ' + type(error).__name__ + '.', file=sys.stderr, flush=True)
    sys.exit('Falha ao configurar/testar Groq. Confira slot, chave, conexão e disponibilidade do modelo. Dados sensíveis omitidos.')
