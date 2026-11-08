# 交接：管理版界面整理 + 纯享版召唤特效

**最新方向见第 14 节：用户已否定 v0.0.18 的人物召唤与预加载，当前改为 0.6 秒原卡旋转放大后打开网页。第 8–13 节仅是历史。**

交接日期：2026-11-07。本轮已继续处理下列待办，结果见第 7 节。工作区里的后端排序、管理版界面和召唤特效仍未提交，提交拆分仍需用户确认。

## 1. 现状一览

| 检查 | 结果 |
|---|---|
| 前端 `cd web && npm run typecheck && npm test && npm run build` | 通过，测试 80 个 |
| 后端 `python -m pytest backend/tests -q` | 通过，测试 308 个 |
| 视觉 | 管理版 7 个页面在 1440/1920/1280/390 宽度下截图核对过；召唤动画逐帧核对过 |
| 未验证 | Safari 下召唤结束后打开新标签页（可能被拦截，见待办）；真实 NAS 部署 |

Python 环境已于本轮修复：当前 `.venv` 使用 Python 3.12.15，项目依赖与视觉验证依赖均已安装。原失效环境保留在被 Git 忽略的 `.venv-handoff-backup-20261107/`，无需再次重建。

## 2. 两批改动

### A. 后端：移到其他目录的书签追加到目标目录末尾（用户自己的改动，本次只跑了测试）
`backend/bookmark_query.py`（`append_bookmarks()`）、`backend/main.py`、`backend/worker.py`、`backend/folder_ai.py`、`backend/tests/test_folder_move.py`、新增 `backend/tests/test_filing_order.py`、`README.md` 和 `API-CONTRACT.md` 中的相关段落。

### B. 前端：本次会话的改动
| 文件 | 内容 |
|---|---|
| `web/src/polish.css`（新增，在 `main.tsx` 中**最后**引入） | 管理版的全部样式整理：统一的颜色变量、页面模板、目录栏、列表行、各页布局、修复抖动 |
| `web/src/FolderRail.tsx`（新增） | 书签库左侧常驻目录栏（宽度 ≥1280px 时显示） |
| `web/src/BookmarkList.tsx` | 书签行：只显示域名和路径，标签放进行内，完整网址移到「详情」 |
| `web/src/main.tsx` | 页头操作区 `pageActions`、`library-layout`/`library-content` 包裹层、任务卡片、设置页把版本面板移到最下面、「清除筛选」按钮常驻但默认隐藏 |
| `web/src/summonSequence.ts`、`CardSummonOverlay.tsx`、`card-summon.css`（新增） | 纯享版点卡片后的召唤特效 |
| `web/src/ClowBookmark.tsx` | `CardDeparture` 的 import 改成了 `./CardSummonOverlay` |
| `web/src/cardDeparture.ts`、`CardDepartureOverlay.tsx`、`departureCanvas.ts`、`card-departure.css` | 旧的翻面碎裂动画调顺了（已不再使用，保留作为备选；`createBackTexture` 仍被召唤特效使用） |
| `web/tests/card-summon.test.mjs`（新增）、`clow-deck.test.mjs`、`departure-canvas.test.mjs` | 对应的测试 |

## 3. 已定下的设计决定（不要推翻）

以下都是和用户确认过、或者是用户明确要求的：

**管理版**
- 管理版统一用白底、浅灰边框、酒红强调色；米黄羊皮纸和金色**只留给纯享版**。颜色变量定义在 `polish.css` 的 `.clarity-shell.mode-manage` 上。
- **页面模板**：左边是标题加一句说明，右边是 `.page-actions`。最前面固定是「去纯享版」，接一条竖线，然后是本页操作，主按钮（酒红）放在最后。
  - 用户明确要求「去纯享版」**放在页面顶部**，不要挪到侧栏。
  - 宽度 ≥1101px 时隐藏顶栏 `.topbar`；更窄时保留顶栏（里面有「去纯享版」「添加网址」和菜单按钮）。
- **书签库目录栏**：目录栏和右侧内容是两个独立的盒子，`.library-layout.has-rail` 用两列网格。外层默认 `display: contents`，所以其他页面和纯享版不受影响。
  - **不要**改回「目录栏用网格跨很多行」的写法：列表高度一变，右侧的搜索栏就会上下跳。
- **防抖动**：「清除筛选」按钮在宽屏下一直占着位置，没有筛选时 `visibility: hidden`；宽度 ≥1101px 时设 `scrollbar-gutter: stable`。用 `scripts/jitter.py` 验证：连点目录时，搜索栏和目录栏的位置必须完全不变。
- 宽屏下书签行的操作按钮只在悬停、键盘聚焦或选中时显示；触屏设备上一直显示。
- 任务中心：三张任务卡片，每张写明做什么、为什么现在不能用、开始按钮。应用设置：左右两栏，「AI 服务」在最上面，「版本与更新」在最下面。

**纯享版召唤特效**（`summonSequence.ts` 是唯一的动画时间轴，有效动画长 1800ms，不含素材等待）

**最新用户纠正：人物必须保持原牌的样子，只补齐抠图缺失部分，不接受重新设计的三维人物。** 第 8 节的程序建模方案已被否定。第 9 节记录雨牌样板，第 10 节将确认后的效果扩展到整套 52 张牌；下列亮度提取实现仅作为素材加载失败的后备。
1. 卡从手牌飞到中央，转两圈、越转越慢，**停在正面**，人物脚下的地面法阵浮现。
2. 卡面发光（glow）。
3. **卡面插画上的召唤物从卡里升起**（emerge）。用户明确要求用卡面上的形象，而不是原创精灵或文字。做法是 `extractFigure()`：从这张卡自己的 `/clow-deck/<key>.webp` 里，取插画区 `ART_WINDOW` 做抠图，规则是「偏暖 × 够亮 × 不能太饱和」，去掉紫底、金框和太阳纹。同时卡面插画区盖上空的紫底（`.clow-summon-hollow`）。
4. 卡碎成光点流向召唤物（dissolve）。
5. 召唤物冲向屏幕、白光一闪（rush/flash），然后打开新标签页。
- 动画中点任意处：跳过并直接打开；点 × 或按 Esc：取消、不打开；系统「减少动态效果」：直接打开。
- 图片尚未加载完成时，在 700ms 的出画前阶段保持原卡，原画就绪后继续；`drawSprite()` 蝴蝶兜底已移除。两种素材均失败或加载超过 8 秒时转入正常打开流程。
- 精灵和光的颜色按卡牌属性取自 `spiritPalette()`，共 8 类。
- 用户之前说过旧的翻面碎裂动画「这个不动」，后来主动要求换成召唤。旧组件保留着；要换回去，只需改 `ClowBookmark.tsx` 里那一行 import。

## 4. 待办 / 未决

1. **提交**（用户还没决定，先问用户）。建议拆成：① 后端排序（A 批）② 管理版界面（`polish.css`、`FolderRail`、`BookmarkList`、`main.tsx`）③ 召唤特效和旧动画调整。提交信息末尾加上项目约定的 Co-Authored-By 行。
2. **README 已同步**：保留当前通用卡面召唤进入正常构建，旧精绘／独立雨精灵实验继续留在本地存档；说明已按当前实现改为约 1.8 秒召唤流程。
3. **Safari 前台真机仍待验证**：新标签页在动画结束时打开，拦截后使用详情与手动链接兜底。自动化 WebKit 与真实 Safari 的验证边界见第 7 节，不能用 WebKit 的通过代替所有 Safari 版本验收。
4. **目录名称已完成**：行内仅显示末级 `folder.name`，悬停提示与操作按钮无障碍名称继续保留完整路径，子目录缩进不变。
5. **待整理箱按钮已完成**：用户本轮明确选择「分类助手」为主按钮、「添加网址」为次要操作；桌面页头与手机顶栏的样式均已处理。
6. **手机与缓存已处理**：完成手机尺寸检查；抠图结果按卡牌与色板缓存，最多 8 张，最久未使用的先淘汰；失败结果不缓存，下次召唤重试。低性能模拟与真实设备边界见第 7 节。

## 5. 怎么验证（视觉）

```sh
# 1) 使用全新隔离目录；先确认端口空闲，不要接入已运行的真实服务
export BOOKMARK_BASE_URL=http://127.0.0.1:18011
export BOOKMARK_DEMO_DIR="$(mktemp -d /tmp/bookmark-demo-XXXXXX)"
DATA_DIR="$BOOKMARK_DEMO_DIR" .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 18011
# 2) 另开终端：灌演示数据（账号「演示账号」/ demo-pass-123）
export BOOKMARK_BASE_URL=http://127.0.0.1:18011
uv pip install --python .venv/bin/python playwright pillow numpy
.venv/bin/python docs/handoff/scripts/seed.py
# 3) 截图，用本机 Chrome（channel='chrome'），参数是「输出目录 标签」
.venv/bin/python docs/handoff/scripts/shot.py /tmp/out v1        # 1440 宽 + 手机宽的书签库
.venv/bin/python docs/handoff/scripts/allpages.py /tmp/out v1    # 7 个管理页的总览图
.venv/bin/python docs/handoff/scripts/jitter.py /tmp/out         # 点目录时的布局偏移
.venv/bin/python docs/handoff/scripts/anim.py /tmp/out v1 80     # 召唤动画，每 80ms 一帧（用 page.clock 控制时间）
.venv/bin/python docs/handoff/scripts/keypreview.py web/public/clow-deck /tmp/out/key.png thunder watery flower windy
# 4) 完整交互检查（真实 Chrome + 自动化 WebKit，使用上面的演示账号）
.venv/bin/python -m playwright install webkit
.venv/bin/python docs/handoff/scripts/verify.py --base-url "$BOOKMARK_BASE_URL" --out /tmp/out
```
改前端后先在 `web` 下运行 `npm run build`，服务端读的是 `web/dist`。`anim.py` 需要系统里有 `ffmpeg`，用来拼帧图。旧截图脚本现在都支持 `BOOKMARK_BASE_URL`（默认仍为 8011）；`verify.py` 支持 `--only layout|chrome|webkit|cache`，便于针对失败项目复查。

## 6. 约定

- 界面文案用中文，简短。新的管理版样式写进 `polish.css`，不要再加新的覆盖层文件。
- 改布局后用截图核对，不要只看代码；动画用 `anim.py` 逐帧核对。
- 不要在真实数据目录 `data/` 上做实验。

## 7. 界面与旧召唤续作（2026-11-07）

- 目录管理行仅显示末级名称，完整路径保留为悬停提示；已有计数、层级和操作逻辑保留。
- 待整理箱的「分类助手」成为主操作，添加网址改为次要操作。手机顶栏复用相同按钮定义，并补充次要操作样式，避免旧 `.action-add` 样式仍将它涂成主色。
- 模式切换按钮补充明确的 `aria-label`；手机隐藏按钮文字后仍可被读屏正确识别，触控高度至少 44px。
- 召唤抠图加入最多 8 张的 LRU 缓存（双 Canvas 像素数据约 26 MB），合并同卡重复加载；失败不缓存，取消后不再接收异步抠图结果。
- README 与当前召唤、管理列表及待整理箱行为保持一致。
- 新增 `scripts/verify.py`，验证多尺寸布局、动画交互与缓存；所有视觉脚本支持选择隔离服务地址。

后端排序改动仍是接手前已存在的用户改动，本轮未修改。真实数据、NAS 部署、独立雨精灵实验 worktree 均未改动。

验证结果与边界：

- TypeScript 检查、80 项前端测试及生产构建通过；308 项后端测试通过（依赖中的一条弃用警告）。
- 目录连续切换时，搜索栏与目录栏的 x/y/宽高完全一致。
- 全部书签、待整理箱、目录管理在 1920、1440、1280、1100、768、390、320 宽度下共 21 组布局检查通过，无页面横向溢出；另外截图核对了 1440 宽的 7 个管理页。
- Chrome 与自动化 WebKit 的动画交互通过：正常结束打开、点击跳过且只打开一次、关闭／Esc 取消后无延迟打开、拦截新标签页后显示详情与手动链接、减少动态效果时直接打开；测试目标页的 `opener` 为 `null`，无页面脚本异常。
- 缓存检查通过：同卡再次召唤不重复处理像素，图片首次失败后下次可重试，使用第 9 张不同卡牌后最早一张被淘汰。Chrome 4 倍 CPU 降速下首次像素处理段约 51.6ms，WebKit 正常速度约 22ms；该计时不包含图片解码与后续光晕绘制，不是整段动画的耗时。
- 真实 Safari 26.6.2 的自动化窗口可登录、切换模式并取消召唤，但窗口被系统判定为后台（`document.visibilityState === 'hidden'`），动画帧暂停；前台坐标操作又返回 `noWindowsAvailable`。因此不把该次停滞归因于产品兼容性，也不声称已经完成真实 Safari 前台弹窗验收。
- 手机与低性能检查采用桌面浏览器的移动视口／触屏模拟及 Chrome 4 倍 CPU 降速，不能替代低端手机真机验收。NAS 尚未部署。

## 8. 已否定的程序三维样板（2026-11-07）

助手曾把“立体”解释为重新进行程序三维建模。用户实际观看后明确否定：“好丑，召唤的样子还要和原来一样……只要补齐抠图缺失的部分即可。” 这意味着保留原人物是最高优先级，不能以三维体积为由改变脸、造型和画风。

此方案的源码、测试和验证脚本已移到被 Git 忽略的 `web/experiments/rain-3d-rejected/` 作为本地历史参考；Three.js 及类型依赖已从当前应用移除。旧 `?summon-preview=rain-3d` 地址兼容显示新的原画补齐预览，不再加载三维模型。

## 9. 当前方向：原画人物补齐（2026-11-07）

- 保留原牌人物的脸、姿态、比例、服饰纹样、线条和配色，只修复抠图误删／被遮挡的小部分。自然镂空继续保持透明，不新增人物、衣服或装饰。
- 最终素材使用内置 ImageGen 直接以原牌为编辑目标提取，选定 `web/public/spirits/rain-restored-v3.png`；完整编辑提示词、原图来源与校验值保存在同目录 `provenance.json`。原版 `web/public/clow-deck/rain.webp` 不改动。
- `web/src/spiritArtwork.ts` 记录修复素材、透明裁切区域与卡面坐标；渲染时保留原始颜色与暗线，不再对修复素材执行亮度抠图或元素染色。
- `CardSummonOverlay.tsx` 在雨牌实际召唤中优先使用完整人物，沿用原先 1800ms 时间轴；素材失败时退回原卡提取，并在下次召唤重试修复素材。缓存仍保留最多 8 张。
- 独立预览 `?summon-preview=rain` 使用相同的召唤组件，提供原牌并排比较、原牌叠加对照和播放按钮；旧三维预览地址也进入此页面。
- 此阶段只接入雨牌修复素材；用户后续确认样板后，已继续扩展整套牌，见第 10 节。

验证脚本：

```sh
.venv/bin/python docs/handoff/scripts/verify-rain-artwork.py --base-url http://127.0.0.1:18011 --out /tmp/rain-restored --engine chrome
.venv/bin/python docs/handoff/scripts/verify-rain-artwork.py --base-url http://127.0.0.1:18011 --out /tmp/rain-restored --engine webkit
```

当前 TypeScript、81 项前端测试和生产构建通过。Chrome／WebKit 均检查并排／叠加对照、4 组横竖屏、实际使用修复素材、播放完成、Esc 取消以及素材失败后的回退和重试；最多 8 张缓存的淘汰检查仍通过。视觉验收仍以用户对原牌形象的实际比对为准。未部署 NAS、未提交或推送。

另在隔离演示库中搜索并点击实际雨牌书签，确认加载的是修复人物素材、取消后不会打开网页，且无页面脚本异常。最终并排对照、叠加对照和召唤截图均已核对。

法阵统一：召唤盘直接使用与纯享版地面相同的 `clow-circle.svg`，保留完整太阳、月轮、叠方框和外围符文。两处由 `clowCircle.ts` 共用素材地址与 90 秒旋转周期。用户进一步明确召唤盘应平铺在人物脚下，不能竖在背后；召唤层现采用与纯享版地面相同的 `scaleY(.36)` 投影，外层固定地面透视、内层在盘面内旋转。盘的直径根据视口收敛，保留放大与淡入淡出，仍由 1800ms 时间轴驱动。

2026-11-08 地面投影修正验证：TypeScript、81 项前端测试及生产构建通过；Chrome 与 WebKit 在 1280×900、390×844、320×568、844×390 的召唤阶段均确认法阵位于下方、投影高宽比为 .36 且未超出视口，并核对截图。播放完成、取消和修复素材失败重试仍通过。

同日进一步按用户要求将牌置于阵心：牌的底边中心与地面法阵中心使用同一基准点，溶解缩小时仍以底边为锚点；整组构图根据人物升起和法阵前沿所需空间缩放，避免阵心下移后超出手机或横屏视口。TypeScript、81 项前端测试和构建通过；Chrome／WebKit 在上述 4 个视口新增核对牌底中心与阵心的偏差小于 1px，播放、取消、素材失败重试及截图均通过。

## 10. 整套 52 张牌的原画召唤物（2026-11-08）

用户确认第 9 节雨牌样板及阵心位置后，明确要求把全部牌统一处理。本轮完成新增 51 张透明素材，保留已确认的 `rain-restored-v3.png`。52 张原始卡面 WebP 没有改动。

- 每张牌使用自身原画作为内置 ImageGen 的编辑目标，保留原人物／动物／物件／抽象纹样，修复少量被框饰打断的轮廓；去掉紫底、边框、牌底通用月亮和顶部通用太阳挂纹。秤牌的悬挂日月、暗牌手持月亮、眠牌杖上的月亮属于主体，保留。
- 最终 PNG 位于 `web/public/spirits/`，当前共 52 个有效素材；逐张来源、源图与输出校验值、完整提示词、透明裁切和摆放坐标见 `provenance.json`。除雨牌 v3、锁牌 v2 外，其余使用 v1。未选中的锁牌 v1 存入被 Git 忽略的本地校样目录。
- `spiritArtwork.ts` 覆盖 `clowDeck` 的全部 52 个键，实际纯享版和预览使用相同的 `CardSummonOverlay`。保持原始颜色与暗线，素材失败时回退原卡提取并在下次重试；缓存最多 8 张。第 7 节约 26 MB 的估计只适用于旧提取尺寸，不能视作当前高分辨率素材的完整内存上限。
- `RainArtworkPreview.tsx` 已扩展为全牌预览，保留原文件名和雨牌旧地址兼容。`?summon-preview=all` 默认风牌，`?summon-preview=<牌型>` 直达指定牌；提供原牌并排／叠加对照、选择框和上一张／下一张。牌型按序号传给真实召唤组件，预览播放不打开真实网站。
- `scripts/import-spirit-artwork.py` 只复制选定 PNG 字节、分析 alpha 边界并维护元数据；不重新加工图像。输入映射为 `{牌型: {path, prompt, version?}}`，已有同名但内容不同的文件会拒绝覆盖。
- `.gitignore` 放行当前版本化召唤物，README 与第三方素材来源记录同步说明这些原牌衍生图像。

验证结果：TypeScript、81 项前端测试、生产构建通过。素材测试覆盖 52 个键、互不重复的图像、RGBA 格式、文件尺寸与裁切边界、无变形摆放以及来源校验值。逐张原牌／透明素材校样及实际召唤截图已核对。

Chrome 与自动化 WebKit 均逐一加载并完整播放 52 张牌，确认使用 `restored` 素材、共用完整法阵、牌底与阵心对齐；全牌选择、首尾循环、叠加对照和手机横竖屏取消通过。正常书签入口的完成打开、点击跳过、Esc／关闭取消、弹窗拦截兜底和减少动态效果也在两种引擎通过。最近 8 张缓存淘汰与全图加载失败后重试通过，雨牌修复素材失败后回退原卡及下次重试也复查通过。

```sh
.venv/bin/python docs/handoff/scripts/verify-all-spirits.py --base-url http://127.0.0.1:18011 --out /tmp/all-spirits --engine chrome
.venv/bin/python docs/handoff/scripts/verify-all-spirits.py --base-url http://127.0.0.1:18011 --out /tmp/all-spirits --engine webkit
.venv/bin/python docs/handoff/scripts/verify.py --base-url http://127.0.0.1:18011 --out /tmp/all-spirits --only cache
```

仍未提交、推送或部署 NAS；真实 Safari 前台与低端手机真机的边界沿用第 7 节。当前本地演示服务继续监听 `127.0.0.1:18011`，使用隔离数据目录。

## 11. 目录勾选框与图标区分（2026-11-08）

用户指出目录管理行左侧的空心勾选框和空心文件夹太相似。`FolderSummary` 现将 18px 开口文件夹放在名称旁，采用浅酒红填色，数量行与名称对齐；移除行级单独的 21px 空心文件夹。样式集中在 `polish.css`，原生勾选框及其至少 44×44px 点击区域保留，装饰图标对读屏隐藏。

TypeScript、81 项前端测试和构建通过；Chrome 检查单选、全选、中间态、键盘空格切换、取消选择和进入／退出排序模式。1440、768、390、320 与 844 横屏视口均无横向溢出，父子目录层级保留，并核对桌面和触屏布局截图。没有修改目录数据或后端逻辑。

用户继续指出左侧勾选框与文件夹高低错开，已将勾选框、图标和目录名称统一对齐首行：标题行高 22px，18px 勾选框和图标在该行内居中，点击区域仍至少 44×44px。6 个目录在上述 5 个视口的勾选框／图标中心偏差均小于 .5px，长名称换行、选中与全选状态也复查通过；TypeScript、81 项测试和构建再次通过。

随后按用户要求把目录行及“全选目录”的可见勾选方框统一从 18px 缩至 14px，同时覆盖通用样式的 17px 最小尺寸。文件夹图标保持 18px，首行中心对齐与 44px 点击区域保留。1440、390、320 宽度下尺寸、对齐、勾选和全选检查通过，81 项测试及构建通过。

## 12. 修复首次点击慢加载时出现兜底蝴蝶（2026-11-08）

用户反馈部分牌首次点击仍飞出抽象蝴蝶。在正常书签入口拦住雷牌修复 PNG 的响应，可在旧版 v0.0.16 稳定复现：1800ms 时间轴先运行，720ms 起人物出场时 `figure` 仍为空，旧 `drawSprite()` 便生成四翅光精灵。原整套预览验证提前解码了素材，未覆盖这一冷加载场景。

修复分支 `fix/summon-artwork-ready`，工作目录 `/Users/ranklier/code/gitlab/ranklier/bookmark-app/.worktrees/summon-artwork-ready`，基于已发布的 `4e6cdfc`。

- `beginSummon()` 接受素材就绪状态；加载未完成时将有效时间保持在 700ms，卡牌仍完整且未进入出画、变空或消散阶段。就绪后从停留处连续恢复，长解码或掉帧不会直接跳到冲屏结束。素材及时就绪时保留原来的 1800ms 节奏。
- 删除了与牌面无关的蝴蝶绘制实现。修复素材失败时仍可回退到当前原卡提取；全部图片失败或加载达到 8 秒时使用原有打开／弹窗拦截详情兜底。等待期间关闭、Esc、改变窗口尺寸、跳过及减少动态效果继续可用，晚到的图片不会触发延迟或重复打开。
- 新增 `verify-artwork-loading.py`，从真实书签入口检查冷加载、恢复、等待时取消／跳过、超时和全部图片失败。`verify-all-spirits.py` 改为先拦住每张素材响应再点击，确认完整卡牌等待后才放行图片，不再提前解码暖缓存。
- 验证脚本使用 ISO 时间暂停虚拟时钟，避免把毫秒时间戳误当秒；异步预览入口等待选项渲染完成再检查。

用户已确认将本修复提交、合入 main 并推送镜像；v0.0.16 是存在旧行为的版本，本次按正常发布流程生成新的版本镜像并更新 latest。

本轮验证结果：当前已跟踪的前端测试 76 项通过（基线 74 项，新增 2 项等待／取消回归；旧记录 81 项包含主目录中未跟踪的历史实验测试），TypeScript 与生产构建通过。Chrome／WebKit 均逐张完成 52 次人为延迟素材的冷加载检查，正常书签入口的延迟恢复、关闭、Esc、窗口变化、跳过、超时和全部图片失败共 7 个场景均通过；原正常打开、弹窗拦截、减少动态效果、8 张缓存和图片失败重试也通过。

已构建本地 ARM64 预览镜像 `bookmark-app:summon-artwork-ready`，使用 tmpfs 隔离数据启动 `bookmark-artwork-ready-preview`，仅监听 `127.0.0.1:18013`。容器健康，HTTP 提供的修复 JS 与本地生产构建字节一致，52 张 PNG 均与来源记录的校验值一致；同一组 7 个冷加载场景在容器上通过 Chrome／WebKit 复查。预览演示账号仍为“演示账号”／`demo-pass-123`。源码预览服务另在 18012，均不连接真实 NAS 数据。

发布只读计划的下一版本为 v0.0.17（amd64＋arm64，同时更新 latest）。用户已按 AGENTS.md 确认提交和发布；实际发布版本、源码修订和镜像摘要由本机 `.release/state.json` 记录，并在发布后核对远端。

## 13. 召唤素材随页面启动准备与浏览器持久缓存（2026-11-08）

用户在 v0.0.17 发布后要求提前准备动画数据，随后明确要求随页面启动加载、复用浏览器缓存，并选择“页面先可用，召唤区显示准备进度，资源就绪后可点”。当前改动在分支 `feat/summon-preload`，worktree `/Users/ranklier/code/gitlab/ranklier/bookmark-app/.worktrees/summon-preload`，基于 `9158819`。本轮沿用用户此前明确的“更新代码、推送镜像”授权，将改动提交、合入 main 并正式发布；最终版本、修订和摘要见主目录 `.release/state.json`。

- `App` 挂载即启动一个页面级任务，登录阶段已开始下载，不再等待纯享版挂载。52 张修复原画、52 张原卡面和共用法阵共 105 个图片资源分批准备；后台最多 2 个传输、1 个纹理准备任务。切换管理／纯享版共用该任务，页面退出时清理。
- 纯享版显示简短进度；全部图片资源及附近卡牌纹理就绪后启用点牌召唤。管理和“翻阅”始终可用。失败显示重试；重试只补缺失资源；减少动态效果时跳过素材准备，保留直接打开。
- `summonAssetCache.ts` 通过 IndexedDB 按版本 URL 保存 52 张 PNG Blob，下载和解码共用同一份文件／在途请求。Blob 异步读取后用临时 Object URL 解码，纹理完成后释放 URL。页面启动清理已不再使用的旧版本键；没有修改图像字节和造型。存储受限／配额不足时回退 HTTP 缓存，不阻止使用。
- HTTP 缓存：版本化 PNG 和 Vite 指纹文件使用 `public, max-age=31536000, immutable`；HTML、原卡和法阵使用 `no-cache` 与 ETag／Last-Modified 协商，未改变时 304、不重传正文。缺失静态素材返回 404/no-store，防止误缓存 SPA HTML；API 的 no-store 保留。
- `summonArtwork.ts` 保持最多 8 张解码纹理的 LRU；只提前解码当前中央／悬停／焦点附近 5 种牌，浏览位置改变时更新。刷新会重建这部分内存纹理，复用本地文件，不把整套 52 张都解码。
- 召唤播放时暂停其他牌的后台准备。点击正在准备的同一张牌会提升并复用任务；原来的 700ms 等待、8 秒打开兜底、取消／跳过行为保留。后台图片准备 8 秒、普通传输 15 秒超时释放队列。

验证：TypeScript、84 项跟踪前端测试和生产构建通过；319 项后端测试通过，其中新增 11 项静态缓存、304、版本更新与缺失素材回归。Chrome 与 WebKit 均验证页面启动即请求、页面仍可用、进度及禁用／启用、附近 5 种牌、暖点击不新增解码／纹理、浏览位置调整、失败重试、存储不可用回退、减少动态效果及 390px 无横向溢出。Chrome 使用 4 倍 CPU 降速与可控动画时钟，不能代替真机帧率验收。

缓存实测使用普通持久浏览器配置，未使用会关闭 HTTP 缓存的 Playwright routing：两种引擎首次原画传输 82,952,564 字节（含传输开销），本地 52 条 PNG；普通刷新、新标签页、关闭后重开浏览器，原画请求／网络传输均为 0，本地仍 52 条，只解码附近 5 种牌。仅 HTTP 缓存时 WebKit 曾部分重传，因此增加 IndexedDB 文件缓存，不能用旧的 HTTP-only 结果描述当前实现。无痕／站点数据被清理或存储被浏览器回收时仍可能重新下载。

```sh
.venv/bin/python docs/handoff/scripts/verify-preload.py --base-url http://127.0.0.1:18015 --out /tmp/preload-check --engine chrome
.venv/bin/python docs/handoff/scripts/verify-preload.py --base-url http://127.0.0.1:18015 --out /tmp/preload-check --engine webkit
```

本地预览 `http://127.0.0.1:18015/` 使用临时 DATA_DIR，账号“演示账号”／`demo-pass-123`，没有连接真实数据。核验报告在 `/Users/ranklier/.codex/visualizations/2026/11/07/01a1b638-4a9a-71d3-a3f2-d1e070f85bd7/summon-preload/startup-cache/verification.json`。正式发布时合入 main；版本镜像与 latest 均由发布脚本核验，并另存 `.release/verification-<版本>.json`。NAS 运行容器不由本发布流程更新。

## 14. 用户要求轻量旋转放大打开（2026-11-08）

用户在实际使用 v0.0.18 后反馈性能太差，明确要求“点击卡片以后，卡片旋转变大，然后新页面出现就可以”。这次要求取代第 9–13 节的人物召唤／素材预加载方案；不要重新启用整套下载、解码、粒子或加载门禁。

工作目录 `/Users/ranklier/code/gitlab/ranklier/bookmark-app/.worktrees/card-open-simple`，分支 `feat/card-open-simple`，基线 `f49d575`。按本会话既有“更新代码、推送镜像”授权，验证后合入 main 并发布；最终版本、修订、摘要以 `.release/state.json` 和对应 verification 记录为准。NAS 运行容器不自动更新。

- `CardOpenOverlay.tsx` 只复制当前卡面，使用浏览器原生 transform 动画，600ms 内旋转 360°、居中并放大，完成后沿用正常新标签页打开。没有 JS 逐帧绘制、Canvas、额外人物图片、模糊纹理、粒子、碎裂或冲屏闪光。动画事件未到时 900ms 保底结束；系统减少动态效果直接打开。
- 移除 App 中的预加载服务、进度、就绪门禁和牌列预加载回调。普通页面不再访问召唤 IndexedDB 或下载 `/spirits/`；已存的旧文件不主动读取或改动。
- 人物 PNG 和旧模块保留在源码中作为历史参考，Vite 生产复制和 Docker 上下文排除 `web/public/spirits/`。移除主入口的旧预览动态 import，`?summon-preview=...` 不再激活旧召唤。产物约从 85.54 MiB 降为 6.26 MiB。
- 保留原牌型、书签排序、纯享版地面背景和独立“翻阅”详情。旧样式文件中共享的翻阅按钮、44px 点击区域、原卡隐藏／恢复和高对比度规则移到 `card-open.css`，避免移除旧碎裂样式时误伤详情。
- 点击空白跳过，Esc／关闭／窗口变化／切后台取消；清理动画与超时，防止取消后延迟或重复打开。弹窗被拦截时显示原有详情及手动链接。

当前验证脚本为 `docs/handoff/scripts/verify-card-open.py`。旧 `verify-preload.py`、召唤／原画预览脚本只对应历史实现，不适用于新的正常入口；`verify.py --only layout` 的管理版布局检查仍可按需使用。真实浏览器验证必须使用隔离 DATA_DIR，并在演示库加入指向测试服务器 `/api/health?animation-check=1` 的“本地打开验证”书签，避免实际打开外部网站。

验证完成：TypeScript、84 项前端测试和生产构建通过。产物 6,564,641 字节（约 6.26 MiB），52 张原卡面保留，`spirits` 目录、相关缓存与召唤代码均未进入生产输出。Chrome／WebKit 在 1280×900、390×844、320×568、844×390 四个视口确认旋转放大、无需加载门禁，Canvas 调用、IndexedDB 访问和人物素材请求均为 0；Esc、关闭、跳过、改变窗口、切后台、动画事件保底、减少动态效果和详情打开／关闭／焦点返回均通过。真实新标签页打开实测 Chrome 4 倍 CPU 降速约 666ms，WebKit 约 640ms，非真机帧率验收。同步修复了 WebKit 关闭详情时卡牌尚未恢复可见，导致焦点无法回到翻阅按钮的时序。核验报告位于 `/Users/ranklier/.codex/visualizations/2026/11/07/01a1b638-4a9a-71d3-a3f2-d1e070f85bd7/card-open-simple/verification.json`。
