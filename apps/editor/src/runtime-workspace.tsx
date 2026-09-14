"use client";

import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { Bot, Check, LoaderCircle, Plus, Save, Send, Trash2, Workflow } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

const apiUrl = process.env.NEXT_PUBLIC_FLOWMIND_API_URL ?? "http://localhost:3001";

interface RuntimeNodeData extends Record<string, unknown> {
  readonly runtimeType: string;
  readonly label: string;
  readonly description: string;
  readonly status: "active" | "inactive";
  readonly config: Readonly<Record<string, unknown>>;
  readonly fields: readonly RuntimeFieldModel[];
}

interface RuntimeFieldModel {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly control: "toggle" | "text" | "textarea" | "number" | "tags" | "select";
  readonly editable: boolean;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

interface RuntimeWorkspaceModel {
  readonly id: "csnf" | "reminders";
  readonly name: string;
  readonly description: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly type: string;
    readonly label: string;
    readonly description: string;
    readonly status: "active" | "inactive";
    readonly position: { readonly x: number; readonly y: number };
    readonly config: Readonly<Record<string, unknown>>;
    readonly fields: readonly RuntimeFieldModel[];
    readonly removable?: boolean;
  }[];
  readonly availableModules: readonly {
    readonly type: string;
    readonly name: string;
    readonly description: string;
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly source: string;
    readonly target: string;
  }[];
}

type RuntimeFlowNode = Node<RuntimeNodeData, "runtime">;

export function RuntimeWorkspace({
  workspaceId,
}: {
  readonly workspaceId: "csnf" | "reminders";
}): React.ReactElement {
  const [workspaces, setWorkspaces] = useState<readonly RuntimeWorkspaceModel[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [testMessage, setTestMessage] = useState("");
  const [testResponse, setTestResponse] = useState("");
  const [testSessionId, setTestSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "saving" | "testing" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/editor/runtime-workspaces`, {
        credentials: "include",
      });
      if (response.status === 401)
        throw new Error("Entre na área de agentes para acessar o runtime.");
      if (!response.ok) throw new Error(`Falha ao carregar runtime (${response.status}).`);
      setWorkspaces((await response.json()) as readonly RuntimeWorkspaceModel[]);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao carregar runtime.");
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const selected = workspace?.nodes.find((item) => item.id === selectedId) ?? workspace?.nodes[0];

  useEffect(() => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraft({ ...selected.config });
  }, [selected?.id, workspaceId]);

  const nodes = useMemo<RuntimeFlowNode[]>(
    () =>
      (workspace?.nodes ?? []).map((item) => ({
        id: item.id,
        type: "runtime",
        position: item.position,
        data: {
          runtimeType: item.type,
          label: item.label,
          description: item.description,
          status: item.status,
          config: item.config,
          fields: item.fields,
        },
        selected: item.id === selected?.id,
      })),
    [selected?.id, workspace?.nodes],
  );

  const save = async () => {
    if (workspaceId !== "csnf") return;
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/editor/runtime-workspaces/csnf`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) throw new Error(`Falha ao salvar (${response.status}).`);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao salvar.");
      setStatus("error");
    }
  };

  const addModule = async (type: string) => {
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch(`${apiUrl}/editor/runtime-workspaces/csnf/modules`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      if (!response.ok) throw new Error(`Falha ao adicionar modulo (${response.status}).`);
      setCatalogOpen(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao adicionar modulo.");
      setStatus("error");
    }
  };

  const removeModule = async () => {
    if (!selected?.removable || !window.confirm(`Remover o modulo ${selected.label}?`)) return;
    setStatus("saving");
    setError(null);
    try {
      const response = await fetch(
        `${apiUrl}/editor/runtime-workspaces/csnf/modules/${selected.id}`,
        {
          method: "DELETE",
          credentials: "include",
        },
      );
      if (!response.ok) throw new Error(`Falha ao remover modulo (${response.status}).`);
      setSelectedId("csnf-agent");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha ao remover modulo.");
      setStatus("error");
    }
  };

  const test = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!testMessage.trim()) return;
    setStatus("testing");
    setError(null);
    setTestResponse("");
    try {
      const response = await fetch(`${apiUrl}/editor/runtime-workspaces/csnf/test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: testMessage.trim(), sessionId: testSessionId }),
      });
      if (!response.ok) throw new Error(`Falha no teste (${response.status}).`);
      const payload = (await response.json()) as { message: string; sessionId: string };
      setTestResponse(payload.message);
      setTestSessionId(payload.sessionId);
      setStatus("ready");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Falha no teste.");
      setStatus("error");
    }
  };

  if (!workspace) {
    return (
      <section className="runtime-loading">
        <LoaderCircle className="spin" />
        {error ?? "Carregando runtime..."}
        {error ? <button onClick={() => void load()}>Tentar novamente</button> : null}
      </section>
    );
  }

  return (
    <main className="runtime-shell">
      <header className="runtime-toolbar">
        <div>
          <strong>{workspace.name}</strong>
          <span>{workspace.description}</span>
        </div>
        <div className="runtime-state">
          <Check /> Sincronizado com o runtime
        </div>
        {workspaceId === "csnf" ? (
          <button className="runtime-add" onClick={() => setCatalogOpen((current) => !current)}>
            <Plus /> Adicionar modulo
          </button>
        ) : null}
      </header>
      {catalogOpen ? (
        <div className="runtime-catalog">
          <div>
            <strong>Adicionar modulo</strong>
            <span>Somente modulos executados pelo runtime aparecem aqui.</span>
          </div>
          {workspace.availableModules.length ? (
            workspace.availableModules.map((module) => (
              <button key={module.type} onClick={() => void addModule(module.type)}>
                <Plus />
                <span>
                  <strong>{module.name}</strong>
                  <small>{module.description}</small>
                </span>
              </button>
            ))
          ) : (
            <p>Todos os modulos disponiveis ja foram adicionados.</p>
          )}
        </div>
      ) : null}
      <section className="runtime-canvas">
        <ReactFlow
          edges={workspace.edges.map((edge) => ({ ...edge, animated: true }))}
          fitView
          maxZoom={1.25}
          minZoom={0.35}
          nodes={nodes}
          nodeTypes={{ runtime: RuntimeNode }}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_event, node) => setSelectedId(node.id)}
        >
          <Background gap={18} />
          <MiniMap bgColor="#11151c" maskColor="rgb(8 10 14 / 72%)" nodeColor="#20c997" />
          <Controls />
        </ReactFlow>
      </section>
      <aside className="runtime-inspector">
        <div className="runtime-inspector-head">
          <div>
            <span>{selected?.type}</span>
            <strong>{selected?.label}</strong>
          </div>
          {workspaceId === "csnf" && selected?.fields.some((field) => field.editable) ? (
            <button
              className="runtime-save"
              disabled={status === "saving"}
              onClick={() => void save()}
            >
              <Save /> Salvar
            </button>
          ) : null}
          {selected?.removable ? (
            <button
              className="runtime-remove"
              title="Remover modulo"
              onClick={() => void removeModule()}
            >
              <Trash2 />
            </button>
          ) : null}
        </div>
        <p>{selected?.description}</p>
        <div className="runtime-fields">
          {selected
            ? selected.fields.map((field) => (
                <RuntimeField
                  key={field.key}
                  field={field}
                  value={draft[field.key] ?? selected.config[field.key]}
                  onChange={(next) => setDraft((current) => ({ ...current, [field.key]: next }))}
                />
              ))
            : null}
        </div>
        {workspaceId === "csnf" ? (
          <form className="runtime-test" onSubmit={test}>
            <div>
              <Bot />
              <strong>Teste local</strong>
            </div>
            <textarea
              maxLength={2000}
              onChange={(event) => setTestMessage(event.target.value)}
              placeholder="Converse com o CSNF sem enviar ao WhatsApp"
              value={testMessage}
            />
            <button disabled={status === "testing" || !testMessage.trim()} type="submit">
              <Send />
              {status === "testing" ? "Gerando..." : "Testar agente"}
            </button>
            {testResponse ? <div className="runtime-response">{testResponse}</div> : null}
          </form>
        ) : null}
        {error ? <div className="runtime-error">{error}</div> : null}
      </aside>
    </main>
  );
}

function RuntimeNode({ data, selected }: NodeProps<RuntimeFlowNode>): React.ReactElement {
  return (
    <div className={`runtime-node ${selected ? "selected" : ""} ${data.status}`}>
      <Handle position={Position.Left} type="target" />
      <div className="runtime-node-icon">
        {data.runtimeType.includes("agent") ? <Bot /> : <Workflow />}
      </div>
      <div>
        <strong>{data.label}</strong>
        <span>{data.description}</span>
      </div>
      <i>{data.status === "active" ? "Ativo" : "Inativo"}</i>
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function RuntimeField({
  field,
  value,
  onChange,
}: {
  readonly field: RuntimeFieldModel;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}): React.ReactElement {
  if (field.control === "toggle")
    return (
      <label className="runtime-toggle">
        <span>
          {field.label}
          <small>{field.description}</small>
        </span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={!field.editable}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i />
      </label>
    );
  if (field.control === "number")
    return (
      <label>
        <span>
          {field.label}
          <small>{field.description}</small>
        </span>
        <input
          type="number"
          disabled={!field.editable}
          value={Number(value)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </label>
    );
  if (field.control === "select")
    return (
      <label>
        <span>
          {field.label}
          <small>{field.description}</small>
        </span>
        <select
          disabled={!field.editable}
          value={String(value ?? "")}
          onChange={(event) => onChange(event.target.value)}
        >
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return (
    <label>
      <span>
        {field.label}
        <small>{field.description}</small>
      </span>
      {field.control === "textarea" ? (
        <textarea
          disabled={!field.editable}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          disabled={!field.editable}
          value={text}
          onChange={(event) =>
            onChange(
              field.control === "tags"
                ? event.target.value
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean)
                : event.target.value,
            )
          }
        />
      )}
    </label>
  );
}
