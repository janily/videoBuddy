// Stroke icons from the v5.1 hand-off prototype (docs/hand-off/videobuddy-v5.1/design/prototype.js).
// Decorative only: every icon is aria-hidden, so accessible names stay on the surrounding text.
const paths = {
  play: <path d="m9 5 10 7-10 7Z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  up: <path d="M12 19V5m-6 6 6-6 6 6" />,
  x: <path d="m6 6 12 12M6 18 18 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  download: <path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4" />,
  chat: <path d="M21 11.5a8.3 8.3 0 0 1-8.5 8.5H4l-2 2V12A9 9 0 0 1 11 3h1.5a8.5 8.5 0 0 1 8.5 8.5Z" />,
  file: <path d="M14 3H5v18h14V8Zm0 0v5h5M8 12h8m-8 4h6" />,
  paperclip: <path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8a2 2 0 0 1 3 3l-8 8a1 1 0 0 0 2 2l7-7" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
  chev: <path d="m9 5 7 7-7 7" />,
  refresh: <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="15" cy="7.5" r="1" /></>,
  folder: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5Z" />,
} as const;
export type IconName = keyof typeof paths;
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={`icon${className ? ` ${className}` : ''}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
