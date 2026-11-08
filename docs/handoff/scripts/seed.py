import os
BASE = os.environ.get('BOOKMARK_BASE_URL', 'http://127.0.0.1:8011').rstrip('/')
import httpx
c = httpx.Client(base_url=BASE, headers={'Origin': BASE})
setup = c.post('/api/auth/setup', json={'username': '演示账号', 'password': 'demo-pass-123'})
setup.raise_for_status()  # An initialized server must never receive demo writes.
print(setup.status_code)
def f(name, parent=None): return c.post('/api/folders', json={'name': name, 'parent_id': parent}).json()['id']
ai = f('人工智能'); dev = f('开发与技术'); fe = f('前端开发', dev); nas = f('自托管与 NAS', dev); life = f('生活与阅读'); design = f('设计灵感')
B = [
 ('https://github.com/awesome-selfhosted/awesome-selfhosted','Awesome Selfhosted · 开源自托管应用清单','可以在自己服务器上运行的自由软件网络服务与应用列表。',nas,['自托管','清单'],''),
 ('https://arxiv.org/list/cs.AI/recent','arXiv · 最近想读的论文','',None,[],''),
 ('https://developer.mozilla.org/','MDN Web Docs · 开发者的 Web 技术手册','从 HTML、CSS 到 JavaScript，系统查阅 Web 标准、浏览器 API 与实践指南。',fe,['前端','参考文档'],'遇到浏览器兼容性问题时优先查这里。'),
 ('https://react.dev/','React 官方文档','用组件构建用户界面的库，新版文档以 Hooks 为中心。',fe,['React','前端'],''),
 ('https://www.nngroup.com/articles/','Nielsen Norman Group · 可用性研究文章','基于研究的用户体验指南。',design,['UX'],'表单设计那篇值得反复看。'),
 ('https://docs.docker.com/compose/','Docker Compose 文档','定义和运行多容器应用。',nas,['Docker'],''),
 ('https://www.anthropic.com/research','Anthropic Research','',ai,['AI'],''),
 ('https://www.typography.com/blog','Typography 博客 · 字体与排版','关于字体设计、排版细节与阅读体验的长文。',design,['排版'],''),
 ('https://www.douban.com/','豆瓣读书 · 想读清单','',life,['读书'],''),
 ('https://sqlite.org/lang.html','SQLite SQL 语法','SQLite 支持的 SQL 语言参考。',dev,['数据库'],''),
]
for url,t,d,fid,tags,n in B:
    r = c.post('/api/bookmarks', json={'url':url,'title':t,'description':d,'folder_id':fid,'tags':tags,'notes':n}); print(r.status_code)
