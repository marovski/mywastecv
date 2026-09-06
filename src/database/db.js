// Banco de dados: SQLite embutido no Node (node:sqlite), API síncrona,
// sem dependências nativas para compilar.
const { DatabaseSync } = require("node:sqlite")
const { hashPassword } = require("../password")
const { DB_PATH } = require("../config")
const { createSchema } = require("./schema")

const db = new DatabaseSync(DB_PATH)

module.exports = db

createSchema(db)

seedIfEmpty()

// --- Dados de exemplo (apenas quando não há utilizadores) --------------
// Todas as contas de exemplo usam a password: noslixu123
function seedIfEmpty() {
    const userCount = db.prepare(`SELECT COUNT(*) AS total FROM users`).get().total
    if (userCount === 0) {
        const pw = hashPassword("noslixu123")
        const addUser = db.prepare(`
            INSERT INTO users (role, name, email, phone, zone, password_hash)
            VALUES (?, ?, ?, ?, ?, ?);
        `)
        const addProfile = db.prepare(`
            INSERT INTO recycler_profiles
                (user_id, org_name, description, accepted_items, service_zones, does_pickup, does_dropoff, hours, image, address, verified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP);
        `)

        addUser.run("admin", "Equipa Nôs Lixu", "admin@noslixu.cv", null, "Platô", pw)

        const recyclers = [
            ["Reciclagem Platô", "reciclador1@noslixu.cv", "2389000001", "Platô",
             "Recolha de papel e eletrónicos no centro da cidade.",
             "Papéis e Papelão,Resíduos Eletrónicos", "Platô,Prainha,Fazenda", 1, 1,
             "Seg-Sex 08:00-16:00", null, "Rua Serpa Pinto, N° 12"],
            ["Eco Palmarejo", "reciclador2@noslixu.cv", "2389000002", "Palmarejo",
             "Pilhas, lâmpadas e óleo alimentar usado.",
             "Pilhas e Baterias,Lâmpadas,Óleo de Cozinha", "Palmarejo,Palmarejo Grande,Achada Santo António", 1, 1,
             "Seg-Sáb 09:00-18:00", null, "Avenida OUA, Bloco B"],
            ["Verde Achada Santo António", "reciclador3@noslixu.cv", "2389000003", "Achada Santo António",
             "Compostagem e recolha de orgânicos e óleo.",
             "Resíduos Orgânicos,Óleo de Cozinha", "Achada Santo António,Terra Branca,Tira Chapéu", 1, 0,
             "Seg-Sex 07:00-15:00", null, "Rua da Liberdade, junto ao mercado"],
            ["Cantinho C Terra Branca", "reciclador4@noslixu.cv", "2389000004", "Terra Branca",
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

        // Mais duas ofertas abertas, escolhidas para caírem no filtro por
        // omissão de um reciclador verificado — senão o board abre vazio.
        const joaoOpen = db.prepare(`SELECT id FROM users WHERE email = 'joao@exemplo.cv'`).get().id
        const addOpen = db.prepare(`
            INSERT INTO listings (citizen_id, items, quantity_kg_est, zone, address, note)
            VALUES (?, ?, ?, ?, ?, ?);
        `)
        // Platô + papel/eletrónicos: entra no board da Reciclagem Platô.
        addOpen.run(joaoOpen, "Papéis e Papelão,Resíduos Eletrónicos", 15, "Platô",
                    "Rua Serpa Pinto, casa 4",
                    "Caixas de arquivo e um computador velho. Melhor de manhã.")
        // Palmarejo + óleo/pilhas: entra no board da Eco Palmarejo.
        addOpen.run(anaId, "Óleo de Cozinha,Pilhas e Baterias", 6, "Palmarejo",
                    "Rua Cabo Verde Telecom, casa 14",
                    "Garrafão de óleo usado e um saco de pilhas.")

        // Recolhas já concluídas, para o /impacto não abrir a zeros.
        // Cada uma é um anúncio fechado + o claim aceite + o registo de pesos.
        const joaoId = db.prepare(`SELECT id FROM users WHERE email = 'joao@exemplo.cv'`).get().id
        const recyclerId = (email) => db.prepare(`SELECT id FROM users WHERE email = ?`).get(email).id

        const addDone = db.prepare(`
            INSERT INTO listings (citizen_id, items, quantity_kg_est, zone, address, note, status)
            VALUES (?, ?, ?, ?, ?, ?, 'recolhida');
        `)
        const addClaim = db.prepare(`
            INSERT INTO claims (listing_id, recycler_id, message, status)
            VALUES (?, ?, ?, 'aceite');
        `)
        const addRecord = db.prepare(`
            INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json, collected_at)
            VALUES (?, ?, ?, ?, ?);
        `)

        const done = [
            [joaoId, "reciclador1@noslixu.cv", "Papéis e Papelão,Resíduos Eletrónicos", "Platô",
             "Rua Serpa Pinto, casa 4", "Arquivo antigo do escritório e dois monitores.",
             { "Papéis e Papelão": 12.5, "Resíduos Eletrónicos": 3 }, "2026-07-14 10:30"],
            [anaId, "reciclador2@noslixu.cv", "Óleo de Cozinha,Pilhas e Baterias", "Palmarejo",
             "Rua Cabo Verde Telecom, casa 14", "Óleo do restaurante e pilhas juntadas em casa.",
             { "Óleo de Cozinha": 5, "Pilhas e Baterias": 1.5 }, "2026-08-02 16:00"],
            [joaoId, "reciclador1@noslixu.cv", "Papéis e Papelão", "Platô",
             "Rua Serpa Pinto, casa 4", "Jornais e revistas.",
             { "Papéis e Papelão": 9 }, "2026-08-21 09:15"],
            [anaId, "reciclador3@noslixu.cv", "Resíduos Orgânicos", "Achada Santo António",
             "Avenida OUA, junto ao mercado", "Restos de fruta e legumes da banca.",
             { "Resíduos Orgânicos": 18 }, "2026-08-28 07:40"]
        ]

        const doneIds = []
        for (const [citizenId, email, items, zone, address, note, weights, collectedAt] of done) {
            const recycler = recyclerId(email)
            const listingId = addDone.run(citizenId, items, null, zone, address, note).lastInsertRowid
            addClaim.run(listingId, recycler, "Passamos a recolher.")
            addRecord.run(listingId, recycler, citizenId, JSON.stringify(weights), collectedAt)
            doneIds.push({ listingId, recycler, citizenId })
        }

        // Avaliações de exemplo. A última recolha fica por avaliar, para o
        // formulário aparecer a quem entrar com uma das contas de exemplo.
        const addRating = db.prepare(`
            INSERT INTO ratings (listing_id, rater_id, rated_id, stars, comment)
            VALUES (?, ?, ?, ?, ?);
        `)
        const reviews = [
            [0, "cidadao", 5, "Chegaram à hora combinada e levaram tudo."],
            [0, "reciclador", 5, "Material bem separado, muito fácil."],
            [1, "cidadao", 4, "Correu bem, só demoraram um pouco a responder."],
            [2, "cidadao", 5, null]
        ]
        for (const [index, who, stars, comment] of reviews) {
            const { listingId, recycler, citizenId } = doneIds[index]
            const rater = who === "cidadao" ? citizenId : recycler
            const rated = who === "cidadao" ? recycler : citizenId
            addRating.run(listingId, rater, rated, stars, comment)
        }
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

        // Inscrições de exemplo, para o painel de admin não abrir vazio.
        const signUp = db.prepare(`
            INSERT INTO workshop_signups (workshop_id, user_id, name, email, phone)
            VALUES (?, ?, ?, ?, ?);
        `)
        const ana = db.prepare(`SELECT id FROM users WHERE email = 'ana@exemplo.cv'`).get()
        const compostagem = db.prepare(`SELECT id FROM workshops WHERE title LIKE 'Compostagem%'`).get()
        if (ana && compostagem) {
            signUp.run(compostagem.id, ana.id, "Ana Tavares", "ana@exemplo.cv", "2389111111")
            signUp.run(compostagem.id, null, "Nádia Semedo", "nadia@exemplo.cv", "2389333333")
            signUp.run(compostagem.id, null, "Elton Barros", "elton@exemplo.cv", null)
        }
    }
}
