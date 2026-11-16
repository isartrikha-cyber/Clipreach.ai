import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Download,
  Film,
  Layers,
  Loader2,
  Pause,
  Play,
  Scissors,
  Sliders,
  Sparkles,
  Subtitles,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { attachVideoToProject, exportClipMp4, fetchProject, updateClip } from '../lib/api';
import {
  BACKGROUND_VIDEOS,
  formatDurationLabel,
  formatTimestamp,
  validateTrimBounds,
  type BackgroundVideoId,
  type CaptionSegment,
  type CaptionStyle,
  type Clip,
  type ExportFormat,
  type FramingMode,
  type Project,
  type TransitionEffect,
} from '../lib/clipLogic';

interface ClipStudioViewProps {
  initialProject: Project;
  onBack: () => void;
  onProjectUpdated: (project: Project) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
}

type InspectorTab = 'score' | 'captions' | 'framing' | 'export';
type SafeZoneOverlay = 'none' | 'reels' | 'shorts' | 'tiktok';

export const ClipStudioView: React.FC<ClipStudioViewProps> = ({
  initialProject,
  onBack,
  onProjectUpdated,
  onDeleteProject,
}) => {
  const [project, setProject] = useState<Project>(initialProject);
  const [selectedClipId, setSelectedClipId] = useState<string>(
    initialProject.clips[0]?.id || ''
  );
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('score');
  const [safeZone, setSafeZone] = useState<SafeZoneOverlay>('none');

  // Video playback state
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const blurBgVideoRef = useRef<HTMLVideoElement | null>(null);
  const gameplayVideoRef = useRef<HTMLVideoElement | null>(null);
  const youtubeIframeRef = useRef<HTMLIFrameElement | null>(null);
  const attachFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);

  // Editable clip drafts
  const [captionsDraft, setCaptionsDraft] = useState<CaptionSegment[]>([]);
  const [trimStartDraft, setTrimStartDraft] = useState(0);
  const [trimEndDraft, setTrimEndDraft] = useState(15);

  const [savingClip, setSavingClip] = useState(false);
  const [exportingClip, setExportingClip] = useState(false);
  const [attachingVideo, setAttachingVideo] = useState(false);
  const [exportSuccessInfo, setExportSuccessInfo] = useState<string | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);

  const isYouTubeEmbed =
    project.streamMode === 'youtube-embed' &&
    !project.videoPath &&
    Boolean(project.youtubeVideoId);

  // Poll while processing
  useEffect(() => {
    setProject(initialProject);
    if (initialProject.clips.length > 0 && !selectedClipId) {
      setSelectedClipId(initialProject.clips[0].id);
    }
  }, [initialProject]);

  useEffect(() => {
    if (project.status === 'ready' || project.status === 'error') return;
    const timer = window.setInterval(async () => {
      try {
        const latest = await fetchProject(project.id);
        setProject(latest);
        onProjectUpdated(latest);
        if (latest.status === 'ready' && latest.clips.length > 0) {
          setSelectedClipId((prev) => prev || latest.clips[0].id);
        }
      } catch (err) {
        console.error('Polling error:', err);
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [project.id, project.status]);

  const activeClip: Clip | undefined = useMemo(() => {
    return project.clips.find((c) => c.id === selectedClipId) || project.clips[0];
  }, [project.clips, selectedClipId]);

  // Sync local drafts when active clip changes
  useEffect(() => {
    if (!activeClip) return;
    setCaptionsDraft(structuredClone(activeClip.captions));
    setTrimStartDraft(activeClip.trimStart);
    setTrimEndDraft(activeClip.trimEnd);
    setExportSuccessInfo(null);
    setStudioError(null);
    setIsPlaying(false);
    setCurrentTime(activeClip.trimStart);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = activeClip.trimStart;
    }
    if (blurBgVideoRef.current) {
      blurBgVideoRef.current.pause();
      blurBgVideoRef.current.currentTime = activeClip.trimStart;
    }
  }, [activeClip?.id]);

  const sendYouTubeCommand = (func: string, args: unknown[] = []) => {
    youtubeIframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }),
      '*'
    );
  };

  // Drive live caption clock when previewing a YouTube-embedded clip
  useEffect(() => {
    if (!isYouTubeEmbed || !isPlaying) return;
    const timer = window.setInterval(() => {
      setCurrentTime((prev) => {
        const next = Number((prev + 0.1).toFixed(2));
        if (next >= trimEndDraft) {
          sendYouTubeCommand('seekTo', [trimStartDraft, true]);
          return trimStartDraft;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [isYouTubeEmbed, isPlaying, trimStartDraft, trimEndDraft]);

  // Keep secondary preview videos synced during play/pause
  const togglePlayback = () => {
    if (!activeClip) return;
    if (isYouTubeEmbed) {
      if (!isPlaying) {
        const target =
          currentTime < trimStartDraft || currentTime >= trimEndDraft
            ? trimStartDraft
            : currentTime;
        setCurrentTime(target);
        sendYouTubeCommand('seekTo', [target, true]);
        sendYouTubeCommand('playVideo');
        if (gameplayVideoRef.current) {
          void gameplayVideoRef.current.play().catch(() => undefined);
        }
        setIsPlaying(true);
      } else {
        sendYouTubeCommand('pauseVideo');
        gameplayVideoRef.current?.pause();
        setIsPlaying(false);
      }
      return;
    }

    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      if (vid.currentTime < trimStartDraft || vid.currentTime >= trimEndDraft) {
        vid.currentTime = trimStartDraft;
      }
      void vid.play();
      if (blurBgVideoRef.current) {
        blurBgVideoRef.current.currentTime = vid.currentTime;
        void blurBgVideoRef.current.play().catch(() => undefined);
      }
      if (gameplayVideoRef.current) {
        void gameplayVideoRef.current.play().catch(() => undefined);
      }
      setIsPlaying(true);
    } else {
      vid.pause();
      blurBgVideoRef.current?.pause();
      gameplayVideoRef.current?.pause();
      setIsPlaying(false);
    }
  };

  const handleTimeUpdate = () => {
    const vid = videoRef.current;
    if (!vid || !activeClip) return;
    const t = vid.currentTime;
    setCurrentTime(t);
    if (t >= trimEndDraft) {
      vid.currentTime = trimStartDraft;
      if (blurBgVideoRef.current) blurBgVideoRef.current.currentTime = trimStartDraft;
    }
  };

  const handleSeek = (nextTime: number) => {
    const clamped = Math.max(trimStartDraft, Math.min(trimEndDraft, nextTime));
    setCurrentTime(clamped);
    if (isYouTubeEmbed) {
      sendYouTubeCommand('seekTo', [clamped, true]);
      return;
    }
    if (videoRef.current) videoRef.current.currentTime = clamped;
    if (blurBgVideoRef.current) blurBgVideoRef.current.currentTime = clamped;
  };

  const handleAttachVideoFile = async (file: File) => {
    setAttachingVideo(true);
    setStudioError(null);
    try {
      const updated = await attachVideoToProject(project.id, file);
      setProject(updated);
      onProjectUpdated(updated);
      setSaveFeedback('Local video attached for 1080p export');
      window.setTimeout(() => setSaveFeedback(null), 2600);
    } catch (err: unknown) {
      setStudioError(err instanceof Error ? err.message : 'Failed to attach local video.');
    } finally {
      setAttachingVideo(false);
    }
  };

  const patchActiveClip = async (patch: Partial<Clip>, feedbackLabel?: string) => {
    if (!activeClip) return;
    setSavingClip(true);
    setStudioError(null);
    try {
      const updated = await updateClip(project.id, activeClip.id, patch);
      const nextProject: Project = {
        ...project,
        clips: project.clips.map((c) => (c.id === updated.id ? updated : c)),
      };
      setProject(nextProject);
      onProjectUpdated(nextProject);
      if (feedbackLabel) {
        setSaveFeedback(feedbackLabel);
        window.setTimeout(() => setSaveFeedback(null), 2200);
      }
    } catch (err: unknown) {
      setStudioError(err instanceof Error ? err.message : 'Failed to save clip edits.');
    } finally {
      setSavingClip(false);
    }
  };

  const handleSaveTrim = () => {
    const validated = validateTrimBounds(
      trimStartDraft,
      trimEndDraft,
      project.durationSeconds
    );
    setTrimStartDraft(validated.trimStart);
    setTrimEndDraft(validated.trimEnd);
    void patchActiveClip(
      { trimStart: validated.trimStart, trimEnd: validated.trimEnd },
      'Trim saved'
    );
  };

  const handleSaveCaptions = () => {
    const normalized = captionsDraft.map((seg) => ({
      ...seg,
      text: seg.words.map((w) => w.word).join(' '),
    }));
    void patchActiveClip({ captions: normalized }, 'Captions saved');
  };

  const handleExport1080p = async () => {
    if (!activeClip) return;
    setExportingClip(true);
    setStudioError(null);
    setExportSuccessInfo(null);
    try {
      const res = await exportClipMp4(project.id, activeClip.id);
      const mb = (res.fileSizeBytes / (1024 * 1024)).toFixed(2);
      setExportSuccessInfo(`Rendered ${res.resolution} MP4 (${mb} MB)`);
      // Trigger download cleanly via anchor element
      const link = document.createElement('a');
      link.href = res.downloadUrl;
      link.download = `${activeClip.title.replace(/\s+/g, '_').toLowerCase()}_1080p.mp4`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: unknown) {
      setStudioError(err instanceof Error ? err.message : '1080p MP4 export failed.');
    } finally {
      setExportingClip(false);
    }
  };

  // Active caption segment for currentTime
  const activeCaptionSegment = useMemo(() => {
    return captionsDraft.find(
      (seg) => currentTime >= seg.start && currentTime <= seg.end
    );
  }, [captionsDraft, currentTime]);

  // --- Processing / Error States ---
  if (project.status !== 'ready') {
    const stages = [
      { id: 'uploading', label: 'Video Ingestion & Validation', threshold: 10 },
      { id: 'probing', label: 'FFmpeg Stream Probing & Audio Extraction', threshold: 25 },
      { id: 'transcribing', label: 'AI Speech Transcription (EN / HI)', threshold: 50 },
      { id: 'analyzing', label: 'Viral Moment Detection & Scoring', threshold: 75 },
    ];

    return (
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Dashboard</span>
        </button>

        <div className="rounded-2xl bg-[#100E1B]/85 backdrop-blur-xl border border-white/[0.08] p-7">
          <div className="flex items-start justify-between gap-4 mb-6">
            <div>
              <h1 className="font-display text-2xl font-bold text-white">{project.title}</h1>
              <p className="text-sm text-slate-400 mt-1">
                {project.originalFilename} · Target {project.targetClipDuration}s clips
              </p>
            </div>
            {project.status === 'error' ? (
              <span className="text-sm font-medium text-rose-400">Failed</span>
            ) : (
              <span className="font-mono tabular-nums text-sm font-semibold text-violet-300">
                {project.progressPercent}%
              </span>
            )}
          </div>

          {project.status === 'error' ? (
            <div className="space-y-5">
              <div
                role="alert"
                className="flex items-start gap-3 p-4 rounded-xl bg-rose-950/50 border border-rose-500/30 text-sm text-rose-200"
              >
                <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-rose-100">Processing Error</p>
                  <p className="mt-1 text-rose-200/90">
                    {project.errorMessage || 'An unexpected error occurred during video analysis.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onBack}
                  className="px-4 py-2 rounded-xl text-sm font-medium bg-white/[0.08] hover:bg-white/[0.14] text-white"
                >
                  Return to Upload Studio
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onDeleteProject(project.id);
                    onBack();
                  }}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-rose-300 hover:bg-rose-500/10 border border-rose-500/20"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Project</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between text-xs text-slate-300 mb-2">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
                    {project.statusMessage}
                  </span>
                  <span className="font-mono tabular-nums">{project.progressPercent}%</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-white/[0.07] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-violet-600 to-blue-500 transition-all duration-300"
                    style={{ width: `${Math.max(6, project.progressPercent)}%` }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-white/[0.06]">
                {stages.map((st) => {
                  const done = project.progressPercent > st.threshold + 12;
                  const active = !done && project.progressPercent >= st.threshold - 10;
                  return (
                    <div
                      key={st.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border text-xs ${
                        done
                          ? 'bg-emerald-950/25 border-emerald-500/25 text-emerald-200'
                          : active
                          ? 'bg-violet-950/35 border-violet-500/35 text-white'
                          : 'bg-white/[0.02] border-white/[0.06] text-slate-500'
                      }`}
                    >
                      {done ? (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : active ? (
                        <Loader2 className="w-4 h-4 text-violet-400 animate-spin shrink-0" />
                      ) : (
                        <Film className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                      <span>{st.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!activeClip) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12 text-center">
        <p className="text-slate-300 mb-4">No clips were generated for this project.</p>
        <button
          type="button"
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-white/10 text-white text-sm"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  const clipDuration = Math.max(1, trimEndDraft - trimStartDraft);
  const clipProgressPct = Math.max(
    0,
    Math.min(100, ((currentTime - trimStartDraft) / clipDuration) * 100)
  );
  const selectedBgId: BackgroundVideoId =
    activeClip.backgroundVideoId === 'none' ? 'cyber_parkour' : activeClip.backgroundVideoId;

  const captionStyleClasses: Record<CaptionStyle, string> = {
    hormozi: 'font-display font-extrabold uppercase tracking-tight text-white drop-shadow-[0_3px_6px_rgba(0,0,0,0.95)] text-lg sm:text-xl',
    minimal: 'font-sans font-medium text-slate-50 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)] text-sm sm:text-base',
    neon: 'font-display font-bold text-white drop-shadow-[0_0_10px_rgba(167,139,250,0.95)] text-base sm:text-lg',
    devanagari: 'font-sans font-bold text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] text-base sm:text-lg',
  };

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-5 space-y-5">
      {/* Studio Top Bar */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to Dashboard"
            className="p-2 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] text-slate-200 border border-white/10 shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="font-display text-lg sm:text-xl font-bold text-white truncate">
              {project.title}
            </h1>
            <p className="text-xs text-slate-400 font-mono tabular-nums">
              {project.clips.length} viral clips · Source {formatDurationLabel(project.durationSeconds)} ·{' '}
              {isYouTubeEmbed ? 'YouTube Embed' : `${project.width}×${project.height}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {saveFeedback && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <Check className="w-3.5 h-3.5" />
              {saveFeedback}
            </span>
          )}
          {isYouTubeEmbed ? (
            <button
              type="button"
              onClick={() => {
                setInspectorTab('export');
                setStudioError(
                  'Attach a local MP4/MOV/WebM file in the Export tab to enable 1080p FFmpeg rendering for this YouTube link.'
                );
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white/[0.08] hover:bg-white/[0.14] text-white border border-white/10 transition-all whitespace-nowrap shrink-0"
            >
              <UploadCloud className="w-4 h-4 text-violet-300" />
              <span>Attach Video for 1080p Batch</span>
            </button>
          ) : (
            <a
              href={`/api/projects/${project.id}/export-all`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white transition-all whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Batch Download All (.zip)</span>
            </a>
          )}
        </div>
      </header>

      {studioError && (
        <div
          role="alert"
          className="flex items-center gap-2.5 p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/30 text-sm text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{studioError}</span>
        </div>
      )}

      {/* 3-Column Studio Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Generated Clips Rail */}
        <aside
          aria-label="Generated Viral Clips"
          className="order-3 lg:order-1 lg:col-span-3 rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] p-3.5 space-y-2 max-h-[340px] lg:max-h-[680px] overflow-y-auto"
        >
          <div className="px-1.5 pb-2 border-b border-white/[0.06] flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-200">
              Viral Clips ({project.clips.length})
            </h2>
            <span className="text-xs text-slate-400 font-mono">Ranked</span>
          </div>

          {project.clips.map((clip, i) => {
            const selected = clip.id === activeClip.id;
            const dur = Math.round(clip.trimEnd - clip.trimStart);
            return (
              <button
                key={clip.id}
                type="button"
                onClick={() => setSelectedClipId(clip.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all ${
                  selected
                    ? 'bg-gradient-to-r from-violet-600/20 to-blue-600/15 border-violet-500/45 text-white'
                    : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/[0.05] text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono tabular-nums text-xs text-violet-300 font-semibold">
                    #{i + 1}
                  </span>
                  <span className="font-mono tabular-nums text-xs font-bold text-white">
                    {clip.viralScore.overall}/100
                  </span>
                </div>
                <p className="text-sm font-medium text-white line-clamp-2 leading-snug">
                  {clip.title}
                </p>
                <p className="text-xs text-slate-400 font-mono tabular-nums mt-1.5">
                  {formatTimestamp(clip.trimStart)} – {formatTimestamp(clip.trimEnd)} · {dur}s
                </p>
              </button>
            );
          })}
        </aside>

        {/* Center Column: 9:16 Live Vertical Video Player & Trim Bar */}
        <main className="order-1 lg:order-2 lg:col-span-5 rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] p-5 flex flex-col items-center">
          {/* Platform Safe-Zone Selector */}
          <div className="w-full flex items-center justify-between gap-2 mb-4">
            <span className="text-xs font-medium text-slate-400">9:16 Studio Preview</span>
            <div className="flex items-center gap-1 p-1 rounded-lg bg-white/[0.04] border border-white/[0.07]">
              {(
                [
                  { id: 'none', label: 'Clean' },
                  { id: 'reels', label: 'Reels' },
                  { id: 'shorts', label: 'Shorts' },
                  { id: 'tiktok', label: 'TikTok' },
                ] as Array<{ id: SafeZoneOverlay; label: string }>
              ).map((zone) => (
                <button
                  key={zone.id}
                  type="button"
                  onClick={() => setSafeZone(zone.id)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors whitespace-nowrap ${
                    safeZone === zone.id
                      ? 'bg-violet-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {zone.label}
                </button>
              ))}
            </div>
          </div>

          {/* 9:16 Frame Container */}
          <div
            data-testid="vertical-preview-frame"
            className="relative w-full max-w-[300px] aspect-[9/16] rounded-2xl overflow-hidden bg-black border border-white/15 shadow-2xl select-none"
          >
            {/* Framing Modes */}
            {isYouTubeEmbed ? (
              (() => {
                const embedSrc = `https://www.youtube.com/embed/${project.youtubeVideoId}?start=${Math.floor(
                  trimStartDraft
                )}&end=${Math.ceil(trimEndDraft)}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
                if (activeClip.framingMode === 'split-gameplay') {
                  return (
                    <div className="w-full h-full flex flex-col">
                      <div className="w-full h-1/2 overflow-hidden relative bg-black">
                        <iframe
                          ref={youtubeIframeRef}
                          src={embedSrc}
                          title={activeClip.title}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="w-full h-full border-0"
                        />
                      </div>
                      <div className="w-full h-1/2 overflow-hidden relative border-t border-white/10">
                        <video
                          ref={gameplayVideoRef}
                          src={`/api/media/background/${selectedBgId}`}
                          muted
                          loop
                          playsInline
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  );
                }
                if (activeClip.framingMode === 'blur-fill') {
                  return (
                    <div className="relative w-full h-full flex items-center justify-center bg-[#090812]">
                      {project.thumbnailPath && (
                        <img
                          src={`/api/media/thumb/${project.id}`}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 brightness-50"
                        />
                      )}
                      <iframe
                        ref={youtubeIframeRef}
                        src={embedSrc}
                        title={activeClip.title}
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                        className="relative z-10 w-full aspect-video border-0"
                      />
                    </div>
                  );
                }
                return (
                  <div className="relative w-full h-full overflow-hidden bg-black flex items-center justify-center">
                    <iframe
                      ref={youtubeIframeRef}
                      src={embedSrc}
                      title={activeClip.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{
                        transform: `translateX(${(0.5 - activeClip.faceCenterX) * 38}%) scale(${
                          activeClip.autoZoom || activeClip.transitionEffect === 'hook-zoom'
                            ? 1.06
                            : 1
                        })`,
                      }}
                      className="h-full aspect-video max-w-none border-0 transition-transform duration-300"
                    />
                  </div>
                );
              })()
            ) : activeClip.framingMode === 'split-gameplay' ? (
              <div className="w-full h-full flex flex-col">
                <div className="w-full h-1/2 overflow-hidden relative">
                  <video
                    ref={videoRef}
                    src={`/api/media/video/${project.id}`}
                    playsInline
                    onTimeUpdate={handleTimeUpdate}
                    onClick={togglePlayback}
                    style={{
                      objectPosition: `${activeClip.faceCenterX * 100}% 50%`,
                      transform:
                        activeClip.autoZoom || activeClip.transitionEffect === 'hook-zoom'
                          ? 'scale(1.06)'
                          : 'scale(1)',
                    }}
                    className="w-full h-full object-cover transition-transform duration-300 cursor-pointer"
                  />
                </div>
                <div className="w-full h-1/2 overflow-hidden relative border-t border-white/10">
                  <video
                    ref={gameplayVideoRef}
                    src={`/api/media/background/${selectedBgId}`}
                    muted
                    loop
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ) : activeClip.framingMode === 'blur-fill' ? (
              <div className="relative w-full h-full flex items-center justify-center">
                <video
                  ref={blurBgVideoRef}
                  src={`/api/media/video/${project.id}`}
                  muted
                  playsInline
                  className="absolute inset-0 w-full h-full object-cover blur-xl scale-110 brightness-50"
                />
                <video
                  ref={videoRef}
                  src={`/api/media/video/${project.id}`}
                  playsInline
                  onTimeUpdate={handleTimeUpdate}
                  onClick={togglePlayback}
                  className="relative z-10 w-full max-h-full object-contain cursor-pointer"
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                src={`/api/media/video/${project.id}`}
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onClick={togglePlayback}
                style={{
                  objectPosition: `${activeClip.faceCenterX * 100}% 50%`,
                  transform:
                    activeClip.autoZoom || activeClip.transitionEffect === 'hook-zoom'
                      ? 'scale(1.06)'
                      : 'scale(1)',
                }}
                className="w-full h-full object-cover transition-transform duration-300 cursor-pointer"
              />
            )}

            {/* Vignette Effect */}
            {activeClip.transitionEffect === 'vignette' && (
              <div
                className="absolute inset-0 pointer-events-none z-10"
                style={{
                  background:
                    'radial-gradient(circle, transparent 50%, rgba(0,0,0,0.68) 100%)',
                }}
              />
            )}

            {/* Contrast Scrim for Captions */}
            <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/75 via-black/30 to-transparent pointer-events-none z-10" />

            {/* Live Word-by-Word Animated Captions */}
            <div
              className={`absolute inset-x-4 z-20 text-center pointer-events-none ${
                activeClip.framingMode === 'split-gameplay'
                  ? 'top-[54%]'
                  : 'bottom-16'
              }`}
            >
              {activeCaptionSegment && (
                <p className={`leading-tight ${captionStyleClasses[activeClip.captionStyle]}`}>
                  {activeCaptionSegment.words.map((w) => {
                    const isActiveWord = currentTime >= w.start && currentTime <= w.end;
                    return (
                      <span
                        key={w.id}
                        className={`inline-block mx-1 transition-transform duration-100 ${
                          isActiveWord
                            ? 'text-amber-300 scale-110'
                            : w.important
                            ? 'text-violet-300'
                            : 'text-white'
                        }`}
                      >
                        {w.word}
                      </span>
                    );
                  })}
                </p>
              )}
            </div>

            {/* Platform Safe-Zone Guides */}
            {safeZone !== 'none' && (
              <div className="absolute inset-0 z-30 pointer-events-none border-2 border-dashed border-cyan-400/50">
                <div className="absolute right-2.5 bottom-20 flex flex-col items-center gap-3 text-[10px] font-mono text-white/80">
                  <div className="w-7 h-7 rounded-full bg-white/15 border border-white/25" />
                  <div className="w-7 h-7 rounded-full bg-white/15 border border-white/25" />
                  <div className="w-7 h-7 rounded-full bg-white/15 border border-white/25" />
                </div>
                <div className="absolute bottom-3 left-3 right-12 text-[10px] font-mono text-cyan-300 bg-black/50 px-2 py-1 rounded">
                  {safeZone.toUpperCase()} SAFE ZONE
                </div>
              </div>
            )}

            {/* Paused Play Trigger (for local MP4; YouTube embeds are directly interactive) */}
            {!isPlaying && !isYouTubeEmbed && (
              <button
                type="button"
                onClick={togglePlayback}
                aria-label="Play clip preview"
                className={`absolute inset-0 z-20 flex justify-center bg-black/20 hover:bg-black/30 transition-colors ${
                  activeClip.framingMode === 'split-gameplay'
                    ? 'items-start pt-[26%]'
                    : 'items-center pb-16'
                }`}
              >
                <span className="w-12 h-12 rounded-full bg-white/15 backdrop-blur-md border border-white/25 flex items-center justify-center text-white shadow-lg">
                  <Play className="w-5 h-5 ml-0.5" />
                </span>
              </button>
            )}
          </div>

          {/* Transport + Manual Trim Controls */}
          <div className="w-full mt-5 space-y-4 pt-4 border-t border-white/[0.07]">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={togglePlayback}
                aria-label={isPlaying ? 'Pause clip' : 'Play clip'}
                className="p-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shrink-0"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </button>
              <div className="flex-1">
                <label htmlFor="clip-scrub" className="sr-only">
                  Seek clip playback
                </label>
                <input
                  id="clip-scrub"
                  type="range"
                  min={trimStartDraft}
                  max={trimEndDraft}
                  step={0.1}
                  value={Math.max(trimStartDraft, Math.min(trimEndDraft, currentTime))}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="w-full accent-violet-500 cursor-pointer"
                />
                <div className="flex justify-between text-xs font-mono tabular-nums text-slate-400 mt-1">
                  <span>{formatTimestamp(Math.max(0, currentTime - trimStartDraft))}</span>
                  <span>{Math.round(clipProgressPct)}%</span>
                  <span>{formatTimestamp(clipDuration)}</span>
                </div>
              </div>
            </div>

            {/* Manual Trim Sliders */}
            <div className="p-3.5 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                  <Scissors className="w-3.5 h-3.5 text-violet-400" />
                  Manual Trim ({trimStartDraft.toFixed(1)}s – {trimEndDraft.toFixed(1)}s)
                </span>
                <button
                  type="button"
                  onClick={handleSaveTrim}
                  disabled={savingClip}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg bg-violet-600/30 hover:bg-violet-600/50 text-violet-200 border border-violet-500/30"
                >
                  {savingClip ? 'Saving...' : 'Apply Trim'}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="trim-start" className="block text-[11px] text-slate-400 mb-1">
                    Start ({trimStartDraft.toFixed(1)}s)
                  </label>
                  <input
                    id="trim-start"
                    type="range"
                    min={0}
                    max={Math.max(1, trimEndDraft - 3)}
                    step={0.5}
                    value={trimStartDraft}
                    onChange={(e) => setTrimStartDraft(Number(e.target.value))}
                    className="w-full accent-violet-500"
                  />
                </div>
                <div>
                  <label htmlFor="trim-end" className="block text-[11px] text-slate-400 mb-1">
                    End ({trimEndDraft.toFixed(1)}s)
                  </label>
                  <input
                    id="trim-end"
                    type="range"
                    min={Math.min(project.durationSeconds, trimStartDraft + 3)}
                    max={Math.max(5, project.durationSeconds)}
                    step={0.5}
                    value={trimEndDraft}
                    onChange={(e) => setTrimEndDraft(Number(e.target.value))}
                    className="w-full accent-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Right Column: Tabbed AI Inspector */}
        <section
          aria-label="Clip Inspector"
          className="order-2 lg:order-3 lg:col-span-4 rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] overflow-hidden"
        >
          {/* Inspector Tabs */}
          <div className="grid grid-cols-4 border-b border-white/[0.08] bg-white/[0.02]">
            {(
              [
                { id: 'score', label: 'Score', icon: <Sparkles className="w-3.5 h-3.5" /> },
                { id: 'captions', label: 'Captions', icon: <Subtitles className="w-3.5 h-3.5" /> },
                { id: 'framing', label: 'Framing', icon: <Layers className="w-3.5 h-3.5" /> },
                { id: 'export', label: 'Export', icon: <Sliders className="w-3.5 h-3.5" /> },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setInspectorTab(tab.id)}
                className={`flex items-center justify-center gap-1.5 py-3 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  inspectorTab === tab.id
                    ? 'border-violet-500 text-white bg-violet-500/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="p-5 max-h-[620px] overflow-y-auto space-y-5">
            {/* TAB 1: VIRAL SCORE */}
            {inspectorTab === 'score' && (
              <div className="space-y-5">
                <div className="flex items-center justify-between pb-4 border-b border-white/[0.07]">
                  <div>
                    <p className="text-xs font-medium text-slate-400">AI Viral Potential</p>
                    <p className="font-display text-4xl font-bold text-white font-mono tabular-nums mt-1">
                      {activeClip.viralScore.overall}
                      <span className="text-lg text-slate-400 font-normal">/100</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-medium text-slate-400 block">Language</span>
                    <span className="text-sm font-medium text-violet-300">
                      {activeClip.language === 'hi' ? 'Hindi' : 'English'}
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {(
                    [
                      ['Hook Strength', activeClip.viralScore.hookStrength],
                      ['Audience Engagement', activeClip.viralScore.engagementPotential],
                      ['Emotional Impact', activeClip.viralScore.emotionalImpact],
                      ['Pacing & Flow', activeClip.viralScore.pacing],
                      ['Content Quality', activeClip.viralScore.contentQuality],
                    ] as Array<[string, number]>
                  ).map(([label, val]) => (
                    <div key={label}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-slate-300">{label}</span>
                        <span className="font-mono tabular-nums text-white font-medium">
                          {val}/100
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500"
                          style={{ width: `${val}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/[0.07] space-y-2">
                  <p className="text-xs font-semibold text-slate-300">Opening Hook</p>
                  <p className="text-sm text-white leading-relaxed">
                    &ldquo;{activeClip.hook || activeClip.title}&rdquo;
                  </p>
                  <p className="text-xs font-semibold text-slate-300 pt-2">AI Analysis</p>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {activeClip.reasoning}
                  </p>
                </div>
              </div>
            )}

            {/* TAB 2: AI CAPTIONS */}
            {inspectorTab === 'captions' && (
              <div className="space-y-5">
                <div>
                  <span className="block text-xs font-medium text-slate-400 mb-2">
                    Caption Animation Style
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'hormozi', label: 'Hormozi Bold' },
                        { id: 'minimal', label: 'Minimal Clean' },
                        { id: 'neon', label: 'Neon Pulse' },
                        { id: 'devanagari', label: 'Hindi / Crisp' },
                      ] as Array<{ id: CaptionStyle; label: string }>
                    ).map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => void patchActiveClip({ captionStyle: st.id }, 'Style updated')}
                        className={`py-2 px-3 rounded-xl text-xs font-medium border transition-colors ${
                          activeClip.captionStyle === st.id
                            ? 'bg-gradient-to-r from-violet-600/25 to-blue-600/20 border-violet-500/50 text-white'
                            : 'bg-white/[0.03] border-white/[0.07] text-slate-300 hover:text-white'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/[0.07] space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-300">
                      Edit Captions & Click Words to Highlight
                    </span>
                    <button
                      type="button"
                      onClick={handleSaveCaptions}
                      disabled={savingClip}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
                    >
                      {savingClip ? 'Saving...' : 'Save Captions'}
                    </button>
                  </div>

                  {captionsDraft.length === 0 ? (
                    <p className="text-xs text-slate-400 py-4">
                      No speech segments detected in this clip interval.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {captionsDraft.map((seg, sIdx) => (
                        <div
                          key={seg.id}
                          className="p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-2"
                        >
                          <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                            <span>
                              {formatTimestamp(seg.start)} – {formatTimestamp(seg.end)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleSeek(seg.start)}
                              className="text-violet-300 hover:text-white"
                            >
                              Jump
                            </button>
                          </div>

                          <input
                            type="text"
                            aria-label={`Edit caption segment ${sIdx + 1}`}
                            value={seg.words.map((w) => w.word).join(' ')}
                            onChange={(e) => {
                              const nextText = e.target.value;
                              const tokens = nextText.split(/\s+/).filter(Boolean);
                              const span = Math.max(0.2, seg.end - seg.start);
                              const step = span / Math.max(1, tokens.length);
                              setCaptionsDraft((prev) =>
                                prev.map((item, idx) =>
                                  idx !== sIdx
                                    ? item
                                    : {
                                        ...item,
                                        text: nextText,
                                        words: tokens.map((tok, wIdx) => ({
                                          id: item.words[wIdx]?.id || `${item.id}-w${wIdx}`,
                                          word: tok,
                                          start: Number((seg.start + wIdx * step).toFixed(2)),
                                          end: Number((seg.start + (wIdx + 1) * step).toFixed(2)),
                                          important: item.words[wIdx]?.important ?? false,
                                        })),
                                      }
                                )
                              );
                            }}
                            className="w-full px-2.5 py-1.5 text-xs bg-[#090812] border border-white/10 rounded-lg text-white focus:outline-none focus:border-violet-500"
                          />

                          <div className="flex flex-wrap gap-1.5">
                            {seg.words.map((w, wIdx) => (
                              <button
                                key={w.id}
                                type="button"
                                onClick={() => {
                                  setCaptionsDraft((prev) =>
                                    prev.map((item, idx) =>
                                      idx !== sIdx
                                        ? item
                                        : {
                                            ...item,
                                            words: item.words.map((wordObj, j) =>
                                              j === wIdx
                                                ? { ...wordObj, important: !wordObj.important }
                                                : wordObj
                                            ),
                                          }
                                    )
                                  );
                                }}
                                className={`px-2 py-0.5 rounded text-[11px] border transition-colors ${
                                  w.important
                                    ? 'bg-violet-600/30 border-violet-400/60 text-violet-100 font-semibold'
                                    : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-white'
                                }`}
                              >
                                {w.word}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 3: FRAMING & BACKGROUND GAMEPLAY */}
            {inspectorTab === 'framing' && (
              <div className="space-y-5">
                <div>
                  <span className="block text-xs font-medium text-slate-400 mb-2">
                    9:16 Vertical Layout
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'auto-face', label: 'Face Track' },
                        { id: 'split-gameplay', label: 'Split BG' },
                        { id: 'blur-fill', label: 'Blur Fill' },
                      ] as Array<{ id: FramingMode; label: string }>
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        onClick={() =>
                          void patchActiveClip(
                            {
                              framingMode: mode.id,
                              backgroundVideoId:
                                mode.id === 'split-gameplay' &&
                                activeClip.backgroundVideoId === 'none'
                                  ? 'cyber_parkour'
                                  : activeClip.backgroundVideoId,
                            },
                            'Framing updated'
                          )
                        }
                        className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-colors ${
                          activeClip.framingMode === mode.id
                            ? 'bg-gradient-to-r from-violet-600/25 to-blue-600/20 border-violet-500/50 text-white'
                            : 'bg-white/[0.03] border-white/[0.07] text-slate-300 hover:text-white'
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Face Tracking X Offset & Auto Zoom */}
                <div className="pt-4 border-t border-white/[0.07] space-y-3">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <label htmlFor="face-pan-slider" className="text-slate-300">
                        Smart Face-Track Pan
                      </label>
                      <span className="font-mono tabular-nums text-violet-300">
                        {Math.round(activeClip.faceCenterX * 100)}%
                      </span>
                    </div>
                    <input
                      id="face-pan-slider"
                      type="range"
                      min={0.1}
                      max={0.9}
                      step={0.05}
                      value={activeClip.faceCenterX}
                      onChange={(e) =>
                        void patchActiveClip({ faceCenterX: Number(e.target.value) })
                      }
                      className="w-full accent-violet-500"
                    />
                  </div>

                  <label className="flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] cursor-pointer">
                    <span className="text-xs font-medium text-slate-200">
                      Automatic Hook Zoom & Reframing
                    </span>
                    <input
                      type="checkbox"
                      checked={activeClip.autoZoom}
                      onChange={(e) =>
                        void patchActiveClip({ autoZoom: e.target.checked }, 'Zoom updated')
                      }
                      className="w-4 h-4 accent-violet-500"
                    />
                  </label>
                </div>

                {/* Background Gameplay Video Picker */}
                <div className="pt-4 border-t border-white/[0.07] space-y-2.5">
                  <span className="block text-xs font-medium text-slate-300">
                    Background Gameplay Video (Split-Screen)
                  </span>
                  <div className="space-y-2">
                    {BACKGROUND_VIDEOS.map((bg) => {
                      const active = activeClip.backgroundVideoId === bg.id;
                      return (
                        <button
                          key={bg.id}
                          type="button"
                          onClick={() =>
                            void patchActiveClip(
                              {
                                backgroundVideoId: bg.id,
                                framingMode:
                                  bg.id === 'none'
                                    ? activeClip.framingMode === 'split-gameplay'
                                      ? 'auto-face'
                                      : activeClip.framingMode
                                    : 'split-gameplay',
                              },
                              'Background updated'
                            )
                          }
                          className={`w-full flex items-center gap-3 p-2.5 rounded-xl border text-left transition-colors ${
                            active
                              ? 'bg-violet-600/20 border-violet-500/50 text-white'
                              : 'bg-white/[0.02] border-white/[0.06] text-slate-300 hover:bg-white/[0.05]'
                          }`}
                        >
                          <span
                            className={`w-9 h-9 rounded-lg bg-gradient-to-br ${bg.previewGradient} border border-white/10 shrink-0`}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-white truncate">{bg.name}</p>
                            <p className="text-[11px] text-slate-400 truncate">{bg.subtitle}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Transitions & Effects */}
                <div className="pt-4 border-t border-white/[0.07]">
                  <span className="block text-xs font-medium text-slate-400 mb-2">
                    Transitions & Effects
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { id: 'none', label: 'None' },
                        { id: 'hook-zoom', label: 'Hook Zoom Punch' },
                        { id: 'fade', label: 'Fade In / Out' },
                        { id: 'vignette', label: 'Cinema Vignette' },
                      ] as Array<{ id: TransitionEffect; label: string }>
                    ).map((fx) => (
                      <button
                        key={fx.id}
                        type="button"
                        onClick={() =>
                          void patchActiveClip({ transitionEffect: fx.id }, 'Effect applied')
                        }
                        className={`py-2 px-3 rounded-xl text-xs font-medium border transition-colors ${
                          activeClip.transitionEffect === fx.id
                            ? 'bg-violet-600/25 border-violet-500/50 text-white'
                            : 'bg-white/[0.03] border-white/[0.07] text-slate-300 hover:text-white'
                        }`}
                      >
                        {fx.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: 1080P EXPORT */}
            {inspectorTab === 'export' && (
              <div className="space-y-5">
                <div>
                  <span className="block text-xs font-medium text-slate-400 mb-2">
                    Target Social Platform Format
                  </span>
                  <div className="grid grid-cols-3 gap-2">
                    {(
                      [
                        { id: 'reels', label: 'IG Reels' },
                        { id: 'shorts', label: 'YT Shorts' },
                        { id: 'tiktok', label: 'TikTok' },
                      ] as Array<{ id: ExportFormat; label: string }>
                    ).map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() =>
                          void patchActiveClip({ exportFormat: fmt.id }, 'Format updated')
                        }
                        className={`py-2 px-2.5 rounded-xl text-xs font-medium border transition-colors ${
                          activeClip.exportFormat === fmt.id
                            ? 'bg-gradient-to-r from-violet-600/25 to-blue-600/20 border-violet-500/50 text-white'
                            : 'bg-white/[0.03] border-white/[0.07] text-slate-300 hover:text-white'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white/[0.03] border border-white/[0.07] space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Resolution</span>
                    <span className="font-mono text-white">1080 × 1920 (1080p)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Aspect Ratio</span>
                    <span className="font-mono text-white">9:16 Vertical</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Clip Duration</span>
                    <span className="font-mono tabular-nums text-white">
                      {clipDuration.toFixed(1)}s
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Burned-in Captions</span>
                    <span className="text-white capitalize">{activeClip.captionStyle}</span>
                  </div>
                </div>

                {isYouTubeEmbed && (
                  <div className="p-4 rounded-xl bg-amber-950/30 border border-amber-500/30 space-y-3 text-xs">
                    <p className="font-semibold text-amber-200">
                      YouTube Stream Restricted — Attach Local Video for 1080p Render
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                      AI analyzed this YouTube video directly via URL, but YouTube blocks raw MP4
                      file extraction on cloud IPs. Attach a local MP4, MOV, or WebM copy to render
                      and download 1080p clips with burned-in captions.
                    </p>
                    <input
                      ref={attachFileInputRef}
                      type="file"
                      accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void handleAttachVideoFile(f);
                        e.target.value = '';
                      }}
                      className="sr-only"
                    />
                    <button
                      type="button"
                      onClick={() => attachFileInputRef.current?.click()}
                      disabled={attachingVideo}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border border-amber-400/40 transition-colors whitespace-nowrap disabled:opacity-50"
                    >
                      <UploadCloud className="w-4 h-4 shrink-0" />
                      <span>
                        {attachingVideo
                          ? 'Attaching Video...'
                          : 'Attach Local MP4 / MOV / WebM'}
                      </span>
                    </button>
                  </div>
                )}

                <div className="space-y-2.5">
                  <button
                    type="button"
                    onClick={handleExport1080p}
                    disabled={exportingClip || isYouTubeEmbed}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white transition-all disabled:opacity-50"
                  >
                    {exportingClip ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Rendering 1080p MP4...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4" />
                        <span>Export & Download 1080p MP4</span>
                      </>
                    )}
                  </button>

                  {exportSuccessInfo && (
                    <p className="text-xs text-emerald-400 text-center font-mono">
                      {exportSuccessInfo}
                    </p>
                  )}

                  {isYouTubeEmbed ? (
                    <button
                      type="button"
                      disabled
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-medium bg-white/[0.04] text-slate-500 border border-white/10 cursor-not-allowed"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Batch Download All {project.clips.length} Clips (.zip)</span>
                    </button>
                  ) : (
                    <a
                      href={`/api/projects/${project.id}/export-all`}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-medium bg-white/[0.06] hover:bg-white/[0.11] text-slate-200 border border-white/10 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Batch Download All {project.clips.length} Clips (.zip)</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
