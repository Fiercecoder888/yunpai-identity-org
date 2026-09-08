import { ArrowLeftOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { Outlet, useNavigate } from 'react-router-dom';
import { isDemoRoleEnabled } from '../app/runtimeMode';
import { RoleSwitcher } from '../features/roles/RoleSwitcher';
import { UserMenu } from '../features/roles/UserMenu';
import { VersionBadge } from '../components/VersionBadge';
import { AgentTaskCenter } from '../features/agent-tasks/AgentTaskCenter';
import { useCurrentRole } from '../features/roles/useCurrentRole';

/**
 * 工人/组长等角色工作台的外壳：复用企业助手对话页的 assistant-shell 玻璃拟态样式，
 * 不使用 workbench/dashboard 的深色侧栏+面包屑布局。顶部只保留「返回对话」+
 * 身份区（真实鉴权下是账号/退出，演示模式才是角色切换）+ 版本号。
 */
export function AssistantRoleLayout() {
  const navigate = useNavigate();
  const roleQuery = useCurrentRole();
  const qualityMode = roleQuery.data?.id === 'quality-assurance';
  const demoRoles = isDemoRoleEnabled();

  return (
    <main className={`assistant-shell sidebar-collapsed role-shell${qualityMode ? ' quality-supervision-shell' : ''}`}>
      <header className="assistant-header">
        <div className="assistant-header-left">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            aria-label={qualityMode ? '返回首页' : '返回对话'}
            onClick={() => navigate('/')}
          >
            {qualityMode ? '首页' : '对话'}
          </Button>
        </div>
        <div className="assistant-header-center">
          <div className="assistant-title">{qualityMode ? '品保流程监督' : '生产工作台'}</div>
          <div className="assistant-subtitle">{qualityMode ? 'M1-M5 全流程进度与任务提醒' : '按当前角色展示工人/组长任务'}</div>
        </div>
        <div className="assistant-header-right">
          {qualityMode ? <AgentTaskCenter supervision /> : null}
          {demoRoles ? <RoleSwitcher /> : <UserMenu />}
          <div className="assistant-header-version">
            <VersionBadge />
          </div>
        </div>
      </header>
      <div className="role-shell-content">
        <Outlet />
      </div>
    </main>
  );
}
