import app from "./app";

// Runtime-only entrypoint. Tests import app directly from app.ts.
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
