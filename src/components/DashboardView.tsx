import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Film,
  Loader2,
  Search,
  Trash2,
  Video,
} from 'lucide-react';
import {
  formatDurationLabel,
  type DashboardSummary,
  type Project,
} from '../lib/clipLogic';
import type { NavTab } from './Sidebar';
import { UploadPanel } from './UploadPanel';

interface DashboardViewProps {
  activeTab: NavTab;
  summary: DashboardSummary;
  loading: boolean;
  onSelectTab: (tab: NavTab) => void;
  onOpenProject: (projectId: string) => void;
  onProjectCreated: (project: Project) => void;
  onDeleteProject: (projectId: string) => Promise<void>;
}

const ProjectThumbnail: React.FC<{ project: Project }> = ({ project }) => {
  const [imgError, setImgError] = useState(false);

  if (!project.thumbnailPath || imgError) {
    return (
      <div className="w-full h-full bg-gradient-to-br from-[#19142B] via-[#110F1F] to-[#0B1224] flex flex-col items-center justify-center text-slate-400 p-4">
        <Film className="w-7 h-7 text-violet-400/80 mb-2" />
        <span className="text-xs text-slate-400 text-center line-clamp-1">
          {project.title}
        </span>
      </div>
    );
  }

  return (
    <img
      src={`/api/media/thumb/${project.id}`}
      alt={project.title}
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
    />
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  activeTab,
  summary,
  loading,
  onSelectTab,
  onOpenProject,
  onProjectCreated,
  onDeleteProject,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'processing' | 'error'>('all');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredProjects = useMemo(() => {
    return summary.projects.filter((proj) => {
      const matchesQuery =
        !searchQuery.trim() ||
        proj.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        proj.originalFilename.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesQuery) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'ready') return proj.status === 'ready';
      if (statusFilter === 'error') return proj.status === 'error';
      return proj.status !== 'ready' && proj.status !== 'error';
    });
  }, [summary.projects, searchQuery, statusFilter]);

  const recentProjects = summary.projects.slice(0, 6);

  const handleDelete = async (projectId: string, title: string) => {
    setDeletingId(projectId);
    try {
      await onDeleteProject(projectId);
    } catch (err) {
      console.error(`Failed to delete ${title}:`, err);
    } finally {
      setDeletingId(null);
    }
  };

  const pageTitle =
    activeTab === 'upload'
      ? 'Upload & AI Studio'
      : activeTab === 'history'
      ? 'Projects & Processing History'
      : 'Creator Studio Dashboard';

  const pageSubtitle =
    activeTab === 'upload'
      ? 'Turn long-form videos into captioned, 9:16 vertical shorts powered by AI.'
      : activeTab === 'history'
      ? 'Inspect every processed video, generated clip pack, and export status.'
      : 'Monitor your viral clip output, available free minutes, and launch new AI edits.';

  const kpis = [
    {
      label: 'Total Videos Processed',
      value: String(summary.stats.totalVideosProcessed),
      sub: `${summary.projects.length} total projects`,
    },
    {
      label: 'Total Clips Generated',
      value: String(summary.stats.totalClipsGenerated),
      sub: 'Ready for Reels, Shorts & TikTok',
    },
    {
      label: 'Average Viral Score',
      value: summary.stats.avgViralScore > 0 ? `${summary.stats.avgViralScore}/100` : '—',
      sub: 'Hook, pacing & retention',
    },
    {
      label: 'Available Free Minutes',
      value: `${summary.stats.remainingMinutes}m`,
      sub: `of ${Math.round(summary.quota.limitSeconds / 60)}m monthly allowance`,
    },
  ];

  const getStatusLabel = (proj: Project) => {
    if (proj.status === 'ready') return { text: 'Ready', cls: 'text-emerald-400' };
    if (proj.status === 'error') return { text: 'Failed', cls: 'text-rose-400' };
    return { text: `${proj.progressPercent}% Processing`, cls: 'text-violet-300' };
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-7 space-y-8">
      {/* Page Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight text-balance">
            {pageTitle}
          </h1>
          <p className="text-sm text-slate-400 mt-1">{pageSubtitle}</p>
        </div>
        {activeTab !== 'upload' && (
          <button
            type="button"
            onClick={() => onSelectTab('upload')}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gradient-to-r from-violet-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white transition-all whitespace-nowrap shrink-0"
          >
            <Video className="w-4 h-4" />
            <span>New Video Project</span>
          </button>
        )}
      </header>

      {/* KPI Strip */}
      {activeTab !== 'upload' && (
        <section
          aria-label="Workspace Metrics"
          className="grid grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {kpis.map((kpi) => (
            <div
              key={kpi.label}
              className="rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] p-5"
            >
              <p className="text-xs font-medium text-slate-400">{kpi.label}</p>
              {loading ? (
                <div className="h-8 w-20 bg-white/[0.06] rounded-md mt-2" />
              ) : (
                <p className="font-display text-2xl sm:text-3xl font-bold text-white font-mono tabular-nums mt-2">
                  {kpi.value}
                </p>
              )}
              <p className="text-xs text-slate-400 mt-1.5">{kpi.sub}</p>
            </div>
          ))}
        </section>
      )}

      {/* Upload & Repurpose Studio */}
      {(activeTab === 'dashboard' || activeTab === 'upload') && (
        <UploadPanel
          onProjectCreated={onProjectCreated}
          remainingMinutes={summary.stats.remainingMinutes}
        />
      )}

      {/* Recent Projects Grid */}
      {activeTab === 'dashboard' && (
        <section aria-label="Recent Projects" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-white">Recent Projects</h2>
            {summary.projects.length > 0 && (
              <button
                type="button"
                onClick={() => onSelectTab('history')}
                className="text-xs font-medium text-violet-300 hover:text-white transition-colors"
              >
                View all history
              </button>
            )}
          </div>

          {recentProjects.length === 0 ? (
            <div className="rounded-2xl bg-[#100E1B]/60 border border-white/[0.08] p-10 text-center">
              <Film className="w-8 h-8 text-slate-500 mx-auto mb-3" />
              <h3 className="text-base font-medium text-white">No video projects yet</h3>
              <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
                Upload an MP4, MOV, or WebM video above, paste a YouTube link, or click
                &ldquo;Try Sample Podcast Video&rdquo; to generate your first batch of viral clips.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {recentProjects.map((proj) => {
                const topScore =
                  proj.clips.length > 0
                    ? Math.max(...proj.clips.map((c) => c.viralScore.overall))
                    : null;
                const statusInfo = getStatusLabel(proj);

                return (
                  <article
                    key={proj.id}
                    className="group rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] overflow-hidden flex flex-col"
                  >
                    <div className="relative aspect-video w-full overflow-hidden border-b border-white/[0.07]">
                      <ProjectThumbnail project={proj} />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent pointer-events-none" />
                      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-slate-200">
                        <span className="font-mono tabular-nums">
                          {proj.durationSeconds > 0
                            ? formatDurationLabel(proj.durationSeconds)
                            : 'Queued'}
                        </span>
                        <span className={statusInfo.cls}>{statusInfo.text}</span>
                      </div>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                      <div>
                        <h3 className="font-medium text-white text-sm line-clamp-1">
                          {proj.title}
                        </h3>
                        <p className="text-xs text-slate-400 mt-1.5 font-mono tabular-nums">
                          {proj.clips.length} clips
                          {topScore !== null ? ` · Top score ${topScore}/100` : ''}
                          {' · '}
                          {new Date(proj.createdAt).toLocaleDateString()}
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-white/[0.06]">
                        <button
                          type="button"
                          onClick={() => onOpenProject(proj.id)}
                          className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-300 hover:text-white transition-colors"
                        >
                          <span>
                            {proj.status === 'ready' ? 'Open Clip Studio' : 'View Progress'}
                          </span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(proj.id, proj.title)}
                          disabled={deletingId === proj.id}
                          aria-label={`Delete project ${proj.title}`}
                          className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Video Processing History Table */}
      {(activeTab === 'dashboard' || activeTab === 'history') && (
        <section
          aria-label="Video Processing History"
          className="rounded-2xl bg-[#100E1B]/80 backdrop-blur-xl border border-white/[0.08] overflow-hidden"
        >
          <div className="p-5 border-b border-white/[0.07] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-white">
                Video Processing History
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                All uploaded videos, YouTube imports, and generated clip packs
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <label htmlFor="history-search" className="sr-only">
                  Search projects
                </label>
                <input
                  id="history-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search projects..."
                  className="w-full sm:w-56 pl-9 pr-3 py-1.5 text-sm bg-[#090812] border border-white/10 rounded-xl text-white placeholder:text-slate-500 focus:outline-none focus:border-violet-500"
                />
              </div>

              <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
                {(['all', 'ready', 'processing', 'error'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setStatusFilter(tab)}
                    className={`px-3 py-1 text-xs font-medium rounded-lg capitalize transition-colors whitespace-nowrap ${
                      statusFilter === tab
                        ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {filteredProjects.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-400">
              {summary.projects.length === 0
                ? 'No processing history yet. Upload a video or run the sample podcast to see real history here.'
                : 'No projects match your current search or filter.'}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.07] text-xs font-medium text-slate-400">
                    <th className="py-3 px-5">Video Project</th>
                    <th className="py-3 px-4">Source</th>
                    <th className="py-3 px-4 text-right">Duration</th>
                    <th className="py-3 px-4 text-right">Clips</th>
                    <th className="py-3 px-4 text-right">Top Score</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] text-sm">
                  {filteredProjects.map((proj) => {
                    const topScore =
                      proj.clips.length > 0
                        ? Math.max(...proj.clips.map((c) => c.viralScore.overall))
                        : null;
                    return (
                      <tr
                        key={proj.id}
                        className="hover:bg-white/[0.025] transition-colors"
                      >
                        <td className="py-3.5 px-5">
                          <div className="font-medium text-white truncate max-w-[260px]">
                            {proj.title}
                          </div>
                          <div className="text-xs text-slate-400 font-mono tabular-nums mt-0.5">
                            {new Date(proj.createdAt).toLocaleString()}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-xs text-slate-300 capitalize">
                          {proj.sourceType}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-300">
                          {proj.durationSeconds > 0
                            ? formatDurationLabel(proj.durationSeconds)
                            : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-slate-300">
                          {proj.clips.length}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-white font-medium">
                          {topScore !== null ? `${topScore}/100` : '—'}
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          {proj.status === 'ready' ? (
                            <span className="text-emerald-400 font-medium">Ready</span>
                          ) : proj.status === 'error' ? (
                            <span className="inline-flex items-center gap-1 text-rose-400 font-medium">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Failed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-violet-300 font-medium">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              {proj.progressPercent}%
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-5 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => onOpenProject(proj.id)}
                              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white transition-colors whitespace-nowrap"
                            >
                              {proj.status === 'ready' ? 'Open Studio' : 'Inspect'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(proj.id, proj.title)}
                              disabled={deletingId === proj.id}
                              aria-label={`Delete ${proj.title}`}
                              className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-white/[0.05] transition-colors disabled:opacity-40"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
