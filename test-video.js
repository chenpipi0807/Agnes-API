/**
 * Agnes AI 文生视频独立测试脚本（零依赖，Node.js 原生 fetch）
 * 用法：node test-video.js
 * 需要 .env 中有 AGNES_API_KEY
 */

const path = require('path');
const fs = require('fs');

// 读取 .env
const envPath = path.join(__dirname, '.env');
if (!fs.existsSync(envPath)) {
  console.error('ERROR: .env not found at ' + envPath);
  process.exit(1);
}

const envRaw = fs.readFileSync(envPath, 'utf-8').replace(/^\uFEFF/, ''); // strip BOM
let API_KEY = '';
for (const line of envRaw.split(/\r?\n/)) {
  const trimmed = line.trim();
  // skip comments and empty
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq < 1) continue;
  const key = trimmed.substring(0, eq).trim();
  const val = trimmed.substring(eq + 1).trim();
  if (key === 'AGNES_API_KEY') {
    API_KEY = val;
    break;
  }
}

if (!API_KEY) {
  console.error('ERROR: AGNES_API_KEY not found in .env');
  console.error('File content preview: ' + envRaw.substring(0, 200));
  process.exit(1);
}

const BASE_URL = 'https://apihub.agnes-ai.com/v1';
const OUTPUT_DIR = path.join(__dirname, 'output', 'videos');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const config = {
  model: 'agnes-video-v2.0',
  prompt: '一只猫在日落时漫步沙滩，柔和的海浪，温暖的金色光线，写实风格，电影镜头',
  width: 1152,
  height: 768,
  num_frames: 121,
  frame_rate: 24,
};

const headers = {
  Authorization: `Bearer ${API_KEY}`,
  'Content-Type': 'application/json',
};

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 15);
}

function log(label, msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${ts}] ${label}:`, msg);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  console.log('========================================');
  console.log('  Agnes AI Text-to-Video Test');
  console.log('========================================');
  console.log('');
  console.log('Params:');
  console.log('  model:       ' + config.model);
  console.log('  prompt:      ' + config.prompt);
  console.log('  resolution:  ' + config.width + 'x' + config.height);
  console.log('  num_frames:  ' + config.num_frames);
  console.log('  frame_rate:  ' + config.frame_rate + ' fps');
  console.log('  API Key:     ' + API_KEY.slice(0, 14) + '...' + API_KEY.slice(-4));
  console.log('');

  // Step 1: Create video task
  log('Step1', 'Creating task...');
  let createRes;
  try {
    createRes = await fetch(`${BASE_URL}/videos`, {
      method: 'POST',
      headers,
      body: JSON.stringify(config),
    });
  } catch (err) {
    console.error('\n!!! NETWORK ERROR (Step1): ' + err.message);
    process.exit(1);
  }

  const createData = await createRes.json();

  if (!createRes.ok) {
    console.error('\n!!! API ERROR (Step1)');
    console.error('  HTTP ' + createRes.status);
    console.error('  Body: ' + JSON.stringify(createData, null, 2));
    process.exit(1);
  }

  log('Step1', 'OK! task_id=' + createData.id + '  status=' + createData.status);
  const taskId = createData.id;

  // Step 2: Poll
  log('Step2', 'Polling (max 10 min)...');
  const start = Date.now();
  const MAX = 600_000;

  while (Date.now() - start < MAX) {
    await sleep(3000);

    let pollRes;
    try {
      pollRes = await fetch(`${BASE_URL}/videos/${taskId}`, { headers });
    } catch (err) {
      log('Step2', 'net err: ' + err.message);
      continue;
    }

    const st = await pollRes.json();
    if (!pollRes.ok) {
      log('Step2', 'HTTP ' + pollRes.status + ' ' + JSON.stringify(st));
      continue;
    }

    const sec = Math.round((Date.now() - start) / 1000);
    const pct = st.progress ?? 0;

    if (st.status === 'completed') {
      // 实际 API 返回的视频 URL 在 remixed_from_video_id 字段
      const videoUrl = st.video_url || st.remixed_from_video_id;
      log('Step2', 'DONE in ' + sec + 's');
      log('Step2', '  video_url: ' + videoUrl);
      log('Step2', '  size: ' + st.size + '  seconds: ' + st.seconds);
      if (st.usage) log('Step2', '  gen_duration: ' + st.usage.duration_seconds + 's');

      // Step 3: Download
      log('Step3', 'Downloading...');
      const file = stamp() + '_' + config.model + '_' + taskId + '.mp4';
      const dest = path.join(OUTPUT_DIR, file);

      try {
        const dl = await fetch(videoUrl);
        if (!dl.ok) throw new Error('HTTP ' + dl.status);
        fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
        const sizeMB = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
        log('Step3', 'OK: ' + dest + '  (' + sizeMB + ' MB)');
      } catch (err) {
        console.error('\n!!! DOWNLOAD FAILED: ' + err.message);
        process.exit(1);
      }

      console.log('\n========================================');
      console.log('  PASSED');
      console.log('========================================');
      return;
    }

    if (st.status === 'failed') {
      console.error('\n!!! TASK FAILED');
      console.error(JSON.stringify(st, null, 2));
      process.exit(1);
    }

    // in_progress / queued
    const label = st.status === 'in_progress' ? 'generating' : 'queued';
    log('Step2', label + '... ' + sec + 's  ' + pct + '%');
  }

  console.error('\n!!! TIMEOUT');
  process.exit(1);
}

main().catch(err => {
  console.error('\n!!! CRASH: ' + err.message);
  process.exit(1);
});
