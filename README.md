# Agnes AI Studio

基于 [Agnes AI](https://agnes-ai.com) API 的本地可视化调用工具，支持文本生成、图像生成、视频生成，所有输出自动保存到本地。

## 直接下载使用（推荐）

无需安装 Node.js，下载对应平台的可执行文件即可运行。

👉 **[前往 Releases 下载最新版本](https://github.com/chenpipi0807/Agnes-API/releases/latest)**

| 平台 | 文件名 |
|------|--------|
| Windows | `Agnes-AI-Studio-win-x64.exe` |
| Mac（Intel） | `Agnes-AI-Studio-macos-x64` |
| Mac（Apple Silicon M1/M2/M3） | `Agnes-AI-Studio-Mac-AppleSilicon` |
| Linux | `Agnes-AI-Studio-linux-x64` |

### 使用步骤

1. 下载对应平台的文件，放到一个单独的文件夹
2. 在**同一文件夹**下新建 `.env` 文件，内容如下：
   ```
   AGNES_API_KEY=你的Key
   AGNES_SITE=cn          # 可选：cn=国内站，intl=国际站（不填默认 intl）
   ```
3. 双击运行（Mac / Linux 需先在终端执行 `chmod +x 文件名`）
4. 浏览器访问 [http://localhost:6430](http://localhost:6430)
5. 也可以不配置 `.env`，启动后在页面头部直接填入 API Key 并点保存

> 获取 Key：[https://platform.agnes-ai.com/settings/apiKeys](https://platform.agnes-ai.com/settings/apiKeys)

---

## 功能

- **💬 文本生成** — 对话补全，支持系统提示、温度调节、流式输出，结果保存为 `.txt` / `.md` / `.json`
- **🖼 图像生成** — 文生图 / 图生图 / 多图合成，常用尺寸预设，结果保存为 `.png`
- **🎬 视频生成** — 文生视频 / 图生视频 / 多图视频 / 关键帧动画，多任务并发自动轮询，结果保存为 `.mp4`
- **📁 历史记录** — 侧边栏展示所有已保存文件，含缩略图、提示词预览，一键复用参数
- **🌐 局域网共享** — 启动后自动打印局域网地址，局域网内其他设备可直接访问

---

## 国内站 / 国际站

Agnes AI 有国内站与国际站两套平台，**账号体系独立：Key 不通用，模型 ID 也不完全一致**。

| 站点 | Base URL | 控制台 |
|------|----------|--------|
| 国际站（默认） | `https://apihub.agnes-ai.com/v1` | [platform.agnes-ai.com](https://platform.agnes-ai.com) |
| 国内站 | `https://api.agnes-ai.cn/v1` | [platform.agnes-ai.cn](https://platform.agnes-ai.cn) |

页面顶部的「站点」下拉框可以随时切换：

- 每个站点的 Key **分别保存**（`.env` 中的 `AGNES_API_KEY_CN` / `AGNES_API_KEY_INTL`），切换站点不会互相覆盖
- 切换站点后，模型下拉框会自动拉取该站点 `/v1/models` 的真实可用模型；拉取失败时回退到内置列表
- 「获取 Key ↗」按钮也会跟着切到对应平台的密钥页面
- 旧版本 `.env` 里只有 `AGNES_API_KEY` 时，启动会自动探测这把 Key 属于哪个站点并写回 `.env`，无需手动迁移

用 A 站的 Key 去调 B 站接口会返回 `401 Invalid token`，这是预期行为。

---

## 从源码运行（开发者）

需要 Node.js 18+。

```bash
git clone https://github.com/chenpipi0807/Agnes-API.git
cd Agnes-API
npm install
npm start
```

浏览器访问 [http://localhost:6430](http://localhost:6430)

### 开发模式（热重载）

```bash
npm run dev
```

---

## 目录结构

```
Agnes-API/
├── server.ts          # Express 后端（API 代理 + 文件保存）
├── src/app.ts         # 前端 TypeScript
├── public/index.html  # UI 页面
├── output/            # 运行时自动生成，所有输出文件
│   ├── text/
│   ├── images/
│   ├── videos/
│   └── uploads/
└── .env               # API Key（不提交到 git）
```

## 技术栈

- **后端**：Node.js + Express + TypeScript
- **前端**：原生 TypeScript + esbuild，无框架依赖
- **打包**：@yao-pkg/pkg（跨平台独立可执行文件）
- **API**：Agnes AI（OpenAI 兼容格式）

## 支持的模型

| 类型 | 国际站 | 国内站 |
|------|--------|--------|
| 文本 | `agnes-2.5-flash`、`agnes-2.0-flash` | `agnes-2.5-flash`、`agnes-3.0-flash`、`agnes-2.5-pro` |
| 图像 | `agnes-image-2.1-flash`（推荐）、`agnes-image-2.0-flash` | `agnes-image-2.1-flash`（推荐）、`agnes-image-2.5-flash` |
| 视频 | `agnes-video-v2.0` | `agnes-video-2.5-flash`、`agnes-video-2.5` |

> 模型列表在运行时从对应站点的 `/v1/models` 拉取，上表仅为拉取失败时的兜底值。
