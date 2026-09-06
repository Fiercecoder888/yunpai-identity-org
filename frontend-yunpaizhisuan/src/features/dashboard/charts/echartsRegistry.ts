import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

let registered = false;

export function registerECharts(): void {
  if (registered) {
    return;
  }
  echarts.use([
    LineChart,
    BarChart,
    PieChart,
    RadarChart,
    HeatmapChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    TitleComponent,
    DataZoomComponent,
    VisualMapComponent,
    CanvasRenderer,
  ]);
  registered = true;
}

registerECharts();

export { echarts };
