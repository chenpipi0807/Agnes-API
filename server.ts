import 'dotenv/config';
import express from 'express';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/output', express.static(path.join(__dirname, 'output')));

const BASE_URL = 'https://apihub.agnes-ai.com/v1';
let API_KEY = process.env.AGNES_API_KEY || '';
const OUTPUT_DIR = path.join(__dirname, 'output');
const ENV_PATH = path.join(__dirname, '.env');

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
  Authorization: `Bearer ${API_KEY}`,
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

// ── Config (API key read/write) ─────────────────────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({ apiKey: API_KEY });
});

app.post('/api/config', (req, res) => {
  const { apiKey } = req.body as { apiKey?: string };
  if (!apiKey || typeof apiKey !== 'string') {
    return res.status(400).json({ error: 'apiKey 不能为空' });
  }
  API_KEY = apiKey.trim();
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  if (/^AGNES_API_KEY=/m.test(content)) {
    content = content.replace(/^AGNES_API_KEY=.*/m, `AGNES_API_KEY=${API_KEY}`);
  } else {
    content = content.trimEnd() + `\nAGNES_API_KEY=${API_KEY}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  res.json({ ok: true });
});

// ── Chat completions ────────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  const { _saveFormat = 'txt', ...body } = req.body as Record<string, unknown>;
  try {
    const { data } = await axios.post(`${BASE_URL}/chat/completions`, body, {
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
      `${BASE_URL}/chat/completions`,
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

    const { data } = await axios.post(`${BASE_URL}/images/generations`, req.body, {
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

    const { data } = await axios.post(`${BASE_URL}/videos`, req.body, {
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
    const { data } = await axios.get(`${BASE_URL}/videos/${req.params.taskId}`, {
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
  console.log('');
  if (!API_KEY) console.warn('  ⚠  AGNES_API_KEY 未在 .env 中设置\n');
});
