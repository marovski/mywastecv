// Materiais de valor acrescentado aceites na plataforma Nôs Lixu.
// co2ePerKg = estimativa indicativa de kg de CO2 equivalente evitados por cada
// kg reciclado (a afinar com a Quercus Cabo Verde / dados locais).
const materials = [
    { key: "papel",        label: "Papéis e Papelão",     co2ePerKg: 0.9 },
    { key: "plastico",     label: "Plástico",             co2ePerKg: 1.5 },
    { key: "vidro",        label: "Vidro",                co2ePerKg: 0.3 },
    { key: "metal",        label: "Metal / Latas",        co2ePerKg: 4.0 },
    { key: "eletronicos",  label: "Resíduos Eletrónicos", co2ePerKg: 1.4 },
    { key: "pilhas",       label: "Pilhas e Baterias",    co2ePerKg: 1.0 },
    { key: "lampadas",     label: "Lâmpadas",             co2ePerKg: 0.5 },
    { key: "organicos",    label: "Resíduos Orgânicos",   co2ePerKg: 0.5 },
    { key: "oleo",         label: "Óleo de Cozinha",      co2ePerKg: 2.5 }
]

const labels = materials.map(m => m.label)
const co2eByLabel = Object.fromEntries(materials.map(m => [m.label, m.co2ePerKg]))

module.exports = { materials, labels, co2eByLabel }
