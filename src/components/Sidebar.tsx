import React, { useState } from 'react';
import {
  Film,
  FolderKanban,
  LayoutDashboard,
  Menu,
  Scissors,
  UploadCloud,
  X,
} from 'lucide-react';
import { calculateRemainingMinutes, type WorkspaceQuota } from '../lib/clipLogic';

export type NavTab = 'dashboard' | 'upload' | 'history';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  quota: WorkspaceQuota;
  onUpdateProfile: (name: string, email: string) => Promise<void>;
}

const AVATAR_SRC = '/src/assets/images/creator_avatar_profile_1794826979939.jpg';

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  quota,
  onUpdateProfile,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [nameDraft, setNameDraft] = useState(quota.userName);
  const [emailDraft, setEmailDraft] = useState(quota.userEmail);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const quotaInfo = calculateRemainingMinutes(quota.usedSeconds, quota.limitSeconds);
  const limitMinutes = Math.round(quota.limitSeconds / 60);

  const navItems: Array<{ id: NavTab; label: string; icon: React.ReactNode }> = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'upload', label: 'Upload Studio', icon: <UploadCloud className="w-4 h-4" /> },
    { id: 'history', label: 'Projects & History', icon: <FolderKanban className="w-4 h-4" /> },
  ];

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    setSaving(true);
    try {
      await onUpdateProfile(nameDraft.trim(), emailDraft.trim());
      setEditingProfile(false);
    } finally {
      setSaving(false);
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between p-5 bg-[#0B0914] border-r border-white/[0.08]">
      <div>
        <div className="flex items-center justify-between mb-8">
          <button
            type="button"
            onClick={() => {
              onSelectTab('dashboard');
              setMobileOpen(false);
            }}
            className="flex items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded-lg"
          >
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white shrink-0">
              <Scissors className="w-4 h-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
              ClipReach AI
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation menu"
            className="lg:hidden p-2 text-slate-400 hover:text-white rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <nav aria-label="Primary navigation" className="space-y-1.5">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  setMobileOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-xl transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-gradient-to-r from-violet-600/20 to-blue-600/15 text-white border border-violet-500/30'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04] border border-transparent'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-8 pt-6 border-t border-white/[0.07]">
          <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
            <span>Free Monthly Quota</span>
            <span className="font-mono tabular-nums text-slate-200 font-medium">
              {quotaInfo.remainingMinutes}m / {limitMinutes}m
            </span>
          </div>
          <div className="w-full h-2 rounded-full bg-white/[0.07] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-blue-500 transition-all duration-300"
              style={{ width: `${Math.max(4, 100 - quotaInfo.usedPercent)}%` }}
            />
          </div>
          <p className="mt-2.5 text-xs text-slate-400 leading-relaxed">
            100% free tier active · No credit card or paid plan required for 1080p exports.
          </p>
        </div>
      </div>

      <div className="pt-5 border-t border-white/[0.07]">
        {editingProfile ? (
          <form onSubmit={handleSaveProfile} className="space-y-2.5">
            <div>
              <label htmlFor="profile-name" className="block text-xs text-slate-400 mb-1">
                Studio Name
              </label>
              <input
                id="profile-name"
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white/[0.05] border border-white/15 rounded-lg text-white focus:outline-none focus:border-violet-500"
                required
              />
            </div>
            <div>
              <label htmlFor="profile-email" className="block text-xs text-slate-400 mb-1">
                Creator Email
              </label>
              <input
                id="profile-email"
                type="email"
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs bg-white/[0.05] border border-white/15 rounded-lg text-white focus:outline-none focus:border-violet-500"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 py-1.5 px-3 text-xs font-medium rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => setEditingProfile(false)}
                className="py-1.5 px-3 text-xs font-medium rounded-lg bg-white/[0.06] text-slate-300 hover:bg-white/[0.1]"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {avatarFailed ? (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                  <Film className="w-4 h-4" />
                </div>
              ) : (
                <img
                  src={AVATAR_SRC}
                  alt={quota.userName}
                  referrerPolicy="no-referrer"
                  onError={() => setAvatarFailed(true)}
                  className="w-9 h-9 rounded-full object-cover border border-white/15 shrink-0"
                />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{quota.userName}</p>
                <p className="text-xs text-slate-400 truncate">{quota.userEmail}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setNameDraft(quota.userName);
                setEmailDraft(quota.userEmail);
                setEditingProfile(true);
              }}
              className="text-xs text-violet-300 hover:text-white px-2 py-1 rounded-md hover:bg-white/[0.06] whitespace-nowrap shrink-0"
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Header Bar (< 15% viewport height) */}
      <div className="lg:hidden flex items-center justify-between px-4 py-3 bg-[#0B0914]/95 border-b border-white/[0.08] sticky top-0 z-30 backdrop-blur-md">
        <button
          type="button"
          onClick={() => onSelectTab('dashboard')}
          className="flex items-center gap-2 text-white font-display font-bold text-base whitespace-nowrap"
        >
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600">
            <Scissors className="w-3.5 h-3.5" />
          </span>
          <span>ClipReach AI</span>
        </button>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono tabular-nums text-slate-300">
            {quotaInfo.remainingMinutes}m left
          </span>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation menu"
            className="p-2 rounded-lg bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
