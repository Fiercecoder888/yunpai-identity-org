import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { runM2Workflow } from '../../services/m2Api';
import {
  buildM2WorkflowPayload,
  loadStoredM2Workflow,
  M2_WORKFLOW_QUERY_KEY,
  parseM2Workflow,
  storeM2Workflow,
  type M2WorkflowFormValues,
} from './m2Workflow';

export function useM2Workflow() {
  const queryClient = useQueryClient();
  const latestQuery = useQuery({
    queryKey: M2_WORKFLOW_QUERY_KEY,
    queryFn: loadStoredM2Workflow,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const runMutation = useMutation({
    mutationFn: async (values: M2WorkflowFormValues) => parseM2Workflow(await runM2Workflow(buildM2WorkflowPayload(values))),
    onSuccess: (workflow) => {
      storeM2Workflow(workflow);
      queryClient.setQueryData(M2_WORKFLOW_QUERY_KEY, workflow);
    },
  });

  return {
    workflow: runMutation.data ?? latestQuery.data ?? null,
    isLoadingStored: latestQuery.isLoading,
    isRunning: runMutation.isPending,
    error: runMutation.error ?? latestQuery.error,
    run: runMutation.mutateAsync,
  };
}
