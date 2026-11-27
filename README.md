# JEV Skill Router

CLI open source para descobrir Agent Skills e preparar um catálogo de candidatas para avaliação de relevância com o Jev, da TypeSafe AI.

## Instalação e uso

Requer Node.js 22.12 ou superior.

```sh
npm ci
npm run build
node dist/cli.js list
node dist/cli.js list --json
node dist/cli.js list --local-dir ./project-skills --global-dir /caminho/para/skills
```

Por padrão, a CLI procura skills locais em `.agents/skills` a partir do diretório atual e skills globais em `~/.agents/skills`. Execute a CLI a partir da raiz do projeto ou use as opções para indicar outros diretórios. Raízes ausentes são tratadas como vazias.

Cada resultado contém `name`, `description`, `path` (caminho absoluto do arquivo `SKILL.md` resolvido) e `scope` (`local` ou `global`). A busca percorre subdiretórios e encerra cada ramo ao encontrar o manifesto de uma skill. Links simbólicos são resolvidos, inclusive quando apontam para fora da raiz. Diretórios já visitados interrompem ciclos. Arquivos resolvidos e nomes repetidos aparecem uma única vez. Skills locais têm prioridade. Dentro do mesmo escopo, a primeira ocorrência válida em ordem de travessia por nome prevalece.

A CLI valida os campos obrigatórios do frontmatter YAML e confere o nome da skill com o diretório resolvido que contém o manifesto ou seu link. Diagnósticos de arquivos inválidos e falhas de leitura vão para stderr, mantendo o JSON em stdout utilizável. A descoberta lê apenas arquivos `SKILL.md` e trata o conteúdo como dados, sem executar instruções ou scripts.

## Desenvolvimento

```sh
npm run typecheck
npm test
```

A validação segue a [especificação de Agent Skills](https://agentskills.io/specification). As próximas etapas estão no [roadmap](ROADMAP.md).

## Seleção de skills

Copie `.env.example` para `.env` e preencha `TYPESAFE_API_KEY`. Se a variável já estiver exportada no ambiente, omita `--env-file=.env`.

```sh
node --env-file=.env dist/cli.js select "Auditar a acessibilidade de um formulário"
node --env-file=.env dist/cli.js select "Revisar componentes React" --json --max-skills 3
```

O comando avalia cada candidata com uma pergunta Noul na [API System One da TypeSafe](https://docs.typesafe.ai/api/system-one). A política ordena as candidatas por relevância e, a cada escolha, descarta as candidatas restantes cuja contribuição para a tarefa já estiver coberta. A saída contém de zero a várias skills, na ordem de seleção.

| Opção | Padrão | Efeito |
| --- | --- | --- |
| `--min-relevance` | `0.7` | Probabilidade mínima para concorrer à seleção, inclusive. |
| `--min-redundancy` | `0.8` | Probabilidade a partir da qual a candidata é removida, inclusive. |
| `--max-skills` | `5` | Número máximo de selecionadas. Zero dispensa a API. |
| `--timeout-ms` | `10000` | Tempo limite por requisição. |
| `--model` | `jev-latest` | Versão ou alias do modelo. |
| `--criteria` | Critérios internos | Arquivo JSON para substituir um ou ambos os pares de critérios. |

Exemplo para `--criteria`:

```json
{
  "relevance": {
    "true": "A capacidade descrita ajuda diretamente a produzir uma entrega pedida.",
    "false": "A capacidade se refere a outra tarefa ou só compartilha vocabulário."
  },
  "redundancy": {
    "true": "A skill de referência cobre a contribuição da candidata para a tarefa.",
    "false": "A candidata acrescenta uma capacidade distinta que a tarefa requer."
  }
}
```

A API recebe a solicitação, nomes e descrições das candidatas e os critérios de julgamento. O corpo do `SKILL.md`, o campo `path` e o escopo ficam no processo local. Trechos Markdown de código, URLs, formatos comuns de caminhos e e-mails são omitidos dos textos enviados. Use uma descrição concisa da tarefa e mantenha código-fonte e dados privados fora da solicitação e dos critérios. Metadados são dados de entrada e as probabilidades não executam instruções.

A saída JSON em stdout contém as skills selecionadas com o campo `relevance`. Stderr recebe métricas por lote com fase, número de perguntas, latência, status HTTP e, quando disponíveis, modelo e tokens de entrada e saída. Falhas devolvem código de saída diferente de zero e encerram a seleção. Os testes usam um provedor ou transporte simulado.

## Roteamento e otimização

O pré-filtro reconhece pedidos completos de aritmética curta, resposta literal e correção pontual de digitação em um arquivo de documentação. Os padrões aceitam português e inglês. Pedidos com etapas adicionais, alvo incerto, negação, critérios personalizados ou indicação de skill seguem para julgamento. Use `--no-prefilter` para desativar a análise local.

A saída normal diferencia uma rota sem julgamento de uma seleção julgada vazia. Com `--json`, stdout mantém o array de skills. Consulte `outcome` no evento `routing-summary` em stderr. Os valores são `local-no-judgment`, `no-relevant-skills`, `skills-selected` e `selection-skipped` (catálogo vazio ou limite zero). Um resultado cacheado preserva o desfecho do julgamento.

O contexto de tecnologias é inferido de um conjunto conhecido de dependências do `package.json` no diretório atual. Use `--technology <nome...>` para adicionar rótulos. Apenas os rótulos são enviados à API. Use `--only-skill <nome...>` e `--exclude-skill <nome...>` para restringir o catálogo por nome exato. A exclusão prevalece se um nome estiver nos dois filtros. As restrições em linguagem natural permanecem no texto avaliado pelo modelo.

Após a primeira comparação de redundância, o motor agrupa pares dos finalistas em um lote quando há pelo menos três, todos cabem nas vagas restantes e os pares cabem no lote de 16 perguntas. As comparações continuam direcionais e a política usa apenas os pares necessários. Catálogos com mais finalistas mantêm as rodadas progressivas. Agrupar esses pares reduz viagens à API, mas pode consultar algum par que a política acabaria dispensando. Use `--baseline` para comparar com o motor da Etapa 2, sem pré-filtro, agrupamento especulativo ou cache.

### Cache e métricas

- O cache usa `$XDG_CACHE_HOME` ou `~/.cache` como base. Use `--cache-dir <path>`, `--cache-ttl-seconds <n>` (padrão de 24 horas) ou `--no-cache` para alterar o comportamento.
- A chave HMAC inclui tarefa, catálogo, modelo informado, configuração de seleção e versão da política. Entradas da Etapa 3 sem versão deixam de ser consultadas e podem ser removidas com `cache-clear`. Decisões locais passam antes da leitura do cache. Os arquivos de resultados guardam índices, probabilidades, data e contagem de chamadas, sem armazenar credenciais, solicitações ou textos das skills. Se o cache estiver indisponível, a seleção continua pelo motor.
- `node dist/cli.js cache-clear` remove as entradas, inclusive expiradas. Use o mesmo `--cache-dir` da seleção se tiver escolhido um diretório próprio. Aliases de modelo, como `jev-latest`, podem mudar no serviço antes do TTL. Fixe uma versão para comparações reproduzíveis.
- O evento `routing-summary` em stderr registra o motivo da rota, estado e contagens de cache, chamadas, tokens, latência total e acumulada da API, custo estimado e chamadas evitadas em relação ao baseline. Para a rota mecânica, chamadas evitadas contam só os lotes iniciais de relevância. Ajuste a tarifa com `--input-usd-per-million` e `--output-usd-per-million`. Os padrões são USD 0,042 e USD 0 por milhão de tokens, respectivamente. [Preços da TypeSafe](https://docs.typesafe.ai/models).

### Benchmark simulado

`npm run benchmark` compara o baseline e o motor otimizado com cinco fixtures reconstruídas a partir dos comportamentos testados na Etapa 2.

| Cenário | Chamadas baseline → otimizado | Resultado esperado |
| --- | --- | --- |
| Múltiplas skills complementares | 4 → 3 | Quatro capacidades distintas. |
| Nenhuma skill relevante | 1 → 0 | Nenhuma skill para uma tarefa mecânica. |
| Limite e limiar de seleção | 1 → 1 | Uma skill, com desempate por nome. |
| Redundância | 4 → 3 | A duplicata é removida e as complementares permanecem. |
| Catálogo em vários lotes | 3 → 3 | Três lotes para 33 candidatas, sem seleção. |

O benchmark compara falsos positivos e falsos negativos com os resultados esperados. Os tokens são estimados pelo tamanho dos pedidos e a latência de rede é simulada. O conjunto bilíngue da Etapa 3.1 acrescenta 18 pedidos rotulados para o pré-filtro, com 6 rotas locais esperadas, 12 encaminhamentos e zero falsos positivos ou negativos nesse conjunto.

### Benchmark observado

Métricas de execuções da Etapa 3 informadas antes da calibração.

| Tarefa e estratégia | Chamadas | Tokens de entrada | Latência |
| --- | ---: | ---: | ---: |
| Landing page 3D, baseline | 6 | 13.564 | 1.416 ms |
| Landing page 3D, otimizado | 6 | 12.129 | 1.171 ms |
| Landing page 3D, cache hit | 0 | 0 | 34 ms |
| Corrigir um erro de digitação no README, `needs-judgment` | 2 | 6.079 | — |

Na landing page, o motor otimizado manteve as seis chamadas e reduziu em 1.435 os tokens de entrada e em 245 ms a latência. A correção de digitação terminou sem seleção após julgamento porque o pré-filtro só reconhecia aritmética curta e resposta literal. Na Etapa 3.1, a rota local para essa tarefa foi verificada offline. Os tempos pós-calibração ainda não foram medidos com a API real.
