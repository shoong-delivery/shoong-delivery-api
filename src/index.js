require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const app = express();
app.use(express.json());

// 배달 시작: POST /delivery/assign
app.post("/delivery/assign", async (req, res) => {
  try {
    const { order_id } = req.body;

    // order에서 user_id 조회
    const order = await prisma.order.findUnique({
      where: { id: order_id },
    });

    const delivery = await prisma.delivery.create({
      data: {
        order_id,
        status: "DELIVERING",
        delivery_started_at: new Date(),
      },
    });

    // Order 상태 변경
    await axios.patch(`${process.env.ORDER_URL}/orders/${order_id}/status`, {
      status: "DELIVERING",
    });

    // Notification 호출
    await axios.post(`${process.env.NOTIFICATION_URL}/notify`, {
      type: "delivery",
      message: "배달이 시작되었습니다",
      user_id: order.user_id,
      order_id,
    });

    res.status(201).json({ success: true, data: delivery });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 배달 완료: POST /delivery/complete
app.post("/delivery/complete", async (req, res) => {
  try {
    const { order_id } = req.body;

    // order에서 user_id 조회
    const order = await prisma.order.findUnique({
      where: { id: order_id },
    });

    const delivery = await prisma.delivery.update({
      where: { order_id },
      data: {
        status: "DELIVERED",
        delivery_finished_at: new Date(),
      },
    });

    // Order 상태 변경
    await axios.patch(`${process.env.ORDER_URL}/orders/${order_id}/status`, {
      status: "DELIVERED",
    });

    // Notification 호출
    await axios.post(`${process.env.NOTIFICATION_URL}/notify`, {
      type: "delivery",
      message: "배달이 완료되었습니다",
      user_id: order.user_id,
      order_id,
    });

    res.json({ success: true, data: delivery });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(process.env.PORT, () =>
  console.log(`[delivery-service] :${process.env.PORT}`),
);
