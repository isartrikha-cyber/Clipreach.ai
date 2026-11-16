import 'dotenv/config';
import { createRequire } from 'module';
import type { Archiver, ArchiverOptions } from 'archiver';
import { Quality, Ytdl, YtdlError, YtdlErrorCode, type FormatMetadata, type VideoInfo } from '@distube/ytdl-core';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { createServer as createViteServer } from 'vite';

const require = createRequire(import.meta.url);
const createArchiver = require('archiver') as (
  format: 'zip' | 'tar',
  options?: ArchiverOptions
) => Archiver;
const ytdl = new Ytdl();
import { analyzeVideoWithGemini, analyzeYouTubeUrlWithGemini } from './server/ai.ts';
import {
  addUsedQuotaSeconds,
  deleteProjectFromDb,
  getProjectById,
  mutateDb,
  readDb,
  updateClipInDb,
  updateProjectFields,
  upsertProject,
} from './server/db.ts';
import {
  AUDIO_DIR,
  createRealSampleVideo,
  ensureBackgroundGameplayAssets,
  ensureMediaDirectories,
  EXPORTS_DIR,
  extractAudioForAI,
  extractSampleFrames,
  extractThumbnail,
  getBackgroundVideoPath,
  probeVideo,
  renderClipMp4,
  THUMBS_DIR,
  UPLOADS_DIR,
} from './server/media.ts';
import {
  BACKGROUND_VIDEOS,
  calculateRemainingMinutes,
  parseYouTubeVideoId,
  validateTrimBounds,
  type BackgroundVideoId,
  type CaptionLanguage,
  type Clip,
  type Project,
} from './src/lib/clipLogic.ts';

ensureMediaDirectories();

const app = express();
app.use(express.json({ limit: '10mb' }));

const ALLOWED_VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureMediaDirectories();
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB limit
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_VIDEO_EXTS.has(ext)) {
      cb(new Error('Unsupported file format. Please upload an MP4, MOV, or WebM video.'));
      return;
    }
    cb(null, true);
  },
});

function streamVideoWithRanges(req: Request, res: Response, filePath: string, mimeType = 'video/mp4') {
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Video file not found on disk.' });
    return;
  }
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath).pipe(res);
  }
}

function getMimeTypeForVideo(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mov') return 'video/quicktime';
  return 'video/mp4';
}

async function processProjectPipeline(projectId: string): Promise<void> {
  const project = getProjectById(projectId);
  if (!project) return;

  try {
    await updateProjectFields(projectId, {
      status: 'probing',
      progressPercent: 18,
      statusMessage: 'Inspecting video stream & extracting audio...',
    });

    const probe = await probeVideo(project.videoPath);
    if (probe.durationSeconds < 5) {
      throw new Error('Video is too short (under 5 seconds). Please upload a longer video.');
    }

    const db = readDb();
    const quota = calculateRemainingMinutes(db.quota.usedSeconds, db.quota.limitSeconds);
    if (probe.durationSeconds > quota.remainingSeconds + 5) {
      throw new Error(
        `Free usage limit reached (${quota.remainingMinutes} min remaining, video is ${(
          probe.durationSeconds / 60
        ).toFixed(1)} min). Delete or manage usage before processing longer clips.`
      );
    }

    const thumbPath = path.join(THUMBS_DIR, `${projectId}.jpg`);
    await extractThumbnail(project.videoPath, Math.min(2, probe.durationSeconds * 0.2), thumbPath);

    if (!probe.hasAudio) {
      throw new Error(
        'This video has no audio track for AI speech transcription. Please upload a video with spoken audio.'
      );
    }

    const audioPath = path.join(AUDIO_DIR, `${projectId}.mp3`);
    await extractAudioForAI(project.videoPath, audioPath);

    await updateProjectFields(projectId, {
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      thumbnailPath: thumbPath,
      status: 'transcribing',
      progressPercent: 45,
      statusMessage: 'Transcribing speech & extracting speaker keyframes...',
    });

    const keyframes = await extractSampleFrames(
      project.videoPath,
      probe.durationSeconds,
      5,
      projectId
    );

    await updateProjectFields(projectId, {
      status: 'analyzing',
      progressPercent: 72,
      statusMessage: 'Detecting viral hooks, pacing & scoring clips with AI...',
    });

    const aiResult = await analyzeVideoWithGemini({
      audioMp3Path: audioPath,
      keyframes,
      durationSeconds: probe.durationSeconds,
      targetClipDuration: project.targetClipDuration,
      requestedClipCount: project.requestedClipCount,
      language: project.language,
    });

    await addUsedQuotaSeconds(probe.durationSeconds);

    await updateProjectFields(projectId, {
      status: 'ready',
      progressPercent: 100,
      statusMessage: `Generated ${aiResult.clips.length} viral clips ready for editing.`,
      fullTranscript: aiResult.fullTranscript,
      clips: aiResult.clips,
      errorMessage: undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unexpected processing error.';
    await updateProjectFields(projectId, {
      status: 'error',
      progressPercent: 0,
      statusMessage: 'Processing failed',
      errorMessage: message,
    });
  }
}

// --- API Routes ---

app.get('/api/dashboard', (_req: Request, res: Response) => {
  const db = readDb();
  const readyProjects = db.projects.filter((p) => p.status === 'ready');
  const totalClipsGenerated = readyProjects.reduce((acc, p) => acc + p.clips.length, 0);
  const allScores = readyProjects.flatMap((p) => p.clips.map((c) => c.viralScore.overall));
  const avgViralScore =
    allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : 0;
  const quotaCalc = calculateRemainingMinutes(db.quota.usedSeconds, db.quota.limitSeconds);

  res.json({
    quota: db.quota,
    stats: {
      totalVideosProcessed: readyProjects.length,
      totalClipsGenerated,
      avgViralScore,
      remainingMinutes: quotaCalc.remainingMinutes,
    },
    projects: db.projects,
    backgrounds: BACKGROUND_VIDEOS,
  });
});

app.patch('/api/workspace/profile', async (req: Request, res: Response) => {
  const { userName, userEmail } = req.body as { userName?: string; userEmail?: string };
  if (!userName || !userName.trim()) {
    res.status(400).json({ error: 'Display name cannot be empty.' });
    return;
  }
  const quota = await mutateDb((state) => {
    state.quota.userName = userName.trim().slice(0, 60);
    if (userEmail && userEmail.trim()) {
      state.quota.userEmail = userEmail.trim().slice(0, 100);
    }
    return state.quota;
  });
  res.json({ quota });
});

app.post('/api/projects/upload', (req: Request, res: Response) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Video upload failed.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Please select a video file (MP4, MOV, or WebM).' });
      return;
    }

    const db = readDb();
    const quota = calculateRemainingMinutes(db.quota.usedSeconds, db.quota.limitSeconds);
    if (quota.remainingSeconds <= 5) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({
        error: 'Free usage limit (60 minutes) exhausted. Delete unused quota or contact support.',
      });
      return;
    }

    const rawDuration = Number(req.body.targetClipDuration || 30);
    const targetClipDuration: 15 | 30 | 45 | 60 =
      rawDuration === 15 || rawDuration === 30 || rawDuration === 45 || rawDuration === 60
        ? rawDuration
        : 30;
    const requestedClipCount = Math.max(
      5,
      Math.min(15, Number(req.body.requestedClipCount || 6))
    );
    const language: CaptionLanguage =
      req.body.language === 'hi' || req.body.language === 'en' ? req.body.language : 'auto';
    const title =
      (req.body.title as string)?.trim() ||
      path.basename(req.file.originalname, path.extname(req.file.originalname));

    const projectId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const project: Project = {
      id: projectId,
      title,
      sourceType: 'upload',
      originalFilename: req.file.originalname,
      videoPath: req.file.path,
      durationSeconds: 0,
      width: 1280,
      height: 720,
      fps: 30,
      targetClipDuration,
      requestedClipCount,
      language,
      status: 'probing',
      progressPercent: 10,
      statusMessage: 'Upload complete. Preparing video pipeline...',
      fullTranscript: '',
      clips: [],
      createdAt: now,
      updatedAt: now,
    };

    await upsertProject(project);
    void processProjectPipeline(projectId);
    res.status(201).json({ project });
  });
});

app.post('/api/projects/youtube', async (req: Request, res: Response) => {
  try {
    const { url, targetClipDuration = 30, requestedClipCount = 6, language = 'auto' } = req.body as {
      url?: string;
      targetClipDuration?: number;
      requestedClipCount?: number;
      language?: CaptionLanguage;
    };

    const trimmedUrl = (url || '').trim();
    if (!trimmedUrl) {
      res.status(400).json({ error: 'Please paste a YouTube link or direct video URL.' });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(trimmedUrl);
    } catch {
      res.status(400).json({ error: 'Please paste a valid URL starting with https:// or http://.' });
      return;
    }

    const db = readDb();
    const quota = calculateRemainingMinutes(db.quota.usedSeconds, db.quota.limitSeconds);
    if (quota.remainingSeconds <= 5) {
      res.status(403).json({
        error: 'Free usage limit (60 minutes) exhausted.',
      });
      return;
    }

    const dur: 15 | 30 | 45 | 60 =
      targetClipDuration === 15 ||
      targetClipDuration === 30 ||
      targetClipDuration === 45 ||
      targetClipDuration === 60
        ? targetClipDuration
        : 30;
    const clipCount = Math.max(5, Math.min(15, Number(requestedClipCount || 6)));
    const lang: CaptionLanguage = language === 'hi' || language === 'en' ? language : 'auto';
    const projectId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();

    const videoId = parseYouTubeVideoId(trimmedUrl);

    // Branch 1: Direct MP4 / MOV / WebM URL
    if (!videoId) {
      const ext = path.extname(parsedUrl.pathname).toLowerCase();
      const safeExt = ALLOWED_VIDEO_EXTS.has(ext) ? ext : '.mp4';
      const outPath = path.join(UPLOADS_DIR, `${projectId}${safeExt}`);
      const project: Project = {
        id: projectId,
        title: path.basename(parsedUrl.pathname, ext) || 'Imported Video Link',
        sourceType: 'youtube',
        sourceUrl: trimmedUrl,
        streamMode: 'local-mp4',
        originalFilename: `link_import${safeExt}`,
        videoPath: outPath,
        durationSeconds: 0,
        width: 1280,
        height: 720,
        fps: 30,
        targetClipDuration: dur,
        requestedClipCount: clipCount,
        language: lang,
        status: 'uploading',
        progressPercent: 12,
        statusMessage: 'Downloading video from direct URL...',
        fullTranscript: '',
        clips: [],
        createdAt: now,
        updatedAt: now,
      };

      await upsertProject(project);
      res.status(201).json({ project });

      void (async () => {
        try {
          const resp = await fetch(trimmedUrl);
          if (!resp.ok || !resp.body) {
            throw new Error(`Remote server returned HTTP ${resp.status}.`);
          }
          const cType = resp.headers.get('content-type') || '';
          if (cType && !cType.includes('video/') && !cType.includes('octet-stream')) {
            throw new Error(
              `URL returned "${cType}" instead of a video file. Paste a YouTube link or direct .mp4/.mov/.webm URL.`
            );
          }
          const buf = Buffer.from(await resp.arrayBuffer());
          fs.writeFileSync(outPath, buf);
          await processProjectPipeline(projectId);
        } catch (dlErr: unknown) {
          const msg = dlErr instanceof Error ? dlErr.message : 'Direct URL download failed.';
          await updateProjectFields(projectId, {
            status: 'error',
            progressPercent: 0,
            statusMessage: 'Link import failed',
            errorMessage: msg,
          });
        }
      })();
      return;
    }

    // Branch 2: YouTube URL (watch, youtu.be, shorts)
    const canonicalYoutubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let ytTitle = `YouTube Video (${videoId})`;
    let thumbUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalYoutubeUrl)}&format=json`
      );
      if (oembedRes.ok) {
        const meta = (await oembedRes.json()) as { title?: string; thumbnail_url?: string };
        if (meta.title) ytTitle = meta.title;
        if (meta.thumbnail_url) thumbUrl = meta.thumbnail_url;
      } else if (oembedRes.status === 404 || oembedRes.status === 401) {
        res.status(422).json({
          error: 'This YouTube video is private, unlisted, or does not exist.',
        });
        return;
      }
    } catch {
      // Proceed with fallback title/thumbnail
    }

    const thumbPath = path.join(THUMBS_DIR, `${projectId}.jpg`);
    try {
      const tRes = await fetch(thumbUrl);
      if (tRes.ok) {
        fs.writeFileSync(thumbPath, Buffer.from(await tRes.arrayBuffer()));
      }
    } catch {
      // Optional thumbnail download
    }

    const outPath = path.join(UPLOADS_DIR, `${projectId}.mp4`);
    const project: Project = {
      id: projectId,
      title: ytTitle,
      sourceType: 'youtube',
      sourceUrl: canonicalYoutubeUrl,
      youtubeVideoId: videoId,
      streamMode: 'local-mp4',
      originalFilename: `${videoId}.mp4`,
      videoPath: outPath,
      thumbnailPath: fs.existsSync(thumbPath) ? thumbPath : undefined,
      durationSeconds: 0,
      width: 1280,
      height: 720,
      fps: 30,
      targetClipDuration: dur,
      requestedClipCount: clipCount,
      language: lang,
      status: 'uploading',
      progressPercent: 14,
      statusMessage: 'Connecting to YouTube video...',
      fullTranscript: '',
      clips: [],
      createdAt: now,
      updatedAt: now,
    };

    await upsertProject(project);
    res.status(201).json({ project });

    void (async () => {
      try {
        // First attempt direct stream download via ytdl-core
        let streamDownloaded = false;
        try {
          const info = await ytdl.getInfo(canonicalYoutubeUrl);
          const lengthSec = Number(info.videoDetails.lengthSeconds || 0);
          if (lengthSec > quota.remainingSeconds + 5) {
            throw new Error(
              `QUOTA_EXCEEDED:This YouTube video is ${(lengthSec / 60).toFixed(1)} min, exceeding your ${quota.remainingMinutes} free min remaining.`
            );
          }
          await updateProjectFields(projectId, {
            title: info.videoDetails.title || ytTitle,
            durationSeconds: lengthSec,
            progressPercent: 22,
            statusMessage: 'Downloading YouTube MP4 stream...',
          });

          await new Promise<void>((resolve, reject) => {
            const stream = ytdl.download(info, {
              quality: Quality.Highest,
              filter: (format: FormatMetadata) =>
                format.hasVideo && format.hasAudio && format.container === 'mp4',
            });
            const fileWrite = fs.createWriteStream(outPath);
            stream.on('error', reject);
            fileWrite.on('error', reject);
            fileWrite.on('finish', resolve);
            stream.pipe(fileWrite);
          });
          streamDownloaded = true;
        } catch (ytErr: unknown) {
          const rawMsg = ytErr instanceof Error ? ytErr.message : String(ytErr);
          if (rawMsg.startsWith('QUOTA_EXCEEDED:')) {
            throw new Error(rawMsg.replace('QUOTA_EXCEEDED:', ''));
          }
          if (YtdlError.is(ytErr, YtdlErrorCode.PRIVATE) || YtdlError.is(ytErr, YtdlErrorCode.NOT_FOUND)) {
            throw new Error('This YouTube video is private or unavailable.');
          }
          // Fall back to Gemini direct YouTube URL multimodal analysis when YouTube blocks cloud IP stream downloads
          streamDownloaded = false;
        }

        if (streamDownloaded) {
          await processProjectPipeline(projectId);
          return;
        }

        await updateProjectFields(projectId, {
          streamMode: 'youtube-embed',
          videoPath: '',
          status: 'analyzing',
          progressPercent: 55,
          statusMessage: 'Analyzing YouTube video directly with Gemini AI...',
        });

        const aiResult = await analyzeYouTubeUrlWithGemini({
          youtubeUrl: canonicalYoutubeUrl,
          videoTitle: ytTitle,
          targetClipDuration: dur,
          requestedClipCount: clipCount,
          language: lang,
        });

        const estDuration = aiResult.durationSeconds || 30;
        const latestDb = readDb();
        const latestQuota = calculateRemainingMinutes(
          latestDb.quota.usedSeconds,
          latestDb.quota.limitSeconds
        );
        if (estDuration > latestQuota.remainingSeconds + 5) {
          throw new Error(
            `This YouTube video is ${(estDuration / 60).toFixed(1)} min, exceeding your ${latestQuota.remainingMinutes} free min remaining.`
          );
        }

        await addUsedQuotaSeconds(estDuration);
        await updateProjectFields(projectId, {
          streamMode: 'youtube-embed',
          videoPath: '',
          durationSeconds: estDuration,
          status: 'ready',
          progressPercent: 100,
          statusMessage: `Generated ${aiResult.clips.length} viral clips from YouTube link.`,
          fullTranscript: aiResult.fullTranscript,
          clips: aiResult.clips,
          errorMessage: undefined,
        });
      } catch (err: unknown) {
        let msg = err instanceof Error ? err.message : 'YouTube link processing failed.';
        try {
          if (msg.trim().startsWith('{')) {
            const parsedErr = JSON.parse(msg) as { error?: { message?: string } };
            if (parsedErr?.error?.message) msg = parsedErr.error.message;
          }
        } catch {
          // Keep original message
        }
        if (/age.?restrict|sign in|login_required/i.test(msg)) {
          msg =
            'This YouTube video is age-restricted or requires sign-in. Try a public non-restricted YouTube link or upload the MP4 directly.';
        }
        await updateProjectFields(projectId, {
          status: 'error',
          progressPercent: 0,
          statusMessage: 'YouTube link processing failed',
          errorMessage: msg,
        });
      }
    })();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid YouTube request.';
    res.status(500).json({ error: msg });
  }
});

app.post('/api/projects/:id/attach-video', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const existing = getProjectById(projectId);
  if (!existing) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }

  upload.single('video')(req, res, async (err) => {
    if (err) {
      res.status(400).json({ error: err.message || 'Failed to upload video file.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'Please select an MP4, MOV, or WebM file to attach.' });
      return;
    }
    try {
      const probe = await probeVideo(req.file.path);
      const updated = await updateProjectFields(projectId, {
        videoPath: req.file.path,
        streamMode: 'local-mp4',
        durationSeconds: probe.durationSeconds,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
      });
      res.json({ project: updated });
    } catch (probeErr: unknown) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(400).json({
        error: probeErr instanceof Error ? probeErr.message : 'Invalid video file.',
      });
    }
  });
});

app.post('/api/projects/sample', async (req: Request, res: Response) => {
  try {
    const db = readDb();
    const quota = calculateRemainingMinutes(db.quota.usedSeconds, db.quota.limitSeconds);
    if (quota.remainingSeconds < 30) {
      res.status(403).json({
        error: 'Insufficient free minutes remaining to process the sample video.',
      });
      return;
    }

    const { targetClipDuration = 15, requestedClipCount = 5, language = 'en' } = req.body as {
      targetClipDuration?: number;
      requestedClipCount?: number;
      language?: CaptionLanguage;
    };

    const projectId = `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sampleMp4Path = path.join(UPLOADS_DIR, `${projectId}_sample.mp4`);

    const dur: 15 | 30 | 45 | 60 =
      targetClipDuration === 15 ||
      targetClipDuration === 30 ||
      targetClipDuration === 45 ||
      targetClipDuration === 60
        ? targetClipDuration
        : 15;

    const now = new Date().toISOString();
    const project: Project = {
      id: projectId,
      title: 'Creator Retention Podcast — First 2 Seconds Hook',
      sourceType: 'sample',
      originalFilename: 'creator_retention_podcast.mp4',
      videoPath: sampleMp4Path,
      durationSeconds: 0,
      width: 1280,
      height: 720,
      fps: 30,
      targetClipDuration: dur,
      requestedClipCount: Math.max(5, Math.min(15, Number(requestedClipCount || 5))),
      language: language === 'hi' || language === 'en' ? language : 'en',
      status: 'uploading',
      progressPercent: 8,
      statusMessage: 'Synthesizing real studio podcast MP4...',
      fullTranscript: '',
      clips: [],
      createdAt: now,
      updatedAt: now,
    };

    await upsertProject(project);
    res.status(201).json({ project });

    void (async () => {
      try {
        await createRealSampleVideo(sampleMp4Path);
        await processProjectPipeline(projectId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Failed to create sample video.';
        await updateProjectFields(projectId, {
          status: 'error',
          progressPercent: 0,
          statusMessage: 'Sample creation failed',
          errorMessage: msg,
        });
      }
    })();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to start sample project.';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/projects/:id', (req: Request, res: Response) => {
  const project = getProjectById(String(req.params.id));
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  res.json({ project });
});

app.delete('/api/projects/:id', async (req: Request, res: Response) => {
  const removed = await deleteProjectFromDb(String(req.params.id));
  if (!removed) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  // Clean up media files
  for (const p of [removed.videoPath, removed.thumbnailPath]) {
    if (p && fs.existsSync(p)) {
      try {
        fs.unlinkSync(p);
      } catch {
        // Ignore cleanup failure
      }
    }
  }
  for (const c of removed.clips) {
    if (c.exportedPath && fs.existsSync(c.exportedPath)) {
      try {
        fs.unlinkSync(c.exportedPath);
      } catch {
        // Ignore
      }
    }
  }
  res.json({ deleted: true, id: removed.id });
});

app.patch('/api/projects/:id/clips/:clipId', async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const clipId = String(req.params.clipId);
  const project = getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const existing = project.clips.find((c) => c.id === clipId);
  if (!existing) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }

  const body = req.body as Partial<Clip>;
  const patch: Partial<Clip> = {
    exportedPath: undefined, // Invalidate cached export on edit
    exportedAt: undefined,
  };

  if (Array.isArray(body.captions)) patch.captions = body.captions;
  if (body.captionStyle) patch.captionStyle = body.captionStyle;
  if (body.framingMode) patch.framingMode = body.framingMode;
  if (typeof body.faceCenterX === 'number') {
    patch.faceCenterX = Math.max(0.1, Math.min(0.9, body.faceCenterX));
  }
  if (typeof body.autoZoom === 'boolean') patch.autoZoom = body.autoZoom;
  if (body.backgroundVideoId) patch.backgroundVideoId = body.backgroundVideoId;
  if (body.transitionEffect) patch.transitionEffect = body.transitionEffect;
  if (body.exportFormat) patch.exportFormat = body.exportFormat;
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();

  if (typeof body.trimStart === 'number' || typeof body.trimEnd === 'number') {
    const validated = validateTrimBounds(
      body.trimStart ?? existing.trimStart,
      body.trimEnd ?? existing.trimEnd,
      project.durationSeconds
    );
    patch.trimStart = validated.trimStart;
    patch.trimEnd = validated.trimEnd;
  }

  const updated = await updateClipInDb(projectId, clipId, patch);
  res.json({ clip: updated });
});

app.post('/api/projects/:id/clips/:clipId/export', async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const clipId = String(req.params.clipId);
  const project = getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }

  if (!project.videoPath || !fs.existsSync(project.videoPath)) {
    res.status(400).json({
      error:
        'YouTube blocked server-side MP4 stream download for this video. Attach a local MP4/MOV/WebM file in the Export tab to render 1080p MP4s.',
    });
    return;
  }

  try {
    const outFile = path.join(EXPORTS_DIR, `${project.id}_${clip.id}_1080p.mp4`);
    await renderClipMp4(project, clip, outFile);
    const stat = fs.statSync(outFile);
    await updateClipInDb(project.id, clip.id, {
      exportedPath: outFile,
      exportedAt: new Date().toISOString(),
    });
    res.json({
      downloadUrl: `/api/projects/${project.id}/clips/${clip.id}/download`,
      fileSizeBytes: stat.size,
      resolution: '1080x1920',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'FFmpeg rendering failed.';
    res.status(500).json({ error: `1080p export failed: ${msg}` });
  }
});

app.get('/api/projects/:id/clips/:clipId/download', async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const clipId = String(req.params.clipId);
  const project = getProjectById(projectId);
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  const clip = project.clips.find((c) => c.id === clipId);
  if (!clip) {
    res.status(404).json({ error: 'Clip not found.' });
    return;
  }
  if (!project.videoPath || !fs.existsSync(project.videoPath)) {
    res.status(400).json({
      error: 'Attach a local MP4/MOV/WebM file to this YouTube project to render 1080p downloads.',
    });
    return;
  }

  try {
    let outFile = clip.exportedPath;
    if (!outFile || !fs.existsSync(outFile)) {
      outFile = path.join(EXPORTS_DIR, `${project.id}_${clip.id}_1080p.mp4`);
      await renderClipMp4(project, clip, outFile);
      await updateClipInDb(project.id, clip.id, {
        exportedPath: outFile,
        exportedAt: new Date().toISOString(),
      });
    }
    const safeName = clip.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 40);
    res.download(outFile, `${safeName || 'clip'}_${clip.exportFormat}_1080p.mp4`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Export failed.';
    res.status(500).json({ error: msg });
  }
});

app.get('/api/projects/:id/export-all', async (req: Request, res: Response) => {
  const project = getProjectById(String(req.params.id));
  if (!project || project.clips.length === 0) {
    res.status(404).json({ error: 'No clips available to export for this project.' });
    return;
  }
  if (!project.videoPath || !fs.existsSync(project.videoPath)) {
    res.status(400).json({
      error: 'Attach a local MP4/MOV/WebM file in the Export tab to enable batch 1080p ZIP rendering.',
    });
    return;
  }

  try {
    const renderedFiles: Array<{ filePath: string; name: string }> = [];
    for (const clip of project.clips) {
      let outFile = clip.exportedPath;
      if (!outFile || !fs.existsSync(outFile)) {
        outFile = path.join(EXPORTS_DIR, `${project.id}_${clip.id}_1080p.mp4`);
        await renderClipMp4(project, clip, outFile);
        await updateClipInDb(project.id, clip.id, {
          exportedPath: outFile,
          exportedAt: new Date().toISOString(),
        });
      }
      const safeName = clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '')
        .slice(0, 32);
      renderedFiles.push({
        filePath: outFile,
        name: `clip_${String(clip.index).padStart(2, '0')}_${safeName || 'short'}_${clip.exportFormat}.mp4`,
      });
    }

    const zipName = `${project.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 32)}_all_clips.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = createArchiver('zip', { zlib: { level: 5 } });
    archive.on('error', (err: Error) => {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    archive.pipe(res);
    for (const item of renderedFiles) {
      archive.file(item.filePath, { name: item.name });
    }
    await archive.finalize();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Batch ZIP export failed.';
    if (!res.headersSent) {
      res.status(500).json({ error: msg });
    }
  }
});

// Media Streaming Routes
app.get('/api/media/video/:projectId', (req: Request, res: Response) => {
  const project = getProjectById(String(req.params.projectId));
  if (!project) {
    res.status(404).json({ error: 'Project not found.' });
    return;
  }
  streamVideoWithRanges(req, res, project.videoPath, getMimeTypeForVideo(project.videoPath));
});

app.get('/api/media/thumb/:projectId', (req: Request, res: Response) => {
  const project = getProjectById(String(req.params.projectId));
  if (!project || !project.thumbnailPath || !fs.existsSync(project.thumbnailPath)) {
    res.status(404).end();
    return;
  }
  res.sendFile(project.thumbnailPath);
});

app.get('/api/media/background/:bgId', (req: Request, res: Response) => {
  const bgId = String(req.params.bgId) as BackgroundVideoId;
  const bgPath = getBackgroundVideoPath(bgId);
  if (!bgPath || !fs.existsSync(bgPath)) {
    res.status(404).json({ error: 'Background video not found.' });
    return;
  }
  streamVideoWithRanges(req, res, bgPath, 'video/mp4');
});

async function startServer() {
  const PORT = 3000;

  // Prepare looping gameplay MP4s asynchronously
  void ensureBackgroundGameplayAssets();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ClipReach AI server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
