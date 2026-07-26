const coreModuleUrl = new URL("../channel-core/dist/index.js", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@flowmind/channel-core") {
    return { url: coreModuleUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
