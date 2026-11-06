# 使用 Ollama 进行扩展开发测试

## F5 启动

1. 在主 VS Code 窗口安装官方扩展 `Ollama.ollama`。
2. 启动 Ollama，准备至少一个支持工具调用的模型。默认 endpoint 为 `http://127.0.0.1:11434`，也可配置 `ollama.endpoint`。
3. 停止旧调试会话，在 Run and Debug 选择 **Run Extension + Ollama**，按 F5。
4. 在开发宿主的 Chat → Models → **Add Models...** 初始化模型提供方，再回到 Chat 选择模型与普通 Agent 模式。打开测试项目和 SCAD 文件，先发送只读请求，例如“查询当前 OpenSCAD Runtime 和 Customizer 参数”。

启动前的 `ollama: prepare` 从本机已安装目录复制官方扩展到 `.build/ollama-dev/extensions/ollama.ollama`，再执行 watch 构建。配置保留 `--disable-extensions`，将本项目和暂存 Ollama 分别作为显式 `--extensionDevelopmentPath` 加载。其他已安装扩展禁用，内置扩展保留。Ollama 在该宿主属于第二个开发扩展；准备脚本不修改官方安装、不自动安装其他扩展，也不复制账户或 headers。

原 **Run Extension** 继续禁用其他已安装扩展。F5 的 `extensionHost` 调试可能复用主 VS Code 进程和配置，因此暂存目录是稳定的开发扩展路径，并不是独立用户 profile；不能靠给 F5 添加 `--user-data-dir` / `--extensions-dir` 来声称完成隔离。

2026-11-06 实测使用 VS Code 1.145.1、官方 Ollama 扩展 0.0.14、Ollama 0.40.15，在标为 **Local** 的普通 Agent 会话中无需登录 Copilot。初始 Copilot 登录提示在 Add Models 枚举 Ollama 后不再阻止输入。不同版本或 harness 的 BYOK 支持应在对应窗口验证，不能只凭 LM API 发现模型就判断 Chat 可用。More 中的 GitHub 连接与模型配置无关。

## 宿主 smoke

```sh
npm run prepare:ollama-dev

SCAD_VSCODE_EXECUTABLE='/Applications/Visual Studio Code.app/Contents/MacOS/Code' \
  npm run test:ollama-dev
```

结果保存在 `.build/ollama-dev/smoke.json` 和 `f5-smoke.json`。测试覆盖独立进程和真实 `vscode.debug.startDebugging` 路径；F5 测试读取 launch.json 的实际参数，安装必须保持禁用的哨兵扩展，并检查全部启用的非内置扩展仅有本项目和 Ollama。

smoke 验证扩展加载和模型发现，不下载模型、不运行模型推理，也不能替代工具调用验收。测试自己的配置目录与日常 F5 的主窗口配置不同。

## 自定义安装路径

默认扫描 `~/.vscode/extensions`，选择已安装的官方扩展版本。可以在启动 VS Code 的环境中指定：

```sh
export SCAD_VSCODE_EXTENSIONS_DIR=/absolute/path/to/extensions
# 或直接指定已解包的官方扩展
export SCAD_OLLAMA_EXTENSION_PATH=/absolute/path/to/ollama.ollama-version
```

准备脚本每次重建暂存副本，不要在其中存放手工文件。如果官方扩展增加新的扩展依赖，准备脚本会拒绝，需先审查依赖再调整白名单。

## 模型任务验收

以实际工具 Input/Output、Dispatcher 终态与后置状态为准。`mimo-v2.6:latest` 的四模块只读查询和精确库安装已有成功记录；数值类型错误、错误 key 和请求停滞仍存在。`qwen3.5:0.8b-mlx` 出现失败调用后的虚假成功回复。这些结果不构成完整能力对等验收，也不能仅凭模型名称或大小归因。

具体场景、已知问题及未验环境统一维护在 [Agent 验证指南](agent-verification.md)。
