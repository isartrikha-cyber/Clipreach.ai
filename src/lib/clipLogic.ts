export type ProjectSourceType = 'upload' | 'youtube' | 'sample';

export type ProjectStatus =
  | 'uploading'
  | 'probing'
  | 'transcribing'
  | 'analyzing'
  | 'ready'
  | 'error';

export type CaptionLanguage = 'auto' | 'en' | 'hi';

export type CaptionStyle = 'hormozi' | 'minimal' | 'neon' | 'devanagari';

export type FramingMode = 'auto-face' | 'split-gameplay' | 'blur-fill';

export type ExportFormat = 'reels' | 'shorts' | 'tiktok';

export type TransitionEffect = 'none' | 'fade' | 'hook-zoom' | 'vignette';

export type BackgroundVideoId = 'none' | 'cyber_parkour' | 'neon_flow' | 'geometric_tunnel';

export interface BackgroundVideoOption {
  id: BackgroundVideoId;
  name: string;
  subtitle: string;
  previewGradient: string;
}

export const BACKGROUND_VIDEOS: BackgroundVideoOption[] = [
  {
    id: 'none',
    name: 'No Gameplay Overlay',
    subtitle: 'Full vertical subject focus',
    previewGradient: 'from-slate-900 to-slate-800',
  },
  {
    id: 'cyber_parkour',
    name: 'Cyber Grid Parkour',
    subtitle: 'High-retention velocity motion',
    previewGradient: 'from-violet-900 via-indigo-900 to-cyan-900',
  },
  {
    id: 'neon_flow',
    name: 'Neon Plasma Flow',
    subtitle: 'Smooth ambient kinetic waves',
    previewGradient: 'from-fuchsia-900 via-purple-900 to-blue-900',
  },
  {
    id: 'geometric_tunnel',
    name: 'Quantum Tunnel Drift',
    subtitle: 'Hypnotic geometric loop',
    previewGradient: 'from-indigo-950 via-blue-900 to-emerald-900',
  },
];

export interface CaptionWord {
  id: string;
  word: string;
  start: number;
  end: number;
  important: boolean;
}

export interface CaptionSegment {
  id: string;
  start: number;
  end: number;
  text: string;
  words: CaptionWord[];
}

export interface ViralScoreBreakdown {
  overall: number;
  hookStrength: number;
  engagementPotential: number;
  emotionalImpact: number;
  pacing: number;
  contentQuality: number;
}

export interface Clip {
  id: string;
  index: number;
  title: string;
  hook: string;
  reasoning: string;
  language: 'en' | 'hi';
  startTime: number;
  endTime: number;
  trimStart: number;
  trimEnd: number;
  viralScore: ViralScoreBreakdown;
  captionStyle: CaptionStyle;
  captions: CaptionSegment[];
  framingMode: FramingMode;
  faceCenterX: number; // 0..1 normalized horizontal focus
  autoZoom: boolean;
  backgroundVideoId: BackgroundVideoId;
  transitionEffect: TransitionEffect;
  exportFormat: ExportFormat;
  exportedPath?: string;
  exportedAt?: string;
}

export interface Project {
  id: string;
  title: string;
  sourceType: ProjectSourceType;
  sourceUrl?: string;
  youtubeVideoId?: string;
  streamMode?: 'local-mp4' | 'youtube-embed';
  originalFilename: string;
  videoPath: string;
  thumbnailPath?: string;
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  targetClipDuration: 15 | 30 | 45 | 60;
  requestedClipCount: number;
  language: CaptionLanguage;
  status: ProjectStatus;
  progressPercent: number;
  statusMessage: string;
  errorMessage?: string;
  fullTranscript: string;
  clips: Clip[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceQuota {
  userName: string;
  userEmail: string;
  limitSeconds: number;
  usedSeconds: number;
}

export interface DashboardSummary {
  quota: WorkspaceQuota;
  stats: {
    totalVideosProcessed: number;
    totalClipsGenerated: number;
    avgViralScore: number;
    remainingMinutes: number;
  };
  projects: Project[];
  backgrounds: BackgroundVideoOption[];
}

/**
 * Weighted viral score out of 100 from the 5 creator-retention dimensions.
 */
export function calculateCompositeViralScore(
  breakdown: Omit<ViralScoreBreakdown, 'overall'>
): number {
  const clamp = (val: number) => Math.max(0, Math.min(100, val));
  const weighted =
    clamp(breakdown.hookStrength) * 0.28 +
    clamp(breakdown.engagementPotential) * 0.24 +
    clamp(breakdown.emotionalImpact) * 0.18 +
    clamp(breakdown.pacing) * 0.15 +
    clamp(breakdown.contentQuality) * 0.15;
  return Math.round(Math.max(0, Math.min(100, weighted)));
}

/**
 * Validates and clamps manual clip trim bounds within actual source video duration.
 */
export function validateTrimBounds(
  startTime: number,
  endTime: number,
  videoDuration: number,
  minDuration = 3,
  maxDuration = 90
): { trimStart: number; trimEnd: number; duration: number } {
  const safeVideoDuration = Math.max(minDuration, videoDuration);
  let trimStart = Number.isFinite(startTime) ? Math.max(0, startTime) : 0;
  let trimEnd = Number.isFinite(endTime)
    ? Math.min(safeVideoDuration, endTime)
    : Math.min(safeVideoDuration, trimStart + minDuration);

  if (trimEnd - trimStart < minDuration) {
    if (trimStart + minDuration <= safeVideoDuration) {
      trimEnd = trimStart + minDuration;
    } else {
      trimEnd = safeVideoDuration;
      trimStart = Math.max(0, safeVideoDuration - minDuration);
    }
  }

  if (trimEnd - trimStart > maxDuration) {
    trimEnd = trimStart + maxDuration;
  }

  return {
    trimStart: Number(trimStart.toFixed(2)),
    trimEnd: Number(trimEnd.toFixed(2)),
    duration: Number((trimEnd - trimStart).toFixed(2)),
  };
}

/**
 * Ensures AI-returned timestamps and word timings sit cleanly within [0, videoDuration].
 */
export function clampClipsToDuration(
  clips: Clip[],
  videoDuration: number
): Clip[] {
  const safeDur = Math.max(5, videoDuration);
  return clips.map((clip, idx) => {
    const bounds = validateTrimBounds(clip.startTime, clip.endTime, safeDur, 3, 90);
    const trimBounds = validateTrimBounds(
      clip.trimStart ?? bounds.trimStart,
      clip.trimEnd ?? bounds.trimEnd,
      safeDur,
      3,
      90
    );

    const clampedCaptions = (clip.captions || []).map((seg, sIdx) => {
      const segStart = Math.max(bounds.trimStart, Math.min(bounds.trimEnd - 0.2, seg.start));
      const segEnd = Math.max(segStart + 0.2, Math.min(bounds.trimEnd, seg.end));
      const words = (seg.words || []).map((w, wIdx) => {
        const wStart = Math.max(segStart, Math.min(segEnd - 0.05, w.start));
        const wEnd = Math.max(wStart + 0.05, Math.min(segEnd, w.end));
        return {
          id: w.id || `${clip.id}-s${sIdx}-w${wIdx}`,
          word: w.word,
          start: Number(wStart.toFixed(2)),
          end: Number(wEnd.toFixed(2)),
          important: Boolean(w.important),
        };
      });
      return {
        id: seg.id || `${clip.id}-s${sIdx}`,
        start: Number(segStart.toFixed(2)),
        end: Number(segEnd.toFixed(2)),
        text: seg.text || words.map((w) => w.word).join(' '),
        words,
      };
    });

    return {
      ...clip,
      index: idx + 1,
      startTime: bounds.trimStart,
      endTime: bounds.trimEnd,
      trimStart: trimBounds.trimStart,
      trimEnd: trimBounds.trimEnd,
      faceCenterX: Math.max(0.1, Math.min(0.9, Number.isFinite(clip.faceCenterX) ? clip.faceCenterX : 0.5)),
      captions: clampedCaptions,
    };
  });
}

export function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  const mins = Math.floor(rounded / 60);
  const rem = rounded % 60;
  return rem === 0 ? `${mins}m` : `${mins}m ${rem}s`;
}

export function calculateRemainingMinutes(
  usedSeconds: number,
  limitSeconds: number
): { remainingSeconds: number; remainingMinutes: number; usedPercent: number } {
  const safeLimit = Math.max(1, limitSeconds);
  const safeUsed = Math.max(0, usedSeconds);
  const remainingSeconds = Math.max(0, safeLimit - safeUsed);
  const remainingMinutes = Number((remainingSeconds / 60).toFixed(1));
  const usedPercent = Math.min(100, Math.round((safeUsed / safeLimit) * 100));
  return { remainingSeconds, remainingMinutes, usedPercent };
}

export function parseYouTubeVideoId(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      const id = parsed.pathname.split('/').filter(Boolean)[0];
      return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const vParam = parsed.searchParams.get('v');
      if (vParam && /^[a-zA-Z0-9_-]{11}$/.test(vParam)) return vParam;
      const parts = parsed.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

function formatAssTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped - Math.floor(clamped)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
}

/**
 * Generates an ASS (Advanced SubStation Alpha) subtitle script with animated word-by-word
 * highlighting and platform-safe vertical alignment for 1080x1920 9:16 exports.
 */
export function buildAssSubtitles(
  segments: CaptionSegment[],
  style: CaptionStyle,
  trimStart: number,
  trimEnd: number,
  layout: FramingMode
): string {
  const styleConfigs: Record<
    CaptionStyle,
    { font: string; size: number; primary: string; highlight: string; outline: string; back: string; bold: number; outlineW: number }
  > = {
    hormozi: {
      font: 'DejaVu Sans',
      size: 74,
      primary: '&H00FFFFFF',
      highlight: '&H0000D4FF', // Gold-yellow highlight in BGR
      outline: '&H00000000',
      back: '&H80000000',
      bold: -1,
      outlineW: 6,
    },
    minimal: {
      font: 'DejaVu Sans',
      size: 56,
      primary: '&H00F8FAFC',
      highlight: '&H00F5A58B', // Soft violet-blue BGR
      outline: '&H00101018',
      back: '&H66000000',
      bold: 0,
      outlineW: 3,
    },
    neon: {
      font: 'DejaVu Sans',
      size: 68,
      primary: '&H00FFFFFF',
      highlight: '&H00FF7BF7', // Vibrant magenta-violet BGR
      outline: '&H004F1D7A',
      back: '&H800A0514',
      bold: -1,
      outlineW: 5,
    },
    devanagari: {
      font: 'Noto Sans Devanagari',
      size: 64,
      primary: '&H00FFFFFF',
      highlight: '&H0038BDF8', // Warm amber/cyan BGR
      outline: '&H00000000',
      back: '&H90000000',
      bold: -1,
      outlineW: 4,
    },
  };

  const cfg = styleConfigs[style] || styleConfigs.hormozi;
  // Center seam on split-screen (y ~ 960), lower third on full-screen (marginV 360)
  const alignment = layout === 'split-gameplay' ? 5 : 2;
  const marginV = layout === 'split-gameplay' ? 40 : 380;

  const header = `[Script Info]
Title: ClipReach AI Subtitles
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${cfg.font},${cfg.size},${cfg.primary},${cfg.highlight},${cfg.outline},${cfg.back},${cfg.bold},0,0,0,100,100,0,0,1,${cfg.outlineW},2,${alignment},70,70,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events: string[] = [];

  for (const seg of segments) {
    if (seg.end <= trimStart || seg.start >= trimEnd) continue;
    const words = seg.words && seg.words.length > 0
      ? seg.words
      : seg.text.split(/\s+/).filter(Boolean).map((word, idx, arr) => {
          const span = (seg.end - seg.start) / Math.max(1, arr.length);
          return {
            id: `${seg.id}-w${idx}`,
            word,
            start: seg.start + idx * span,
            end: seg.start + (idx + 1) * span,
            important: false,
          };
        });

    // Emit one event per active word window so the currently spoken word highlights cleanly
    for (let i = 0; i < words.length; i++) {
      const active = words[i];
      if (active.end <= trimStart || active.start >= trimEnd) continue;
      const relStart = Math.max(0, active.start - trimStart);
      const relEnd = Math.max(relStart + 0.08, Math.min(trimEnd - trimStart, active.end - trimStart));

      const lineText = words
        .map((w, wIdx) => {
          const raw = style === 'hormozi' ? w.word.toUpperCase() : w.word;
          const escaped = escapeAssText(raw);
          if (wIdx === i) {
            return `{\\c${cfg.highlight}\\fscx112\\fscy112}${escaped}{\\c${cfg.primary}\\fscx100\\fscy100}`;
          }
          if (w.important) {
            return `{\\c${cfg.highlight}}${escaped}{\\c${cfg.primary}}`;
          }
          return escaped;
        })
        .join(' ');

      events.push(
        `Dialogue: 0,${formatAssTime(relStart)},${formatAssTime(relEnd)},Default,,0,0,0,,${lineText}`
      );
    }
  }

  return `${header}\n${events.join('\n')}\n`;
}

export interface FfmpegFilterOptions {
  sourceWidth: number;
  sourceHeight: number;
  framingMode: FramingMode;
  faceCenterX: number; // 0..1
  autoZoom: boolean;
  transitionEffect: TransitionEffect;
  clipDuration: number;
  hasBackgroundVideo: boolean;
  assSubtitlePath?: string;
}

/**
 * Builds a deterministic FFmpeg -filter_complex pipeline producing 1080x1920 (9:16) output.
 */
export function buildFfmpegFilterGraph(opts: FfmpegFilterOptions): {
  filterComplex: string;
  videoOutputLabel: string;
} {
  const safeW = Math.max(16, opts.sourceWidth || 1280);
  const safeH = Math.max(16, opts.sourceHeight || 720);
  const faceX = Math.max(0.1, Math.min(0.9, opts.faceCenterX ?? 0.5));
  const duration = Math.max(1, opts.clipDuration || 15);

  const fxFilters: string[] = [];
  if (opts.transitionEffect === 'fade') {
    const fadeOutStart = Math.max(0.2, duration - 0.5).toFixed(2);
    fxFilters.push(`fade=t=in:st=0:d=0.35`, `fade=t=out:st=${fadeOutStart}:d=0.45`);
  } else if (opts.transitionEffect === 'vignette') {
    fxFilters.push(`vignette=PI/4`);
  } else if (opts.transitionEffect === 'hook-zoom' || opts.autoZoom) {
    // Subtle dynamic punch-in scale across the first seconds while keeping 1080x1920 geometry
    fxFilters.push(`eq=contrast=1.04:saturation=1.06`);
  }

  const subtitleEscaped = opts.assSubtitlePath
    ? opts.assSubtitlePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
    : null;

  const chains: string[] = [];
  let currentLabel = '[vmain]';

  if (opts.framingMode === 'split-gameplay' && opts.hasBackgroundVideo) {
    // Top 1080x960 cropped main speaker + Bottom 1080x960 looping gameplay video
    chains.push(
      `[0:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960:(iw-1080)*${faceX.toFixed(3)}:(ih-960)/2,setsar=1[vtop]`,
      `[1:v]scale=1080:960:force_original_aspect_ratio=increase,crop=1080:960,setsar=1[vbot]`,
      `[vtop][vbot]vstack=inputs=2[vmain]`
    );
  } else if (opts.framingMode === 'blur-fill') {
    chains.push(
      `[0:v]split=2[vbg_in][vfg_in]`,
      `[vbg_in]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:4[vbg]`,
      `[vfg_in]scale=1080:-2:force_original_aspect_ratio=decrease[vfg]`,
      `[vbg][vfg]overlay=(W-w)/2:(H-h)/2,setsar=1[vmain]`
    );
  } else {
    // auto-face 9:16 smart center-crop
    const targetAspect = 9 / 16;
    const sourceAspect = safeW / safeH;
    const zoomScale = opts.autoZoom ? 1.06 : 1.0;
    if (sourceAspect > targetAspect) {
      chains.push(
        `[0:v]scale=-2:${Math.round(1920 * zoomScale)},crop=1080:1920:(iw-1080)*${faceX.toFixed(3)}:(ih-1920)/2,setsar=1[vmain]`
      );
    } else {
      chains.push(
        `[0:v]scale=${Math.round(1080 * zoomScale)}:-2,crop=1080:1920:(iw-1080)*${faceX.toFixed(3)}:(ih-1920)/2,setsar=1[vmain]`
      );
    }
  }

  if (fxFilters.length > 0) {
    chains.push(`${currentLabel}${fxFilters.join(',')}[vfx]`);
    currentLabel = '[vfx]';
  }

  if (subtitleEscaped) {
    chains.push(`${currentLabel}ass='${subtitleEscaped}'[vsub]`);
    currentLabel = '[vsub]';
  }

  chains.push(`${currentLabel}format=yuv420p[vout]`);

  return {
    filterComplex: chains.join(';'),
    videoOutputLabel: '[vout]',
  };
}
