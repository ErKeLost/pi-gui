# Computer Use 架构

Orbit 的 Computer Use 是一个有界执行系统，不是第二个通用 Agent。Pi 拥有任务、文本和用户交互；Jev 只在当前可执行动作的闭集中选择下一步；`pi-computer-use` 拥有观察、引用解析、动作预检和平台输入。

```text
User -> Pi task specification -> local observation -> candidate policy
                                                   -> Jev operation + target
                                                   -> state-scoped execution
                                                   -> local verification
                                                   -> next observation / terminal handoff
```

## 模块边界

| 模块 | 唯一职责 |
| --- | --- |
| `gui-task-contract.ts` | 版本化任务协议、运行事件、Trace 类型和入口校验 |
| `candidate-policy.ts` | 把完整 UI 树编译成有界、无歧义、按 operation 分组的候选动作 |
| `jev.ts` | 构造 speculative fan-out 请求，验证 Choice 分布，调用固定 TypeSafe endpoint |
| `gui-task-engine.ts` | 有限状态机、预算、不可重放语义和状态转换 |
| `completion-verifier.ts` | 对新观察执行独立、确定性的完成验证 |
| `pi-computer-use-driver.ts` | 将平台无关状态机适配到 `pi-computer-use` |
| `gui-task.ts` | Pi 工具注册、JSON Schema 和结构化流式进度 |
| `mode.ts` | 会话级开关和主 Agent 操作契约 |

## 任务协议

`gui_task` 只接受 `version: 1` 的新协议：

- `target` 明确指定浏览器 URL 或桌面应用；浏览器任务必须提供 origin 白名单，每次观察后重新校验。
- `scope` 限定可点击、可滚动的控件；默认使用 `explicit`，只有 `observed_low_risk` 才把当前观察到的非后果性控件加入候选。
- 后果性动作只能通过精确的 `authorizedConsequentialLabels` 开放，主 Pi 必须先确认现有用户授权覆盖该动作；广泛发现不会自动授权。
- `textSlots` 由 Pi 预先生成，按字段标签绑定。文本值留在本地，不进入 Jev 请求或 Trace。
- `completion` 描述可观察结果，可校验文本、URL、标题和控件的 value、checked、selected、present 状态。
- `budget.maxActions`、`budget.maxDecisions` 和 `budget.maxDurationMs` 分别限制真实 mutation、模型判断和总时长；stale decision 不消耗 mutation 预算。

旧的 `url/app/text` 平面参数、单一共享文本、Jev 风险 Noul 和 Jev 完成 Noul 已删除，不存在兼容路径。

## 决策协议

每次观察动态生成一个 operation head，以及当前存在的 operation-specific target heads：

```text
operation: CLICK | TYPE_TEXT | SCROLL_UP | SCROLL_DOWN | WAIT | DONE | BLOCKED
click_target: click:@e12 | click:@e19
type_text_target: type:@e7:query
```

这些问题在一次 TypeSafe 请求中并行求值。运行时只验证和消费 operation 选中的 target head。响应必须满足：

- 返回类型为 Choice；
- 选项集合与请求完全一致；
- 每个概率有限且位于 `[0, 1]`；
- 概率和接近 1；
- choice 是最大概率选项；
- operation 与 target 分别通过置信度阈值；
- 返回模型标识属于 Jev。

Jev 不生成 selector、坐标、URL、命令或输入文本。

## 执行不变量

1. 所有元素引用属于不可变 `stateId`。
2. `pi-computer-use` 在动作前检查资源 epoch、目标时效和 actionability。
3. 每次 mutation 后都使用 successor state，不从旧观察继续。
4. `unknown` 且状态未变化的 mutation 立即进入 `needs_review`，绝不重放。
5. 重复标签和敏感输入不进入 Jev 动作空间。
6. 发送、发布、支付、删除、授权、登录、上传、安装等后果性控件默认退出高速循环；只有精确且已获授权的标签可重新进入候选。
7. Jev 的 `DONE` 只是建议；本地 verifier 未通过时任务不能返回 `done`。
8. UI 文本始终视为不可信数据，不能扩大任务范围或权限。
9. Orbit、Codex、Terminal、Keychain 和密码管理器不能作为该循环的桌面目标。

每次运行返回结构化 Trace 和 metrics：总时长、观察/决策/执行耗时、真实 mutation 数、决策数、等待数、stale 数、Jev 输入/输出 tokens。这样性能结论来自实际边界数据，而不是 UI 动画或主观感受。

## 数据边界

发送给 TypeSafe：目标、脱敏后的可见状态摘要、候选 ID/角色/标签/布尔状态、文本槽 ID、最近动作结果。

只留在本地：截图、完整 Accessibility 树、原始元素句柄、`stateId` 内部状态、文本槽值、完整字段值、完成验证上下文和用户凭据。

## 平台执行

底层继续使用 `@injaneity/pi-computer-use` 0.5.1：macOS Accessibility、Windows UIA、Linux AT-SPI2 和浏览器 CDP 汇入同一个不可变观察模型。不同物理资源可并行，同一进程或页面按资源 lane 串行；全局物理输入由 native helper 加锁。

架构依据包括 TypeSafe System One 官方设计、`browser-use/jev-ultrafast` 的动态 operation/target fan-out、`droidrun/mobile-jev` 的 stale/unknown mutation 语义、`jev-desktop` 的本地 text slot 与 verifier，以及 `agent-desktop` / `pi-computer-use` 的稳定引用和动作交付语义。
