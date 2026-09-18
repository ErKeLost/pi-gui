import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useProjects } from "../lib/projects";
import { changeSession, connect, connectRemoteConnection, dispatchRemoteEvent, loadMessages, report } from "../lib/rpc";
import { detectRuntimeEnvironment } from "../lib/runtime-environment";
import { openRemoteRuntime, storedPairingUri } from "../lib/remote-runtime";
import { useWorkspace } from "../lib/store";

type Discovery = { pi: string; node: string; version: string; cwd: string; home: string };
let runtimeStarted = false;

type PairingState = { uri: string; required: boolean; connecting: boolean; error: string | null };

export function useWorkspaceBootstrap() {
  const runtimeTarget = useWorkspace(state => state.runtimeTarget);
  const [pairing, setPairing] = useState<PairingState>(() => ({ uri: storedPairingUri(), required: false, connecting: false, error: null }));
  const [remoteRevision, setRemoteRevision] = useState(0);
  const discovery = useQuery({
    queryKey: ["discovery"],
    queryFn: () => invoke<Discovery>("discover"),
    enabled: runtimeTarget === "desktop",
  });

  const attachRemote = useCallback(async (uri: string) => {
    setPairing(current => ({ ...current, uri, connecting: true, required: true, error: null }));
    try {
      const snapshot = await openRemoteRuntime(uri, {
        onPiEvent: dispatchRemoteEvent,
        onEvent: event => {
          if (event.type === "connection.invalidated") void loadMessages(event.project).catch(report);
        },
        onState: state => {
          if (state === "offline" && useWorkspace.getState().runtimeTarget === "mobile") {
            useWorkspace.getState().set({ connection: "offline", error: "电脑连接已断开" });
            setPairing(current => ({ ...current, required: true, connecting: false, error: "电脑连接已断开" }));
          }
        },
        onError: error => useWorkspace.getState().set({ error: error.message }),
      });
      const savedId = localStorage.getItem("orbit.remote.connection.v1");
      const connection = snapshot.connections.find(item => item.id === savedId) ?? snapshot.connections[0];
      if (!connection) throw new Error("电脑端当前没有可用的 Pi 连接，请先在电脑打开工作区");
      useWorkspace.getState().set({ runtimeTarget: "mobile", cwd: connection.cwd, connectionId: connection.id, workspaceMode: "project", error: null });
      useProjects.getState().add(snapshot.connections.map(item => item.cwd));
      await connectRemoteConnection(connection);
      setPairing(current => ({ ...current, uri, connecting: false, required: false, error: null }));
      setRemoteRevision(value => value + 1);
    } catch (error) {
      setPairing(current => ({ ...current, connecting: false, required: true, error: String(error instanceof Error ? error.message : error) }));
    }
  }, []);

  useEffect(() => {
    if (runtimeStarted) return;
    runtimeStarted = true;
    void detectRuntimeEnvironment().then(environment => {
      useWorkspace.getState().set({ runtimeTarget: environment.target });
      if (environment.target === "mobile") {
        const uri = storedPairingUri();
        if (uri) void attachRemote(uri);
        else setPairing(current => ({ ...current, required: true }));
      }
    }).catch(report);
  }, [attachRemote]);

  useEffect(() => {
    if (!discovery.data) return;
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

  return { runtimeTarget, pairing, remoteRevision, setPairingUri: (uri: string) => setPairing(current => ({ ...current, uri, error: null })), connectPairing: attachRemote };
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
