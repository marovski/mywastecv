// Correspondência entre o perfil de um reciclador (materiais aceites, zonas
// servidas) e um anúncio.
//
// O formato de armazenamento é um CSV de labels em recycler_profiles. Esse
// pormenor é implementação: quem chama passa e recebe valores de domínio,
// nunca strings com vírgulas lá dentro.
const zones = require("../data/praia-zones")
const { labels: itemLabels } = require("../data/materials")

function decode(csv) {
    return String(csv || "").split(",").map(s => s.trim()).filter(Boolean)
}

function encode(values, allowed) {
    const list = values === undefined || values === null
        ? []
        : (Array.isArray(values) ? values : [values])
    const set = new Set(allowed)
    return [...new Set(list.filter(v => set.has(v)))].join(",")
}

// Perfil em bruto (linha da BD) → valores de domínio.
function parse(profile) {
    return {
        items: decode(profile && profile.accepted_items),
        zones: decode(profile && profile.service_zones)
    }
}

// Valores vindos de um formulário → colunas prontas a gravar.
// Só sobrevivem materiais e zonas conhecidos.
function serialise(items, serviceZones) {
    return {
        accepted_items: encode(items, itemLabels),
        service_zones: encode(serviceZones, zones)
    }
}

// Materiais conhecidos de uma seleção de formulário, como lista.
function knownItems(values) {
    return encode(values, itemLabels).split(",").filter(Boolean)
}

// Uma lista vazia significa "sem preferência", logo aceita tudo.
function servesZone(profile, zone) {
    const list = parse(profile).zones
    return list.length === 0 || list.includes(zone)
}

function acceptsItems(profile, itemsCsv) {
    const list = parse(profile).items
    if (list.length === 0) return true
    const set = new Set(list)
    return decode(itemsCsv).some(i => set.has(i))
}

// O anúncio interessa a este reciclador?
function accepts(profile, listing) {
    return servesZone(profile, listing.zone) && acceptsItems(profile, listing.items)
}

// Mesma regra, mas avaliada em SQL (para filtrar no SELECT em vez de em JS).
// As vírgulas de guarda evitam que "Palmarejo" case com "Palmarejo Grande".
// Consome um parâmetro posicional: a zona.
function zoneFilterSql(column) {
    return `(',' || ${column} || ',') LIKE ('%,' || ? || ',%')`
}

// Separa a lista de materiais em anunciados/restantes, na mesma ordem de
// `allMaterials`. Usado pela confirmação de recolha para mostrar primeiro
// o que já se esperava, e o resto só se for preciso.
function splitByAnnounced(itemsCsv, allMaterials) {
    const announced = new Set(decode(itemsCsv))
    return {
        announcedMaterials: allMaterials.filter(m => announced.has(m.label)),
        otherMaterials: allMaterials.filter(m => !announced.has(m.label))
    }
}

module.exports = {
    parse, serialise, knownItems, servesZone, acceptsItems, accepts, zoneFilterSql, splitByAnnounced
}
