import type React from "react";

import type { ReminderOccurrence } from "../types";

export function OccurrenceList({ occurrences }: { readonly occurrences: readonly ReminderOccurrence[] }): React.ReactElement {
  return (
    <section className="occurrences">
      <div className="section-heading"><h3>Disparos recentes</h3><span>{occurrences.length}</span></div>
      <div className="occurrence-list">
        {occurrences.length === 0 ? <p className="empty-copy">Nenhum lembrete disparado ainda.</p> : null}
        {occurrences.slice(0, 8).map((occurrence) => (
          <article key={occurrence.id}>
            <span className={`occurrence-status ${occurrence.status}`} />
            <div>
              <strong>{occurrence.status === "delivered" ? "Entregue no app" : occurrence.status}</strong>
              <time>{new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(occurrence.scheduledFor))}</time>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
