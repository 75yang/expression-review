# Expression Review · 表达复盘

**让表达训练从“凭感觉改进”，变成“有原句、有对照、有下一步”。**

A local-first Chinese speaking practice workbench with transcript playback, filler discovery, and source-grounded review.

这是一个从个人使用场景出发的开源作品：录制或导入 → 本地转写 → 逐句回听 → 口癖核对 → 复盘 → 再次练习。

> 本仓库仅包含源码与重新编写的合成示例。没有真实录音、视频、转写稿、复盘记录、个人词库、数据库、密钥或原项目 Git 历史。

## 先体验，再配置

要求 **Node.js 22.19 或更新的 Node 22 版本**、npm。首次安装需要联网。

```sh
npm ci
npm run dev
```

打开 `http://127.0.0.1:3000`：

- `/`：作品介绍。
- `/demo`：可编辑的合成文本演示，口癖候选与计数完全在浏览器计算，不需要 API Key，不保存输入。
- `/app`：完整本地工作台。首次启动是空素材库。

素材库默认保存在操作系统的应用数据目录，不会写进源码仓库：Windows 为 `%LOCALAPPDATA%/ExpressionReview/library`，macOS 为 `~/Library/Application Support/ExpressionReview/library`，Linux 为 `$XDG_DATA_HOME/expression-review/library`。可用 `MATERIAL_LIBRARY_DIR` 指定其他位置。

## 解决什么问题

| 问题 | 实现 | 边界 |
| --- | --- | --- |
| 手动列口癖容易遗漏 | 常见词、重复词组、相邻重复自动发现 | 高频主题词也可能进入候选，需要核对 |
| “然后”有时是正常用词 | 原句定位、逐处标记、回听、确认入库 | 不把全文匹配次数直接当作口癖次数 |
| 每次复盘互不关联 | 父录制优先、历史关键词检索、来源引用 | 当前为词法 RAG，非向量检索；片段不能代表整体进步 |
| 训练反馈难以执行 | 观点层和表述层草稿、下一轮训练动作 | AI 草稿需核实，用户决定是否保存 |

还包括素材导入与录制、标签、多级重录关系、逐句时间定位、音波显示、Markdown 复盘和手机局域网配对。

## 可选：本地语音转写

仅体验网页和文本演示无需 Python。需要转写真实音视频时，安装 Python 3.10+、FFmpeg（包括 `ffprobe`），再运行：

```sh
python -m pip install -r requirements-asr.txt
```

将 `.env.example` 复制为 `.env.local`，按机器能力设置 `ASR_MODEL`、`ASR_DEVICE` 和 `ASR_COMPUTE_TYPE`。默认 CPU / small；模型首次运行时可能下载。转写准确率依赖音质、模型与设备，填充音可能被识别器省略。FFmpeg 的可执行文件由 npm 依赖提供，`ffprobe` 需要系统安装或单独配置。

## 可选：AI 判断与历史复盘

在 `.env.local` 配置自己的模型账号。支持现有 Qwen / OpenAI 适配。API 调用可能产生费用；没有有效额度时本地发现、核对与保存仍可使用。

AI 辅助判断最多处理 60 处未核对上下文，不自动覆盖人工判断。勾选“参考历史表达”后，会额外发送最多 4 条历史片段给所配置的模型服务。音视频不随复盘请求上传。历史原话是证据，未经确认的模型评价不作为事实检索。

## 技术与设计

- Next.js / React / TypeScript：介绍页、交互演示、训练工作台和 API。
- SQLite + 本地文件：结构化记录与音视频、转写文件分开管理。
- `Intl.Segmenter`：中文词组候选和词法检索，无需外部向量库。
- SHA-256 逐字稿版本：避免重新转写后沿用错位标记。
- Zod + Agent SDK：结构化 AI 输出校验。
- Python / faster-whisper / PyAV：本地转写与波形处理。

详见 [架构与数据流](docs/ARCHITECTURE.md)、[发布边界](SECURITY.md)、[作品展示脚本](docs/DEMO.md)。

## 检查和构建

```sh
npm run test:analysis
npm run lint
npm run build
npm start
```

发布前执行 `npm run audit:public`，检查 Git 索引和已提交历史里的文件路径与文本。CI 同样执行检查。自动检查只能识别已定义的风险模式，仍应人工查看提交文件。

## GitHub 与部署

这是可公开的**源码作品**，不是已经加固的多用户云服务。完整工作台默认仅绑定本机，不应直接在公网托管，也不能直接部署到 GitHub Pages：它需要 Node 服务、SQLite、持久化文件与本地处理工具。

只发布这个独立目录，不要从个人工作目录或原有 Git 历史推送。`.gitignore` 防止常见运行文件进入索引；不要强制添加真实素材。

后续方向：向量检索、跨次训练趋势、已确认改写库、完整端到端测试、多用户身份与资源隔离。

## License

[MIT](LICENSE)。第三方依赖与下载模型遵循各自许可证。
