import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  Film,
  Link2,
  Play,
  UploadCloud,
} from 'lucide-react';
import {
  createSampleProject,
  submitYouTubeProject,
  uploadVideoWithProgress,
} from '../lib/api';
import type { CaptionLanguage, Project } from '../lib/clipLogic';

interface UploadPanelProps {
  onProjectCreated: (project: Project) => void;
  remainingMinutes: number;
}

export const UploadPanel: React.FC<UploadPanelProps> = ({
  onProjectCreated,
  remainingMinutes,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [targetDuration, setTargetDuration] = useState<15 | 30 | 45 | 60>(30);
  const [clipCount, setClipCount] = useState<number>(6);
  const [language, setLanguage] = useState<CaptionLanguage>('auto');

  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadBytesLabel, setUploadBytesLabel] = useState('');
  const [submittingMode, setSubmittingMode] = useState<'file' | 'youtube' | 'sample' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setErrorMessage(null);
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['mp4', 'mov', 'webm'].includes(ext)) {
      setErrorMessage('Unsupported file format. Please choose an MP4, MOV, or WebM video.');
      return;
    }

    setUploading(true);
    setSubmittingMode('file');
    setUploadPercent(0);
    setUploadBytesLabel('');

    try {
      const project = await uploadVideoWithProgress(
        file,
        {
          targetClipDuration: targetDuration,
          requestedClipCount: clipCount,
          language,
        },
        (pct, loaded, total) => {
          setUploadPercent(pct);
          const loadedMb = (loaded / (1024 * 1024)).toFixed(1);
          const totalMb = (total / (1024 * 1024)).toFixed(1);
          setUploadBytesLabel(`${loadedMb} MB / ${totalMb} MB`);
        }
      );
      onProjectCreated(project);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Video upload failed.');
    } finally {
      setUploading(false);
      setSubmittingMode(null);
    }
  };

  const handleYouTubeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    if (!youtubeUrl.trim()) {
      setErrorMessage('Please paste a YouTube link or direct video URL.');
      return;
    }
    setUploading(true);
    setSubmittingMode('youtube');
    try {
      const project = await submitYouTubeProject({
        url: youtubeUrl.trim(),
        targetClipDuration: targetDuration,
        requestedClipCount: clipCount,
        language,
      });
      setYoutubeUrl('');
      onProjectCreated(project);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to import YouTube link.');
    } finally {
      setUploading(false);
      setSubmittingMode(null);
    }
  };

  const handleSampleProject = async () => {
    setErrorMessage(null);
    setUploading(true);
    setSubmittingMode('sample');
    try {
      const project = await createSampleProject({
        targetClipDuration: targetDuration === 60 ? 15 : targetDuration,
        requestedClipCount: Math.max(5, Math.min(8, clipCount)),
        language: language === 'hi' ? 'hi' : 'en',
      });
      onProjectCreated(project);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Failed to start sample project.');
    } finally {
      setUploading(false);
      setSubmittingMode(null);
    }
  };

  const durationOptions: Array<15 | 30 | 45 | 60> = [15, 30, 45, 60];

  return (
    <section
      aria-label="Video Upload and AI Clip Generator"
      className="rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] p-6"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="font-display text-xl font-semibold text-white">
            Repurpose Long-Form Video
          </h2>
          <p className="text-sm text-slate-400 mt-1">
            Upload MP4, MOV, or WebM files or paste a YouTube / direct video link to generate 5–15 vertical clips.
          </p>
        </div>
        <button
          type="button"
          onClick={handleSampleProject}
          disabled={uploading || remainingMinutes <= 0.5}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-white/[0.06] hover:bg-white/[0.11] text-slate-100 border border-white/10 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <Play className="w-4 h-4 text-violet-400" />
          <span>
            {submittingMode === 'sample' ? 'Preparing Sample...' : 'Try Sample Podcast Video'}
          </span>
        </button>
      </div>

      {/* Generation Controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 pb-6 border-b border-white/[0.07]">
        <div>
          <span className="block text-xs font-medium text-slate-400 mb-2">
            Target Clip Duration
          </span>
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
            {durationOptions.map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => setTargetDuration(sec)}
                className={`py-1.5 text-xs font-mono tabular-nums font-medium rounded-lg transition-colors ${
                  targetDuration === sec
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {sec}s
              </button>
            ))}
          </div>
        </div>

        <div>
          <label
            htmlFor="clip-count-select"
            className="block text-xs font-medium text-slate-400 mb-2"
          >
            Number of Viral Clips
          </label>
          <select
            id="clip-count-select"
            value={clipCount}
            onChange={(e) => setClipCount(Number(e.target.value))}
            className="w-full h-[38px] px-3 text-sm bg-[#161326] border border-white/10 rounded-xl text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value={5}>5 clips (Best highlights)</option>
            <option value={6}>6 clips (Balanced)</option>
            <option value={8}>8 clips (Creator pack)</option>
            <option value={10}>10 clips (Deep extraction)</option>
            <option value={12}>12 clips (High volume)</option>
            <option value={15}>15 clips (Maximum coverage)</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="caption-lang-select"
            className="block text-xs font-medium text-slate-400 mb-2"
          >
            Transcription & Captions Language
          </label>
          <select
            id="caption-lang-select"
            value={language}
            onChange={(e) => setLanguage(e.target.value as CaptionLanguage)}
            className="w-full h-[38px] px-3 text-sm bg-[#161326] border border-white/10 rounded-xl text-slate-100 focus:outline-none focus:border-violet-500"
          >
            <option value="auto">Auto-Detect (English / Hindi)</option>
            <option value="en">English</option>
            <option value="hi">Hindi (हिन्दी)</option>
          </select>
        </div>
      </div>

      {/* Drag and Drop + YouTube Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        <div className="lg:col-span-7">
          <input
            ref={fileInputRef}
            type="file"
            accept=".mp4,.mov,.webm,video/mp4,video/quicktime,video/webm"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = '';
            }}
            className="sr-only"
            id="video-file-upload"
          />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className={`h-full min-h-[168px] flex flex-col items-center justify-center text-center p-6 rounded-xl border border-dashed transition-colors ${
              dragActive
                ? 'border-violet-400 bg-violet-500/10'
                : 'border-white/15 bg-white/[0.02] hover:border-violet-500/50 hover:bg-white/[0.03]'
            }`}
          >
            <div className="w-11 h-11 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center text-violet-300 mb-3">
              <UploadCloud className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-white">
              Drag & drop your video file here
            </p>
            <p className="text-xs text-slate-400 mt-1 mb-4">
              MP4, MOV, or WebM · Up to 500 MB · {remainingMinutes} free min available
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="px-4 py-2 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white transition-all whitespace-nowrap disabled:opacity-50"
            >
              {submittingMode === 'file' ? 'Uploading Video...' : 'Browse Video File'}
            </button>
          </div>
        </div>

        <form
          onSubmit={handleYouTubeSubmit}
          className="lg:col-span-5 flex flex-col justify-between p-5 rounded-xl bg-white/[0.02] border border-white/[0.08]"
        >
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-white mb-1.5">
              <Link2 className="w-4 h-4 text-blue-400" />
              <span>Import from YouTube or Video URL</span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Paste a public YouTube link, Shorts URL, or direct .mp4/.mov/.webm video link. AI
              transcribes speech, detects viral hooks, and frames 9:16 clips automatically.
            </p>
            <label htmlFor="youtube-url-input" className="sr-only">
              YouTube or Video URL
            </label>
            <input
              id="youtube-url-input"
              type="url"
              value={youtubeUrl}
              onChange={(e) => setYoutubeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... or https://.../video.mp4"
              disabled={uploading}
              className="w-full px-3.5 py-2.5 text-sm bg-[#090812] border border-white/15 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <button
            type="submit"
            disabled={uploading || !youtubeUrl.trim()}
            className="mt-4 w-full py-2.5 px-4 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white transition-all whitespace-nowrap disabled:opacity-50"
          >
            {submittingMode === 'youtube' ? 'Importing Video Link...' : 'Generate Clips from Link'}
          </button>
        </form>
      </div>

      {/* Real Upload Progress */}
      {submittingMode === 'file' && uploading && (
        <div className="mt-5 p-4 rounded-xl bg-white/[0.04] border border-violet-500/30">
          <div className="flex items-center justify-between text-xs text-slate-200 mb-2">
            <span className="flex items-center gap-2 font-medium">
              <Film className="w-4 h-4 text-violet-400" />
              Uploading video to ClipReach Studio...
            </span>
            <span className="font-mono tabular-nums">
              {uploadPercent}% {uploadBytesLabel ? `· ${uploadBytesLabel}` : ''}
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-150"
              style={{ width: `${uploadPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Message */}
      {errorMessage && (
        <div
          role="alert"
          className="mt-5 flex items-start gap-3 p-4 rounded-xl bg-rose-950/50 border border-rose-500/30 text-sm text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
    </section>
  );
};
