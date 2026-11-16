import { execFile } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { GoogleGenAI } from '@google/genai';
import {
  buildAssSubtitles,
  buildFfmpegFilterGraph,
  type BackgroundVideoId,
  type Clip,
  type Project,
} from '../src/lib/clipLogic.ts';

const execFileAsync = promisify(execFile);

export const DATA_ROOT = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_ROOT, 'uploads');
export const THUMBS_DIR = path.join(DATA_ROOT, 'thumbs');
export const AUDIO_DIR = path.join(DATA_ROOT, 'audio');
export const EXPORTS_DIR = path.join(DATA_ROOT, 'exports');
export const SUBS_DIR = path.join(DATA_ROOT, 'subs');
export const BACKGROUNDS_DIR = path.join(DATA_ROOT, 'backgrounds');
export const SAMPLES_DIR = path.join(DATA_ROOT, 'samples');

export function ensureMediaDirectories(): void {
  for (const dir of [
    DATA_ROOT,
    UPLOADS_DIR,
    THUMBS_DIR,
    AUDIO_DIR,
    EXPORTS_DIR,
    SUBS_DIR,
    BACKGROUNDS_DIR,
    SAMPLES_DIR,
  ]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

export interface VideoProbeInfo {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export async function probeVideo(filePath: string): Promise<VideoProbeInfo> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);
  const data = JSON.parse(stdout);
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const videoStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'video');
  const audioStream = streams.find((s: { codec_type?: string }) => s.codec_type === 'audio');

  if (!videoStream) {
    throw new Error('The uploaded file does not contain a valid video stream.');
  }

  let fps = 30;
  if (typeof videoStream.r_frame_rate === 'string' && videoStream.r_frame_rate.includes('/')) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
    if (num > 0 && den > 0) fps = Math.round(num / den);
  }

  const rawDuration = Number(data.format?.duration || videoStream.duration || 0);
  const durationSeconds = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : 0;

  return {
    durationSeconds,
    width: Number(videoStream.width) || 1280,
    height: Number(videoStream.height) || 720,
    fps,
    hasAudio: Boolean(audioStream),
  };
}

export async function extractThumbnail(
  filePath: string,
  seekSeconds: number,
  outJpgPath: string
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss',
    String(Math.max(0, seekSeconds)),
    '-i',
    filePath,
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2',
    '-q:v',
    '3',
    outJpgPath,
  ]);
}

export async function extractAudioForAI(
  filePath: string,
  outMp3Path: string
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    filePath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '48k',
    outMp3Path,
  ]);
}

export async function extractSampleFrames(
  filePath: string,
  durationSeconds: number,
  count: number,
  prefix: string
): Promise<Array<{ timestamp: number; path: string }>> {
  const safeCount = Math.max(1, Math.min(8, count));
  const results: Array<{ timestamp: number; path: string }> = [];
  for (let i = 0; i < safeCount; i++) {
    const ts = Number((((i + 0.5) / safeCount) * Math.max(1, durationSeconds)).toFixed(2));
    const framePath = path.join(THUMBS_DIR, `${prefix}_kf_${i}.jpg`);
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-ss',
        String(ts),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=480:-2',
        '-q:v',
        '4',
        framePath,
      ]);
      if (fs.existsSync(framePath)) {
        results.push({ timestamp: ts, path: framePath });
      }
    } catch {
      // Ignore individual keyframe failure
    }
  }
  return results;
}

export function getBackgroundVideoPath(bgId: BackgroundVideoId): string | null {
  if (bgId === 'none') return null;
  return path.join(BACKGROUNDS_DIR, `${bgId}.mp4`);
}

/**
 * Generates 3 genuine looping 1080x960 procedural MP4 background videos using FFmpeg.
 */
export async function ensureBackgroundGameplayAssets(): Promise<void> {
  ensureMediaDirectories();
  const specs: Array<{ id: Exclude<BackgroundVideoId, 'none'>; filter: string }> = [
    {
      id: 'cyber_parkour',
      filter:
        "color=c=#09061a:s=540x480:r=30:d=8,geq=r='clip(40+90*pow(sin(X/28+T*4)*cos(Y/28-T*6),2)+60*(Y/480),0,255)':g='clip(18+65*sin(X/32-T*3)*sin(Y/32+T*5),0,255)':b='clip(110+120*abs(sin((X-270)/(Y+40)*6+T*5)),0,255)',scale=1080:960",
    },
    {
      id: 'neon_flow',
      filter:
        "color=c=#0b071c:s=540x480:r=30:d=8,geq=r='clip(120*pow(sin(X/45+T*3+sin(Y/35-T*2)),2)+40,0,255)':g='clip(35+50*cos(Y/40+T*2.5),0,255)':b='clip(160+85*sin((X+Y)/50-T*4),0,255)',scale=1080:960,boxblur=4:1",
    },
    {
      id: 'geometric_tunnel',
      filter:
        'mandelbrot=size=540x480:rate=30:maxiter=45:outer=normalized_iteration_count,scale=1080:960,hue=H=t*0.6',
    },
  ];

  for (const spec of specs) {
    const outPath = path.join(BACKGROUNDS_DIR, `${spec.id}.mp4`);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 5000) continue;
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-f',
        'lavfi',
        '-i',
        spec.filter,
        '-t',
        '8',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '28',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        outPath,
      ]);
    } catch (err) {
      console.error(`Failed to generate background asset ${spec.id}:`, err);
    }
  }
}

/**
 * Creates a real 40-second 1280x720 multi-scene creator podcast MP4 with real spoken
 * audio generated via Gemini TTS, so testing the full upload -> AI -> FFmpeg export
 * pipeline requires zero external files.
 */
export async function createRealSampleVideo(outMp4Path: string): Promise<void> {
  ensureMediaDirectories();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is required to synthesize the sample podcast video audio.');
  }

  const wavPath = path.join(SAMPLES_DIR, 'sample_podcast.wav');
  if (!fs.existsSync(wavPath) || fs.statSync(wavPath).size < 10000) {
    const ai = new GoogleGenAI({
      apiKey,
      apiVersion: 'v1beta',
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const script =
      'Stop posting sixty-minute podcasts without cutting them into vertical hooks first. ' +
      'Here is the brutal truth most creators ignore: ninety percent of your audience decides whether to stay in the first two seconds. ' +
      'If your opening line sounds like a slow introduction, viewers swipe immediately. ' +
      'Instead, open with a bold contrarian takeaway, highlight every power word with dynamic captions, and lock the camera onto the speaker. ' +
      'That single shift doubled our watch-through rate on Instagram Reels, YouTube Shorts, and TikTok in thirty days. ' +
      'Now let us break down the exact three-step retention framework every top creator uses right now.';

    const ttsResponse = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: script,
              speechMetadata: {
                style: 'Energetic, authoritative creator economy podcast host speaking clearly',
              },
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Puck' },
          },
        },
      },
    });

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('Gemini TTS did not return audio data for the sample podcast.');
    }
    fs.writeFileSync(wavPath, Buffer.from(base64Audio, 'base64'));
  }

  // Probe WAV duration so video matches audio length cleanly
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    wavPath,
  ]);
  const wavMeta = JSON.parse(stdout);
  const audioDur = Math.max(20, Math.ceil(Number(wavMeta.format?.duration || 35)));

  // Compose a crisp 1280x720 studio visual with live audio waveform & host card
  await execFileAsync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=#0d0b1a:s=1280x720:d=${audioDur}:r=30`,
    '-i',
    wavPath,
    '-filter_complex',
    [
      `[0:v]drawbox=x=80:y=80:w=1120:h=560:color=#17132c@0.9:t=fill,drawbox=x=80:y=80:w=1120:h=560:color=#6d28d9@0.4:t=2[bg]`,
      `[1:a]showwaves=s=960x180:mode=cline:colors=#a78bfa|#38bdf8:rate=30[waves]`,
      `[bg][waves]overlay=160:370[vid]`,
      `[vid]drawtext=text='CREATOR RETENTION PODCAST':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=165,drawtext=text='Why The First 2 Seconds Decide Viral Reach':fontcolor=#c4b5fd:fontsize=26:x=(w-text_w)/2:y=225,format=yuv420p[vout]`,
    ].join(';'),
    '-map',
    '[vout]',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-crf',
    '24',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-shortest',
    '-movflags',
    '+faststart',
    outMp4Path,
  ]);
}

/**
 * Renders an individual 1080x1920 9:16 vertical clip with burned-in ASS subtitles,
 * smart reframing, optional split-screen background gameplay, and transitions.
 */
export async function renderClipMp4(
  project: Project,
  clip: Clip,
  outputPath: string
): Promise<string> {
  ensureMediaDirectories();
  const trimStart = Math.max(0, clip.trimStart);
  const trimEnd = Math.max(trimStart + 1, Math.min(project.durationSeconds, clip.trimEnd));
  const clipDuration = Number((trimEnd - trimStart).toFixed(2));

  const assContent = buildAssSubtitles(
    clip.captions,
    clip.captionStyle,
    trimStart,
    trimEnd,
    clip.framingMode
  );
  const assPath = path.join(SUBS_DIR, `${project.id}_${clip.id}.ass`);
  fs.writeFileSync(assPath, assContent, 'utf-8');

  const bgPath =
    clip.framingMode === 'split-gameplay'
      ? getBackgroundVideoPath(
          clip.backgroundVideoId === 'none' ? 'cyber_parkour' : clip.backgroundVideoId
        )
      : null;
  const hasBackgroundVideo = Boolean(bgPath && fs.existsSync(bgPath));

  const { filterComplex, videoOutputLabel } = buildFfmpegFilterGraph({
    sourceWidth: project.width,
    sourceHeight: project.height,
    framingMode: clip.framingMode,
    faceCenterX: clip.faceCenterX,
    autoZoom: clip.autoZoom,
    transitionEffect: clip.transitionEffect,
    clipDuration,
    hasBackgroundVideo,
    assSubtitlePath: path.relative(process.cwd(), assPath),
  });

  const args: string[] = [
    '-y',
    '-ss',
    String(trimStart),
    '-t',
    String(clipDuration),
    '-i',
    project.videoPath,
  ];

  if (hasBackgroundVideo && bgPath) {
    args.push('-stream_loop', '-1', '-t', String(clipDuration), '-i', bgPath);
  }

  args.push(
    '-filter_complex',
    filterComplex,
    '-map',
    videoOutputLabel,
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '22',
    '-c:a',
    'aac',
    '-b:a',
    '128k',
    '-movflags',
    '+faststart',
    outputPath
  );

  await execFileAsync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 16 });
  return outputPath;
}
