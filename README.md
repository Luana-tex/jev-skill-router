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
