// Quem pode ver o quê num anúncio.
//
// A morada do anúncio e o telefone do cidadão só são revelados ao dono e ao
// reciclador cujo pedido foi aceite. Esta é a única regra de privacidade da
// plataforma e vive inteira aqui: nenhum handler a volta a decidir.
const { waLink, messageToRecycler, messageToCitizen } = require("../whatsapp")

// Reciclador cujo pedido foi aceite, ou null enquanto não houver match.
function acceptedRecyclerId(db, listingId) {
    const row = db.prepare(
        `SELECT recycler_id FROM claims WHERE listing_id = ? AND status = 'aceite'`
    ).get(listingId)
    return row ? row.recycler_id : null
}

function loadCollection(db, listingId) {
    const collection = db.prepare(
        `SELECT * FROM collection_records WHERE listing_id = ?`
    ).get(listingId)
    if (!collection) return null
    try {
        collection.weights = JSON.parse(collection.weights_json || "{}")
    } catch {
        collection.weights = {}
    }
    return collection
}

// Tudo o que uma página de anúncio precisa de saber sobre este visitante,
// já com os campos privados removidos quando não lhe são devidos.
function forListing(db, listingId, viewer) {
    const listing = db.prepare(`
        SELECT l.*, u.name AS citizen_name, u.phone AS citizen_phone
        FROM listings l JOIN users u ON u.id = l.citizen_id
        WHERE l.id = ?
    `).get(listingId)
    if (!listing) return null

    const isOwner = viewer.id === listing.citizen_id
    const acceptedId = acceptedRecyclerId(db, listing.id)
    const isAcceptedRecycler = viewer.role === "reciclador" && viewer.id === acceptedId
    const canSeeContact = isOwner || isAcceptedRecycler

    const citizenPhone = listing.citizen_phone
    if (!canSeeContact) {
        listing.address = null
        listing.citizen_phone = null
    }

    const claims = isOwner
        ? db.prepare(`
            SELECT c.*, u.name AS recycler_name, u.phone AS recycler_phone,
                   p.address AS recycler_address, p.verified_at
            FROM claims c
            JOIN users u ON u.id = c.recycler_id
            LEFT JOIN recycler_profiles p ON p.user_id = c.recycler_id
            WHERE c.listing_id = ? ORDER BY c.created_at
        `).all(listing.id)
        : []

    const myClaim = viewer.role === "reciclador"
        ? db.prepare(`SELECT * FROM claims WHERE listing_id = ? AND recycler_id = ?`)
            .get(listing.id, viewer.id) || null
        : null

    // Avisos por WhatsApp: só depois de um match e só para as duas partes
    // envolvidas — a mesma regra que revela os contactos.
    let waToRecycler = null
    let waToCitizen = null
    if (acceptedId) {
        if (isOwner) {
            const accepted = claims.find(c => c.status === "aceite")
            if (accepted) {
                waToRecycler = waLink(accepted.recycler_phone, messageToRecycler(listing, viewer.name))
            }
        } else if (isAcceptedRecycler) {
            waToCitizen = waLink(citizenPhone, messageToCitizen(listing, viewer.name))
        }
    }

    return {
        listing,
        isOwner,
        isAcceptedRecycler,
        canSeeContact,
        acceptedRecyclerId: acceptedId,
        claims,
        myClaim,
        collection: loadCollection(db, listing.id),
        waToRecycler,
        waToCitizen,
        // Concluir a recolha: só as duas partes, e só com o anúncio reservado.
        canConclude: canSeeContact && acceptedId !== null && listing.status === "reservada"
    }
}

module.exports = { forListing, acceptedRecyclerId }
