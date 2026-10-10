const S = ({ children, strokeWidth = 2, ...p }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
    stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="square"
    strokeLinejoin="miter" aria-hidden="true" {...p}>{children}</svg>
);

export const Crescent = ({ size = 22, ...p }) => (
  <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" {...p}>
    <defs>
      <linearGradient id="chBrandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#DDDDDD" />
        <stop offset="100%" stopColor="#7EA3CC" />
      </linearGradient>
    </defs>
    <path d="M22 4a12 12 0 1 0 6 22A14 14 0 0 1 22 4z" fill="url(#chBrandGrad)" />
  </svg>
);

/** Utilitarian rectangular progress gauge in steel blue. */
export function MoonProgress({ pct = 0, size = 26 }) {
  const progress = Math.min(Math.max(pct, 0), 100);
  return (
    <svg viewBox="0 0 24 12" width={size} height={12} role="progressbar"
      aria-label="Upload progress" aria-valuemin="0" aria-valuemax="100"
      aria-valuenow={Math.round(progress)} style={{ flexShrink: 0 }}>
      <rect x="0.5" y="0.5" width="23" height="11" fill="var(--bg-deep)" stroke="var(--line-strong)" strokeWidth="1" />
      <rect x="2" y="2" width={(20 * progress) / 100} height="8" fill="var(--ch-steel)" />
    </svg>
  );
}

export const FolderIcon = (p) => (
  <S {...p}><path d="M3 7h6l2 2h10v10H3z" /><path d="M3 7v12" /></S>
);
export const FileIcon = (p) => (
  <S {...p}><path d="M14 3H5v18h14V8z" /><path d="M14 3v5h5" /></S>
);
export const ImgIcon = (p) => (
  <S {...p}><rect x="3" y="5" width="18" height="14" /><circle cx="8.5" cy="10" r="1.5" /><path d="m21 17-5-5-4 4-2-2-5 5" /></S>
);
export const VidIcon = (p) => (
  <S {...p}><rect x="3" y="5" width="18" height="14" /><path d="m10 9 5 3-5 3z" /></S>
);
export const MusicIcon = (p) => (
  <S {...p}><path d="M9 18V6l10-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="16.5" cy="16" r="2.5" /></S>
);
export const ZipIcon = (p) => (
  <S {...p}><rect x="4" y="3" width="16" height="18" /><path d="M12 3v2m0 2v2m0 2v2" /></S>
);
export const CodeIcon = (p) => (
  <S {...p}><path d="m8 8-4 4 4 4M16 8l4 4-4 4" /></S>
);
export const UploadIcon = (p) => (
  <S {...p}><path d="M12 16V4m0 0 4 4m-4-4L8 8" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></S>
);
export const PlusIcon = (p) => (<S {...p}><path d="M12 5v14M5 12h14" /></S>);
export const SearchIcon = (p) => (
  <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>
);
export const DownloadIcon = (p) => (
  <S {...p}><path d="M12 4v12m0 0 4-4m-4 4-4-4" /><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2" /></S>
);
export const TrashIcon = (p) => (
  <S {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.8 12a2 2 0 0 1-2 1.9H8.8a2 2 0 0 1-2-1.9L6 7" /></S>
);
export const RestoreIcon = (p) => (
  <S {...p}><path d="M4 7v5h5" /><path d="M5.5 12a7 7 0 1 0 2-5" /></S>
);
export const MoveIcon = (p) => (
  <S {...p}><path d="M5 7h9" /><path d="m11 4 3 3-3 3" /><path d="M19 17h-9" /><path d="m13 14-3 3 3 3" /></S>
);
export const EditIcon = (p) => (
  <S {...p}><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z" /><path d="m13.5 6.5 3 3" /></S>
);
export const XIcon = (p) => (<S {...p}><path d="M6 6l12 12M18 6 6 18" /></S>);
export const LogoutIcon = (p) => (
  <S {...p}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></S>
);
export const ShareIcon = (p) => (
  <S {...p}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></S>
);
export const ChevR = (p) => (<S width="14" height="14" {...p}><path d="m9 6 6 6-6 6" /></S>);
export const LinkIcon = (p) => (
  <S {...p}><path d="M10 14a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.6-5.6l-1.7 1.7" /><path d="M14 10a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.6 5.6l1.7-1.7" /></S>
);
export const UsersIcon = (p) => (
  <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 5a3.5 3.5 0 0 1 0 6.6M15.5 14a6.5 6.5 0 0 1 6 6" /></S>
);
export const MegaphoneIcon = (p) => (
  <S {...p}><path d="M11 4a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-4l-3 4V4h7z"/><path d="M13 5v4l5 2V3l-5 2z"/></S>
);
export const LockIcon = (p) => (
  <S {...p}><rect x="3" y="11" width="18" height="11" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></S>
);
export const ShieldIcon = (p) => (
  <S {...p}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></S>
);
export const TelegramIcon = (p) => (
  <S {...p}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></S>
);
export const CopyIcon = (p) => (
  <S {...p}><rect x="9" y="9" width="13" height="13" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></S>
);
export const CheckIcon = (p) => (
  <S {...p}><polyline points="20 6 9 17 4 12" /></S>
);


export function iconFor(node) {
  if (node.type === "folder") return FolderIcon;
  const m = node.mime || "", n = node.name.toLowerCase();
  if (m.startsWith("image/")) return ImgIcon;
  if (m.startsWith("video/")) return VidIcon;
  if (m.startsWith("audio/")) return MusicIcon;
  if (/\.(zip|rar|7z|tar|gz|xz)$/.test(n)) return ZipIcon;
  if (/\.(js|jsx|ts|tsx|py|c|cpp|h|ino|rs|go|java|sh|json|yml|yaml|html|css|sql|m|v|vhd)$/.test(n)) return CodeIcon;
  return FileIcon;
}
