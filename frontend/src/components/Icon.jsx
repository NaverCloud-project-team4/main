import React from 'react';

// A shared, rounded icon style keeps navigation and actions visually consistent.
export default function Icon({ name, size = 24, className = '' }) {
  const paths = {
    map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Z"/><path d="M9 3v16M15 5v16"/></>,
    feed: <><rect x="4" y="3" width="16" height="18" rx="4"/><path d="M8 8h8M8 12h8M8 16h4"/></>,
    camera: <><path d="M8 6 9.5 3h5L16 6h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></>,
    tree: <><path d="M12 21v-6M8 21h8"/><path d="M7 16a4 4 0 0 1-2-7 4 4 0 0 1 4-5 4 4 0 0 1 7 1 4 4 0 0 1 3 6 3 3 0 0 1-2 5Z"/></>,
    leaf: <><path d="M20 4C10 2 3 7 5 14c2 7 15 5 15-10Z" fill="currentColor" stroke="none"/><path d="M4 21 15 10"/></>,
    heart: <path d="M20.5 5.7a5.2 5.2 0 0 0-7.4 0L12 6.8l-1.1-1.1a5.2 5.2 0 0 0-7.4 7.4L12 21l8.5-7.9a5.2 5.2 0 0 0 0-7.4Z"/>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
    chevron: <path d="m9 5 7 7-7 7"/>,
    refresh: <><path d="M20 10a8 8 0 1 0-2 8M20 4v6h-6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  };
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.leaf}</svg>;
}
