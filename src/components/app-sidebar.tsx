"use client";

import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Video,
  ListVideo,
  Radio,
  Share2,
  Activity,
  Settings,
  RadioTower,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAppStore, type PanelType } from "@/lib/store";

const navItems: { id: PanelType; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "videos", label: "Videos", icon: Video },
  { id: "playlists", label: "Playlists", icon: ListVideo },
  { id: "streams", label: "Streams", icon: Radio },
  { id: "relays", label: "Relays", icon: Share2 },
  { id: "monitor", label: "Monitor", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const { activePanel, setActivePanel } = useAppStore();

  return (
    <div className="flex h-full flex-col">
      {/* Logo / Branding */}
      <div className="flex items-center gap-3 px-4 py-5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <RadioTower className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white tracking-tight">
              AI Agent
            </span>
            <span className="text-[11px] text-zinc-500">
              Live Automation
            </span>
          </div>
        )}
      </div>

      <Separator className="bg-zinc-800" />

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePanel === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActivePanel(item.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150",
                  isActive
                    ? "bg-emerald-600/15 text-emerald-400"
                    : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                )}
              >
                <Icon
                  className={cn(
                    "h-5 w-5 shrink-0",
                    isActive ? "text-emerald-400" : "text-zinc-500"
                  )}
                />
                {!collapsed && <span>{item.label}</span>}
                {isActive && !collapsed && (
                  <div className="ml-auto h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
              </button>
            );
          })}
        </nav>
      </ScrollArea>

      <Separator className="bg-zinc-800" />

      {/* Status */}
      <div className="px-4 py-4">
        <div className="flex items-center gap-2">
          <div className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </div>
          {!collapsed && (
            <span className="text-xs text-zinc-500">System Online</span>
          )}
        </div>
      </div>
    </div>
  );
}

function DesktopSidebar() {
  const { sidebarCollapsed, toggleSidebar } = useAppStore();

  return (
    <aside
      className={cn(
        "hidden lg:flex flex-col border-r border-zinc-800 bg-zinc-900 transition-all duration-300",
        sidebarCollapsed ? "w-[68px]" : "w-[240px]"
      )}
    >
      <SidebarContent collapsed={sidebarCollapsed} />
      <div className="border-t border-zinc-800 p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          className="w-full text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
        >
          {sidebarCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}

function MobileSidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen, setActivePanel } =
    useAppStore();

  return (
    <Sheet open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <SheetContent
        side="left"
        className="w-[260px] bg-zinc-900 border-zinc-800 p-0"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Navigation</SheetTitle>
        </SheetHeader>
        <SidebarContent collapsed={false} />
      </SheetContent>
    </Sheet>
  );
}

export function AppSidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileSidebar />
    </>
  );
}
