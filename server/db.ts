import fs from 'fs';
import path from 'path';
import type { Clip, Project, WorkspaceQuota } from '../src/lib/clipLogic.ts';

export interface DatabaseState {
  quota: WorkspaceQuota;
  projects: Project[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'clipreach.db.json');

const DEFAULT_STATE: DatabaseState = {
  quota: {
    userName: 'Creator Studio',
    userEmail: 'creator@clipreach.ai',
    limitSeconds: 3600, // 60 free minutes
    usedSeconds: 0,
  },
  projects: [],
};

let writeChain: Promise<void> = Promise.resolve();

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function readDb(): DatabaseState {
  ensureDataDir();
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(DEFAULT_STATE, null, 2), 'utf-8');
    return structuredClone(DEFAULT_STATE);
  }
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<DatabaseState>;
    return {
      quota: {
        userName: parsed.quota?.userName || DEFAULT_STATE.quota.userName,
        userEmail: parsed.quota?.userEmail || DEFAULT_STATE.quota.userEmail,
        limitSeconds:
          typeof parsed.quota?.limitSeconds === 'number'
            ? parsed.quota.limitSeconds
            : DEFAULT_STATE.quota.limitSeconds,
        usedSeconds:
          typeof parsed.quota?.usedSeconds === 'number' ? parsed.quota.usedSeconds : 0,
      },
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export async function mutateDb<T>(updater: (state: DatabaseState) => T): Promise<T> {
  let result!: T;
  writeChain = writeChain.then(() => {
    const state = readDb();
    result = updater(state);
    ensureDataDir();
    const tmpPath = `${DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpPath, DB_PATH);
  });
  await writeChain;
  return result;
}

export function getProjectById(projectId: string): Project | undefined {
  const db = readDb();
  return db.projects.find((p) => p.id === projectId);
}

export async function upsertProject(project: Project): Promise<Project> {
  return mutateDb((state) => {
    const idx = state.projects.findIndex((p) => p.id === project.id);
    if (idx >= 0) {
      state.projects[idx] = project;
    } else {
      state.projects.unshift(project);
    }
    return project;
  });
}

export async function updateProjectFields(
  projectId: string,
  patch: Partial<Project>
): Promise<Project | null> {
  return mutateDb((state) => {
    const idx = state.projects.findIndex((p) => p.id === projectId);
    if (idx < 0) return null;
    state.projects[idx] = {
      ...state.projects[idx],
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return state.projects[idx];
  });
}

export async function updateClipInDb(
  projectId: string,
  clipId: string,
  patch: Partial<Clip>
): Promise<Clip | null> {
  return mutateDb((state) => {
    const proj = state.projects.find((p) => p.id === projectId);
    if (!proj) return null;
    const clipIdx = proj.clips.findIndex((c) => c.id === clipId);
    if (clipIdx < 0) return null;
    proj.clips[clipIdx] = {
      ...proj.clips[clipIdx],
      ...patch,
    };
    proj.updatedAt = new Date().toISOString();
    return proj.clips[clipIdx];
  });
}

export async function addUsedQuotaSeconds(seconds: number): Promise<WorkspaceQuota> {
  return mutateDb((state) => {
    state.quota.usedSeconds = Math.max(0, state.quota.usedSeconds + Math.round(seconds));
    return state.quota;
  });
}

export async function deleteProjectFromDb(projectId: string): Promise<Project | null> {
  return mutateDb((state) => {
    const idx = state.projects.findIndex((p) => p.id === projectId);
    if (idx < 0) return null;
    const [removed] = state.projects.splice(idx, 1);
    return removed;
  });
}
