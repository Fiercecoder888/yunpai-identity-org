/**
 * 测试人员名单（前端常量配置 + localStorage 持久化）。
 *
 * 用途：组长派工/排程时选择工人、工人端选择自己的身份。后端如提供 workers 列表
 * API 可优先复用；当前阶段以本地名单兜底，保证「下拉可搜索、可选中、选中后可派工」
 * 的流程可用。自定义名单会持久化到 localStorage，重启浏览器后仍生效。
 */
export type TestPersonnelRole = 'worker' | 'leader';

export type TestPersonnel = {
  id: string;
  name: string;
  role: TestPersonnelRole;
  station?: string;
  teamName?: string;
};

/** 测试名单版本：本地缓存与该版本不一致时回退到内置名单（新增测试人员后 +1）。 */
export const TEST_PERSONNEL_VERSION = 2;

/**
 * 本地测试名单：30 工人 + 5 组长。
 * 工人覆盖常见工位（押出/绞线/注塑/组装/包装/裁线/焊接/测试/冲压/端子/铜带/绕包…）；
 * 组长覆盖 5 个班组。
 */
export const TEST_PERSONNEL: TestPersonnel[] = [
  // 一车间 A 班（押出/绞线）
  { id: 'worker-zhangsan', name: '张三', role: 'worker', station: '押出机 01', teamName: '一车间 A 班' },
  { id: 'worker-lisi', name: '李四', role: 'worker', station: '绞线机 01', teamName: '一车间 A 班' },
  { id: 'worker-wangwu', name: '王五', role: 'worker', station: '注塑机 02', teamName: '一车间 B 班' },
  { id: 'worker-zhaoliu', name: '赵六', role: 'worker', station: '组装线 03', teamName: '一车间 B 班' },
  { id: 'worker-qianqi', name: '钱七', role: 'worker', station: '包装线 01', teamName: '二车间 A 班' },
  { id: 'worker-sunba', name: '孙八', role: 'worker', station: '裁线机 01', teamName: '一车间 A 班' },
  { id: 'worker-zhoujiu', name: '周九', role: 'worker', station: '焊接机 01', teamName: '一车间 A 班' },
  { id: 'worker-wushi', name: '吴十', role: 'worker', station: '测试台 01', teamName: '一车间 A 班' },
  { id: 'worker-zhengshi', name: '郑十一', role: 'worker', station: '押出机 02', teamName: '一车间 A 班' },
  { id: 'worker-wangshi', name: '王十二', role: 'worker', station: '绞线机 02', teamName: '一车间 A 班' },
  { id: 'worker-fengshi', name: '冯十三', role: 'worker', station: '注塑机 03', teamName: '一车间 B 班' },
  { id: 'worker-chenshi', name: '陈十四', role: 'worker', station: '组装线 04', teamName: '一车间 B 班' },
  { id: 'worker-chushi', name: '褚十五', role: 'worker', station: '包装线 02', teamName: '二车间 A 班' },
  { id: 'worker-weishi', name: '卫十六', role: 'worker', station: '冲压机 01', teamName: '二车间 A 班' },
  { id: 'worker-jiangshi', name: '蒋十七', role: 'worker', station: '端子压接机 01', teamName: '二车间 B 班' },
  { id: 'worker-shenshi', name: '沈十八', role: 'worker', station: '铜带绕包机 01', teamName: '二车间 B 班' },
  { id: 'worker-hanshi', name: '韩十九', role: 'worker', station: '绞线机 03', teamName: '二车间 B 班' },
  { id: 'worker-yangshi', name: '杨二十', role: 'worker', station: '裁线机 02', teamName: '二车间 A 班' },
  { id: 'worker-zhushi', name: '朱二十一', role: 'worker', station: '焊接机 02', teamName: '三车间 A 班' },
  { id: 'worker-qinshi', name: '秦二十二', role: 'worker', station: '测试台 02', teamName: '三车间 A 班' },
  { id: 'worker-youshi', name: '尤二十三', role: 'worker', station: '押出机 03', teamName: '三车间 A 班' },
  { id: 'worker-xushi', name: '许二十四', role: 'worker', station: '组装线 05', teamName: '三车间 B 班' },
  { id: 'worker-heshi', name: '何二十五', role: 'worker', station: '包装线 03', teamName: '三车间 B 班' },
  { id: 'worker-lvshi', name: '吕二十六', role: 'worker', station: '冲压机 02', teamName: '三车间 B 班' },
  { id: 'worker-shishi', name: '施二十七', role: 'worker', station: '端子压接机 02', teamName: '三车间 A 班' },
  { id: 'worker-zhangshi', name: '张二十八', role: 'worker', station: '注塑机 04', teamName: '三车间 A 班' },
  { id: 'worker-kongshi', name: '孔二十九', role: 'worker', station: '铜带绕包机 02', teamName: '四车间 A 班' },
  { id: 'worker-caoshi', name: '曹三十', role: 'worker', station: '测试台 03', teamName: '四车间 A 班' },
  { id: 'worker-yanshi', name: '严三十一', role: 'worker', station: '裁线机 03', teamName: '四车间 A 班' },
  { id: 'worker-jiashi', name: '华三十二', role: 'worker', station: '组装线 06', teamName: '四车间 B 班' },
  // 组长：5 个班组
  { id: 'leader-zhang', name: '张组长', role: 'leader', teamName: '一车间 A 班' },
  { id: 'leader-laozhou', name: '老周', role: 'leader', teamName: '一车间 B 班' },
  { id: 'leader-laoliu', name: '老刘', role: 'leader', teamName: '二车间 A 班' },
  { id: 'leader-chen', name: '陈组长', role: 'leader', teamName: '三车间 A 班' },
  { id: 'leader-wang', name: '王组长', role: 'leader', teamName: '四车间 A 班' },
];

/** 本地自定义名单的存储键；内容为 TestPersonnel[] 的 JSON。 */
export const TEST_PERSONNEL_STORAGE_KEY = 'yunpai-test-personnel';

/** 当前选中的工人/组长 ID（派工/报工身份持久化）。 */
export const SELECTED_WORKER_STORAGE_KEY = 'yunpai-selected-worker-id';

export const roleLabel = (role: TestPersonnelRole): string => (role === 'leader' ? '组长' : '工人');

/** 展示名：工人-张三 / 组长-老周。 */
export const personnelDisplayName = (person: TestPersonnel): string =>
  `${roleLabel(person.role)}-${person.name}`;

export function loadTestPersonnel(): TestPersonnel[] {
  if (typeof window === 'undefined') {
    return TEST_PERSONNEL;
  }
  // 版本不匹配（内置名单升级过）→ 直接使用内置名单，忽略旧缓存
  if (window.localStorage.getItem(TEST_PERSONNEL_VERSION_KEY) !== String(TEST_PERSONNEL_VERSION)) {
    return TEST_PERSONNEL;
  }
  try {
    const raw = window.localStorage.getItem(TEST_PERSONNEL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (item): item is TestPersonnel =>
            Boolean(item) &&
            typeof item === 'object' &&
            typeof (item as TestPersonnel).id === 'string' &&
            typeof (item as TestPersonnel).name === 'string' &&
            ((item as TestPersonnel).role === 'worker' || (item as TestPersonnel).role === 'leader'),
        );
        if (valid.length > 0) {
          return valid;
        }
      }
    }
  } catch {
    // 本地数据损坏时回退默认名单
  }
  return TEST_PERSONNEL;
}

/** 本地名单版本 key：保存时写入版本，读取时不匹配则回退内置名单（防旧缓存覆盖新增人员）。 */
const TEST_PERSONNEL_VERSION_KEY = 'yunpai-test-personnel-version';

export function saveTestPersonnel(list: TestPersonnel[]): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(TEST_PERSONNEL_STORAGE_KEY, JSON.stringify(list));
  window.localStorage.setItem(TEST_PERSONNEL_VERSION_KEY, String(TEST_PERSONNEL_VERSION));
}

export function readSelectedWorkerId(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.localStorage.getItem(SELECTED_WORKER_STORAGE_KEY) ?? '';
}

export function persistSelectedWorkerId(workerId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  if (workerId) {
    window.localStorage.setItem(SELECTED_WORKER_STORAGE_KEY, workerId);
  } else {
    window.localStorage.removeItem(SELECTED_WORKER_STORAGE_KEY);
  }
}

/** 按关键字搜索测试人员（匹配姓名/ID/工位/班组/角色前缀）。 */
export function searchTestPersonnel(
  query: string,
  list: TestPersonnel[] = loadTestPersonnel(),
): TestPersonnel[] {
  const keyword = query.trim().toLowerCase();
  if (!keyword) {
    return list;
  }
  return list.filter((person) =>
    [person.name, person.id, person.station ?? '', person.teamName ?? '', roleLabel(person.role), personnelDisplayName(person)]
      .join(' ')
      .toLowerCase()
      .includes(keyword),
  );
}

/** 把测试人员名单转成 antd Select options（label 带角色前缀，可按姓名/工位搜索）。 */
export function toTestPersonnelOptions(list: TestPersonnel[] = loadTestPersonnel()) {
  return list.map((person) => ({
    value: person.id,
    label: personnelDisplayName(person),
    searchText: [
      person.name,
      person.id,
      person.station ?? '',
      person.teamName ?? '',
      roleLabel(person.role),
    ]
      .join(' ')
      .toLowerCase(),
    person,
  }));
}
