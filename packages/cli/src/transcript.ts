import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface TranscriptSegment {
  start: number;
  text: string;
}

export interface Transcript {
  videoId: string;
  url: string;
  title: string;
  channel: string;
  duration: number;
  uploadDate?: string;
  segments: TranscriptSegment[];
  text: string;
}

export function parseVideoId(input: string): string {
  const m = input.match(/(?:v=|youtu\.be\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/) ?? input.match(/^([A-Za-z0-9_-]{11})$/);
  if (!m) throw new Error(`Cannot find a YouTube video id in "${input}"`);
  return m[1]!;
}

interface Json3 {
  events?: Array<{ tStartMs?: number; segs?: Array<{ utf8?: string }> }>;
}

/** Collapse caption events into ~paragraphs of `window` seconds. */
export function json3ToSegments(json: Json3, window = 30): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let bucket: { start: number; parts: string[] } | null = null;
  for (const ev of json.events ?? []) {
    if (!ev.segs) continue;
    const text = ev.segs.map((s) => s.utf8 ?? '').join('').replace(/\s+/g, ' ').trim();
    if (!text || text === '[Music]' || text === '[Applause]') continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    if (!bucket || start - bucket.start >= window) {
      if (bucket) out.push({ start: bucket.start, text: bucket.parts.join(' ') });
      bucket = { start, parts: [text] };
    } else bucket.parts.push(text);
  }
  if (bucket) out.push({ start: bucket.start, text: bucket.parts.join(' ') });
  return out;
}

export function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatTranscript(t: Transcript): string {
  const head = [`# ${t.title}`, `channel: ${t.channel}`, `url: ${t.url}`, `duration: ${formatTimestamp(t.duration)}`, ''];
  return head.concat(t.segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`)).join('\n');
}

/**
 * Fetch captions with yt-dlp (run through uvx so nothing needs installing).
 * Manual subtitles win over auto-captions when both exist. Files are cached in `cacheDir`.
 */
export async function fetchTranscript(input: string, cacheDir = 'tmp/transcripts'): Promise<Transcript> {
  const videoId = parseVideoId(input);
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const dir = resolve(cacheDir);
  mkdirSync(dir, { recursive: true });
  const infoPath = join(dir, `${videoId}.info.json`);

  if (!existsSync(infoPath) || !findSubs(dir, videoId)) {
    // YouTube rate-limits caption downloads (HTTP 429); back off and retry a few times.
    const delays = [0, 8000, 20000, 45000];
    let lastErr = '';
    for (const delay of delays) {
      if (delay) await Bun.sleep(delay);
      const proc = Bun.spawn(
        [
          'uvx', '--from', 'yt-dlp', 'yt-dlp',
          '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'en.*,en',
          '--sub-format', 'json3', '--write-info-json', '--no-warnings', '--quiet',
          '-o', join(dir, '%(id)s.%(ext)s'), url,
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      );
      const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
      if (code === 0 && findSubs(dir, videoId)) {
        lastErr = '';
        break;
      }
      lastErr = err.trim() || `yt-dlp exited with ${code}`;
      if (!/429|Too Many Requests/.test(lastErr)) break;
    }
    if (lastErr) {
      const hint = /429|Too Many Requests/.test(lastErr)
        ? ' (YouTube is rate-limiting caption downloads; wait a few minutes and try again)'
        : lastErr.includes('uvx') || lastErr.includes('ENOENT')
          ? ' (is uv installed? https://docs.astral.sh/uv/)'
          : '';
      throw new Error(`yt-dlp failed: ${lastErr}${hint}`);
    }
  }
  const subsFile = findSubs(dir, videoId);
  if (!subsFile) throw new Error(`No English captions available for ${url}`);
  const info = existsSync(infoPath) ? (JSON.parse(readFileSync(infoPath, 'utf8')) as Record<string, unknown>) : {};
  const segments = json3ToSegments(JSON.parse(readFileSync(subsFile, 'utf8')) as Json3);
  return {
    videoId,
    url,
    title: String(info.title ?? videoId),
    channel: String(info.channel ?? info.uploader ?? ''),
    duration: Number(info.duration ?? 0),
    uploadDate: typeof info.upload_date === 'string' ? info.upload_date : undefined,
    segments,
    text: segments.map((s) => s.text).join(' '),
  };
}

function findSubs(dir: string, videoId: string): string | null {
  const files = readdirSync(dir).filter((f) => f.startsWith(`${videoId}.`) && f.endsWith('.json3'));
  // Prefer manual English subs ("en.json3") over auto ("en-orig.json3" / "en.json3" from auto may share the name).
  const manual = files.find((f) => f === `${videoId}.en.json3`);
  const any = files.find((f) => /\.en[^.]*\.json3$/.test(f));
  const pick = manual ?? any;
  return pick ? join(dir, pick) : null;
}
