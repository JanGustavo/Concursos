#!/usr/bin/env python3
import asyncio
import os
import sys
from browser_use import Agent, Browser
from browser_use.llm import ChatOpenAI

# Permite importar módulos da raiz se necessário (ex: ai_service)
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

async def run_visual_audit(target_url: str = "http://localhost:8000/tjpb-mapa-estudo.html"):
    """
    Executa um agente navegadores com browser-use para testar
    interações, responsividade e botões da interface.
    """
    # 1. Configuração do navegador local (browser-use 1.0+)
    browser = Browser(
        kind="chromium",
        headless=False,
    )

    # 2. Definição da tarefa visual e tátil do agente
    task_prompt = f"""
    Acesse a URL {target_url}.
    Realize as seguintes validações:
    1. Role (scroll) a página suavemente até o final e retorne ao topo.
    2. Identifique os principais botões de ação na tela e interaja com um deles.
    3. Redimensione ou altere o viewport para simular um layout mobile (390x844).
    4. Verifique se há algum elemento visual sobreposto ou quebrado.
    5. Retorne um resumo com a confirmação das interações e eventuais problemas observados.
    """

    # 3. Inicialização da LLM
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_BASE_URL")
    model_name = os.getenv("OPENAI_MODEL") or "gpt-4o"

    llm_kwargs = {
        "model": model_name,
        "temperature": 0.0,
    }
    if api_key:
        llm_kwargs["api_key"] = api_key
    if base_url:
        llm_kwargs["base_url"] = base_url

    print(f"🔧 Configurando LLM: modelo='{model_name}' | base_url='{base_url or 'default (OpenAI)'}'")
    llm = ChatOpenAI(**llm_kwargs)

    # 4. Execução do agente
    agent = Agent(
        task=task_prompt,
        llm=llm,
        browser=browser
    )

    print("🚀 Iniciando agente de testes visuais e de responsividade...")
    history = await agent.run()
    
    print("\n✅ Resultado da validação do agente:")
    print(history.final_result())

    await browser.close()

async def run_smoke(target_url):
    """Verificação reproduzível da árvore, sem chamada de LLM."""
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        try:
            for width, height in [(1280, 900), (390, 844)]:
                page = await browser.new_page(viewport={'width': width, 'height': height})
                await page.goto(target_url, wait_until='domcontentloaded')
                await page.get_by_role('tab', name='Mapa de estudos').click()
                await page.get_by_role('button', name='Mapa oficial').click()
                assert await page.locator('.map-area .branch').count() == 3
                assert await page.locator('.map-area .node .stage-badge').count() == await page.locator('.map-area .node').count()
                assert await page.locator('.map-area .wire').count() > 0
                overflow = await page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                assert not overflow, f'Overflow horizontal em {width}px'
                await page.get_by_role('button', name='Diagnóstico').click()
                await page.get_by_role('button', name='Expandir ramos').click()
                assert await page.locator('#personal-map .pm-branch[open]').count() > 0
                await page.get_by_label('Encontrar assunto').fill('sintaxe')
                assert await page.locator('#personal-map .pm-row').count() > 0
                print(f'OK: {width}×{height}, ramos, busca, expansão e sem overflow')
                await page.close()
        finally:
            await browser.close()

if __name__ == "__main__":
    smoke = '--smoke' in sys.argv
    args = [arg for arg in sys.argv[1:] if arg != '--smoke']
    url_alvo = args[0] if args else "http://localhost:8000/tjpb-mapa-estudo.html"
    asyncio.run(run_smoke(url_alvo) if smoke else run_visual_audit(url_alvo))
