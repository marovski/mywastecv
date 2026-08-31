// Configuração de ambiente.
// DATA_DIR guarda a base de dados e os uploads. Em produção deve apontar para
// um volume persistente (ex.: /var/data no Render); localmente usa ./var.
const path = require("node:path")
const fs = require("node:fs")

const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(__dirname, "..", "var")

const DB_PATH = path.join(DATA_DIR, "database.db")
const UPLOADS_DIR = path.join(DATA_DIR, "uploads")
const LISTINGS_UPLOAD_DIR = path.join(UPLOADS_DIR, "listings")

fs.mkdirSync(LISTINGS_UPLOAD_DIR, { recursive: true })

module.exports = { DATA_DIR, DB_PATH, UPLOADS_DIR, LISTINGS_UPLOAD_DIR }
