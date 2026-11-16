import type {
  CaptionLanguage,
  Clip,
  DashboardSummary,
  Project,
  WorkspaceQuota,
} from './clipLogic';

async function parseError(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (data && typeof data.error === 'string') return data.error;
  } catch {
    // Fallback
  }
  return `Request failed with status ${res.status}`;
}

export async function fetchDashboard(): Promise<DashboardSummary> {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function fetchProject(projectId: string): Promise<Project> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`);
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export function uploadVideoWithProgress(
  file: File,
  options: {
    title?: string;
    targetClipDuration: 15 | 30 | 45 | 60;
    requestedClipCount: number;
    language: CaptionLanguage;
  },
  onProgress: (percent: number, loadedBytes: number, totalBytes: number) => void
): Promise<Project> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append('video', file);
    if (options.title) formData.append('title', options.title);
    formData.append('targetClipDuration', String(options.targetClipDuration));
    formData.append('requestedClipCount', String(options.requestedClipCount));
    formData.append('language', options.language);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/projects/upload');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        const pct = Math.round((ev.loaded / ev.total) * 100);
        onProgress(pct, ev.loaded, ev.total);
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 200 && xhr.status < 300 && parsed.project) {
          resolve(parsed.project as Project);
        } else {
          reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during video upload.'));
    xhr.send(formData);
  });
}

export async function submitYouTubeProject(payload: {
  url: string;
  targetClipDuration: 15 | 30 | 45 | 60;
  requestedClipCount: number;
  language: CaptionLanguage;
}): Promise<Project> {
  const res = await fetch('/api/projects/youtube', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function createSampleProject(payload: {
  targetClipDuration: 15 | 30 | 45 | 60;
  requestedClipCount: number;
  language: CaptionLanguage;
}): Promise<Project> {
  const res = await fetch('/api/projects/sample', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { project: Project };
  return data.project;
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function updateClip(
  projectId: string,
  clipId: string,
  patch: Partial<Clip>
): Promise<Clip> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { clip: Clip };
  return data.clip;
}

export async function exportClipMp4(
  projectId: string,
  clipId: string
): Promise<{ downloadUrl: string; fileSizeBytes: number; resolution: string }> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/clips/${encodeURIComponent(clipId)}/export`,
    { method: 'POST' }
  );
  if (!res.ok) throw new Error(await parseError(res));
  return res.json();
}

export async function updateWorkspaceProfile(
  userName: string,
  userEmail: string
): Promise<WorkspaceQuota> {
  const res = await fetch('/api/workspace/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userName, userEmail }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { quota: WorkspaceQuota };
  return data.quota;
}

export async function attachVideoToProject(
  projectId: string,
  file: File
): Promise<Project> {
  const formData = new FormData();
  formData.append('video', file);
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/attach-video`,
    {
      method: 'POST',
      body: formData,
    }
  );
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as { project: Project };
  return data.project;
}
