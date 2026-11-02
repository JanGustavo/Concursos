"""Gera um HTML independente, preservando os avanços e unificando os bancos de questões."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parent.parent
source = ROOT / 'referencias' / 'pagina_claude_2026-10-26.html'
s = source.read_text()
core = (ROOT / 'assets' / 'practice-core.js').read_text()
ui = (ROOT / 'assets' / 'practice-ui.js').read_text()
css = (ROOT / 'assets' / 'practice.css').read_text()
css += '\n' + (ROOT / 'assets' / 'courses-app.css').read_text()
css += '\n' + (ROOT / 'assets' / 'cyber-theme.css').read_text()
courses_ui = (ROOT / 'assets' / 'courses-app.js').read_text()
panel = (ROOT / 'assets' / 'practice-panel.html').read_text()
gran_panel = (ROOT / 'assets' / 'gran-panel.html').read_text()
gran_ui = (ROOT / 'assets' / 'gran-module.js').read_text()
report_summary = (ROOT / 'assets' / 'report-summary.html').read_text()

# Carregar questões de Português e mapeamento
bank_pt = json.loads((ROOT / 'dados' / 'questoes_portugues.json').read_text())
mapping = ['p3','p1','p3','p2','p3','p1','p4','p4','p3','p3','p1','p3','p2','p3','p1','p3','p3','p4','p1','p1']
for q, b in zip(bank_pt['questoes'], mapping):
    q['bloco'] = b

# Carregar questões de TI se existir
bank_ti_file = ROOT / 'dados' / 'questoes_ti.json'
ti_questoes = []
if bank_ti_file.exists():
    bank_ti = json.loads(bank_ti_file.read_text())
    ti_questoes = bank_ti.get('questoes', [])

combined_questions = bank_pt['questoes'] + ti_questoes
bank = {
    "textos": bank_pt.get('textos', []),
    "questoes": combined_questions,
    "nota": "Questões de Português e TI (FGV) estruturadas para o edital TJPB Desenvolvimento de Sistemas."
}

# Injetar PWA manifest e meta tags no <head>
pwa_tags = """<link rel="manifest" href="/manifest.json">
<link rel="icon" type="image/png" sizes="192x192" href="/assets/icon-192.png">
<meta name="theme-color" content="#070913">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/assets/icon-192.png">
"""
s = s.replace('<head>', '<head>\n' + pwa_tags, 1)

s = s.replace('</style>', css + '\n</style>', 1)
old = '<button class="view" type="button" id="data-tab"'
new = '<button class="view" type="button" id="start-tab" role="tab" aria-controls="start-view" aria-selected="false">Por onde começar</button><button class="view" type="button" id="planner-tab" role="tab" aria-controls="planner-view" aria-selected="false">Ciclo de estudos</button><button class="view" type="button" id="questions-tab" role="tab" aria-controls="questions-view" aria-selected="false">Questões importadas</button><button class="view" type="button" id="gran-tab" role="tab" aria-controls="gran-view" aria-selected="false">Filtros do Gran</button><button class="view" type="button" id="courses-tab" role="tab" aria-controls="courses-view" aria-selected="false">Cursos e aulas</button>' + old
assert old in s
s = s.replace(old, new, 1)

s = s.replace('</main>', panel + gran_panel + '''
<section id="start-view" role="tabpanel" aria-labelledby="start-tab" hidden><div id="start-root"></div></section>
<section id="planner-view" role="tabpanel" aria-labelledby="planner-tab" hidden><div id="planner-root"></div></section>
<section id="courses-view" class="practice courses" role="tabpanel" aria-labelledby="courses-tab" hidden>
 <div id="courses-root"></div>
 <noscript>Ative o JavaScript para acessar os cursos e as aulas.</noscript>
</section>
</main>''', 1)
research_start = s.index('>', s.index('id="data-view"')) + 1
s = s[:research_start] + report_summary + '\n<h2>Dados e referências do concurso</h2>' + s[research_start:]
s = s.replace('<div class="detail-body"><div class="study-context">', '<div class="detail-body"><div class="gran-block-launch"><a class="practice-btn primary" id="gran-block-link" target="_blank" rel="noopener noreferrer">Questões no Gran ↗</a><small>Abre o filtro FGV deste assunto. Requer internet e acesso ao Gran.</small></div><div class="practice-block-launch"><button type="button" class="practice-btn" id="practice-block-button">Praticar neste bloco</button><small id="practice-block-note"></small></div><div class="study-context">', 1)
old = "currentStudyNode=id; renderGranSearch(id);"
assert old in s
s = s.replace(old, "currentStudyNode=id; renderPracticeBlock(id); renderGranSearch(id);", 1)
s = s.replace('document.getElementById("gran-search").open=false;', 'document.getElementById("gran-search").open=true;', 1)
# Tópicos sem filtro específico mantêm acesso ao filtro amplo, identificado como tal.
s = s.replace("tops.filter(f=>f.itens.includes(index))", "tops.filter(f=>(f.itens||[]).includes(index))")
s = s.replace("tops.some(f=>f.itens.length)", "tops.some(f=>(f.itens||[]).length)")
s = s.replace("const practice=mine.length?", "const broad=tops.find(f=>f.verified&&!f.amplo)||tops.find(f=>f.verified);\n  const practice=mine.length?", 1)
s = s.replace("(itemLevel?'<span class=\"study-pending\">Sem busca ainda</span>':'')", "(broad?`<a class=\"study-practice\" href=\"${esc(granSearchUrl(broad))}\" target=\"_blank\" rel=\"noopener noreferrer\">Gran · busca do bloco ↗</a>`:(itemLevel?'<span class=\"study-pending\">Sem busca ainda</span>':''))", 1)
s = s.replace("const ok=filters.filter(f=>f.verified).length;", """const ok=filters.filter(f=>f.verified).length;
 const primary=filters.find(f=>f.verified&&!f.amplo)||filters.find(f=>f.verified)||filters[0];
 const direct=document.getElementById('gran-block-link');direct.hidden=!primary;
 if(primary){direct.href=granSearchUrl(primary);direct.setAttribute('aria-label','Questões de '+nodes[id].title+' no Gran, banca FGV');}else direct.removeAttribute('href');""", 1)

start = s.index("document.querySelectorAll('.view').forEach(b=>b.addEventListener('click'")
end = s.index('\nlet currentStudyNode=', start)
s = s[:start] + '''function showView(id){
 document.querySelectorAll('.view').forEach(tab=>tab.setAttribute('aria-selected',String(tab.getAttribute('aria-controls')===id)));
 ['map-view','data-view','questions-view','gran-view','courses-view','start-view','planner-view'].forEach(key=>document.getElementById(key).hidden=key!==id);
 document.querySelector('.hint').hidden=id!=='map-view';if(id==='map-view')requestAnimationFrame(draw);
}
document.querySelectorAll('.view').forEach(tab=>tab.addEventListener('click',()=>showView(tab.getAttribute('aria-controls'))));
document.querySelectorAll('[data-view-target]').forEach(button=>button.addEventListener('click',()=>{showView(button.dataset.viewTarget);document.querySelector('.view[aria-controls="'+button.dataset.viewTarget+'"]').focus()}));
document.querySelector('.views').addEventListener('keydown',e=>{
 if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
 e.preventDefault();const tabs=[...document.querySelectorAll('.view')],i=tabs.indexOf(document.activeElement);
 const n=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 tabs[n].click();tabs[n].focus();
});
''' + s[end:]

s = s.replace('function loadProgress(o){\n granProgress=o;', 'function loadProgress(o){\n o=PracticeCore.normalizeProgress(o);\n granProgress=o;', 1)
assert 'o=PracticeCore.normalizeProgress(o)' in s

s = s.replace("else if(!d.tentativas)h+='<small>'+d.questoes+' questões no banco, sem tentativas. Rode: python estudo.py simulado -b '+esc(id)+'</small>';", "else if(!d.tentativas)h+='<small>'+d.questoes+' questões no banco, sem tentativas. Use Praticar neste bloco para começar pelo navegador.</small>';")
s = s.replace('Progresso de ', 'Progresso carregado em ')
s = s.replace('se o Chrome bloquear, digite <code>allow pasting</code>', 'use apenas scripts que você tenha revisado')
s = s.replace('A prática nesta etapa acontece no Gran.', 'Você pode praticar no Gran ou importar um JSON para a aba Questões.')
s = s.replace('background:#b67515}.p-low', 'background:#88600f}.p-low')
s = s.replace('<script>\nconst nodes=', '<script>\n' + core + '\n</script>\n<script>\nconst nodes=', 1)
assert core in s

seed = json.dumps(bank, ensure_ascii=False).replace('<', '\\u003c')
s = s.replace('</body>', '<div id="assistant-root"></div><script type="application/json" id="practice-seed">' + seed + '</script>\n<script>\n' + ui + '\n' + gran_ui + '\n</script>\n<script>\n' + courses_ui + '\n</script>\n</body>', 1)
(ROOT / 'tjpb-mapa-estudo.html').write_text(s)
print(f'HTML independente gerado: {len(s.encode()):,} bytes com {len(combined_questions)} questões no seed.')

# Linked reports use the same visual tokens; keep all original report content and behavior.
import re
report_css = (ROOT / 'assets' / 'cyber-theme.css').read_text() + '\n' + (ROOT / 'assets' / 'report-theme.css').read_text()
for name in ['relatorio_visual_fgv_ti_tribunais.html', 'tjpb_desenvolvimento_sistemas_relatorio.html']:
    path = ROOT / name
    report = re.sub(r'<style id="tjpb-shared-theme">.*?</style>', '', path.read_text(), flags=re.S)
    report = report.replace('</head>', '<style id="tjpb-shared-theme">' + report_css + '</style></head>', 1)
    path.write_text(report)
