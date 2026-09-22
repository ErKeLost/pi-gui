# Computer Use 架构

Orbit 的 Computer Use 是一个类型化的分阶段执行系统，不是第二个通用 Agent。Pi 拥有任务规划、文本和用户交互；本地层拥有阶段状态、集合与空间 grounding；Jev 只在当前阶段的窄候选集中选择；官方 Cua Driver TypeScript SDK 拥有 Accessibility、窗口截图、snapshot-bound token、动作预检和平台输入。

```text
User -> Pi typed target + phase plan
                    -> local desktop target resolver
                         -> Cua installed-app/window inventory
                         -> exact identity or bounded Jev semantic choice
                    -> app lifecycle (connect or launch -> wait for pid/window)
                    -> Cua AX + screenshot observation
                    -> local phase/collection grounding
                    -> narrow Jev action choice
                    -> Cua Driver execution
                    -> phase ledger
                    -> local final verification
```

## 模块边界

| 模块 | 唯一职责 |
| --- | --- |
| `gui-task-contract.ts` | 唯一任务协议、运行事件、Trace 类型和入口校验 |
| `desktop-target-resolver.ts` | 将自然语言应用/窗口意图解析为 Cua 枚举出的真实应用和窗口候选；不拥有启动与输入权限 |
| `candidate-policy.ts` | 把 AX 控件与 capture-bound OCR 区域编译成候选动作，并建立结构集合与 reading order |
| `jev.ts` | 构造单一 bounded candidate Choice，验证完整概率分布，调用固定 TypeSafe endpoint |
| `gui-task-engine.ts` | 类型化 phase ledger、窄候选路由、预算、不可重放语义和状态转换 |
| `completion-verifier.ts` | 对新观察执行独立、确定性的完成验证 |
| `cua-driver.ts` | 将平台无关状态机适配到官方 `@trycua/cua-driver` TypeScript SDK |
| `gui-task.ts` | Pi 工具注册、JSON Schema 和结构化流式进度 |
| `mode.ts` | 会话级开关和主 Agent 操作契约 |

Orbit 不向 Pi 注册 Cua Driver 的原始工具。`gui_task` 首次执行时懒加载同进程 native SDK，会话关闭时显式 shutdown；Jev无法访问 Driver实例、element token、截图或坐标，也不能绕过 phase 与 verifier。

## 运行时身份与路径

macOS 辅助功能按**进程代码签名**授权，不能把权限从 Pi GUI.app 传给系统 Node。因此 Pi 会话在 macOS 上通过 `~/Library/Application Support/ai.pi.gui/runtime/Orbit Agent.app` 启动：这是带 `ai.pi.gui.agent` 标识、显示名为 Orbit 的包装运行时，用户只需在系统设置里允许 **Orbit** 的辅助功能和屏幕录制。

| 变量 | 含义 |
| --- | --- |
| `ORBIT_HOST_BUNDLE_ID` | 主应用 `ai.pi.gui` |
| `ORBIT_AGENT_BUNDLE_ID` | 电脑操作运行时 `ai.pi.gui.agent` |
| `ORBIT_PI_NODE_PATH` | 实际启动 Pi 的可执行文件（macOS 为 Orbit Agent） |
| `ORBIT_PI_CLI_PATH` | 捆绑的 Pi CLI |
| `ORBIT_TYPESAFE_KEY_PATH` | Jev Key 文件 |
| `NODE_PATH` | 捆绑的 `@trycua` / `@typesafe-ai` 模块 |


## 任务协议

`gui_task` 只有一套当前协议：

- `target.app` 是自然语言应用意图，不是进程名、bundle ID 或本地化显示名。解析器先使用 Cua 的 installed-app inventory 做唯一稳定身份匹配；无法精确匹配时，Jev 只在该有界 inventory 中选择，不能发明应用。
- `target.launch.timeoutMs` 显式授权冷启动，并作为等待真实进程和顶层窗口出现的最大期限；它不是固定 sleep。未提供 `launch` 时只能连接已经运行且暴露窗口的应用。
- `target.activation` 必须显式选择 `background` 或 `foreground`。Cua 的 `launch_app` 保持后台启动；只有 `foreground` 才在拿到精确 `pid + windowId` 后调用并验证 `bring_to_front`。
- 多窗口时先使用明确的 `windowTitle` 或唯一可用窗口；仍有歧义时 Jev 只在该应用的顶层窗口候选中选择，不取数组第一个。
- 纯启动任务使用空 `steps` 和 `completion.appReady=true`。只有成功取得精确窗口并完成首个 `getWindowState` 快照，`appReady` 才成立；不会为了满足协议编造一次点击。
- `steps` 是 Pi 生成的有序类型化计划。`fill` 写入一个 prepared slot；`activate` 选择与已填 slot 结构相关的控件；`select` 使用本地 collection 的一基索引和 reading order；`choose` 仅用于一个明确的点击或滚动目的。`activate` / `choose` 必须声明动作后的 `expect`，非末尾 `select` 也必须声明；只有独立的 `skipIf` 可以在动作前跳过 phase。
- `expect` 可以使用当前状态条件，也可以声明 `collectionChanged`、`titleChanged` 或 `urlChanged` 转换条件。纯状态 expectation 若在动作前已经成立，不能证明新动作，运行时会拒绝；提交并刷新结果集合时应把已填 slot 与 `collectionChanged=true` 组合为因果证据。
- `scope.allow` 只授权 `click`、`type_text`、`scroll` 动作种类。实际候选在观察后由 AX capability 和原生 OCR 矩形构造，不要求 Pi 预猜 UI 标签。
- `textSlots` 由 Pi 预先生成并描述用途。运行时将每个本地 slot 与观察到的可编辑控件组成候选，文本值不进入 Jev 请求或 Trace。`fill` 自身负责聚焦、全选和输入；点位输入后同时使用 AXValue 与字段 bounds 内的 OCR 精确匹配证明写入成功。批量输入中“点击获得焦点”的聚合 `worked` 不能证明文本写入，未通过双通道验证时会降为 `unknown`。
- 滚动数值由调用方完整提供在 `scope.scrollDeltas`；执行器没有内置方向或距离。
- `completion` 描述可观察结果，可校验文本、URL、标题和控件状态。每个 `fill` slot 都必须进入 `requiredSlots`，证明 prepared input 曾被 AX 或字段区域 OCR 观察、或由执行层确认；`mediaPlayback` 通过同一 `current / duration` 时间轨的推进验证播放，不猜播放/暂停按钮文案。
- `budget.maxActions`、`budget.maxDecisions` 和 `budget.maxDurationMs` 由调用方显式提供，分别限制真实 mutation、模型判断和总时长。
- `WAIT` 只在当前 phase 没有可执行候选时开放，用于重新观察；`BLOCKED` 是 `abstain`。
- TypeSafe Choice 的 255 个选项上限只约束当前 phase 实际发送的窄候选，不再因为全屏候选总量而整批退出。
- AX 候选只来自当前 on-screen 控件；视觉图片候选会覆盖描述相同的粗粒度容器/链接动作。collection 只来自同一结构祖先下、分布在不同兄弟分支且忽略文案后稳定能力形状一致的 action owner；能力形状包含 owner 角色、图片/编辑/嵌套动作能力和观测尺寸，不包含业务词或固定坐标。同一 owner 的缩略图、角标和头像不会重复计数。候选描述只进入 Choice criteria 一次，不在 state 中重复。

## 决策协议

每次观察由本地代码生成不可变候选。AX 目标绑定元素 ref；WebView/iframe 点击和视觉目标绑定当前 `stateId` 与截图点位。重复兄弟子树形成 collection，并由矩形行重叠及横向位置建立 reading order。`select` 先为每个满足 index 的 collection 本地取出目标 ordinal，再让 Jev只根据 collection 摘要选择正确集合；Jev不计算 ordinal。当前 phase 再从全量本地候选中投影出窄候选。对 Jev 暴露的 ID 是不透明标识，不包含 ref、截图 ID 或坐标：

```text
candidate:
  candidate-1             -> TYPE_TEXT field near "Search" with local slot query
  candidate-2             -> CLICK collection item 5 of 16 in reading order
  reobserve               -> discard this set and obtain a fresh observation
  abstain                 -> stop without mutating the UI
```

响应必须满足：

- 返回类型为 Choice；
- 选项集合与请求完全一致；
- 每个概率有限且位于 `[0, 1]`；
- 概率和接近 1；
- choice 是最大概率选项；
- confidence 与完整概率分布被校验和记录，但没有未经任务评测校准的全局执行阈值；
- 返回模型标识属于 Jev。

Jev 不接收或生成 selector、元素 ref、截图 ID、坐标、URL、命令或输入文本。

## 执行不变量

1. 所有元素引用和视觉坐标属于不可变 `stateId`；旧截图候选在执行前被拒绝。
2. 生命周期层只从 Cua inventory 解析身份。启动参数严格遵守 `launch_app` schema；启动后重新枚举并等待真实 pid/windowId，不能把模型生成的名称当成系统身份。
3. Cua Driver 在动作前检查 snapshot-bound element token、精确 pid/windowId、delivery route 和 actionability。
4. 每次 mutation 后都使用 successor state，不从旧观察继续。任意 fingerprint 变化或笼统的执行 `worked` 都不能替代业务证明；fill 只由 slot 证明推进，其他中间 phase 只由显式 `expect` 推进，终端 phase 只由最终 verifier 完成。
5. `unknown` 且状态未变化的 mutation 立即进入 `needs_review`；任何已经尝试过的逻辑候选都会从后续集合移除，即使动态画面让截图持续变化也不重放。
6. 重复目标 fail closed；文本槽值和完整字段值不进入 Jev 动作空间。字段区域 OCR 只在本地与 prepared value 做精确归一化比较。
7. 动作授权来自调用方构造的完整候选和宿主策略，不从任何语言的控件标签关键词推断。
8. Jev 不拥有 plan、ordinal 或 `DONE`；Pi 拥有 plan，本地层拥有 ordinal 与 phase ledger，只有 verifier 能返回 `done`。
9. UI 文本始终视为不可信数据，不能扩大任务范围或权限。
10. 当完成条件同时要求 prepared slots 和媒体播放时，slot 首次满足时已存在的媒体轨被记录为因果基线；所有 fill slot 被协议强制纳入该条件，只有之后出现的新轨道能证明本次任务完成。
11. 控件角色在 verifier 中规范化；`AXButton`、`button` 等平台拼写映射到同一语义角色。

每次运行返回结构化 Trace 和 metrics：总时长、目标解析/观察/动作决策/执行耗时、目标解析决策数、真实 mutation 数、动作决策数、等待数、Jev 输入/输出 tokens。目标解析与界面动作选择分开记录，纯启动任务不会再被错误显示为“没有调用 Jev”。

## 数据边界

发送给 TypeSafe：目标解析时发送自然语言应用/窗口意图、Cua inventory 中的应用显示名或窗口标题及最小运行状态；动作选择时发送当前 phase 的目的、整体目标摘要、可见状态摘要、opaque 候选 ID、来源种类、角色、标签、本地证明的 collection ordinal、布尔状态、文本槽 ID、最近动作结果。

只留在本地：应用 bundle ID、launch path、pid/windowId、截图、坐标、bounds、结构父节点、完整 Accessibility 树、元素 ref/句柄、`stateId`、文本槽值、完整字段值、完成验证上下文和用户凭据。

## 平台执行

底层固定使用 `@trycua/cua-driver` 0.28.2。`getWindowState` 同时返回 AX/UIA/AT-SPI 元素与窗口截图；AX 动作优先使用 snapshot-bound element token，WebView 文本输入使用 Cua 的 pixel-focus keyboard route。所有动作使用 exact pid + bigint windowId，默认 background delivery，拒绝不会自动升级为 foreground。截图不发送给 Jev。`cua-perception` 与 `jev-use` 仍处于 Draft preview，因此当前正式路径不伪造视觉区域；发布版 Driver广告并提供受验证扩展后才通过 capability 启用。

当前零安装视觉路径识别可见文字以及 AX 已标注控件，不声称理解完全无文字、无 Accessibility 标签的图标。该边界必须由以后独立的结构化 region provider 扩展，不能通过应用关键词或猜测坐标补齐。

架构依据包括 TypeSafe System One 官方设计、Cua Driver `jev-use` 的本地完整候选、`reobserve` / `abstain`、单观察单动作、snapshot-bound token 与独立 postcondition verifier。
