"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/store";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardPanel } from "@/components/dashboard/dashboard-panel";
import { VideoLibraryPanel } from "@/components/videos/video-library-panel";
import { PlaylistsPanel } from "@/components/playlists/playlists-panel";
import { StreamTasksPanel } from "@/components/streams/stream-tasks-panel";
import { RelayTasksPanel } from "@/components/relays/relay-tasks-panel";
import { MonitorPanel } from "@/components/monitor/monitor-panel";
import { SettingsPanel } from "@/components/settings/settings-panel";

const panels: Record<string, React.ComponentType> = {
  dashboard: DashboardPanel,
  videos: VideoLibraryPanel,
  playlists: PlaylistsPanel,
  streams: StreamTasksPanel,
  relays: RelayTasksPanel,
  monitor: MonitorPanel,
  settings: SettingsPanel,
};

export default function HomePage() {
  const { activePanel, setMobileSidebarOpen } = useAppStore();
  const ActiveComponent = panels[activePanel] || DashboardPanel;

  return (
    <div className="flex h-screen overflow-hidden bg-zinc-50">
      <AppSidebar />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar for mobile */}
        <header className="flex items-center gap-4 border-b border-zinc-200 bg-white px-4 py-3 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-semibold text-zinc-900">
            YouTube Live Automation
          </h1>
        </header>

        {/* Desktop top bar */}
        <header className="hidden lg:flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-3">
          <h1 className="text-lg font-semibold text-zinc-900">
            YouTube Live Automation
          </h1>
          <div className="flex items-center gap-2 text-sm text-zinc-500">
            <div className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </div>
            All systems operational
          </div>
        </header>

        {/* Scrollable content area */}
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={activePanel}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <ActiveComponent />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
    </div>
  );
}
