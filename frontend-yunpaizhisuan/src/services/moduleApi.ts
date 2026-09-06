import { requestJson } from './httpClient';
import type { ModuleStatus } from '../types/api';

export function getModuleStatuses() {
  return requestJson<ModuleStatus[]>('/dashboard/module-statuses');
}
