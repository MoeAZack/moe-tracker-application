import React from 'react';

const safeName = (value: string) => value.trim().replace(/[^A-Za-z0-9_-]/g, '_');
const initials = (value: string) => value.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';

function MediaTile({ src, label, className, imageClassName }: { src: string; label: string; className: string; imageClassName?: string }) {
  return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-cyan-500/20 via-slate-900 to-violet-500/20 font-mono font-black text-cyan-200 ring-1 ring-inset ring-white/10 ${className}`} aria-hidden="true">
    <span>{initials(label)}</span>
    <img src={src} alt="" loading="lazy" className={`absolute inset-0 h-full w-full ${imageClassName || 'object-cover'}`} onError={event => { event.currentTarget.style.display = 'none'; }} />
  </span>;
}

export function AgentPortrait({ name, className = 'h-9 w-9 rounded-lg' }: { name: string; className?: string }) {
  return <MediaTile src={`/agents/${encodeURIComponent(name === 'KAY/O' ? 'KAY_O' : safeName(name))}.png`} label={name} className={className} imageClassName="object-cover object-top" />;
}

export function MapThumbnail({ name, className = 'h-10 w-16 rounded-lg' }: { name: string; className?: string }) {
  return <MediaTile src={`/maps/${encodeURIComponent(safeName(name))}.png`} label={name} className={className} imageClassName="object-cover" />;
}

export function WeaponThumbnail({ name, className = 'h-11 w-24 rounded-lg' }: { name: string; className?: string }) {
  return <MediaTile src={`/weapons/${encodeURIComponent(safeName(name))}.png`} label={name} className={className} imageClassName="object-contain px-1.5 py-2 brightness-125 contrast-125 drop-shadow-[0_0_6px_rgba(103,232,249,0.55)]" />;
}
