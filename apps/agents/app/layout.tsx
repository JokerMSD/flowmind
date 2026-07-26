import type { Metadata } from "next";
import type React from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "FlowMind Agents",
  description: "Agentes nativos e automacoes pessoais do FlowMind.",
};

export default function RootLayout({ children }: { readonly children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
