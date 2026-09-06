import { setupServer } from 'msw/node';
import { createHandlers } from './handlers';
import type { MockScenario } from './scenarios/current';

let serverMockScenario: MockScenario = 'normal';

export const setServerMockScenario = (scenario: MockScenario) => {
  serverMockScenario = scenario;
};

export const resetServerMockScenario = () => {
  serverMockScenario = 'normal';
};

export const server = setupServer(...createHandlers(() => serverMockScenario));
