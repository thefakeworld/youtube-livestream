import { create } from "zustand";

export type PanelType =
  | "dashboard"
  | "videos"
  | "playlists"
  | "streams"
  | "relays"
  | "monitor"
  | "settings";

interface AppState {
  activePanel: PanelType;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  setActivePanel: (panel: PanelType) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  activePanel: "dashboard",
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  setActivePanel: (panel) =>
    set({ activePanel: panel, mobileSidebarOpen: false }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
}));
