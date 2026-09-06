import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuditLogPage } from '../pages/AuditLogPage';
import { M5FlowDashboardPage } from '../pages/M5FlowDashboardPage';
import { PurchaseWarningsPage } from '../pages/PurchaseWarningsPage';
import { TaskBoardPage } from '../pages/TaskBoardPage';
import { renderWithApp } from '../tests/testUtils';
import { sidebarGroups } from '../features/roles/sidebarConfig';
import { routeMeta, type AppPath } from './router';

const sidebarLabels = new Map<string, string>();
for (const group of sidebarGroups) {
  for (const item of group.items) {
    sidebarLabels.set(item.key, item.label);
  }
}

describe('routeMeta consistency', () => {
  it('keeps every routeMeta path present in the sidebar with the same navTitle label', () => {
    const paths = Object.keys(routeMeta) as AppPath[];
    for (const path of paths) {
      expect(sidebarLabels.has(path), `侧栏缺少 ${path}`).toBe(true);
      expect(sidebarLabels.get(path)).toBe(routeMeta[path].navTitle);
    }
    expect(sidebarLabels.size).toBe(paths.length);
  });

  it.each([
    ['/modules/purchase-warnings', <PurchaseWarningsPage key="purchase-warnings" />],
    ['/modules/m5-flow', <M5FlowDashboardPage key="m5-flow" />],
    ['/tasks', <TaskBoardPage key="tasks" />],
    ['/audit', <AuditLogPage key="audit" />],
  ] as Array<[AppPath, React.ReactElement]>)(
    'renders an h2 page heading on %s matching routeMeta navTitle',
    async (path, node) => {
      renderWithApp(<MemoryRouter initialEntries={[path]}>{node}</MemoryRouter>);
      const heading = await screen.findByRole('heading', { level: 2 }, { timeout: 8000 });
      expect(heading.textContent).toBe(routeMeta[path].navTitle);
      expect(heading).toHaveAttribute('data-testid', 'page-heading-title');
    },
  );
});
