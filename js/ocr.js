// スクショの文字認識(端末内)。Tesseract.js を初回だけCDNから読み込む。画像は外部に送信されない。
import { parseAttendance, mergeRows } from './parse.js';

const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
const TARGET_WIDTH = 1400; // 検証で最も安定した幅(小さい画像は拡大して読む)
const MAX_WIDTH = 1800;
const MIN_USABLE_WIDTH = 500;

let scriptPromise = null;
let workerPromise = null;
let onProgress = () => {};

function loadScript() {
  if (window.Tesseract) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_URL;
    s.onload = resolve;
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('文字認識の部品を読み込めませんでした。ネットワークを確認してください'));
    };
    document.head.append(s);
  });
  return scriptPromise;
}

async function getWorker() {
  await loadScript();
  workerPromise ??= window.Tesseract.createWorker(['jpn', 'eng'], 1, {
    logger: (m) => onProgress(m),
  }).catch((e) => {
    workerPromise = null;
    throw e;
  });
  return workerPromise;
}

/** 画像を読みやすい大きさに整えて canvas にする */
export async function prepareImage(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale =
    bmp.width < TARGET_WIDTH ? TARGET_WIDTH / bmp.width : bmp.width > MAX_WIDTH ? MAX_WIDTH / bmp.width : 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const originalWidth = bmp.width;
  bmp.close?.();
  return { canvas, originalWidth };
}

/**
 * 複数枚のスクショを読み取り、日付ごとに統合した結果を返す。
 * @param {File[]} files
 * @param {(p:{phase:'load'|'read', index:number, total:number, ratio:number}) => void} progress
 * @param {{year:number, month:number}} fallback ヘッダーが写っていない画像に使う年月
 */
export async function recognizeFiles(files, progress, fallback) {
  let phase = 'load';
  let index = 0;
  onProgress = (m) => {
    if (m.status === 'recognizing text') progress({ phase: 'read', index, total: files.length, ratio: m.progress });
    else if (/loading|initializing/.test(m.status)) progress({ phase, index, total: files.length, ratio: m.progress ?? 0 });
  };
  progress({ phase: 'load', index: 0, total: files.length, ratio: 0 });
  const worker = await getWorker();
  phase = 'read';

  const lists = [];
  const ignored = [];
  const notes = [];
  let header = fallback;

  for (index = 0; index < files.length; index++) {
    const { canvas, originalWidth } = await prepareImage(files[index]);
    if (originalWidth < MIN_USABLE_WIDTH) {
      notes.push(`${index + 1}枚目は画像が小さい(幅${originalWidth}px)ため、読み取れない場合があります`);
    }
    // 分割モードを2通り試して、日付ごとに信頼できる方を採る
    for (const psm of ['6', '4']) {
      await worker.setParameters({ tessedit_pageseg_mode: psm });
      const { data } = await worker.recognize(canvas);
      const lines = data.lines.map((l) => ({
        text: l.text.trim(),
        confidence: l.confidence,
        edge: l.bbox.y1 > canvas.height * 0.9, // 下部のタブバーに近い行
      }));
      const r = parseAttendance(lines, { fallback: header });
      if (r.headerFound) header = { year: r.year, month: r.month };
      lists.push(r.rows);
      if (psm === '6') ignored.push(...r.ignored);
    }
  }
  return { rows: mergeRows(...lists), ignored, notes, header };
}
