import { buildApp } from "./app.js";
import { OpenAIProvider } from "./llm/openai.js";

const app = await buildApp({
  llmProvider: new OpenAIProvider(),
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: ["req.headers.authorization"], remove: true },
  },
});

const { port } = app.runtimeConfig;

await app.listen({ port, host: "0.0.0.0" });
app.log.info({ port }, "Server listening");
