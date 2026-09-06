import { isAppPath, routeMeta } from './router';

export type PageHeadingInfo = {
  title: string;
  description?: string;
  groupKey?: string;
  breadcrumb?: string;
};

const resolvePath = (path?: string) => {
  if (path) {
    return path;
  }
  if (typeof window === 'undefined') {
    return '/';
  }
  return window.location.pathname;
};

export function usePageHeading(path?: string): PageHeadingInfo {
  const resolved = resolvePath(path);
  if (!isAppPath(resolved)) {
    return { title: '' };
  }
  const meta = routeMeta[resolved];
  return {
    title: meta.pageTitle ?? meta.navTitle,
    description: meta.description,
    groupKey: meta.groupKey,
    breadcrumb: meta.breadcrumb ?? meta.navTitle,
  };
}
