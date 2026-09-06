type RuntimeEnv = {
  readonly [key: string]: string | boolean | undefined;
  VITE_API_BASE_URL?: string;
  VITE_ENABLE_MSW?: string;
  VITE_LENOVO_TEST_IDENTITY?: string;
  VITE_ENABLE_DEMO_ROLES?: string;
};

const buildRuntimeEnv = (): RuntimeEnv => ({
  // Keep these as direct import.meta.env property reads. Vite does not include
  // Docker-provided VITE_* values when the whole import.meta.env object is
  // passed through as a default argument in a production bundle.
  VITE_API_BASE_URL: import.meta.env.VITE_API_BASE_URL,
  VITE_ENABLE_MSW: import.meta.env.VITE_ENABLE_MSW,
  VITE_LENOVO_TEST_IDENTITY: import.meta.env.VITE_LENOVO_TEST_IDENTITY,
  VITE_ENABLE_DEMO_ROLES: import.meta.env.VITE_ENABLE_DEMO_ROLES,
});

export const isMswDemoMode = (env: RuntimeEnv = buildRuntimeEnv()) =>
  env.VITE_ENABLE_MSW !== 'false' && !env.VITE_API_BASE_URL;

export const isLenovoTestIdentity = (env: RuntimeEnv = buildRuntimeEnv()) =>
  env.VITE_LENOVO_TEST_IDENTITY === 'true';

/**
 * 演示角色切换（复用 RoleSwitcher 的 demo 角色机制）是否可用。
 *
 * 默认在 MSW demo 模式可用；生产测试部署（走真实网关、MSW 关闭）需要显式开启
 * `VITE_ENABLE_DEMO_ROLES=true`，以便用「测试工号区分身份」的方式在前端切换
 * 组长/工人等角色裁剪视图。开启后仅改变前端角色裁剪，不影响真实后端调用。
 */
export const isDemoRoleEnabled = (env: RuntimeEnv = buildRuntimeEnv()) =>
  isMswDemoMode(env) || env.VITE_ENABLE_DEMO_ROLES === 'true';
