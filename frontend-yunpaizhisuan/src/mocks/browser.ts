import { setupWorker } from 'msw/browser';
import { createHandlers } from './handlers';
import { getMockScenario } from './scenarios/current';

export const worker = setupWorker(...createHandlers(getMockScenario));
