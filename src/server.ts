import express from "express";
import cors from "cors";
import "dotenv/config";


const app = express();

app.use(cors());
app.use(express.json());

// ✅ Health check route
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, message: "coffee-tools-api is running" });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
