# Roadmap

1. **Descoberta** — Catálogo local e global com frontmatter validado, tratamento de duplicidades e links simbólicos, CLI e testes. Concluída.
2. **Julgamento e seleção** — Perguntas Noul em lote via API System One, política configurável e CLI. Motor preservado como baseline. [Documentação da TypeSafe sobre Noul](https://docs.typesafe.ai/primitives/noul).
3. **Smart Routing e otimização** — Pré-filtro conservador, restrições explícitas, contexto de tecnologias, agrupamento de redundância, cache persistente e métricas. Comparação concluída nas cinco fixtures simuladas.
4. **Calibração do pré-filtro** — Correções pontuais em documentação em português e inglês, desfechos de rota distintos e invalidação por versão da política. Métricas observadas da Etapa 3 e resultados simulados da Etapa 3.1 registrados no README.
5. **Validação ampliada** — Medir a qualidade e a latência pós-calibração com amostras representativas e chamadas reais autorizadas. [Guia de arquitetura da TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
6. **Integração com Codex** — Skill global explícita com adaptador consultivo, inventário da sessão e fallback nativo. Descoberta confirmada pelo App Server em projeto temporário e recomendações testadas com API simulada.
7. **Depuração da integração Codex** — Credencial resolvida independentemente do projeto, diagnóstico offline e fallback com códigos seguros. Validação externa concluída com transporte simulado.
8. **Robustez da integração** — Aprovação de rede pontual com fallback, opções públicas do launcher para cache e métricas, rastreio local das decisões e registro da execução real autorizada.
9. **Seleção adaptativa** — Identificadores qualificados do Codex, erros de inventário por entrada e seleção por cobertura com orçamento configurável. Comparação simulada e medições reais anteriores registradas no README.
10. **Analytics e persistência** — SQLite nativo opt-in, migrations, correlação de tentativas, exportação e CLI de consultas locais. O serviço de leitura fica disponível para a futura interface.
11. **Robustez do analytics** — Métricas preservadas com tentativas ausentes, consultas somente leitura, diagnósticos de persistência e recuperação idempotente sem novo julgamento.
12. **Fundação do dashboard** — Next.js local, design system responsivo, Overview e navegação de leitura sobre o SQLite existente, com estados de carregamento, vazio, falha e dados parciais.
