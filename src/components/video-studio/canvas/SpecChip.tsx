'use client';
import {useId,useState} from 'react';
export function SpecChip({label,value,options,onSelect,disabled}:{label:string;value:string;options:{value:string;label:string}[];onSelect:(value:string)=>void;disabled?:boolean}){
 const [open,setOpen]=useState(false),id=useId();
 return <div className="spec-chip"><button className="spec-chip-label" aria-expanded={open} aria-controls={id} disabled={disabled} onClick={()=>setOpen(!open)}>{label} ▾</button>{open&&<div id={id} className="spec-options" role="group" aria-label={label}>{options.map(option=><button key={option.value} aria-pressed={value===option.value} onClick={()=>{onSelect(option.value);setOpen(false)}}>{option.label}</button>)}</div>}</div>;
}
