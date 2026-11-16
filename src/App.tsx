import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ClipStudioView } from './components/ClipStudioView';
import { DashboardView } from './components/DashboardView';
import { Sidebar, type NavTab } from './components/Sidebar';
import {
  deleteProject,
  fetchDashboard,
  fetchProject,
  updateWorkspaceProfile,
} from './lib/api';
import { BACKGROUND_VIDEOS, type DashboardSummary, type Project } from './lib/clipLogic';

const EMPTY_SUMMARY: DashboardSummary = {
  quota: {
    userName: 'Creator Studio',
    userEmail: 'creator@clipreach.ai',
    limitSeconds: 3600,
    usedSeconds: 0,
  },
  stats: {
    totalVideosProcessed: 0,
    totalClipsGenerated: 0,
    avgViralScore: 0,
    remainingMinutes: 60,
  },
  projects: [],
  backgrounds: BACKGROUND_VIDEOS,
};

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [summary, setSummary] = useState<DashboardSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const loadDashboard = useCallback(async () => {
    try {
      const data = await fetchDashboard();
      setSummary(data);
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [activeTab, selectedProjectId]);

  // Poll dashboard lightly if any project is actively processing while on dashboard
  useEffect(() => {
    const hasProcessing = summary.projects.some(
      (p) => p.status !== 'ready' && p.status !== 'error'
    );
    if (!hasProcessing || selectedProjectId) return;
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [summary.projects, selectedProjectId, loadDashboard]);

  const handleOpenProject = async (projectId: string) => {
    setSelectedProjectId(projectId);
    try {
      const fresh = await fetchProject(projectId);
      setSummary((prev) => ({
        ...prev,
        projects: prev.projects.map((p) => (p.id === fresh.id ? fresh : p)),
      }));
    } catch {
      // Fallback to cached project in summary
    }
  };

  const handleProjectCreated = (project: Project) => {
    setSummary((prev) => ({
      ...prev,
      projects: [project, ...prev.projects],
    }));
    setSelectedProjectId(project.id);
  };

  const handleProjectUpdated = (updated: Project) => {
    setSummary((prev) => {
      const nextProjects = prev.projects.map((p) => (p.id === updated.id ? updated : p));
      const ready = nextProjects.filter((p) => p.status === 'ready');
      const totalClipsGenerated = ready.reduce((acc, p) => acc + p.clips.length, 0);
      const scores = ready.flatMap((p) => p.clips.map((c) => c.viralScore.overall));
      const avgViralScore =
        scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      return {
        ...prev,
        stats: {
          ...prev.stats,
          totalVideosProcessed: ready.length,
          totalClipsGenerated,
          avgViralScore,
        },
        projects: nextProjects,
      };
    });
  };

  const handleDeleteProject = async (projectId: string) => {
    await deleteProject(projectId);
    setSummary((prev) => ({
      ...prev,
      projects: prev.projects.filter((p) => p.id !== projectId),
    }));
    if (selectedProjectId === projectId) {
      setSelectedProjectId(null);
    }
    void loadDashboard();
  };

  const handleUpdateProfile = async (name: string, email: string) => {
    const quota = await updateWorkspaceProfile(name, email);
    setSummary((prev) => ({ ...prev, quota }));
  };

  const activeProject = selectedProjectId
    ? summary.projects.find((p) => p.id === selectedProjectId) || null
    : null;

  return (
    <div
      className="min-h-screen flex flex-col lg:flex-row bg-[#07070B] text-slate-100"
      style={{
        backgroundImage:
          'radial-gradient(ellipse 80% 45% at 50% -8%, rgba(109, 40, 217, 0.16), transparent 70%)',
      }}
    >
      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setSelectedProjectId(null);
          setActiveTab(tab);
        }}
        quota={summary.quota}
        onUpdateProfile={handleUpdateProfile}
      />

      <div className="flex-1 min-w-0">
        {error && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
            <div
              role="alert"
              className="flex items-center gap-2.5 p-3.5 rounded-xl bg-rose-950/50 border border-rose-500/30 text-sm text-rose-200"
            >
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {activeProject ? (
          <ClipStudioView
            initialProject={activeProject}
            onBack={() => {
              setSelectedProjectId(null);
              void loadDashboard();
            }}
            onProjectUpdated={handleProjectUpdated}
            onDeleteProject={handleDeleteProject}
          />
        ) : (
          <DashboardView
            activeTab={activeTab}
            summary={summary}
            loading={loading}
            onSelectTab={setActiveTab}
            onOpenProject={(id) => void handleOpenProject(id)}
            onProjectCreated={handleProjectCreated}
            onDeleteProject={handleDeleteProject}
          />
        )}
      </div>
    </div>
  );
}
