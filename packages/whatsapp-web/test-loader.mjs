const channelCoreUrl = new URL("../channel-core/dist/index.js", import.meta.url).href;
const channelRuntimeUrl = new URL("../channel-runtime/dist/index.js", import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@flowmind/channel-core") {
    return { url: channelCoreUrl, shortCircuit: true };
  }
  if (specifier === "@flowmind/channel-runtime") {
    return { url: channelRuntimeUrl, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
