// lib/redisKeys.ts
export const getQueueKeys = (tenantId: string) => ({
  queue: `tenant:${tenantId}:queue`,
  counter: `tenant:${tenantId}:counter`,
  nowServing: `tenant:${tenantId}:now_serving`,
  nextPatient: `tenant:${tenantId}:next_patient`,
});
