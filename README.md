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

## Integração com Codex

A skill global `jev-skill-router` usa o inventário de skills que o Codex já apresenta à sessão do projeto atual e o mesmo pré-filtro, cache e motor do comando `select`. A integração é opcional e acionada com `$jev-skill-router`.

Na raiz deste repositório, após `npm ci`:

```sh
npm run build
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/codex/jev-skill-router" "$HOME/.agents/skills/jev-skill-router"
```

Abra o Codex no projeto em que quer trabalhar e escreva, por exemplo, `$jev-skill-router Sugira skills para revisar a acessibilidade de um formulário.` Para usar o julgamento remoto, configure a chave conforme a seção abaixo. O link depende de manter o checkout no mesmo caminho e o build disponível.

O adaptador recebe em stdin um resumo curto compartilhável e o inventário visível à sessão. A saída JSON tem status `advisory` e uma lista de recomendações com nome, caminho local e relevância. O status `native-fallback` devolve o controle à seleção nativa quando o roteador está indisponível, desativado ou há outra skill explicitamente solicitada. O caminho local identifica a candidata no Codex. Somente o resumo e metadados compartilháveis entram no julgamento remoto. A integração dispensa leitura de arquivos do projeto, considera o nome e a descrição que a sessão já apresenta, e rejeita formatos comuns de credenciais. Use somente dados compartilháveis, pois padrões textuais não identificam todo conteúdo privado.

A disponibilidade das candidatas depende do inventário que o cliente expõe à sessão. Nomes duplicados são omitidos para evitar ambiguidade. O Codex confere o caminho e decide se carrega a skill pela via nativa, com as permissões, sandbox e aprovações da sessão. Uma recomendação não comprova uso efetivo. Na validação, o `skills/list` do Codex reconheceu a skill global e a candidata local em um projeto temporário, e o launcher recomendou o mesmo caminho habilitado usando transporte simulado. A validação não executou um turno de modelo.

Para desativar temporariamente, inicie o Codex com `JEV_SKILL_ROUTER_DISABLED=1` ou deixe de invocar a skill. Para desinstalar uma instalação feita pelo comando acima, execute `unlink "$HOME/.agents/skills/jev-skill-router"`. O [Codex também permite desabilitar uma skill por nome ou caminho](https://developers.openai.com/codex/config-reference).

### Credenciais e diagnóstico

O Codex procura a chave nesta ordem:

1. Variável `TYPESAFE_API_KEY` herdada pelo subprocesso.
2. Arquivo indicado por `JEV_SKILL_ROUTER_ENV_FILE`, que deve ser um caminho absoluto.
3. Arquivo global `${XDG_CONFIG_HOME:-$HOME/.config}/jev-skill-router/.env`.
4. Arquivo `.env` ao lado do `package.json` da instalação do roteador.

Configure `TYPESAFE_API_KEY` em uma única origem e mantenha arquivos de credenciais privados (`chmod 600` em sistemas POSIX). Um arquivo encontrado mas inválido interrompe a resolução com diagnóstico. O `.env` do projeto atual não é consultado. Decisões locais, seleções explícitas e acertos de cache continuam disponíveis sem autenticação.

De qualquer projeto, execute:

```sh
node "$HOME/.agents/skills/jev-skill-router/scripts/recommend.mjs" doctor
```

Também é possível rodar `node dist/cli.js doctor` na instalação. O comando verifica o vínculo global, o manifesto, o launcher, o build e a origem da configuração. `configured` indica credencial disponível localmente. Autenticação e rede aparecem como `not-checked` porque o comando funciona offline.

Em um fallback, `diagnostic.code` identifica a etapa que falhou. Exemplos incluem `missing-credentials`, `invalid-credentials-config`, `authentication-failed` (HTTP 401), `access-denied` (HTTP 403), `network-blocked`, `network-unavailable`, `timeout` e `invalid-response`. O diagnóstico pode incluir o código HTTP. Ele omite chaves, respostas brutas e detalhes privados do transporte. `network-blocked` indica uma negação de permissão reportada pelo sistema, que pode vir da sandbox ou de outra política de rede. Quando o launcher propõe `request-network-approval-once` após uma falha de rede, a skill solicita autorização do Codex para uma única nova tentativa. A consulta pode consumir créditos e segue as permissões da sessão. A execução autorizada usa `--after-network-approval`. Se a autorização for negada, estiver indisponível ou a nova tentativa falhar, o Codex usa seleção nativa. O launcher não sugere repetir após uma resposta HTTP, mesmo que uma falha de rede ocorra mais tarde.

Para repetir a verificação offline, rode o doctor a partir de outro diretório e execute `npm test` no roteador. Uma invocação remota com cache frio pode consumir créditos.

### Opções do launcher

Passe as opções diretamente ao script da skill, sem importar módulos internos. O JSON de entrada segue em stdin.

```sh
node "$HOME/.agents/skills/jev-skill-router/scripts/recommend.mjs" --metrics --explain < entrada-compartilhavel.json
node "$HOME/.agents/skills/jev-skill-router/scripts/recommend.mjs" --no-cache --metrics < entrada-compartilhavel.json
node "$HOME/.agents/skills/jev-skill-router/scripts/recommend.mjs" cache-clear
```

- `--cache-dir` e `--cache-ttl-seconds` personalizam o cache. Use o mesmo diretório com `cache-clear`. A opção `--no-cache` dispensa leitura e gravação.
- `--metrics` inclui quantidade de tentativas HTTP, tokens retornados pela API, latência e custo estimado no JSON. As tarifas podem ser configuradas com `--input-usd-per-million` e `--output-usd-per-million`.
- `--explain` mostra a lista de nomes enviada ao adaptador, duplicidades e decisões de relevância, redundância ou limite. Em um acerto de cache, as decisões intermediárias não são reconstituídas. Os dados de explicação ficam locais e não exigem chamadas adicionais.
- `usageTracking: "not-observed"` indica que o launcher emite recomendações. A sessão do Codex informa separadamente quais skills carregou e efetivamente usou.

### Execução real observada

Em um projeto externo, após autorização de rede, houve **5 chamadas**, **8.234 tokens de entrada**, **979 tokens de saída**, **1.077 ms** de roteamento e **5 recomendações**, com custo estimado de **US$ 0,000345828**. Essas métricas foram fornecidas pela execução real anterior às mudanças desta etapa.

A skill `frontend-design` estava instalada globalmente no momento da análise. Os dados da execução original não incluem o inventário enviado nem os julgamentos intermediários. Por isso, não é possível distinguir ausência no inventário, duplicidade, relevância abaixo do limiar, sobreposição com uma recomendação ou o limite padrão de cinco. O modo `--explain` permite distinguir esses casos se a execução estiver disponível para inspeção. A política permanece a mesma para todas as candidatas.

### Seleção adaptativa e identificadores de plugins

O inventário aceita nomes simples e identificadores qualificados como `sites:sites`. O namespace é parte do identificador, e o caminho absoluto para `SKILL.md` é validado separadamente. O JSON lista candidatas inválidas em `rejectedCandidates` por índice e campo, além de nomes duplicados em `excludedDuplicates`. A seleção explícita continua no fluxo nativo. [Implementação oficial de namespaces no Codex](https://github.com/openai/codex/blob/main/codex-rs/ext/skills/src/loader/namespace.rs).

Para tarefas com entregas separáveis, o JSON do launcher aceita `needs`, uma lista de uma a oito necessidades explícitas, e `contextTokens` opcional por candidata. O Jev julga a cobertura de cada necessidade em lotes de até 32 perguntas, sem uma consulta de complexidade e sem rodadas pareadas de redundância. O TypeScript maximiza as necessidades cobertas, usa o menor número de skills possível e desempata por menor contexto estimado e maior relevância. Quando só cabe cobertura parcial, `coverage.uncovered` indica os índices das lacunas. Os índices seguem a ordem de `needs` após remoção de duplicatas exatas. Skills indicadas não são executadas pelo roteador.

O launcher aceita `--max-skills` (5), `--min-relevance` (0,7) e `--max-context-tokens` (8.192). Cada candidata sem estimativa reserva 1.024 tokens. O orçamento é uma estimativa local, e caminhos e estimativas não são enviados ao Jev. Sem `needs`, o motor usa a política anterior. `--baseline` força a política original sem cache e sem as otimizações de roteamento. O cache adaptativo inclui necessidades, estimativas e orçamento. A cobertura pode ser recuperada de um hit, enquanto o detalhe intermediário de `--explain` aparece na execução que fez o julgamento.

#### Métricas reais, antes da adaptação

A execução informada avaliou 28 skills, selecionou 5, descartou 18 pelo limite e classificou 5 abaixo do limiar. Houve 10 chamadas bem-sucedidas, 16.837 tokens de entrada, 1.942 de saída e 2.143 ms de roteamento. O custo estimado foi US$ 0,000707154. O launcher rejeitou separadamente `sites:sites`.

Na política anterior, a relevância divide 28 candidatas em dois lotes. Cada escolha antes de atingir o limite de cinco pode gerar novos lotes de redundância com as candidatas restantes. Se ainda houver mais de 16, quatro rodadas podem somar outras oito chamadas. Essa estrutura reproduz as dez chamadas em simulação. O resumo da execução real não mostra as fases de cada chamada.

#### Comparação simulada

A fixture de 28 candidatas e quatro necessidades compara o motor anterior com o adaptativo em `test/adaptive.test.ts`. Os tokens são estimativas do transporte simulado e a tabela não mede latência real.

| Motor | Chamadas | Tokens de entrada | Tokens de saída | Recomendações |
| --- | ---: | ---: | ---: | ---: |
| Anterior | 10 | 15.040 | 260 | 5 |
| Adaptativo | 4 | 7.368 | 224 | 4 |

Na fixture, as quatro recomendações adaptativas cobrem as quatro necessidades rotuladas. Em tarefas reais, a cobertura depende da decomposição feita pelo Codex e do julgamento do Jev. A quantidade de perguntas cresce com o número de necessidades, então a economia da fixture não é garantida para outros catálogos. Nenhuma chamada real foi realizada nesta etapa.

### Escolha da integração

| Mecanismo | Papel na Etapa 4 |
| --- | --- |
| [Skill personalizada](https://developers.openai.com/codex/skills) | Ponto de entrada escolhido. Permite acionamento explícito no turno existente e mantém a política de seleção e carregamento no Codex. |
| [Wrapper da CLI](https://developers.openai.com/codex/cli/reference) | Poderia preparar um prompt antes de iniciar o Codex, mas exigiria um ponto de entrada adicional. A CLI do roteador serve como adaptador JSON da skill. |
| [SDK](https://developers.openai.com/codex/sdk) e [App Server](https://developers.openai.com/codex/app-server) | Opções para um cliente que orquestra sessões. O App Server foi usado em validação para consultar o catálogo nativo. |
| [AGENTS.md](https://developers.openai.com/codex/guides/agents-md) e [Hooks](https://developers.openai.com/codex/hooks) | Instruções de escopo de projeto e eventos de ciclo de vida, respectivamente. Ficaram fora do fluxo de instalação para preservar os projetos e manter o acionamento explícito. |
| [MCP](https://developers.openai.com/codex/mcp) e plugins | Opções para expor ferramentas e distribuir integrações. Esta versão usa uma skill e um executável local. |
