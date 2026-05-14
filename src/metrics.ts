import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();

collectDefaultMetrics({ register: registry });

// 배달 시작 시도 횟수
export const deliveryAssignTotal = new Counter({
  name: 'delivery_assign_total',
  help: 'Total delivery /assign attempts',
  labelNames: ['result'] as const,
  registers: [registry],
});

// 배달 완료 시도 횟수 (멱등성 가드로 인한 skipped 포함)
export const deliveryCompleteTotal = new Counter({
  name: 'delivery_complete_total',
  help: 'Total delivery /complete attempts',
  labelNames: ['result'] as const,
  registers: [registry],
});

// 배달 소요시간 (delivery_finished_at - delivery_started_at)
// 버킷: 2m / 5m / 10m / 15m / 30m / 60m — 포트폴리오 임계값(5분) 기준 분포 보기
export const deliveryDurationSeconds = new Histogram({
  name: 'delivery_duration_seconds',
  help: 'Delivery duration from delivery_started_at to delivery_finished_at',
  buckets: [120, 300, 600, 900, 1800, 3600],
  registers: [registry],
});
