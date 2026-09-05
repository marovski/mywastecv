// Ligações wa.me para as partes se avisarem depois de um match.
// Não é uma API nem custa nada: abre o WhatsApp do próprio utilizador com a
// mensagem já escrita. Enquanto não houver notificações automáticas (email/SMS),
// é o canal realista na Praia.
const DEFAULT_COUNTRY = "238" // Cabo Verde

// Normaliza um telefone escrito à mão para o formato que o wa.me aceita
// (só dígitos, com indicativo). Devolve null se não parecer utilizável.
function normalisePhone(raw) {
    if (!raw) return null

    let digits = String(raw).replace(/[^\d+]/g, "")
    if (digits.startsWith("+")) {
        digits = digits.slice(1)
    } else if (digits.startsWith("00")) {
        digits = digits.slice(2)
    } else {
        // Número local: 9 xxx xxx / 5 xxx xxx são números CV de 7 dígitos.
        digits = digits.replace(/^0+/, "")
        if (digits.length === 7) digits = DEFAULT_COUNTRY + digits
    }

    // Um número internacional plausível tem entre 8 e 15 dígitos (E.164).
    if (!/^\d{8,15}$/.test(digits)) return null
    return digits
}

// URL wa.me com mensagem pré-preenchida, ou null se o telefone não servir.
function waLink(phone, message) {
    const digits = normalisePhone(phone)
    if (!digits) return null
    const text = message ? "?text=" + encodeURIComponent(message) : ""
    return `https://wa.me/${digits}${text}`
}

// Mensagens-tipo, em português, para cada momento do fluxo.
function messageToRecycler(listing, citizenName) {
    return [
        `Olá! Sou ${citizenName}, do Nôs Lixu.`,
        `Aceitei o seu pedido de recolha (anúncio #${listing.id}): ${listing.items}, na zona ${listing.zone}.`,
        `Podemos combinar a recolha?`
    ].join(" ")
}

function messageToCitizen(listing, recyclerName) {
    return [
        `Olá! Sou ${recyclerName}, reciclador no Nôs Lixu.`,
        `O meu pedido para o anúncio #${listing.id} (${listing.items}, ${listing.zone}) foi aceite.`,
        `Quando lhe dá jeito fazer a recolha?`
    ].join(" ")
}

module.exports = { waLink, normalisePhone, messageToRecycler, messageToCitizen }
