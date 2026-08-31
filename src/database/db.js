// Banco de dados: SQLite embutido no Node (node:sqlite), API síncrona,
// sem dependências nativas para compilar.
const { DatabaseSync } = require("node:sqlite")
const { hashPassword } = require("../password")

const db = new DatabaseSync("./src/database/database.db")
db.exec(`PRAGMA foreign_keys = ON;`)

module.exports = db

// Tabela antiga (recicladores anónimos) — substituída por users + recycler_profiles.
db.exec(`DROP TABLE IF EXISTS recyclers;`)

// --- Schema -------------------------------------------------------------
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        role          TEXT NOT NULL CHECK (role IN ('cidadao', 'reciclador', 'admin')),
        name          TEXT NOT NULL,
        email         TEXT NOT NULL UNIQUE,
        phone         TEXT,
        zone          TEXT,
        password_hash TEXT NOT NULL,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recycler_profiles (
        user_id        INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        org_name       TEXT,
        description    TEXT,
        accepted_items TEXT,
        service_zones  TEXT,
        does_pickup    INTEGER DEFAULT 1,
        does_dropoff   INTEGER DEFAULT 0,
        hours          TEXT,
        image          TEXT,
        address        TEXT,
        verified_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS listings (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        citizen_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        items           TEXT NOT NULL,
        quantity_kg_est REAL,
        zone            TEXT NOT NULL,
        address         TEXT,
        photo_path      TEXT,
        note            TEXT,
        status          TEXT NOT NULL DEFAULT 'aberta'
                        CHECK (status IN ('aberta', 'reservada', 'recolhida', 'expirada')),
        available_until TEXT,
        created_at      TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS claims (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id  INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        recycler_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message     TEXT,
        status      TEXT NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente', 'aceite', 'recusada', 'retirada')),
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (listing_id, recycler_id)
    );

    CREATE TABLE IF NOT EXISTS collection_records (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id   INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        recycler_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        citizen_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        weights_json TEXT,
        collected_at TEXT,
        created_at   TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workshops (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        description TEXT,
        date        TEXT NOT NULL,
        zone        TEXT,
        capacity    INTEGER DEFAULT 30,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workshop_signups (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        workshop_id INTEGER NOT NULL REFERENCES workshops(id) ON DELETE CASCADE,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        email       TEXT NOT NULL,
        phone       TEXT,
        created_at  TEXT DEFAULT CURRENT_TIMESTAMP
    );
`)

seedIfEmpty()

// --- Dados de exemplo (apenas quando não há utilizadores) --------------
// Todas as contas de exemplo usam a password: mywaste123
function seedIfEmpty() {
    const userCount = db.prepare(`SELECT COUNT(*) AS total FROM users`).get().total
    if (userCount === 0) {
        const pw = hashPassword("mywaste123")
        const addUser = db.prepare(`
            INSERT INTO users (role, name, email, phone, zone, password_hash)
            VALUES (?, ?, ?, ?, ?, ?);
        `)
        const addProfile = db.prepare(`
            INSERT INTO recycler_profiles
                (user_id, org_name, description, accepted_items, service_zones, does_pickup, does_dropoff, hours, image, address, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);
        `)

        addUser.run("admin", "Equipa My Waste", "admin@mywaste.cv", null, "Platô", pw)

        const recyclers = [
            ["Reciclagem Platô", "reciclador1@mywaste.cv", "2389000001", "Platô",
             "Recolha de papel e eletrónicos no centro da cidade.",
             "Papéis e Papelão,Resíduos Eletrónicos", "Platô,Prainha,Fazenda", 1, 1,
             "Seg-Sex 08:00-16:00", null, "Rua Serpa Pinto, N° 12"],
            ["Eco Palmarejo", "reciclador2@mywaste.cv", "2389000002", "Palmarejo",
             "Pilhas, lâmpadas e óleo alimentar usado.",
             "Pilhas e Baterias,Lâmpadas,Óleo de Cozinha", "Palmarejo,Palmarejo Grande,Achada Santo António", 1, 1,
             "Seg-Sáb 09:00-18:00", null, "Avenida OUA, Bloco B"],
            ["Verde Achada Santo António", "reciclador3@mywaste.cv", "2389000003", "Achada Santo António",
             "Compostagem e recolha de orgânicos e óleo.",
             "Resíduos Orgânicos,Óleo de Cozinha", "Achada Santo António,Terra Branca,Tira Chapéu", 1, 0,
             "Seg-Sex 07:00-15:00", null, "Rua da Liberdade, junto ao mercado"],
            ["Cantinho C Terra Branca", "reciclador4@mywaste.cv", "2389000004", "Terra Branca",
             "Ponto de entrega para plástico, metal, papel e eletrónicos.",
             "Plástico,Metal / Latas,Papéis e Papelão,Resíduos Eletrónicos,Pilhas e Baterias",
             "Terra Branca,Calabaceira,Safende,Vila Nova", 0, 1,
             "Seg-Sáb 08:00-17:00", null, "Estrada de Terra Branca, Armazém 3"]
        ]
        for (const r of recyclers) {
            const [org, email, phone, zone, desc, items, svcZones, pickup, dropoff, hours, image, addr] = r
            const info = addUser.run("reciclador", org, email, phone, zone, pw)
            addProfile.run(info.lastInsertRowid, org, desc, items, svcZones, pickup, dropoff, hours, image, addr)
        }

        addUser.run("cidadao", "Ana Tavares", "ana@exemplo.cv", "2389111111", "Palmarejo", pw)
        addUser.run("cidadao", "João Monteiro", "joao@exemplo.cv", "2389222222", "Platô", pw)

        // Um anúncio de exemplo da Ana (id do primeiro cidadão)
        const anaId = db.prepare(`SELECT id FROM users WHERE email = 'ana@exemplo.cv'`).get().id
        db.prepare(`
            INSERT INTO listings (citizen_id, items, quantity_kg_est, zone, address, note)
            VALUES (?, ?, ?, ?, ?, ?);
        `).run(anaId, "Papéis e Papelão,Plástico", 8, "Palmarejo",
               "Rua Cabo Verde Telecom, casa 14",
               "Caixas de cartão e garrafões de plástico limpos. Podem levantar à tarde.")
    }

    const workshopCount = db.prepare(`SELECT COUNT(*) AS total FROM workshops`).get().total
    if (workshopCount === 0) {
        const insert = db.prepare(`
            INSERT INTO workshops (title, description, date, zone, capacity)
            VALUES (?, ?, ?, ?, ?);
        `)
        const workshops = [
            ["Introdução à separação de resíduos", "Aprende a separar resíduos em casa e conhece os fluxos de reciclagem disponíveis na Praia.", "2020-06-15 17:00", "Platô", 40],
            ["Compostagem doméstica", "Workshop prático sobre como transformar resíduos orgânicos em composto.", "2026-09-20 16:00", "Palmarejo", 25],
            ["Reciclagem de óleo de cozinha", "Como recolher e encaminhar óleo alimentar usado sem contaminar a água.", "2026-10-05 17:30", "Achada Santo António", 30]
        ]
        for (const w of workshops) insert.run(...w)
    }
}
