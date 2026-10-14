import React from 'react';

/** Moe Tracker owl mark. Text is rendered separately so branding never clips. */
export default function Logo({ size = 40, className = '' }: { size?: number; className?: string }) {
  return <img src="/moe-owl-emblem-256.png" width={size} height={size} className={`object-contain ${className}`} alt="Moe Tracker owl" draggable={false} />;
}
