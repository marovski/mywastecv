// Banco de dados: SQLite embutido no Node (node:sqlite), API síncrona,
// sem dependências nativas para compilar.
//
// Abrir uma base de dados é uma decisão de quem arranca a aplicação, não um
// efeito de importar este módulo: o ponto de entrada abre o ficheiro, os testes
// abrem ":memory:" — a mesma costura que os módulos de domínio já usam.
const { DatabaseSync } = require("node:sqlite")
const { createSchema } = require("./schema")

// Abre a base de dados em `path` (ou ":memory:") com o esquema já aplicado.
function openDatabase(path) {
    const db = new DatabaseSync(path)
    createSchema(db)
    return db
}

module.exports = { openDatabase }
