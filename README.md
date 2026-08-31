# Nôs Lixu

> *Da bida nôbu pa nôs lixu.*

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

Contas de exemplo (password `noslixu123`): `admin@noslixu.cv`,
`reciclador1@noslixu.cv`, `ana@exemplo.cv`.

Em produção, defina `SESSION_SECRET`.

## Deploy (Render)

O repositório inclui [`render.yaml`](render.yaml). No [Render](https://render.com):

1. **New → Blueprint** e ligar o repositório `marovski/mywastecv`.
2. Confirmar — o Render cria o serviço web (plano free, região Frankfurt) e
   gera automaticamente o `SESSION_SECRET`.
3. Abrir o URL `*.onrender.com`.

**Persistência:** no plano free, a base de dados e as fotos vivem em `./var` e
são apagadas a cada deploy (a app volta a semear os dados de exemplo). Para as
manter, seguir a nota no fim do `render.yaml` (plano `starter` + disco +
`DATA_DIR=/var/data`).

### Variáveis de ambiente

| Variável | Efeito |
|---|---|
| `PORT` | porta HTTP (o Render define-a) |
| `SESSION_SECRET` | **obrigatória em produção** — assina o cookie de sessão |
| `NODE_ENV=production` | ativa cookies `secure` (a app já usa `trust proxy`) |
| `DATA_DIR` | pasta da base de dados + uploads (default `./var`) |

## Documentação

Ver [`CLAUDE.md`](CLAUDE.md) para arquitetura, rotas, esquema da base de dados e
convenções.
