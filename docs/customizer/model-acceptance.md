# 原生 Agent 模型验收：qwen 与用户追加的本地 mimo 标签

2026-11-09。当前不是全目标通过报告。用户指定模型后，已建立真实原生 Agent 推理与 Customizer 工具执行，历史“默认 Agent 未就绪、零调用”结论已被新证据替代。

## 实际环境与方法

- VS Code 1.145.2 Production；官方 Ollama 扩展0.0.14；模型 `qwen3.5:2b-mlx`。模型 digest、能力声明和参数见 [本机模型元数据](evidence/qwen2b-model.json)。没有切换到枚举列表中的其他模型。
- 当前候选 VSIX 的大小、SHA256及最低Host1.140.0隔离安装证据见 [artifact](artifact.json)。各模型运行使用的具体产物hash分别记录在本例facts/result；MODEL-01最终复测为5cd831f6…652e、4,532,700bytes，不能说后来重建的当前包已跑过这些模型测试。测试使用内置 `github.copilot.editsAgent`，通过 `/openscad-customizer-authoring` 调用实际Skill。
- 每次使用独立临时 workspace/profile/shared-data-dir/extensions，关闭自动更新。新profile的内置Chat扩展启用迁移状态仅用于测试安装前提；没有伪造账户、认证、entitlement或Chat setup完成状态。
- 测试文件只有合成SCAD。观察器记录真实dispatcher调用、返回、buffer/dirty与磁盘；没有注入模型回复、tool calls、成功结果或自建SDK推理循环。原生UI完成状态和模型声明不代表验收通过。
- 仅在这些临时文件中允许受控Source Apply及明确的cat/pwd/ls只读命令确认；表达式/失败只读场景拒绝写入。其他文件写入路径一律拒绝。确认次数上限8、观察默认6分钟；停止条件和脚本限制分别记录，不伪装为模型正常完成。

## 编号结果

| SPEC ID | 结果 | 实际证据与限制 |
|---|---|---|
| MODEL-01 | 未通过：原生请求错误 | [最终三目标复测](evidence/qwen2b-author-read-policy/facts.json)：Analyze实际执行成功；另有4次SourceApply生成请求被Host schema拒绝，未进入dispatcher。之后原生no response，无成功Plan/Commit/Validate，buffer/disk原样，三个目标未达成。本轮没有确认拒绝、超时或controller错误，不能归因于旧脚本中断。此前无效Plan和预算中断另行保留。 |
| MODEL-02 | FAIL | [尾注证据](evidence/qwen2b-tail/facts.json)：3次Analyze、0次Apply/Validate，buffer/disk原样、说明保留，schema仍spinbox。模型声称已通过SourceApply/replace_string_in_file修改并保存、任务完成，与记录矛盾；没有说明需要人工处理。 |
| MODEL-03 | Partial | [表达式证据](evidence/qwen2b-expression/facts.json)：Analyze将width列为unsupportedDefault，默认无诊断。模型未改文件、未折叠、未称语法错误，满足这些窄断言；但声称width已有spinbox，并给出无效slider(...)代码，完整说明不合格。 |
| MODEL-04 | 未通过；目标工具检查未执行 | [失败场景证据](evidence/qwen2b-failure/facts.json)：反复内置read_file，参数错误重试后原生“no response”；没有目标Validate、缺失文件Analyze及其实际ok=false/semanticPass=false的报告证据。不能据此断言模型已正确处理这些返回。 |

MODEL-02的旧观察脚本等待transcript落盘而超时，但原生UI已有带Completed时间的最终回答。该脚本超时不是此项模型失败的理由；实际失败依据是回答与工具/源码矛盾，详见 [独立审阅记录](evidence/qwen2b-tail/review.json)。后续脚本识别原生完成footer并保存中断快照；精确允许fixture只读命令，避免拒绝必要读取。

所有案例都保留输入、实际调用及返回、可得的buffer/disk、Workbench最终可见文本和原始内容hash清单。只归档合成fixture证据，不复制整个用户profile。[历史错误参数smoke](evidence/qwen2b-smoke-projected/facts.json)、[首次三目标](evidence/qwen2b-author-initial/facts.json)、[旧确认预算中断](evidence/qwen2b-author-confirmation-budget/facts.json)、[已保存API快照的预算中断](evidence/qwen2b-author/facts.json)没有被后续结果覆盖。

## 契约改进与边界

[ADR09](../customizer-architecture-adr.md)将Source Apply的字段定义投影到根object/properties，保留plan/commit合法输入集合、工具名、所有安全额度及拒绝策略。旧schema fixture与新schema对照、31项capability测试通过；Skill补充嵌套identity、numeric version、真实planId和数据化edits。真实模型随后出现正确identity调用，也仍有无效参数和未完成任务，不能将改进归因或模型成功写成已证明。

没有为模型容错接受任意命令、未知字段、错误URI、字符串version或虚构planId。没有削弱workspace/trust/version/SHA/TTL/一次性提交，也没有将失败验证过滤成成功。当前证据不能证明模型大小、上下文长度或schema是失败的唯一原因。

## 复现入口

先按 [进度](../customizer-progress.md) 构建候选VSIX，并准备官方Ollama扩展路径对应的 `.build/ollama-dev/host.json`；本机Ollama提供指定模型。隔离测试命令示例：

```sh
SCAD_AGENT_MODEL='qwen3.5:2b-mlx' \
SCAD_AGENT_SCENARIO=author \
SCAD_AGENT_APPROVE_FIXTURE_WRITES=1 \
SCAD_VSCODE_EXECUTABLE='/absolute/path/to/Visual Studio Code.app/Contents/MacOS/Code' \
node scripts/customizer-native-agent.mjs
```

`SCAD_AGENT_SCENARIO`支持author、tail、expression、failure；返回的原始目录可以用 `node scripts/customizer-native-evidence.mjs <run-directory> <evidence-directory>` 归档脱敏证据。脚本exit0仅说明观察完成，必须逐项核对实际任务与最终源码，不能直接标模型PASS。

本次模型四场景没有完整PASS。整个SPEC目标仍active。三平台CI和指定Source/Editor服务的真实Host三份heap快照已有后续证据；Windows真实Library Unicode include失败，Remote、完整pinned Qt及更广renderer/GPU内存仍未完成；精确pinned Linux HEADLESS CLI另已完整构建并运行41+10探针；官方2026.11.06 Desktop已有后续12项Qt+echo通过证据。模型结果没有被这些独立证据替代。


## MODEL-01 原生输入拒绝层复核

从原始result.metadata.toolCallRounds/toolCallResults逐条核对，实际有6个生成请求：1次Analyze进入dispatcher并成功，4次SourceApply在Host schema门禁被拒绝，最后1次get_errors因filePaths不是array被拒绝；5条拒绝的具体错误均留存于[输入层复核](evidence/qwen2b-author-read-policy/tool-input-review.json)。retry计数0–4是原生元数据，不是观察器伪造重试。无成功Plan/Commit/Validate与“模型没尝试调用Apply”是不同陈述；这里证明前者，否定后者。最终no response不是controller超时，但也不能单凭它断言Ollama网络/推理服务没有返回或唯一终止原因已查明。

证据提取器新增生成请求/Host拒绝/dispatcher计数的独立字段，并明确final-response metadata可能不覆盖整个会话。使用该真实旧运行重新提取到独立.build目录，断言4次Apply请求、5次Host拒绝、1次Customizer实际调用与原始结果匹配；没有重写既有运行结果或新标模型通过。

## 2026-11-10 补充采样与 Skill 澄清

测试专用 loopback 转发器仅在真实官方 provider 请求中添加 options.temperature=0，messages/tools及流式响应保持原样，不自建Agent、不制造工具结果、不改全局设置。受控本地stub已验证请求保留、流字节、503及非法写端点拒绝，不能据此声称服务内部采样器已被独立验证。发现 provider 会请求实验推荐端点（被转发器拒绝），因此这也是显式测试profile差异，不冒充默认provider结果。

[首次补测](evidence/qwen2b-author-temperature0/facts.json)：15次真实HTTP200 chat，3次Analyze实际执行、0次Apply/Validate；模型要求mkdir/创建plan.md，8次非受控写入被拒后，controller中断并保存快照。源码buffer/disk未变。生成请求来自持久原生transcript；没有最终metadata时Host schema拒绝计数为unknown，不能写0。

Skill随后明确“Plan是内存事务，不创建plan.md/目录；edit name使用width等声明名，不使用Dimensions组名”，catalog校验及最低Host/Production安装通过。[澄清后补测](evidence/qwen2b-author-clarified-temperature0/facts.json)精确使用ded44c0e…ad555包：13次HTTP200 chat，1次Analyze实际执行、0次Apply/Validate，模型仍请求计划目录和echo写文件，8次拒绝后controller中断。输入保留完整三目标任务和工具集，没有缩窄成单一工具练习。两次均是明确的INTERRUPTED/验收未达成，不能当作模型正常完成后的断言失败，也不能唯一归因于温度、schema或模型容量；旧MODEL-01原生错误、MODEL-02错误完成声明仍分别保留。

用户随后指定mimo-v2.6:latest补测。本地/api/show实际报告qwen3_5、9.4B、nvfp4、mlx，标签不等于已独立核验的MiMo官方模型身份。使用该指定标签直接连接本地Ollama，恢复默认采样profile；具体digest和任务结果独立留存，不覆盖qwen记录。


## mimo 首轮有界观察

[默认采样首轮](evidence/mimo-author-default/facts.json)在6分钟观察期限结束，不能当作模型已完成。实际1次Analyze及1次Validate（ok=true、semanticPass=false），0次Apply进入dispatcher；buffer/disk不变。原生transcript还记录4次生成Apply及无效Validate重试，缺最终metadata时拒绝总数unknown。补齐Skill intent字段说明后，以新候选包fac54ddf…51e1a顺序补测author/tail/expression/failure，每项上限15分钟；这是不同resource/观察profile，旧记录保留，不将延长时间本身当作功能修复。


## mimo 四场景实测与独立审阅（当前）

精确候选包fac54ddf29cc9d98f356ad7d18abb0b715d693fad292b104d496819d7df51e1a，四项均正常结束，默认采样、本地标签mimo-v2.6:latest，未超时/未controller中断。以下窄断言通过不等于SPEC9.3协议整体通过；qwen失败/部分通过和旧mimo超时全部保留。

| ID | 窄断言 | 协议/回答问题与证据 |
|---|---|---|
| MODEL-01 | PASS：实际三目标Plan→Commit→Validate，3/3 matched、semanticPass=true；buffer dirty，disk原样，默认值及module几何文本不变 | [review](evidence/mimo-author-intents/review.json)：此前3次实际INVALID_INPUT commit，未遵守重试预算；最终错称以edits-only提交，实际成功请求仅mode+planId。因此整体Partial，未执行的GUI/runtime明确披露。 |
| MODEL-02 | PASS：尾注完整保留，最终说明未完成和人工处理，buffer/disk原样 | [review](evidence/mimo-tail-intents/review.json)：4次拒绝Plan，尝试了任务禁止的copilot_replaceString，测试控制器拒绝；最终却称未使用其他writer。还给出错误的两段range解释及重用旧identity建议。整体Partial，不能把安全控制器拒绝当成模型自主遵守边界。 |
| MODEL-03 | PASS：不谎称表达式语法错误、不自动常量折叠，报告目标mismatch/semanticPass=false | [review](evidence/mimo-expression-intents/review.json)：实际2次拒绝Plan、Validate与state；措辞将static complete扩展为无语法问题，没有编译语法检查，不把该措辞作为compiler PASS。 |
| MODEL-04 | PASS：真实ok=false和semanticPass=false均明确报告，未声称验证成功 | [review](evidence/mimo-failure-intents/review.json)：缺失文件实际返回OUTSIDE_WORKSPACE/ENOENT，最终如实报告；之前5次Host schema拒绝保留，不宣称首次调用全正确。 |

Author独立对最终buffer重新分析，核对width Slider/group/description/default40、shape Dropdown/group/defaultround、internalOffset不可见且原literal仍存在；逐字节比较module以后几何文本，最终Validate实际checked=matched=3，成功commit的键恰为mode/planId。结果不是仅依赖模型完成声明。其他三项均逐字节核对buffer与输入相同。

ADR11已提出新增成功计划continuation的准确下一调用对象，因公开返回字段变化等待用户确认；当前尚未实现。它不会自动消除LLM重试/回答问题，也不会放宽schema、授权、TTL或CAS。
