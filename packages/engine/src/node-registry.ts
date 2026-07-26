import type { NodeRegistry, NodeType, RegisteredNode } from "@flowmind/schema";

export class DefaultNodeRegistry implements NodeRegistry {
  private readonly nodes = new Map<NodeType, RegisteredNode>();

  register(node: RegisteredNode): void {
    this.nodes.set(node.type, node);
  }

  get(type: NodeType): RegisteredNode | undefined {
    return this.nodes.get(type);
  }
}
