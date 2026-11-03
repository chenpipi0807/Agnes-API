import * as path from 'path';
import * as fs from 'fs';

// pkg 打包后 process.pkg 存在；__dirname 指向快照内部，可执行文件实际路径用 process.execPath
const isPkg = !!(process as any).pkg;
const APP_DIR   = isPkg ? path.dirname(process.execPath) : __dirname;
const PUBLIC_DIR = isPkg ? path.join(__dirname, '..', 'public') : path.join(__dirname, 'public');

import dotenv from 'dotenv';
dotenv.config({ path: path.join(APP_DIR, '.env') });

import express from 'express';
import axios from 'axios';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/output', express.static(path.join(APP_DIR, 'output')));

// ── 站点（国内站 / 国际站）──────────────────────────────────────────────
// 两个站点账号体系独立：Key 不通用，模型 ID 也不完全一致。

type SiteId = 'intl' | 'cn';

interface SiteInfo {
  id: SiteId;
  label: string;
  baseUrl: string;
  platform: string;
}

const SITES: Record<SiteId, SiteInfo> = {
  intl: {
    id: 'intl',
    label: '国际站',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    platform: 'https://platform.agnes-ai.com',
  },
  cn: {
    id: 'cn',
    label: '国内站',
    baseUrl: 'https://api.agnes-ai.cn/v1',
    platform: 'https://platform.agnes-ai.cn',
  },
};

const SITE_IDS: SiteId[] = ['cn', 'intl'];

const normalizeSite = (v: string | undefined): SiteId | null =>
  v === 'cn' || v === 'intl' ? v : null;

const OUTPUT_DIR = path.join(APP_DIR, 'output');
const ENV_PATH   = path.join(APP_DIR, '.env');

let currentSite: SiteId = normalizeSite(process.env.AGNES_SITE) ?? 'intl';

const apiKeys: Record<SiteId, string> = {
  cn:   (process.env.AGNES_API_KEY_CN || '').trim(),
  intl: (process.env.AGNES_API_KEY_INTL || '').trim(),
};

// 兼容旧版本：只有 AGNES_API_KEY 时先挂到当前站点，启动后自动识别归属
const legacyKey = (process.env.AGNES_API_KEY || '').trim();
if (legacyKey && !apiKeys[currentSite]) apiKeys[currentSite] = legacyKey;

const baseUrl = () => SITES[currentSite].baseUrl;
const activeKey = () => apiKeys[currentSite];

for (const dir of ['text', 'images', 'videos', 'uploads']) {
  fs.mkdirSync(path.join(OUTPUT_DIR, dir), { recursive: true });
}

// ── Types ───────────────────────────────────────────────────────────────────

interface OutputMeta {
  prompt: string;
  model: string;
  timestamp: string;
  systemPrompt?: string;
  size?: string;
  mode?: string;
  inputImages?: string[];   // remote URLs or /output/uploads/... paths
  seed?: number;
  negativePrompt?: string;
  width?: number;
  height?: number;
  numFrames?: number;
  frameRate?: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const authHeaders = () => ({
  Authorization: `Bearer ${activeKey()}`,
  'Content-Type': 'application/json',
});

function stamp(): string {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15);
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const res = await axios.get<Buffer>(url, { responseType: 'arraybuffer', timeout: 180_000 });
  fs.writeFileSync(dest, res.data);
}

function saveMeta(dir: string, basename: string, meta: OutputMeta): void {
  fs.writeFileSync(
    path.join(OUTPUT_DIR, dir, `${basename}.meta.json`),
    JSON.stringify(meta, null, 2),
    'utf-8'
  );
}

function readMeta(dir: string, basename: string): OutputMeta | null {
  const p = path.join(OUTPUT_DIR, dir, `${basename}.meta.json`);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

// 保存 base64 图片到 uploads 目录，返回本地 URL 路径
function saveBase64Upload(data: string): string | null {
  const m = data.match(/^data:image\/([a-z+]+);base64,(.+)$/);
  if (!m) return null;
  const ext = m[1].replace('jpeg', 'jpg');
  const filename = `${stamp()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  fs.writeFileSync(path.join(OUTPUT_DIR, 'uploads', filename), Buffer.from(m[2], 'base64'));
  return `/output/uploads/${filename}`;
}

// 处理图片数组：base64 → 本地文件，返回 { forApi, forMeta }
function processImages(images: string[]): { forApi: string[]; forMeta: string[] } {
  const forMeta: string[] = [];
  for (const img of images) {
    if (img.startsWith('data:')) {
      forMeta.push(saveBase64Upload(img) ?? '[本地文件]');
    } else {
      forMeta.push(img);
    }
  }
  return { forApi: images, forMeta };
}

// ── Config（站点 / API Key 读写）─────────────────────────────────────────────

function persistEnv(updates: Record<string, string>): void {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  for (const [k, v] of Object.entries(updates)) {
    const line = `${k}=${v}`;
    const re = new RegExp(`^${k}=.*$`, 'm');
    content = re.test(content)
      ? content.replace(re, line)
      : content.trimEnd() + `\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
}

function persistSiteState(): void {
  persistEnv({
    AGNES_SITE: currentSite,
    AGNES_API_KEY_CN: apiKeys.cn,
    AGNES_API_KEY_INTL: apiKeys.intl,
  });
}

const siteList = () =>
  SITE_IDS.map(id => ({ id, label: SITES[id].label, platform: SITES[id].platform }));

app.get('/api/config', (_req, res) => {
  res.json({ site: currentSite, apiKey: activeKey(), sites: siteList() });
});

app.post('/api/config', (req, res) => {
  const { site, apiKey } = req.body as { site?: SiteId; apiKey?: string };

  if (site !== undefined) {
    const next = normalizeSite(site);
    if (!next) return res.status(400).json({ error: `未知站点: ${site}` });
    currentSite = next;
  }

  if (apiKey !== undefined) {
    const key = String(apiKey).trim();
    if (!key) return res.status(400).json({ error: 'apiKey 不能为空' });
    apiKeys[currentSite] = key;
    modelCache.delete(currentSite);
  }

  persistSiteState();
  res.json({ ok: true, site: currentSite, apiKey: activeKey(), sites: siteList() });
});

// ── 模型列表（按站点实时拉取，失败回退内置列表）─────────────────────────────

const MODEL_FALLBACK: Record<SiteId, { chat: string[]; image: string[]; video: string[] }> = {
  intl: {
    chat:  ['agnes-2.5-flash', 'agnes-2.0-flash'],
    image: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'],
    video: ['agnes-video-v2.0'],
  },
  cn: {
    chat:  ['agnes-2.5-flash', 'agnes-3.0-flash', 'agnes-2.5-pro'],
    image: ['agnes-image-2.1-flash', 'agnes-image-2.5-flash'],
    video: ['agnes-video-2.5-flash', 'agnes-video-2.5'],
  },
};

const modelCache = new Map<SiteId, { at: number; data: any }>();

function classifyModels(ids: string[]) {
  const isVideo = (id: string) => /video/i.test(id);
  const isImage = (id: string) => /image/i.test(id);
  const isOther = (id: string) => /embed|tts|whisper|rerank|moderation/i.test(id);
  return {
    chat:  ids.filter(id => !isVideo(id) && !isImage(id) && !isOther(id)),
    image: ids.filter(isImage),
    video: ids.filter(isVideo),
  };
}

async function modelsFor(site: SiteId) {
  const cached = modelCache.get(site);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.data;

  const key = apiKeys[site];
  let data: any = null;

  if (key) {
    try {
      const { data: raw } = await axios.get(`${SITES[site].baseUrl}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        timeout: 10_000,
      });
      const ids: string[] = (raw?.data ?? []).map((m: any) => m?.id).filter(Boolean);
      if (ids.length) data = { ...classifyModels(ids), source: 'live' };
    } catch { /* 走兜底列表 */ }
  }

  if (!data) data = { ...MODEL_FALLBACK[site], source: key ? 'fallback' : 'offline' };

  modelCache.set(site, { at: Date.now(), data });
  return data;
}

app.get('/api/models', async (_req, res) => {
  try {
    const data = await modelsFor(currentSite);
    res.json({ ...data, site: currentSite });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Chat completions ────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { _saveFormat = 'txt', ...body } = req.body as Record<string, unknown>;
  try {
    const { data } = await axios.post(`${baseUrl()}/chat/completions`, body, {
      headers: authHeaders(),
      timeout: 120_000,
    });

    const content: string = (data as any).choices?.[0]?.message?.content ?? '';
    const model = String(body.model ?? 'unknown').replace(/[^a-z0-9.-]/gi, '_');
    const base = `${stamp()}_${model}`;

    let filename: string;
    let fileContent: string;

    if (_saveFormat === 'json') {
      filename = `${base}.json`;
      fileContent = JSON.stringify(data, null, 2);
    } else if (_saveFormat === 'md') {
      filename = `${base}.md`;
      const userMsg = (body as any).messages?.at(-1)?.content ?? '';
      fileContent = `# ${model}\n\n**Prompt:** ${userMsg}\n\n---\n\n${content}`;
    } else {
      filename = `${base}.txt`;
      fileContent = content;
    }

    fs.writeFileSync(path.join(OUTPUT_DIR, 'text', filename), fileContent, 'utf-8');

    const msgs = (body as any).messages ?? [];
    const userMsg: string = [...msgs].reverse().find((m: any) => m.role === 'user')?.content ?? '';
    const sysMsg: string = msgs.find((m: any) => m.role === 'system')?.content ?? '';
    saveMeta('text', base, {
      prompt: userMsg,
      model: String(body.model ?? ''),
      timestamp: new Date().toISOString(),
      systemPrompt: sysMsg || undefined,
    });

    res.json({ ...(data as object), _savedAs: `text/${filename}` });
  } catch (err: any) {
    res.status(err.response?.status ?? 500).json({ error: err.message, details: err.response?.data });
  }
});

// ── Streaming chat ──────────────────────────────────────────────────────────

app.post('/api/chat/stream', async (req, res) => {
  const { _saveFormat: _sf, ...body } = req.body as Record<string, unknown>;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  try {
    const { data: stream } = await axios.post(
      `${baseUrl()}/chat/completions`,
      { ...body, stream: true },
      { headers: authHeaders(), responseType: 'stream', timeout: 120_000 }
    );
    (stream as NodeJS.ReadableStream).pipe(res);
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Image generation ────────────────────────────────────────────────────────

app.post('/api/image', async (req, res) => {
  try {
    // 处理输入图片（base64 → 本地文件）
    const rawImages: string[] = req.body.extra_body?.image ?? [];
    const { forMeta } = rawImages.length ? processImages(rawImages) : { forMeta: [] };

    const { data } = await axios.post(`${baseUrl()}/images/generations`, req.body, {
      headers: authHeaders(),
      timeout: 180_000,
    });

    const imageUrl: string | undefined = (data as any).data?.[0]?.url;
    let savedAs = '';

    if (imageUrl) {
      const model = String(req.body.model ?? 'unknown').replace(/[^a-z0-9.-]/gi, '_');
      const filebase = `${stamp()}_${model}`;
      const filename = `${filebase}.png`;
      await downloadFile(imageUrl, path.join(OUTPUT_DIR, 'images', filename));
      savedAs = `images/${filename}`;

      saveMeta('images', filebase, {
        prompt: req.body.prompt ?? '',
        model: req.body.model ?? '',
        timestamp: new Date().toISOString(),
        size: req.body.size,
        mode: req.body.tags?.includes('img2img') ? 'img2img' : 'txt2img',
        inputImages: forMeta.length ? forMeta : undefined,
        seed: req.body.seed,
      });
    }

    res.json({ ...(data as object), _savedAs: savedAs });
  } catch (err: any) {
    res.status(err.response?.status ?? 500).json({ error: err.message, details: err.response?.data });
  }
});

// ── Video — create task ─────────────────────────────────────────────────────

app.post('/api/video', async (req, res) => {
  try {
    // 先保存本地上传的图片，与图像接口保持一致
    const rawImages: string[] = req.body.image
      ? [req.body.image]
      : (req.body.extra_body?.image ?? []);
    const { forMeta } = rawImages.length ? processImages(rawImages) : { forMeta: [] };

    const { data } = await axios.post(`${baseUrl()}/videos`, req.body, {
      headers: authHeaders(),
      timeout: 120_000,
    });

    const taskId = (data as any).id;
    if (taskId) {
      const taskMeta = {
        prompt: req.body.prompt ?? '',
        model: req.body.model ?? '',
        negativePrompt: req.body.negative_prompt,
        width: req.body.width,
        height: req.body.height,
        numFrames: req.body.num_frames,
        frameRate: req.body.frame_rate,
        inputImages: forMeta.length ? forMeta : undefined,
      };
      fs.writeFileSync(
        path.join(OUTPUT_DIR, 'videos', `${taskId}.task.json`),
        JSON.stringify(taskMeta, null, 2),
        'utf-8'
      );
    }

    res.json(data);
  } catch (err: any) {
    res.status(err.response?.status ?? 500).json({ error: err.message, details: err.response?.data });
  }
});

// ── Video — poll + save when done ───────────────────────────────────────────

app.get('/api/video/:taskId', async (req, res) => {
  try {
    const { data } = await axios.get(`${baseUrl()}/videos/${req.params.taskId}`, {
      headers: authHeaders(),
      timeout: 30_000,
    });

    // 实际 API 返回的视频 URL 在 remixed_from_video_id 字段（文档中 video_url 字段不存在）
    const videoUrl: string | undefined =
      (data as any).video_url || (data as any).remixed_from_video_id;

    if ((data as any).status === 'completed' && videoUrl) {
      const videoDir = path.join(OUTPUT_DIR, 'videos');
      const existing = fs.readdirSync(videoDir)
        .filter(f => !f.endsWith('.task.json') && !f.endsWith('.meta.json'))
        .find(f => f.includes(req.params.taskId));
      if (existing) {
        return res.json({ ...(data as object), _savedAs: `videos/${existing}` });
      }

      const model = String((data as any).model ?? 'unknown').replace(/[^a-z0-9.-]/gi, '_');
      const filebase = `${stamp()}_${model}_${req.params.taskId}`;
      const filename = `${filebase}.mp4`;
      await downloadFile(videoUrl, path.join(videoDir, filename));

      // 读取任务 meta 并保存为视频 meta
      const taskMetaPath = path.join(videoDir, `${req.params.taskId}.task.json`);
      if (fs.existsSync(taskMetaPath)) {
        const taskMeta = JSON.parse(fs.readFileSync(taskMetaPath, 'utf-8'));
        saveMeta('videos', filebase, { ...taskMeta, timestamp: new Date().toISOString() });
      }

      return res.json({ ...(data as object), _savedAs: `videos/${filename}` });
    }

    res.json(data);
  } catch (err: any) {
    res.status(err.response?.status ?? 500).json({ error: err.message, details: err.response?.data });
  }
});

// ── List saved outputs (with meta) ──────────────────────────────────────────

app.get('/api/outputs', (_req, res) => {
  const result: Record<string, Array<{ file: string; meta: OutputMeta | null }>> = {};
  for (const dir of ['text', 'images', 'videos']) {
    const p = path.join(OUTPUT_DIR, dir);
    const all = fs.existsSync(p) ? fs.readdirSync(p).sort().reverse() : [];
    const files = all.filter(f =>
      !f.endsWith('.meta.json') && !f.endsWith('.task.json')
    );
    result[dir] = files.map(file => ({
      file,
      meta: readMeta(dir, file.replace(/\.[^.]+$/, '')),
    }));
  }
  res.json(result);
});

// ── 旧版 Key 的站点归属识别 ─────────────────────────────────────────────────

// 老版本 .env 里只有 AGNES_API_KEY，没有记录站点。
// 启动时用这把 Key 探测一次，确认它属于国内站还是国际站，然后写回 .env。
async function detectLegacyKeySite(): Promise<void> {
  if (normalizeSite(process.env.AGNES_SITE)) return;   // 已经明确记录过站点
  if (!legacyKey) return;

  for (const id of SITE_IDS) {
    try {
      await axios.get(`${SITES[id].baseUrl}/models`, {
        headers: { Authorization: `Bearer ${legacyKey}` },
        timeout: 6_000,
      });
      if (id !== currentSite || apiKeys[id] !== legacyKey) {
        for (const s of SITE_IDS) if (apiKeys[s] === legacyKey) apiKeys[s] = '';
        currentSite = id;
        apiKeys[id] = legacyKey;
        persistSiteState();
      }
      console.log(`  ✓ 已识别旧 Key 属于：${SITES[id].label}\n`);
      return;
    } catch { /* 这把 Key 在该站无效，继续试下一个 */ }
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 6430;
app.listen(PORT, '0.0.0.0', () => {
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const lanIps: string[] = [];
  for (const ifaces of Object.values(nets) as any[]) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) lanIps.push(iface.address);
    }
  }
  console.log(`\n  Agnes AI Studio`);
  console.log(`  本机：    http://localhost:${PORT}`);
  for (const ip of lanIps) console.log(`  局域网：  http://${ip}:${PORT}`);
  console.log(`  站点：    ${SITES[currentSite].label}  ${baseUrl()}`);
  console.log('');
  if (!activeKey()) {
    console.warn(`  ⚠  ${SITES[currentSite].label}的 API Key 未设置，请在页面顶部填写\n`);
  }
  void detectLegacyKeySite();
});
