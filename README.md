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
