import { Tabs } from 'antd';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTabsStore } from '../store/useTabsStore';

export function ModuleTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const { tabs, closeTab } = useTabsStore();

  return (
    <div className="module-tabs" data-testid="module-tabs">
      <Tabs
        hideAdd
        type="editable-card"
        activeKey={location.pathname}
        items={tabs.map((tab) => ({
          key: tab.path,
          label: tab.title,
          closable: tab.closable,
        }))}
        onChange={(key) => navigate(key)}
        onEdit={(targetKey, action) => {
          if (action !== 'remove' || typeof targetKey !== 'string') {
            return;
          }

          const nextPath = closeTab(targetKey);
          if (targetKey === location.pathname) {
            navigate(nextPath);
          }
        }}
      />
    </div>
  );
}
