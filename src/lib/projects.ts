import {create} from 'zustand'
export type Project={path:string;name:string}
export function mergeProjects(existing:Project[],paths:string[]):Project[]{const all=new Map(existing.map(p=>[p.path,p]));for(const raw of paths){const path=raw.replace(/\/+$/,'')||'/';all.set(path,{path,name:path.split('/').filter(Boolean).at(-1)||'/'})}return [...all.values()]}
function load():Project[]{try{const value=JSON.parse(localStorage.getItem('pi-gui.projects')??'[]');return Array.isArray(value)?value.filter((item:Project)=>item&&typeof item.path==='string'&&typeof item.name==='string'):[]}catch{return []}}
export const useProjects=create<{projects:Project[];add:(paths:string[])=>void}>(set=>({projects:load(),add:paths=>set(state=>{const projects=mergeProjects(state.projects,paths);localStorage.setItem('pi-gui.projects',JSON.stringify(projects));return {projects}})}))
