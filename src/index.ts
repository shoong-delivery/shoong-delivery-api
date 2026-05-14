import 'dotenv/config';
import express, { Request, Response } from 'express';
import axios from 'axios';
import cors from 'cors';
import { PrismaClient } from '@prisma/client';
import {
  registry,
  deliveryAssignTotal,
  deliveryCompleteTotal,
  deliveryDurationSeconds,
} from './metrics';

const prisma = new PrismaClient();
const app = express();
app.use(express.json());
app.use(cors());

// Health Check
app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok' }));

// Prometheus 스크랩 엔드포인트
app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    console.error('[metrics] error -', (err as Error).message);
    res.status(500).end();
  }
});

// 배달 시작: POST /assign
app.post('/assign', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body as { order_id: number };

    const order = await prisma.order.findUnique({ where: { id: order_id } });

    const delivery = await prisma.delivery.create({
      data: {
        order_id,
        status: 'DELIVERING',
        delivery_started_at: new Date(),
      },
    });

    await axios.patch(`${process.env.ORDER_API_URL}/${order_id}/status`, { status: 'DELIVERING' });
    await axios.post(`${process.env.NOTIFICATION_API_URL}`, {
      type: 'delivery',
      message: '배달이 시작되었습니다',
      user_id: order?.user_id,
      order_id,
    });

    deliveryAssignTotal.labels('success').inc();
    res.status(201).json({ success: true, data: delivery });
  } catch (err) {
    deliveryAssignTotal.labels('fail').inc();
    console.error(err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// 배달 완료: POST /complete
app.post('/complete', async (req: Request, res: Response) => {
  try {
    const { order_id } = req.body as { order_id: number };

    // 멱등성 가드: 이미 DELIVERED면 체이닝 호출(상태/알림) 없이 즉시 반환
    // 배치 재시도, 클라이언트 중복 호출 대비
    const existing = await prisma.delivery.findUnique({ where: { order_id } });
    if (existing?.status === 'DELIVERED') {
      deliveryCompleteTotal.labels('skipped').inc();
      return res.json({ success: true, skipped: true, data: existing });
    }

    const order = await prisma.order.findUnique({ where: { id: order_id } });

    const delivery = await prisma.delivery.update({
      where: { order_id },
      data: {
        status: 'DELIVERED',
        delivery_finished_at: new Date(),
      },
    });

    // 배달 소요시간 히스토그램에 기록
    if (delivery.delivery_started_at && delivery.delivery_finished_at) {
      const seconds =
        (delivery.delivery_finished_at.getTime() - delivery.delivery_started_at.getTime()) / 1000;
      deliveryDurationSeconds.observe(seconds);
    }

    await axios.patch(`${process.env.ORDER_API_URL}/${order_id}/status`, { status: 'DELIVERED' });
    await axios.post(`${process.env.NOTIFICATION_API_URL}`, {
      type: 'delivery',
      message: '배달이 완료되었습니다',
      user_id: order?.user_id,
      order_id,
    });

    deliveryCompleteTotal.labels('success').inc();
    res.json({ success: true, data: delivery });
  } catch (err) {
    deliveryCompleteTotal.labels('fail').inc();
    console.error(err);
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

const PORT = process.env.PORT || 3003;
const server = app.listen(PORT, () =>
  console.log(`[delivery-service] :${PORT}`)
);

process.on('SIGTERM', async () => {
  console.log('[delivery-service] SIGTERM received, shutting down...');
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});
