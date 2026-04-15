import { buildApp } from "./app.js";
import { OpenAIProvider } from "./llm/openai.js";
import { config } from "./config.js";

const port = config.port;

const app = await buildApp({
  llmProvider: new OpenAIProvider(),
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`Server listening on http://localhost:${port}`);
