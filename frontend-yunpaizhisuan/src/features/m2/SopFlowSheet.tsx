import './SopFlowSheet.css';

export type SopFlowSheetStep = {
  key: string;
  title: string;
  description?: string;
  visualType?: string;
  machineModel?: string;
  standardTime?: string;
};

type SopFlowSheetProps = {
  productName: string;
  documentNo?: string;
  station?: string;
  steps: SopFlowSheetStep[];
};

const isInspectionStep = (visualType?: string) => visualType === 'inspection' || visualType === 'decision';

export function SopFlowSheet({ productName, documentNo, station, steps }: SopFlowSheetProps) {
  return (
    <section className="sop-flow-sheet" aria-label="SOP 工艺流程图">
      <header className="sop-flow-sheet__header">
        <div className="sop-flow-sheet__title">
          <span>工艺流程：</span>
          <strong>{productName || '未命名产品'} 工艺流程</strong>
        </div>
        <div className="sop-flow-sheet__meta">
          <span>{documentNo || '文件编号待确认'}</span>
          <span>{station || '工站待确认'}</span>
        </div>
      </header>

      <div className="sop-flow-sheet__body">
        {steps.map((step, index) => {
          const inspection = isInspectionStep(step.visualType);
          return (
            <div className="sop-flow-sheet__row" key={step.key}>
              <div className="sop-flow-sheet__sequence">工序{index + 1}</div>
              <div className="sop-flow-sheet__node-column">
                {inspection ? (
                  <div className="sop-flow-sheet__diamond">
                    <div className="sop-flow-sheet__diamond-inner">{step.title}</div>
                  </div>
                ) : (
                  <div className="sop-flow-sheet__oval">{step.title}</div>
                )}
                {index < steps.length - 1 ? <div className="sop-flow-sheet__connector" aria-hidden="true" /> : null}
              </div>
              <div className="sop-flow-sheet__annotation">
                {step.description ? <div className="sop-flow-sheet__description">{step.description}</div> : null}
                <div>设备：{step.machineModel || '待确认'}</div>
                <div>草稿工时：{step.standardTime || '待现场 IE 实测'}</div>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="sop-flow-sheet__footer">
        规范：测试/检查/量测/判定使用菱形；加工/组装/清洁/包装使用椭圆。工程草稿 / not for release.
      </footer>
    </section>
  );
}
