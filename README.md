# My Waste

Plataforma do movimento de reciclagem da **Praia, Cabo Verde** — um projeto
**Cantinho C** em parceria com o **Global Shapers Praia Hub**.

Liga quem tem materiais recicláveis (cidadãos) a quem os recolhe (recicladores),
e forma a população em workshops sobre gestão de resíduos.

## Funcionalidades

- **Contas** para cidadãos e recicladores (email + password).
- **Anúncios**: cidadãos publicam materiais (tipo, quantidade, zona, foto);
  a morada exata só é revelada ao reciclador aceite.
- **Board de anúncios** filtrado pelas zonas e materiais de cada reciclador,
  com pedido de recolha (*claim*) e aceitação pelo cidadão.
- **Confirmação de recolha** com pesos por material.
- **Workshops** com inscrição online.
- **Painel de impacto**: workshops realizados, fluxos de reciclagem, recicladores
  mobilizados, cidadãos envolvidos, kg desviados e CO₂e evitado.
- **Admin** para verificar recicladores.

## Stack

Express 4 · Nunjucks · SQLite (`node:sqlite`, sem dependências nativas) ·
`cookie-session` · `multer`. Sem build nem framework de frontend.

## Correr localmente

```bash
npm install
npm start          # http://localhost:8001
```

Requer **Node 22.5+**. A base de dados (`src/database/database.db`) é criada e
populada com dados de exemplo no primeiro arranque.

Contas de exemplo (password `mywaste123`): `admin@mywaste.cv`,
`reciclador1@mywaste.cv`, `ana@exemplo.cv`.

Em produção, defina `SESSION_SECRET`.

## Documentação

Ver [`CLAUDE.md`](CLAUDE.md) para arquitetura, rotas, esquema da base de dados e
convenções.
