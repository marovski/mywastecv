// Schema das tabelas, isolado da abertura da base de dados para que os testes
// possam criar o mesmo esquema numa base em memória (:memory:).
function createSchema(db) {
    db.exec(`PRAGMA foreign_keys = ON;`)

    // Tabela antiga (recicladores anónimos) — substituída por users + recycler_profiles.
    db.exec(`DROP TABLE IF EXISTS recyclers;`)

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

    CREATE TABLE IF NOT EXISTS ratings (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
        rater_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        rated_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stars      INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
        comment    TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE (listing_id, rater_id)
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
}

module.exports = { createSchema }
