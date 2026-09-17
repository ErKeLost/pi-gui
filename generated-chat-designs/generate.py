import base64,getpass,json,urllib.request,re
from pathlib import Path
out=Path(__file__).parent
key=getpass.getpass('API key: ')
ref=base64.b64encode(Path('/var/folders/8y/vk201_1n4d78nsmlyfsrqk740000gn/T/codex-clipboard-648fed5c-e1c9-422e-9209-9f1fd4f14068.png').read_bytes()).decode()
common='''Generate ONE beautiful high-fidelity desktop application UI design image, landscape 16:10, sharp readable typography. Use attached screenshot as product reference, but professionally redesign its chat area. This is a real implementable coding agent desktop app, not a landing page, no decorative charts or gradients. Keep left navigation with project adny-me, 新建会话, 工作台, 技能与命令, 最近会话, 设置. Narrow sidebar 230px, main content well aligned. Chinese interface. Same completed conversation in all designs: user asks 读一下这个项目是干什么的; assistant has read 4 files and run 2 commands, then answers that adny.me is a personal portfolio with React, TypeScript and Tailwind, with a short overview and concise project structure. Clear logic: user prompt → grouped completed execution with inspectable disclosure → prominent assistant answer → follow-up composer. No repeated Reasoned headings. Technical traces are secondary. Completed activity uses a tiny muted green check, current model Grok 4.6 · Medium in composer, empty composer send button is disabled. Composer anchored at bottom with spacious 2-line field, attachment plus and model menu at bottom. No fake badges or unnecessary cards. Beautiful hierarchy, crisp line icons, 1px borders, restrained colors, subtle rounded corners, main content maximum readable line length, careful generous margins. Show full app edge-to-edge, no laptop frame or presentation title outside app. '''
variants=[
('01-quiet', '''DIRECTION A: Quiet Graphite. Closest evolution of reference, exceptionally polished monochrome macOS professional software. Background #111214, sidebar #18191c, white and soft gray text, barely visible borders. Single chat column ~800px. Tool activity is one compact inline collapsed disclosure row 已完成 · 读取 4 个文件 · 运行 2 次 · 12 秒 above answer. No expanded timeline. Answer is beautiful unboxed editorial typography, strong heading 项目概览 then compact structured prose and 3 small neutral tech pills. Keep hierarchy focused on readable conversation, luminous yet subtle composer, no accent except understated blue links. Balanced dense content with whitespace. '''),
('02-process-card', '''DIRECTION B: Crafted Process Card. Deep slate charcoal slightly warm dark theme, understated periwinkle accent. Single centered chat column. Between user question and answer, one compact execution card titled 已完成项目分析 with check and 12 秒. Show 3 condensed steps with checks 阅读项目说明, 检查技术栈, 梳理页面结构, each short relative file name on right. Card can collapse using top-right chevron. No shell command text clutter. Answer outside the process card, clearly stronger visual weight, heading 这是一个开发者个人作品站, explanatory prose and structured details. Composer has a soft double border focus treatment and elegant model selector. Premium restrained tool software. '''),
('03-inspector', '''DIRECTION C: Split Inspector. Professional charcoal developer workspace. Left sidebar ~210px, middle chat area ~800px, right slim activity inspector ~300px. Right panel titled 执行记录 with close icon, completed status 6 个步骤 · 12 秒, compact chronological file reads and command summaries with subtle connectors, relative paths README.md, package.json, src/data/portfolio.ts, src/routes/index.tsx. Central chat displays only one small 已完成分析 查看过程 link plus excellent readable final answer, no timeline duplication. Chat header has subtle 执行记录 toggle to reopen panel. Composer occupies central column only, inspector has its own vertical boundary. Refined graphite, tiny mint checks, muted blue active toggle. Intentional spacing, excellent typography and visual balance. ''')]
for name,spec in variants:
 prompt=common+" Dark graphite GitHub-like understated developer UI. All execution grouped into nested disclosure hierarchy, no separate right inspector. Design a consistent same app shell for all states. " + ({'01-quiet': 'STATE 1 COLLAPSED: Only one activity summary row above final answer: 已完成分析 · 读取 4 个文件 · 运行 2 次, right chevron. Beautiful editorial answer below, low visual noise.', '02-process-card': 'STATE 2 GROUP EXPANDED: Activity header expanded, shows six compact file and command rows indented with thin vertical guide. Each row has icon, short readable label, completion tick, and right disclosure chevron. Each detail remains collapsed. Answer below.', '03-inspector': 'STATE 3 NESTED DETAIL EXPANDED: Same activity list expanded, one command row 运行项目检查 is expanded further revealing an inset dark terminal panel labeled Shell with copy icon, command $ npm run check, a few output lines, exit code 0 and duration 2 秒. Other rows remain compact. Final answer below and composer at bottom.'}[name])
 (out/(name+'.txt')).write_text(prompt)
 data={'model':'gpt-image-2.5','prompt':prompt,'n':1,'size':'1536x1024'}
 print('GENERATING',name,flush=True)
 try:
  req=urllib.request.Request('https://api.llmgates.com/v1/images/generations',data=json.dumps(data).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','X-TokenX-Provider':'openai'})
  with urllib.request.urlopen(req,timeout=240) as r: result=json.load(r)
  (out/(name+'-response.json')).write_text(json.dumps(result))
  def walk(x):
   if isinstance(x,dict):
    for k,v in x.items():
     if k=='b64_json':
      target=out/(name+'.png');target.write_bytes(base64.b64decode(v));print('IMAGE',str(target.resolve()),flush=True)
     else:walk(v)
   elif isinstance(x,list):
    for v in x:walk(v)
   elif isinstance(x,str):
    if x.startswith('data:image/'):
     target=out/(name+'.png');target.write_bytes(base64.b64decode(x.split(',',1)[1]));print('IMAGE',str(target.resolve()),flush=True)
    elif len(x)<12000:print('CONTENT',x,flush=True)
    else:print('LONG_STRING',len(x),x[:80],flush=True)
  walk(result)
 except Exception as e:
  print('ERROR',str(e), e.read(3000).decode() if hasattr(e,'read') else '',flush=True)
  break
