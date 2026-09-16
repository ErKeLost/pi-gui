import {useEffect,useState} from 'react'

export function usePageVisible(){
 const [visible,setVisible]=useState(()=>!document.hidden)
 useEffect(()=>{const update=()=>setVisible(!document.hidden);document.addEventListener('visibilitychange',update);return()=>document.removeEventListener('visibilitychange',update)},[])
 return visible
}
