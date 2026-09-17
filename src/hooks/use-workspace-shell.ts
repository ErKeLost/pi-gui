import { useEffect, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useProjects } from "../lib/projects";
import { changeSession, connect, native, report } from "../lib/rpc";
import { useWorkspace } from "../lib/store";

type Discovery = { pi: string; node: string; version: string; cwd: string; home: string };
let started = false;

export function useWorkspaceBootstrap() {
  const discovery = useQuery({
    queryKey: ["discovery"],
    queryFn: () => invoke<Discovery>("discover"),
    enabled: native,
  });

  useEffect(() => {
    if (!discovery.data || started) return;
    started = true;
    useWorkspace.getState().set({ homeDir: discovery.data.home, piVersion: discovery.data.version });
    if (localStorage.getItem("pi-gui.workspaceMode") === "home") {
      void connect(discovery.data.home, "home").catch(report);
      return;
    }
    const storedPath = localStorage.getItem("pi-gui.cwd");
    const savedProjects = useProjects.getState().projects;
    if (!storedPath && savedProjects.length === 0) {
      useWorkspace.getState().set({ cwd: "", workspaceMode: "project" });
      return;
    }
    const path = storedPath || savedProjects[0]?.path || discovery.data.cwd;
    useProjects.getState().add([path]);
    void connect(path, "project").catch(report);
  }, [discovery.data]);

  useEffect(() => {
    if (discovery.error) useWorkspace.getState().set({ error: String(discovery.error) });
  }, [discovery.error]);
}

export function useWorkspaceShortcuts(
  online: boolean,
  setSidebarOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key === "n") {
        event.preventDefault();
        if (online) void changeSession({ type: "new_session" }).catch(report);
      }
      if (event.key === ",") {
        event.preventDefault();
        useWorkspace.getState().set({ panel: "settings", settingsPage: "general" });
      }
      if (event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarOpen(value => !value);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [online, setSidebarOpen]);
}
