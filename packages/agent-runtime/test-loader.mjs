const coreModuleUrl = new URL("../agent-core/dist/index.js", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@flowmind/agent-core") {
    return { url: coreModuleUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
