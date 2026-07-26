import { createServer } from "./server.js";

const server = createServer();
const port = Number.parseInt(process.env.PORT ?? "3001", 10);
const host = process.env.HOST ?? "0.0.0.0";

await server.listen({ host, port });
