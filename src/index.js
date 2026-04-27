require("dotenv").config();
const express = require("express");
const axios = require("axios");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const app = express();
app.use(express.json());

const cors = require("cors");
app.use(cors());

// Health Check
app.get("/health", (req, res) => res.json({ status: "ok" }));

// 배달 시작: POST /assign
app.post("/assign", async (req, res) => {
  try {
    const { order_id } = req.body;

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

    await axios.patch(`${process.env.ORDER_API_URL}/order/${order_id}/status`, {
      status: "DELIVERING",
    });

    await axios.post(`${process.env.NOTIFICATION_API_URL}/notify`, {
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

// 배달 완료: POST /complete
app.post("/complete", async (req, res) => {
  try {
    const { order_id } = req.body;

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

    await axios.patch(`${process.env.ORDER_API_URL}/order/${order_id}/status`, {
      status: "DELIVERED",
    });

    await axios.post(`${process.env.NOTIFICATION_API_URL}/notify`, {
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

const server = app.listen(process.env.PORT, () =>
  console.log(`[delivery-service] :${process.env.PORT}`)
);

process.on("SIGTERM", async () => {
  console.log("[delivery-service] SIGTERM received, shutting down...");
  await prisma.$disconnect();
  server.close(() => process.exit(0));
});