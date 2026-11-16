import fs from 'fs';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  calculateCompositeViralScore,
  clampClipsToDuration,
  type CaptionLanguage,
  type CaptionSegment,
  type Clip,
} from '../src/lib/clipLogic.ts';

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please ensure an API key is attached in Settings > Secrets.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withRetries<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes('API_KEY_INVALID') ||
        msg.includes('PERMISSION_DENIED') ||
        msg.includes('403') ||
        msg.includes('400')
      ) {
        throw err;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 800 * Math.pow(2, attempt - 1)));
      }
    }
  }
  throw lastError;
}

export interface AIAnalysisResult {
  fullTranscript: string;
  durationSeconds?: number;
  clips: Clip[];
}

interface RawGeminiClipResponse {
  fullTranscript: string;
  detectedLanguage: 'en' | 'hi';
  estimatedDurationSeconds?: number;
  clips: Array<{
    title: string;
    hook: string;
    reasoning: string;
    language: 'en' | 'hi';
    startTime: number;
    endTime: number;
    faceCenterX: number;
    viralScore: {
      hookStrength: number;
      engagementPotential: number;
      emotionalImpact: number;
      pacing: number;
      contentQuality: number;
    };
    captions: Array<{
      start: number;
      end: number;
      text: string;
      importantWords: string[];
    }>;
  }>;
}

const CLIP_ANALYSIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    fullTranscript: { type: Type.STRING },
    detectedLanguage: { type: Type.STRING },
    estimatedDurationSeconds: { type: Type.NUMBER },
    clips: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          hook: { type: Type.STRING },
          reasoning: { type: Type.STRING },
          language: { type: Type.STRING },
          startTime: { type: Type.NUMBER },
          endTime: { type: Type.NUMBER },
          faceCenterX: { type: Type.NUMBER },
          viralScore: {
            type: Type.OBJECT,
            properties: {
              hookStrength: { type: Type.NUMBER },
              engagementPotential: { type: Type.NUMBER },
              emotionalImpact: { type: Type.NUMBER },
              pacing: { type: Type.NUMBER },
              contentQuality: { type: Type.NUMBER },
            },
            required: [
              'hookStrength',
              'engagementPotential',
              'emotionalImpact',
              'pacing',
              'contentQuality',
            ],
          },
          captions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                start: { type: Type.NUMBER },
                end: { type: Type.NUMBER },
                text: { type: Type.STRING },
                importantWords: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: ['start', 'end', 'text', 'importantWords'],
            },
          },
        },
        required: [
          'title',
          'hook',
          'reasoning',
          'language',
          'startTime',
          'endTime',
          'faceCenterX',
          'viralScore',
          'captions',
        ],
      },
    },
  },
  required: ['fullTranscript', 'detectedLanguage', 'clips'],
};

function mapGeminiClipsResponse(
  parsed: RawGeminiClipResponse,
  durationSeconds: number,
  requestedLang: CaptionLanguage
): AIAnalysisResult {
  if (!Array.isArray(parsed.clips) || parsed.clips.length === 0) {
    throw new Error('AI analysis could not detect spoken clips in this video.');
  }

  const effectiveDuration = Math.max(
    durationSeconds || 0,
    parsed.estimatedDurationSeconds || 0,
    ...parsed.clips.map((c) => c.endTime || 0),
    15
  );

  const mappedClips: Clip[] = parsed.clips.slice(0, 15).map((raw, idx) => {
    const lang: 'en' | 'hi' =
      raw.language === 'hi' || parsed.detectedLanguage === 'hi' || requestedLang === 'hi'
        ? 'hi'
        : 'en';

    const overall = calculateCompositeViralScore(raw.viralScore);

    const segments: CaptionSegment[] = (raw.captions || []).map((cap, sIdx) => {
      const wordsRaw = cap.text.trim().split(/\s+/).filter(Boolean);
      const importantSet = new Set(
        (cap.importantWords || []).map((w) =>
          w.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/gi, '')
        )
      );
      const span = Math.max(0.2, cap.end - cap.start);
      const perWord = span / Math.max(1, wordsRaw.length);

      return {
        id: `c${idx + 1}-s${sIdx + 1}`,
        start: cap.start,
        end: cap.end,
        text: cap.text.trim(),
        words: wordsRaw.map((word, wIdx) => {
          const clean = word.toLowerCase().replace(/[^a-z0-9\u0900-\u097f]/gi, '');
          return {
            id: `c${idx + 1}-s${sIdx + 1}-w${wIdx + 1}`,
            word,
            start: Number((cap.start + wIdx * perWord).toFixed(2)),
            end: Number((cap.start + (wIdx + 1) * perWord).toFixed(2)),
            important: importantSet.has(clean),
          };
        }),
      };
    });

    return {
      id: `clip_${idx + 1}_${Date.now().toString(36)}`,
      index: idx + 1,
      title: raw.title || `Viral Highlight #${idx + 1}`,
      hook: raw.hook || '',
      reasoning: raw.reasoning || 'Strong conversational pacing and clear opener.',
      language: lang,
      startTime: raw.startTime,
      endTime: raw.endTime,
      trimStart: raw.startTime,
      trimEnd: raw.endTime,
      viralScore: {
        overall,
        hookStrength: Math.round(raw.viralScore.hookStrength),
        engagementPotential: Math.round(raw.viralScore.engagementPotential),
        emotionalImpact: Math.round(raw.viralScore.emotionalImpact),
        pacing: Math.round(raw.viralScore.pacing),
        contentQuality: Math.round(raw.viralScore.contentQuality),
      },
      captionStyle: lang === 'hi' ? 'devanagari' : 'hormozi',
      captions: segments,
      framingMode: 'auto-face',
      faceCenterX: Number.isFinite(raw.faceCenterX) ? raw.faceCenterX : 0.5,
      autoZoom: true,
      backgroundVideoId: 'none',
      transitionEffect: 'hook-zoom',
      exportFormat: idx % 3 === 0 ? 'reels' : idx % 3 === 1 ? 'shorts' : 'tiktok',
    };
  });

  mappedClips.sort((a, b) => b.viralScore.overall - a.viralScore.overall);
  const clamped = clampClipsToDuration(mappedClips, effectiveDuration);

  return {
    fullTranscript: parsed.fullTranscript || '',
    durationSeconds: effectiveDuration,
    clips: clamped,
  };
}

/**
 * Analyzes real audio + keyframe strip from the uploaded video using Gemini.
 */
export async function analyzeVideoWithGemini(params: {
  audioMp3Path: string;
  keyframes: Array<{ timestamp: number; path: string }>;
  durationSeconds: number;
  targetClipDuration: 15 | 30 | 45 | 60;
  requestedClipCount: number;
  language: CaptionLanguage;
}): Promise<AIAnalysisResult> {
  const ai = getGeminiClient();

  const audioBuffer = fs.readFileSync(params.audioMp3Path);
  const audioPart = {
    inlineData: {
      mimeType: 'audio/mp3',
      data: audioBuffer.toString('base64'),
    },
  };

  const imageParts = params.keyframes.slice(0, 6).map((kf) => ({
    inlineData: {
      mimeType: 'image/jpeg',
      data: fs.readFileSync(kf.path).toString('base64'),
    },
  }));

  const safeCount = Math.max(5, Math.min(15, params.requestedClipCount));
  const effectiveClipDur = Math.min(
    params.targetClipDuration,
    Math.max(6, Math.floor(params.durationSeconds * 0.75))
  );

  const langDirective =
    params.language === 'hi'
      ? 'Transcribe and write captions in Hindi (Devanagari script or natural Hindi as spoken).'
      : params.language === 'en'
      ? 'Transcribe and write captions in English.'
      : 'Auto-detect the spoken language (English or Hindi) and transcribe in that exact language.';

  const prompt = `You are an expert viral short-form video editor and retention analyst.
Analyze the attached audio track (total duration: ${params.durationSeconds.toFixed(1)} seconds) and the ${imageParts.length} sampled video frames.

Tasks:
1. Produce an accurate full transcript of what is actually spoken in the audio. ${langDirective}
2. Identify ${safeCount} high-retention viral short clips from the video.
   - Each clip MUST have startTime and endTime strictly between 0 and ${params.durationSeconds.toFixed(1)} seconds.
   - Aim for each clip to be roughly ${effectiveClipDur} seconds long (between 6 and ${params.targetClipDuration} seconds depending on natural sentence boundaries). If the source video is short (e.g. under 90s), create ${safeCount} distinct or overlapping high-hook highlights focusing on different takeaways/openers/climaxes within the video bounds.
   - Focus on powerful hooks, emotional peaks, contrarian claims, and engaging conversations.
3. For each clip, estimate faceCenterX (0.15 to 0.85) representing the horizontal center of the primary speaker/subject visible in the sampled frames (0.5 is dead center).
4. For each clip, provide time-aligned caption segments (2 to 5 words per segment) covering the spoken words inside [startTime, endTime], and list the 1-3 most impactful/power words per segment in importantWords.
5. Score each clip from 0 to 100 across: hookStrength, engagementPotential, emotionalImpact, pacing, contentQuality.

Return ONLY valid JSON matching the schema.`;

  const response = await withRetries(async () => {
    return ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [audioPart, ...imageParts, { text: prompt }],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: CLIP_ANALYSIS_SCHEMA,
      },
    });
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty analysis response.');
  }

  const parsed = JSON.parse(text) as RawGeminiClipResponse;
  return mapGeminiClipsResponse(parsed, params.durationSeconds, params.language);
}

/**
 * Analyzes a public YouTube URL directly via Gemini multimodal YouTube fileData support,
 * used when direct MP4 stream download is blocked by YouTube bot-check from cloud IPs.
 */
export async function analyzeYouTubeUrlWithGemini(params: {
  youtubeUrl: string;
  videoTitle: string;
  targetClipDuration: 15 | 30 | 45 | 60;
  requestedClipCount: number;
  language: CaptionLanguage;
}): Promise<AIAnalysisResult> {
  const ai = getGeminiClient();
  const safeCount = Math.max(5, Math.min(15, params.requestedClipCount));

  const langDirective =
    params.language === 'hi'
      ? 'Transcribe and write captions in Hindi (Devanagari script or natural Hindi as spoken).'
      : params.language === 'en'
      ? 'Transcribe and write captions in English.'
      : 'Auto-detect the spoken language (English or Hindi) and transcribe in that exact language.';

  const prompt = `You are an expert viral short-form video editor and retention analyst.
Watch and listen to the attached YouTube video ("${params.videoTitle}").

Tasks:
1. Report the video's total duration in seconds as estimatedDurationSeconds.
2. Produce an accurate full transcript of what is actually spoken in the video. ${langDirective}
3. Identify ${safeCount} high-retention viral short clips from the video.
   - Each clip MUST have valid startTime and endTime strictly within [0, estimatedDurationSeconds].
   - Target roughly ${params.targetClipDuration} seconds per clip (or shorter segments if the total video is under ${params.targetClipDuration} seconds, ensuring at least 5 seconds per clip and creating ${safeCount} highlights across the key moments if the video is short).
   - Focus on powerful hooks, emotional moments, contrarian takes, and engaging dialogue.
4. Estimate faceCenterX (0.15 to 0.85) for where the main speaker/subject sits horizontally in the frame.
5. Provide time-aligned caption segments (2 to 5 words per segment) for each clip with importantWords highlighted.
6. Score each clip 0-100 across hookStrength, engagementPotential, emotionalImpact, pacing, and contentQuality.

Return ONLY valid JSON matching the schema.`;

  const response = await withRetries(async () => {
    return ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: {
        parts: [
          {
            fileData: {
              fileUri: params.youtubeUrl,
            },
          },
          { text: prompt },
        ],
      },
      config: {
        thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
        responseMimeType: 'application/json',
        responseSchema: CLIP_ANALYSIS_SCHEMA,
      },
    });
  });

  const text = (response.text ?? '').trim();
  if (!text) {
    throw new Error('Gemini returned an empty analysis response for this YouTube video.');
  }

  const parsed = JSON.parse(text) as RawGeminiClipResponse;
  return mapGeminiClipsResponse(
    parsed,
    parsed.estimatedDurationSeconds || 0,
    params.language
  );
}
