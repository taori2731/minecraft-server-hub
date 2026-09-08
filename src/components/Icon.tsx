import type { SVGProps } from "react";

export type IconName =
  | "add" | "back" | "chart" | "check" | "chevron" | "clipboard" | "clock"
  | "close" | "console" | "download" | "file" | "folder" | "gear" | "info"
  | "invite" | "list" | "memory" | "menu" | "moon" | "more" | "play"
  | "plugin" | "refresh" | "restart" | "search" | "server" | "stop" | "sun" | "trash" | "users";

const paths: Record<IconName, React.ReactNode> = {
  add: <><path d="M12 5v14M5 12h14" /></>,
  back: <path d="m15 18-6-6 6-6" />,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m9 18 6-6-6-6" />,
  clipboard: <><rect x="8" y="4" width="11" height="16" rx="2"/><path d="M16 4V2H5a2 2 0 0 0-2 2v13h5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  console: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
  download: <><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/></>,
  file: <><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></>,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19 13.5v-3l-2-.7-.8-1.8.9-1.9L15 4l-1.9.9-1.9-.8L10.5 2h-3l-.7 2.1-1.8.8L3.1 4 1 6.1 1.9 8l-.8 1.8-2.1.7v3l2.1.7.8 1.8-.9 1.9L3.1 20l1.9-.9 1.8.8.7 2.1h3l.7-2.1 1.9-.8 1.9.9 2.1-2.1-.9-1.9.8-1.8z" transform="translate(2) scale(.83)"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></>,
  invite: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7M18 8v6M15 11h6"/></>,
  list: <><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
  memory: <><rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M19 9h3M2 15h3M19 15h3"/></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  moon: <path d="M20 15.5A8 8 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z" />,
  more: <><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></>,
  play: <path d="m8 5 11 7-11 7z" fill="currentColor" stroke="none" />,
  plugin: <path d="M9 3v4H5v4H2v5h5v5h5v-3h4v-4h5V9h-4V5h-5V2z" />,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 9M5.5 15A7 7 0 0 0 18 17.5l2-2.5"/></>,
  restart: <><path d="M20 7v5h-5"/><path d="M18.5 9A7 7 0 1 0 19 15"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  server: <><rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6h.01M7 17h.01M11 6h7M11 17h7"/></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor" stroke="none" />,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></>,
  users: <><circle cx="9" cy="8" r="3"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7M16 5a3 3 0 0 1 0 6M17 14c2.5.5 4 2.5 4 6"/></>,
};

export function Icon({ name, size = 22, ...props }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {paths[name]}
    </svg>
  );
}
