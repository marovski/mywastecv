// Ciclo de vida de um anúncio.
//
//   aberta ──accept──> reservada ──conclude──> recolhida
//     ^                    │
//     └──── withdraw ──────┘
//   aberta / reservada ──expire | sweepExpired──> expirada
//
// Todas as transições legais vivem aqui, com as suas pré-condições. Cada
// operação devolve { ok: true, ... } ou { ok: false, status, message } — cabe
// a quem chama traduzir isso num redirect ou numa página de erro.
const { acceptedRecyclerId } = require("./visibility")

const fail = (status, message) => ({ ok: false, status, message })

function now() {
    return new Date().toISOString().slice(0, 16).replace("T", " ")
}

// Corre várias escritas como uma só: ou acontecem todas, ou nenhuma.
function inTransaction(db, work) {
    db.exec("BEGIN")
    try {
        const result = work()
        if (result && result.ok === false) {
            db.exec("ROLLBACK")
            return result
        }
        db.exec("COMMIT")
        return result
    } catch (err) {
        db.exec("ROLLBACK")
        throw err
    }
}

function getListing(db, listingId) {
    return db.prepare(`SELECT * FROM listings WHERE id = ?`).get(listingId)
}

// Um reciclador manifesta interesse. Exige conta verificada e anúncio aberto.
function claim(db, listingId, recyclerId, message) {
    const profile = db.prepare(
        `SELECT verified_at FROM recycler_profiles WHERE user_id = ?`
    ).get(recyclerId)
    if (!profile || !profile.verified_at) {
        return fail(403, "A sua conta de reciclador ainda não foi verificada pela equipa Nôs Lixu.")
    }
    const listing = getListing(db, listingId)
    if (!listing || listing.status !== "aberta") {
        return fail(400, "Este anúncio já não está disponível.")
    }
    db.prepare(`INSERT OR IGNORE INTO claims (listing_id, recycler_id, message) VALUES (?, ?, ?)`)
      .run(listing.id, recyclerId, message || null)
    return { ok: true }
}

// O cidadão escolhe um reciclador: o anúncio reserva e os outros pedidos caem.
function accept(db, listingId, claimId, citizenId) {
    const listing = getListing(db, listingId)
    if (!listing || listing.citizen_id !== citizenId) {
        return fail(403, "Ação não permitida.")
    }
    const claimRow = db.prepare(`SELECT * FROM claims WHERE id = ? AND listing_id = ?`)
        .get(claimId, listing.id)
    if (!claimRow || claimRow.status !== "pendente") {
        return fail(400, "Este pedido já não pode ser aceite.")
    }
    return inTransaction(db, () => {
        db.prepare(`UPDATE claims SET status = 'aceite' WHERE id = ?`).run(claimRow.id)
        db.prepare(`UPDATE claims SET status = 'recusada' WHERE listing_id = ? AND id != ? AND status = 'pendente'`)
          .run(listing.id, claimRow.id)
        const info = db.prepare(`UPDATE listings SET status = 'reservada' WHERE id = ? AND status = 'aberta'`)
            .run(listing.id)
        if (info.changes === 0) return fail(400, "Este anúncio já não está disponível.")
        return { ok: true }
    })
}

// O reciclador desiste. Se já era o aceite, o anúncio volta ao board.
function withdraw(db, claimId, recyclerId) {
    const claimRow = db.prepare(`SELECT * FROM claims WHERE id = ?`).get(claimId)
    if (!claimRow || claimRow.recycler_id !== recyclerId) {
        return fail(403, "Ação não permitida.")
    }
    return inTransaction(db, () => {
        db.prepare(`UPDATE claims SET status = 'retirada' WHERE id = ?`).run(claimRow.id)
        if (claimRow.status === "aceite") {
            db.prepare(`UPDATE listings SET status = 'aberta' WHERE id = ? AND status = 'reservada'`)
              .run(claimRow.listing_id)
        }
        return { ok: true, listingId: claimRow.listing_id }
    })
}

// O dono retira o anúncio de circulação.
function expire(db, listingId, citizenId) {
    const listing = getListing(db, listingId)
    if (!listing || listing.citizen_id !== citizenId) {
        return fail(403, "Ação não permitida.")
    }
    db.prepare(`UPDATE listings SET status = 'expirada' WHERE id = ? AND status IN ('aberta','reservada')`)
      .run(listing.id)
    return { ok: true }
}

// Qualquer uma das duas partes fecha a recolha, com os pesos por material.
function conclude(db, listingId, userId, weights) {
    const listing = getListing(db, listingId)
    if (!listing) return fail(404, "Anúncio não encontrado.")

    const acceptedId = acceptedRecyclerId(db, listing.id)
    const isParty = userId === listing.citizen_id || userId === acceptedId
    if (!isParty || !acceptedId || listing.status !== "reservada") {
        return fail(403, "Só é possível concluir um anúncio reservado.")
    }
    if (!weights || !Object.keys(weights).length) {
        return fail(400, "Indique o peso recolhido de pelo menos um material.")
    }

    return inTransaction(db, () => {
        db.prepare(`
            INSERT INTO collection_records (listing_id, recycler_id, citizen_id, weights_json, collected_at)
            VALUES (?, ?, ?, ?, ?)
        `).run(listing.id, acceptedId, listing.citizen_id, JSON.stringify(weights), now())
        db.prepare(`UPDATE listings SET status = 'recolhida' WHERE id = ?`).run(listing.id)
        return { ok: true }
    })
}

// Marca como expirada qualquer oferta aberta cuja validade já passou.
// Barata e síncrona: corre no arranque e antes das listagens, em vez de
// depender de uma tarefa agendada.
function sweepExpired(db) {
    db.prepare(`
        UPDATE listings SET status = 'expirada'
        WHERE status = 'aberta'
          AND available_until IS NOT NULL
          AND available_until < date('now')
    `).run()
}

// A equipa remove um anúncio (conteúdo impróprio, denúncia, etc). Só a partir
// de "aberta": um anúncio reservado ou concluído já tem outra parte envolvida
// e sai do âmbito desta ação.
function moderate(db, listingId, reason) {
    const listing = getListing(db, listingId)
    if (!listing) return fail(404, "Anúncio não encontrado.")
    if (listing.status !== "aberta") {
        return fail(400, "Só é possível remover um anúncio aberto.")
    }
    const text = (reason || "").trim()
    if (!text) return fail(400, "Indique o motivo da remoção.")

    db.prepare(`UPDATE listings SET status = 'removida', moderation_reason = ? WHERE id = ?`)
      .run(text, listing.id)
    return { ok: true }
}

// Devolve um anúncio removido ao board — engano da equipa, denúncia infundada.
function restore(db, listingId) {
    const listing = getListing(db, listingId)
    if (!listing) return fail(404, "Anúncio não encontrado.")
    if (listing.status !== "removida") {
        return fail(400, "Este anúncio não está removido.")
    }
    db.prepare(`UPDATE listings SET status = 'aberta', moderation_reason = NULL WHERE id = ?`)
      .run(listing.id)
    return { ok: true }
}

module.exports = { claim, accept, withdraw, expire, conclude, sweepExpired, moderate, restore }
