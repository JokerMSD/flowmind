import { stopPreviousLocalInstance } from "./local-process.mjs";

const stopped = stopPreviousLocalInstance();
console.log(stopped ? "FlowMind local encerrado." : "Nenhuma instancia local registrada.");
