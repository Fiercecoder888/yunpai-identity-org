import { Tag, Tooltip } from 'antd';

export type YunpaiBuildInfo = {
  commit: string;
  branch: string;
  buildTime: string;
  dirty?: boolean;
};

declare global {
  interface Window {
    __YUNPAI_BUILD__?: YunpaiBuildInfo;
  }
}

const shortCommit = (commit: string): string => (commit.length > 7 ? commit.slice(0, 7) : commit);

const readDevBuildInfo = (): YunpaiBuildInfo | undefined => {
  if (!import.meta.env.DEV || typeof document === 'undefined') {
    return undefined;
  }
  const commit = document.querySelector('meta[name="yunpai-build-commit"]')?.getAttribute('content');
  if (!commit) {
    return undefined;
  }
  return { commit, branch: 'dev', buildTime: new Date().toISOString(), dirty: false };
};

const formatBuildTime = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export function VersionBadge({ className }: { className?: string }) {
  const info = typeof window === 'undefined' ? undefined : (window.__YUNPAI_BUILD__ ?? readDevBuildInfo());
  if (!info?.commit || !info.branch || !info.buildTime) {
    return null;
  }

  const isDev = info.branch === 'dev';
  const label = isDev
    ? `dev @ ${shortCommit(info.commit)}`
    : `${shortCommit(info.commit)} · ${info.branch} · ${formatBuildTime(info.buildTime)}`;

  return (
    <Tooltip
      title={`commit: ${info.commit}${info.dirty ? ' (dirty)' : ''}\nbranch: ${info.branch}\nbuildTime: ${info.buildTime}`}
    >
      <Tag className={className ? `version-badge ${className}` : 'version-badge'} color="blue">
        {label}
      </Tag>
    </Tooltip>
  );
}
