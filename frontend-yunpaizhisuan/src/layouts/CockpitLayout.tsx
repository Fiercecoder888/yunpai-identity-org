import { Outlet } from 'react-router-dom';

/** 全屏驾驶舱布局：无侧栏/无标签页，深色主题由 /cockpit 页面引入。 */
export function CockpitLayout() {
  return (
    <div className="cockpit-shell">
      <Outlet />
    </div>
  );
}
