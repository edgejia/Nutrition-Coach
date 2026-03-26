import { buildApp } from "./app.js";
import { OpenAIProvider } from "./llm/openai.js";

const port = Number(process.env.PORT ?? 3000);

const app = await buildApp({
  llmProvider: new OpenAIProvider(),
});

await app.listen({ port, host: "0.0.0.0" });
console.log(`Server listening on http://localhost:${port}`);
