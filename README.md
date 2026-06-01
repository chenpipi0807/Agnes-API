# Agnes AI Studio

基于 [Agnes AI](https://agnes-ai.com) API 的本地可视化调用工具，支持文本生成、图像生成、视频生成，所有输出自动保存到本地。

## 功能

- **💬 文本生成** — 对话补全，支持系统提示、温度调节、流式输出，结果保存为 `.txt` / `.md` / `.json`
- **🖼 图像生成** — 文生图 / 图生图 / 多图合成，常用尺寸预设，结果保存为 `.png`
- **🎬 视频生成** — 文生视频 / 图生视频 / 多图视频 / 关键帧动画，多任务并发自动轮询，结果保存为 `.mp4`
- **📁 历史记录** — 侧边栏展示所有已保存文件，含缩略图、提示词预览，一键复用参数
- **🌐 局域网共享** — 启动后自动打印局域网地址，局域网内其他设备可直接访问

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key

复制 `.env.example` 为 `.env`，填入你的 Agnes AI Key（也可以启动后在页面头部直接填写并保存）：

```
AGNES_API_KEY=你的Key
PORT=6430
```

> 获取 Key：[https://platform.agnes-ai.com/settings/apiKeys](https://platform.agnes-ai.com/settings/apiKeys)

### 3. 启动

```bash
npm start
```

浏览器访问 [http://localhost:6430](http://localhost:6430)

## 开发模式

前端热重载 + 后端同步启动：

```bash
npm run dev
```

## 目录结构

```
agnes/
├── server.ts          # Express 后端（API 代理 + 文件保存）
├── src/
│   └── app.ts         # 前端 TypeScript
├── public/
│   └── index.html     # UI 页面
├── output/            # 自动生成，所有输出文件
│   ├── text/
│   ├── images/
│   ├── videos/
│   └── uploads/       # 本地上传的图片缓存
└── .env               # API Key（不提交到 git）
```

## 技术栈

- **后端**：Node.js + Express + TypeScript（ts-node）
- **前端**：原生 TypeScript + esbuild 打包，无框架依赖
- **API**：Agnes AI（OpenAI 兼容格式）

## 支持的模型

| 类型 | 模型 |
|------|------|
| 文本 | `agnes-2.0-flash` |
| 图像 | `agnes-image-2.1-flash`（推荐）、`agnes-image-2.0-flash` |
| 视频 | `agnes-video-v2.0` |
