import {emptyTelemetry,observe,type Telemetry} from './telemetry'
import { create } from 'zustand'
import { emptyTranscript, reduceEvent, type Event, type Transcript, type RpcSessionState, type UiRequest } from './protocol'
export type Panel = 'chat' | 'sessions' | 'tree' | 'commands' | 'settings' | 'console' | 'changes' | 'pi-tools'
export type SettingsPage = 'general' | 'providers' | 'sessions' | 'tree' | 'pi-tools' | 'changes' | 'console'
export type WorkspaceMode = 'project' | 'home'
export type Workspace = {
  telemetry:Telemetry; inspector:boolean; transcript: Transcript; state: RpcSessionState | null; connection: 'offline' | 'connecting' | 'online';
  cwd:string; connectionId:string; homeDir:string; workspaceMode:WorkspaceMode; piVersion:string; panel:Panel; settingsPage:SettingsPage; error:string | null; draft:string;
  dialogs:UiRequest[]; notices:string[]; statuses:Record<string,string>; widgets:Record<string,string[]>;
  set: (patch: Partial<Omit<Workspace,'set'|'event'>>) => void; event:(event:Event)=>void;
}
export const useWorkspace=create<Workspace>((set)=>({
  telemetry:emptyTelemetry(),inspector:false,transcript:emptyTranscript(),state:null,connection:'offline',cwd:'',connectionId:'',homeDir:'',workspaceMode:'project',piVersion:'',panel:'chat',settingsPage:'general',error:null,draft:'',dialogs:[],notices:[],statuses:{},widgets:{},
  set:(patch)=>set(patch),event:(event)=>set(current=>({transcript:reduceEvent(current.transcript,event),telemetry:observe(current.telemetry,event)})),
}))
