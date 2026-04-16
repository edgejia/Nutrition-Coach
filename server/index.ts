import { buildApp } from "./app.js";
import { OpenAIProvider } from "./llm/openai.js";
import { config } from "./config.js";

const port = config.port;

const app = await buildApp({
  llmProvider: new OpenAIProvider(),
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: { paths: ["req.headers.authorization"], remove: true },
  },
});

await app.listen({ port, host: "0.0.0.0" });
app.log.info({ port }, "Server listening");
