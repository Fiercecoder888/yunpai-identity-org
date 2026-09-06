import { Modal, Tabs } from 'antd';
import { useState } from 'react';
import { MasterTableCrud } from './MasterTableCrud';
import { MASTER_TABLE_CONFIGS } from './masterTableConfigs';

type M0MasterDataModalProps = {
  open: boolean;
  onClose: () => void;
  /** 打开时默认激活的表名（如 m0_master_piece_rate）；不传则第一个表。 */
  initialTable?: string;
};

/**
 * 基础数据管理弹窗：不跳页，直接在 Modal 内嵌 13 张 m0 主数据表的 CRUD
 * （复用 MASTER_TABLE_CONFIGS + MasterTableCrud，与数据建设工作台一致）。
 * 受控组件：open 由外部传入，onClose 在关闭（X/遮罩/Esc）时回调。
 * initialTable 用于从其它入口（如计件工资卡片）跳转到指定表。
 */
export function M0MasterDataModal({ open, onClose, initialTable }: M0MasterDataModalProps) {
  const [activeTable, setActiveTable] = useState<string>(
    () => initialTable && MASTER_TABLE_CONFIGS.some((c) => c.table === initialTable) ? initialTable : MASTER_TABLE_CONFIGS[0]?.table ?? '',
  );

  return (
    <Modal
      title="基础数据管理"
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(94vw, 1100px)"
      destroyOnHidden
      styles={{ body: { maxHeight: '70vh', overflow: 'auto' } }}
    >
      <Tabs
        activeKey={activeTable}
        onChange={setActiveTable}
        items={MASTER_TABLE_CONFIGS.map((config) => ({
          key: config.table,
          label: config.label,
          children: <MasterTableCrud config={config} />,
        }))}
      />
    </Modal>
  );
}
