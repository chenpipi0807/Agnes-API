// Agnes AI Studio — Frontend TypeScript

// ── Types ──────────────────────────────────────────────────────────────────

type SaveFormat = 'txt' | 'json' | 'md';

interface ChatPayload {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
  _saveFormat?: SaveFormat;
}

interface ImagePayload {
  model: string;
  prompt: string;
  size?: string;
  seed?: number;
  tags?: string[];
  extra_body?: { image?: string[]; response_format?: string };
}

interface VideoPayload {
  model: string;
  prompt: string;
  negative_prompt?: string;
  image?: string;
  width?: number;
  height?: number;
  num_frames?: number;
  frame_rate?: number;
  seed?: number;
  extra_body?: { image?: string[]; mode?: string };
}

interface VideoStatus {
  id: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  video_url?: string;
  _savedAs?: string;
  model?: string;
  size?: string;
  seconds?: string;
}

interface TaskEntry {
  id: string;
  status: string;
  progress: number;
  prompt: string;
  createdAt: number;
  completedAt?: number;
  savedAs?: string;
  videoUrl?: string;
}

interface OutputMeta {
  prompt: string;
  model: string;
  timestamp: string;
  systemPrompt?: string;
  size?: string;
  mode?: string;
  inputImages?: string[];
  seed?: number;
  negativePrompt?: string;
  width?: number;
  height?: number;
  numFrames?: number;
  frameRate?: number;
}

interface OutputEntry {
  file: string;
  meta: OutputMeta | null;
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function post(endpoint: string, body: object): Promise<any> {
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

async function get(endpoint: string): Promise<any> {
  const res = await fetch(`/api/${endpoint}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data;
}

// ── UI helpers ──────────────────────────────────────────────────────────────

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function setStatus(
  statusEl: HTMLElement,
  msg: string,
  type: 'idle' | 'loading' | 'success' | 'error' = 'idle'
) {
  statusEl.textContent = msg;
  statusEl.className = `status status-${type}`;
}

function setBusy(btn: HTMLButtonElement, busy: boolean) {
  btn.disabled = busy;
  if (busy) {
    btn.dataset.orig = btn.textContent ?? '';
    btn.textContent = '处理中…';
  } else {
    btn.textContent = btn.dataset.orig ?? btn.textContent;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── 视频帧数计算（秒 × fps → 最近的 8n+1，钳位 9–441） ─────────────────────

function secondsToFrames(seconds: number, fps: number): number {
  const raw = seconds * fps;
  const n = Math.max(1, Math.round((raw - 1) / 8));
  return Math.min(441, n * 8 + 1);
}

// ── 图片输入行（本地上传为主，URL 为辅） ──────────────────────────────────

function urlInputRow(urlClass: string): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'img-input-row';
  const fid = 'fp-' + Math.random().toString(36).slice(2, 8);
  row.innerHTML = `
    <div class="img-row-main">
      <input type="file" id="${fid}" accept="image/*" style="display:none" />
      <label for="${fid}" class="img-upload-zone">
        <span class="upload-icon">📎</span>
        <span class="upload-label-text">点击选择本地图片</span>
      </label>
      <button type="button" class="btn-icon rm-btn" title="删除">✕</button>
    </div>
    <div class="url-secondary">
      <span class="url-or">或粘贴 URL</span>
      <input type="text" class="${urlClass} url-text" placeholder="https://…" />
    </div>`;

  const uploadZone = row.querySelector<HTMLLabelElement>('.img-upload-zone')!;
  const labelText = row.querySelector<HTMLSpanElement>('.upload-label-text')!;
  const filePicker = row.querySelector<HTMLInputElement>(`#${fid}`)!;
  const urlInput = row.querySelector<HTMLInputElement>('.url-text')!;

  filePicker.addEventListener('change', () => {
    const file = filePicker.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      row.dataset.b64 = reader.result as string;
      labelText.textContent = file.name;
      uploadZone.classList.add('has-file');
      urlInput.value = '';
    };
    reader.readAsDataURL(file);
  });

  // 有文件时点击 → 清除，而不是重新打开选择框
  uploadZone.addEventListener('click', e => {
    if (uploadZone.classList.contains('has-file')) {
      e.preventDefault();
      delete row.dataset.b64;
      labelText.textContent = '点击选择本地图片';
      uploadZone.classList.remove('has-file');
      filePicker.value = '';
    }
  });

  row.querySelector('.rm-btn')!.addEventListener('click', () => row.remove());
  return row;
}

// 从 img-input-row 容器中读取所有图片值（base64 data URI 或 URL）
function getImageValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.img-input-row'))
    .map(row => {
      if (row.dataset.b64) return row.dataset.b64;
      const input = row.querySelector<HTMLInputElement>('.url-text');
      return input?.value.trim() ?? '';
    })
    .filter(Boolean);
}

// ── 复用函数 ──────────────────────────────────────────────────────────────────

function reuseText(meta: OutputMeta) {
  document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="text"]')?.click();
  el<HTMLTextAreaElement>('chat-user').value = meta.prompt;
  if (meta.model) el<HTMLSelectElement>('chat-model').value = meta.model;
  if (meta.systemPrompt) el<HTMLTextAreaElement>('chat-system').value = meta.systemPrompt;
}

function reuseImage(meta: OutputMeta) {
  document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="image"]')?.click();
  el<HTMLTextAreaElement>('image-prompt').value = meta.prompt;
  if (meta.model) el<HTMLSelectElement>('image-model').value = meta.model;
  if (meta.size) el<HTMLSelectElement>('image-size').value = meta.size;
  if (meta.seed) el<HTMLInputElement>('image-seed').value = String(meta.seed);

  const container = el('image-urls');
  container.innerHTML = '';

  if (meta.inputImages?.length) {
    for (const img of meta.inputImages) {
      const row = urlInputRow('img-url');
      if (!img.startsWith('[')) {
        row.querySelector<HTMLInputElement>('.url-text')!.value = img;
      }
      container.appendChild(row);
    }
    const modeSel = el<HTMLSelectElement>('image-mode');
    modeSel.value = meta.mode === 'img2img' ? 'img2img' : 'txt2img';
    modeSel.dispatchEvent(new Event('change'));
  } else {
    container.appendChild(urlInputRow('img-url'));
    const modeSel = el<HTMLSelectElement>('image-mode');
    modeSel.value = 'txt2img';
    modeSel.dispatchEvent(new Event('change'));
  }
}

function reuseVideo(meta: OutputMeta) {
  document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="video"]')?.click();
  el<HTMLTextAreaElement>('video-prompt').value = meta.prompt;
  if (meta.model) el<HTMLSelectElement>('video-model').value = meta.model;
  if (meta.negativePrompt) el<HTMLTextAreaElement>('video-negative').value = meta.negativePrompt;
  if (meta.width) el<HTMLInputElement>('video-width').value = String(meta.width);
  if (meta.height) el<HTMLInputElement>('video-height').value = String(meta.height);
  if (meta.frameRate) el<HTMLInputElement>('video-fps').value = String(meta.frameRate);
  if (meta.numFrames && meta.frameRate) {
    el<HTMLInputElement>('video-seconds').value = String(
      Math.round(meta.numFrames / meta.frameRate * 10) / 10
    );
  }

  // 同步预设下拉
  const preset = el<HTMLSelectElement>('video-preset');
  const sizeKey = `${meta.width ?? 1152}x${meta.height ?? 768}`;
  const match = Array.from(preset.options).find(o => o.value === sizeKey);
  preset.value = match ? sizeKey : '';

  const container = el('video-urls');
  container.innerHTML = '';
  if (meta.inputImages?.length) {
    for (const img of meta.inputImages) {
      const row = urlInputRow('vid-url');
      if (!img.startsWith('[')) row.querySelector<HTMLInputElement>('.url-text')!.value = img;
      container.appendChild(row);
    }
    const modeSel = el<HTMLSelectElement>('video-mode');
    modeSel.value = meta.inputImages.length > 1 ? 'multi' : 'image';
    modeSel.dispatchEvent(new Event('change'));
  } else {
    container.appendChild(urlInputRow('vid-url'));
  }
}

// ── API Key 管理 ─────────────────────────────────────────────────────────────

async function initApiKey() {
  const input = el<HTMLInputElement>('apiKey');
  const saveBtn = el<HTMLButtonElement>('btn-save-key');
  const statusEl = el('key-status');

  try {
    const { apiKey } = await get('config');
    if (apiKey) input.value = apiKey;
  } catch { /* 用户自行填写 */ }

  saveBtn.addEventListener('click', async () => {
    const key = input.value.trim();
    if (!key) { setStatus(statusEl, '请输入 API Key', 'error'); return; }
    setBusy(saveBtn, true);
    try {
      await post('config', { apiKey: key });
      setStatus(statusEl, '已保存到 .env ✓', 'success');
      setTimeout(() => setStatus(statusEl, ''), 3000);
    } catch (err: any) {
      setStatus(statusEl, `保存失败: ${err.message}`, 'error');
    } finally {
      setBusy(saveBtn, false);
    }
  });
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab!;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      el(`panel-${tab}`).classList.add('active');
    });
  });
}

// ── 文本 / Chat ──────────────────────────────────────────────────────────────

function initChat() {
  const form = el<HTMLFormElement>('chat-form');
  const resultEl = el('chat-result');
  const statusEl = el('chat-status');
  const submitBtn = el<HTMLButtonElement>('chat-submit');

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const model = el<HTMLSelectElement>('chat-model').value;
    const system = el<HTMLTextAreaElement>('chat-system').value.trim();
    const user = el<HTMLTextAreaElement>('chat-user').value.trim();
    const temperature = parseFloat(el<HTMLInputElement>('chat-temp').value);
    const maxTokensRaw = el<HTMLInputElement>('chat-maxtokens').value.trim();
    const saveFormat = el<HTMLSelectElement>('chat-format').value as SaveFormat;
    const streaming = el<HTMLInputElement>('chat-stream').checked;

    if (!user) { setStatus(statusEl, '消息内容不能为空', 'error'); return; }

    setBusy(submitBtn, true);
    setStatus(statusEl, '发送中…', 'loading');
    resultEl.textContent = '';

    const messages: ChatPayload['messages'] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const payload: ChatPayload = { model, messages, temperature, _saveFormat: saveFormat };
    if (maxTokensRaw) payload.max_tokens = parseInt(maxTokensRaw);

    try {
      if (streaming) {
        const res = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const reader = res.body!.getReader();
        const dec = new TextDecoder();
        let full = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of dec.decode(value).split('\n')) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              full += JSON.parse(raw).choices?.[0]?.delta?.content ?? '';
              resultEl.textContent = full;
            } catch { /* 忽略不完整块 */ }
          }
        }
        setStatus(statusEl, '流式输出完成', 'success');
      } else {
        const data = await post('chat', payload);
        resultEl.textContent = data.choices?.[0]?.message?.content ?? '';
        const u = data.usage;
        setStatus(statusEl, `已保存 → ${data._savedAs}  |  tokens: ${u?.total_tokens ?? '?'}`, 'success');
      }
    } catch (err: any) {
      setStatus(statusEl, `错误：${err.message}`, 'error');
    } finally {
      setBusy(submitBtn, false);
    }
  });

  el('chat-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(resultEl.textContent ?? '').then(() =>
      setStatus(statusEl, '已复制到剪贴板！', 'success')
    );
  });

  el<HTMLInputElement>('chat-temp').addEventListener('input', function () {
    el('chat-temp-val').textContent = this.value;
  });
}

// ── 图像 ──────────────────────────────────────────────────────────────────────

function initImage() {
  const form = el<HTMLFormElement>('image-form');
  const resultEl = el('image-result');
  const statusEl = el('image-status');
  const submitBtn = el<HTMLButtonElement>('image-submit');
  const modelSel = el<HTMLSelectElement>('image-model');
  const modeSel = el<HTMLSelectElement>('image-mode');
  const imgSection = el('image-input-section');
  const urlsContainer = el('image-urls');

  urlsContainer.appendChild(urlInputRow('img-url'));

  function syncMode() {
    const isImg2Img = modeSel.value !== 'txt2img';
    imgSection.style.display = isImg2Img ? 'block' : 'none';
    const multiOpt = modeSel.querySelector<HTMLOptionElement>('option[value="multi"]');
    if (multiOpt) multiOpt.disabled = modelSel.value !== 'agnes-image-2.0-flash';
  }
  modelSel.addEventListener('change', syncMode);
  modeSel.addEventListener('change', syncMode);
  syncMode();

  el('add-image-url').addEventListener('click', () => {
    urlsContainer.appendChild(urlInputRow('img-url'));
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const model = modelSel.value;
    const prompt = el<HTMLTextAreaElement>('image-prompt').value.trim();
    const size = el<HTMLSelectElement>('image-size').value;
    const mode = modeSel.value;
    const seedRaw = el<HTMLInputElement>('image-seed').value.trim();
    const images = getImageValues(urlsContainer);

    if (!prompt) { setStatus(statusEl, '提示词不能为空', 'error'); return; }

    setBusy(submitBtn, true);
    setStatus(statusEl, '图片生成中…', 'loading');
    resultEl.innerHTML = '';

    const payload: ImagePayload = { model, prompt, size };
    if (seedRaw && model === 'agnes-image-2.0-flash') payload.seed = parseInt(seedRaw);
    if (mode === 'img2img' || mode === 'multi') {
      payload.extra_body = { image: images, response_format: 'url' };
      if (model === 'agnes-image-2.0-flash') payload.tags = ['img2img'];
    }

    try {
      const data = await post('image', payload);
      const url: string | undefined = data.data?.[0]?.url;
      if (url) {
        const img = document.createElement('img');
        img.src = url;
        img.className = 'result-img';
        img.alt = '生成图片';
        resultEl.appendChild(img);
        if (data._savedAs) {
          const a = document.createElement('a');
          a.href = `/output/${data._savedAs}`;
          a.textContent = `↓ 下载：${data._savedAs}`;
          a.className = 'dl-link';
          a.download = '';
          resultEl.appendChild(a);
        }
        setStatus(statusEl, `已保存 → ${data._savedAs}`, 'success');
        loadOutputs();
      }
    } catch (err: any) {
      setStatus(statusEl, `错误：${err.message}`, 'error');
    } finally {
      setBusy(submitBtn, false);
    }
  });
}

// ── 视频任务队列 ──────────────────────────────────────────────────────────────

const videoTasks = new Map<string, TaskEntry>();
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _tickTimer: ReturnType<typeof setInterval> | null = null;

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${s % 60}s`;
}

function renderTaskList() {
  const listEl = el('task-list');
  const tasks = Array.from(videoTasks.values()).reverse();
  if (!tasks.length) {
    listEl.innerHTML = '<div class="task-empty">暂无任务</div>';
    return;
  }
  listEl.innerHTML = tasks.map(t => {
    const now = Date.now();
    const elapsed = fmtDuration((t.completedAt ?? now) - t.createdAt);
    const isActive = t.status !== 'completed' && t.status !== 'failed';
    const statusCls = t.status === 'completed' ? 'ts-ok' : t.status === 'failed' ? 'ts-err' : 'ts-pending';
    const statusLabel = t.status === 'completed' ? '✓ 完成'
      : t.status === 'failed' ? '✗ 失败'
      : `${t.status === 'in_progress' ? '生成中' : '排队中'} ${t.progress}%`;
    const bar = isActive
      ? `<div class="tpbar"><div class="tpbar-fill" style="width:${t.progress}%"></div></div>`
      : '';
    const videoHtml = (t.status === 'completed' && t.videoUrl)
      ? `<video controls class="result-video" style="margin-top:8px">
           <source src="${t.videoUrl}" type="video/mp4">
         </video>
         ${t.savedAs ? `<a href="/output/${t.savedAs}" class="dl-link" download>↓ 下载：${t.savedAs}</a>` : ''}`
      : '';
    return `
      <div class="task-card${isActive ? ' task-card--active' : ''}">
        <div class="tc-row">
          <code class="tc-id">${t.id.slice(0, 22)}…</code>
          <span class="tc-status ${statusCls}">${statusLabel}</span>
          <span class="tc-time">${elapsed}</span>
        </div>
        <div class="tc-prompt">${esc(t.prompt.length > 80 ? t.prompt.slice(0, 80) + '…' : t.prompt)}</div>
        ${bar}${videoHtml}
      </div>`;
  }).join('');
}

async function pollAllTasks() {
  const pending = Array.from(videoTasks.values())
    .filter(t => t.status !== 'completed' && t.status !== 'failed');
  if (!pending.length) return;
  await Promise.allSettled(pending.map(async task => {
    try {
      const data: VideoStatus = await get(`video/${task.id}`);
      task.status = data.status;
      task.progress = data.progress ?? 0;
      if (data.status === 'completed') {
        task.completedAt = Date.now();
        if (data._savedAs) task.savedAs = data._savedAs;
        if (data.video_url) task.videoUrl = data.video_url;
        loadOutputs();
      }
    } catch { /* 静默，下次再试 */ }
  }));
  renderTaskList();
}

function startGlobalPoll() {
  if (!_pollTimer) _pollTimer = setInterval(pollAllTasks, 3000);
  if (!_tickTimer) _tickTimer = setInterval(() => {
    if (Array.from(videoTasks.values()).some(t => t.status !== 'completed' && t.status !== 'failed'))
      renderTaskList();
  }, 1000);
}

// ── 视频 ──────────────────────────────────────────────────────────────────────

function initVideo() {
  const form = el<HTMLFormElement>('video-form');
  const statusEl = el('video-status');
  const submitBtn = el<HTMLButtonElement>('video-submit');
  const modeSel = el<HTMLSelectElement>('video-mode');
  const imgSection = el('video-input-section');
  const urlsContainer = el('video-urls');

  urlsContainer.appendChild(urlInputRow('vid-url'));

  // fps 变化时更新时长上限
  const secInput = el<HTMLInputElement>('video-seconds');
  const fpsSelect = el<HTMLSelectElement>('video-fps');

  function updateSecondsMax() {
    const fps = parseInt(fpsSelect.value) || 24;
    const maxSec = Math.floor(441 / fps * 10) / 10;
    secInput.max = String(maxSec);
    if (parseFloat(secInput.value) > maxSec) secInput.value = String(maxSec);
  }
  fpsSelect.addEventListener('change', updateSecondsMax);
  updateSecondsMax();

  // 尺寸预设联动
  el<HTMLSelectElement>('video-preset').addEventListener('change', function () {
    if (!this.value) return;
    const [w, h] = this.value.split('x');
    el<HTMLInputElement>('video-width').value = w;
    el<HTMLInputElement>('video-height').value = h;
  });
  ['video-width', 'video-height'].forEach(id => {
    el<HTMLInputElement>(id).addEventListener('input', () => {
      const preset = el<HTMLSelectElement>('video-preset');
      const current = `${el<HTMLInputElement>('video-width').value}x${el<HTMLInputElement>('video-height').value}`;
      preset.value = Array.from(preset.options).find(o => o.value === current) ? current : '';
    });
  });

  function syncMode() {
    imgSection.style.display = modeSel.value !== 'text' ? 'block' : 'none';
  }
  modeSel.addEventListener('change', syncMode);
  syncMode();

  el('add-video-url').addEventListener('click', () => {
    urlsContainer.appendChild(urlInputRow('vid-url'));
  });

  renderTaskList();

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const model = el<HTMLSelectElement>('video-model').value;
    const prompt = el<HTMLTextAreaElement>('video-prompt').value.trim();
    const neg = el<HTMLTextAreaElement>('video-negative').value.trim();
    const mode = modeSel.value;
    const images = getImageValues(urlsContainer);
    const width = parseInt(el<HTMLInputElement>('video-width').value) || 1152;
    const height = parseInt(el<HTMLInputElement>('video-height').value) || 768;
    const seconds = parseFloat(secInput.value) || 5;
    const frameRate = parseInt(fpsSelect.value) || 24;
    const numFrames = secondsToFrames(seconds, frameRate);
    const seedRaw = el<HTMLInputElement>('video-seed').value.trim();

    if (!prompt) { setStatus(statusEl, '提示词不能为空', 'error'); return; }

    setBusy(submitBtn, true);
    setStatus(statusEl, '提交中…', 'loading');

    const payload: VideoPayload = { model, prompt, width, height, num_frames: numFrames, frame_rate: frameRate };
    if (neg) payload.negative_prompt = neg;
    if (seedRaw) payload.seed = parseInt(seedRaw);
    if (mode === 'image' && images.length) payload.image = images[0];
    else if (mode === 'multi' && images.length) payload.extra_body = { image: images };
    else if (mode === 'keyframe' && images.length) payload.extra_body = { image: images, mode: 'keyframes' };

    try {
      const data = await post('video', payload);
      if (!data.id) throw new Error('未返回任务 ID');
      videoTasks.set(data.id, {
        id: data.id,
        status: data.status ?? 'queued',
        progress: data.progress ?? 0,
        prompt,
        createdAt: Date.now(),
      });
      renderTaskList();
      startGlobalPoll();
      setStatus(statusEl, `已提交，自动轮询中（共 ${videoTasks.size} 个任务）`, 'success');
    } catch (err: any) {
      setStatus(statusEl, `错误：${err.message}`, 'error');
    } finally {
      setBusy(submitBtn, false);
    }
  });
}

// ── 侧边栏渲染 ───────────────────────────────────────────────────────────────

function shortModel(m: string): string {
  return m.replace('agnes-', '').replace('-flash', '-f').replace('image-', 'img-');
}

function renderOutputItem(cat: string, entry: OutputEntry): string {
  const { file, meta } = entry;
  const url = `/output/${cat}/${file}`;
  const ext = file.split('.').pop()?.toLowerCase() ?? '';
  const isImg = ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
  const isVid = ext === 'mp4';

  const thumb = isImg
    ? `<img src="${url}" class="out-thumb" loading="lazy" alt="">`
    : isVid
    ? `<div class="out-icon">🎬</div>`
    : `<div class="out-icon">📄</div>`;

  const modelTag = meta?.model
    ? `<span class="out-model">${esc(shortModel(meta.model))}</span>`
    : '';

  const promptText = meta?.prompt
    ? `<div class="out-prompt" title="${esc(meta.prompt)}">${esc(meta.prompt)}</div>`
    : '';

  const inputThumbs = (meta?.inputImages?.length)
    ? `<div class="out-input-thumbs">${meta.inputImages.slice(0, 4).map(u => {
        if (u.startsWith('/output/') || u.startsWith('http'))
          return `<img src="${u}" class="out-input-thumb" loading="lazy" title="${esc(u)}">`;
        return `<span class="out-input-local" title="本地文件">📎</span>`;
      }).join('')}</div>`
    : '';

  const metaAttr = meta
    ? `data-meta="${esc(JSON.stringify({ ...meta, _cat: cat }))}"`
    : '';

  return `
    <div class="out-card">
      ${thumb}
      <div class="out-info">
        ${modelTag}
        ${promptText}
        ${inputThumbs}
        <div class="out-file-row">
          <a href="${url}" target="_blank" class="out-link" title="${esc(file)}">${esc(file)}</a>
          ${meta ? `<button class="reuse-btn" ${metaAttr}>复用</button>` : ''}
        </div>
      </div>
    </div>`;
}

// ── 加载已保存文件 ────────────────────────────────────────────────────────────

async function loadOutputs() {
  try {
    const data: Record<string, OutputEntry[]> = await get('outputs');
    for (const [cat, entries] of Object.entries(data)) {
      const listEl = el(`out-${cat}`);
      if (!listEl) continue;
      if (!entries.length) {
        listEl.innerHTML = '<span class="out-empty">暂无文件</span>';
        continue;
      }
      listEl.innerHTML = entries.slice(0, 20).map(e => renderOutputItem(cat, e)).join('');
    }
  } catch (err: any) {
    console.error('加载输出文件失败:', err.message);
  }
}

// ── 复用按钮事件委托 ──────────────────────────────────────────────────────────

function initReuseDelegate() {
  document.addEventListener('click', e => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.reuse-btn');
    if (!btn?.dataset.meta) return;
    try {
      const meta: OutputMeta & { _cat?: string } = JSON.parse(btn.dataset.meta);
      const cat = meta._cat;
      if (cat === 'text') reuseText(meta);
      else if (cat === 'images') reuseImage(meta);
      else if (cat === 'videos') reuseVideo(meta);
    } catch (err) {
      console.error('复用失败:', err);
    }
  });
}

// ── 初始化 ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  initApiKey();
  initTabs();
  initChat();
  initImage();
  initVideo();
  initReuseDelegate();
  loadOutputs();

  el('btn-refresh').addEventListener('click', loadOutputs);
  setInterval(loadOutputs, 12_000);
});
