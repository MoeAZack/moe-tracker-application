import React from 'react';
import { resourceAssetPath } from '../../lib/resourceCatalog';

const initials = (value: string) => value.trim().split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?';

function MediaTile({ src, label, className, imageClassName }: { src: string; label: string; className: string; imageClassName?: string }) {
  return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-gradient-to-br from-cyan-500/20 via-slate-900 to-violet-500/20 font-mono font-black text-cyan-200 ring-1 ring-inset ring-white/10 ${className}`} aria-hidden="true">
    <span>{initials(label)}</span>
    <img src={src} alt="" loading="lazy" className={`absolute inset-0 h-full w-full ${imageClassName || 'object-cover'}`} onError={event => { event.currentTarget.style.display = 'none'; }} />
  </span>;
}

export function AgentPortrait({ name, className = 'h-9 w-9 rounded-lg' }: { name: string; className?: string }) {
  return <MediaTile src={resourceAssetPath('agent', name)} label={name} className={className} imageClassName="object-cover object-top" />;
}

export function MapThumbnail({ name, className = 'h-10 w-16 rounded-lg' }: { name: string; className?: string }) {
  return <MediaTile src={resourceAssetPath('map', name)} label={name} className={className} imageClassName="object-cover" />;
}

export function WeaponThumbnail({ name, className = 'h-11 w-24 rounded-lg' }: { name: string; className?: string }) {
  return <MediaTile src={resourceAssetPath('weapon', name)} label={name} className={className} imageClassName="object-contain px-1 py-1.5 brightness-150 contrast-150 drop-shadow-[0_1px_7px_rgba(103,232,249,0.7)]" />;
}
