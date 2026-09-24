/**
 * Philippine address reference data, shared by the customer form and the seed.
 *
 * Real province / city / barangay combinations with their actual postal
 * codes. faker's generic address data produces places that do not exist,
 * which reads as fake the moment anyone who lives here looks at it.
 *
 * The form offers these as choices and suggestions, not as a closed list: a
 * barangay missing from here is still a real barangay, so it is typed freely.
 */
export type PhLocation = {
  province: string;
  city: string;
  barangays: string[];
  postalCode: string;
};

export const PH_LOCATIONS: PhLocation[] = [
  {
    province: "Metro Manila",
    city: "Quezon City",
    barangays: ["Diliman", "Loyola Heights", "Socorro", "Bagumbayan", "Kamuning", "Project 6"],
    postalCode: "1101",
  },
  {
    province: "Metro Manila",
    city: "Makati",
    barangays: ["Poblacion", "Bel-Air", "San Lorenzo", "Guadalupe Nuevo", "Pio del Pilar"],
    postalCode: "1210",
  },
  {
    province: "Metro Manila",
    city: "Pasig",
    barangays: ["Ortigas Center", "Kapitolyo", "San Antonio", "Ugong", "Pinagbuhatan"],
    postalCode: "1605",
  },
  {
    province: "Metro Manila",
    city: "Taguig",
    barangays: ["Fort Bonifacio", "Ususan", "Western Bicutan", "Signal Village"],
    postalCode: "1630",
  },
  {
    province: "Metro Manila",
    city: "Manila",
    barangays: ["Malate", "Ermita", "Sampaloc", "Santa Cruz", "Binondo"],
    postalCode: "1004",
  },
  {
    province: "Metro Manila",
    city: "Mandaluyong",
    barangays: ["Highway Hills", "Wack-Wack Greenhills", "Plainview", "Barangka Ilaya"],
    postalCode: "1550",
  },
  {
    province: "Metro Manila",
    city: "Paranaque",
    barangays: ["BF Homes", "Don Bosco", "San Antonio", "Moonwalk"],
    postalCode: "1700",
  },
  {
    province: "Metro Manila",
    city: "Caloocan",
    barangays: ["Bagumbong", "Camarin", "Grace Park East", "Sangandaan"],
    postalCode: "1400",
  },
  {
    province: "Cebu",
    city: "Cebu City",
    barangays: ["Lahug", "Banilad", "Guadalupe", "Mabolo", "Talamban"],
    postalCode: "6000",
  },
  {
    province: "Cebu",
    city: "Mandaue",
    barangays: ["Tipolo", "Banilad", "Subangdaku", "Canduman"],
    postalCode: "6014",
  },
  {
    province: "Cebu",
    city: "Lapu-Lapu",
    barangays: ["Pusok", "Basak", "Mactan", "Babag"],
    postalCode: "6015",
  },
  {
    province: "Davao del Sur",
    city: "Davao City",
    barangays: ["Poblacion", "Buhangin", "Talomo", "Matina Crossing", "Bajada"],
    postalCode: "8000",
  },
  {
    province: "Laguna",
    city: "Santa Rosa",
    barangays: ["Balibago", "Don Jose", "Santo Domingo", "Macabling"],
    postalCode: "4026",
  },
  {
    province: "Laguna",
    city: "Calamba",
    barangays: ["Parian", "Real", "Canlubang", "Halang"],
    postalCode: "4027",
  },
  {
    province: "Cavite",
    city: "Bacoor",
    barangays: ["Molino IV", "Talaba", "Zapote", "Niog"],
    postalCode: "4102",
  },
  {
    province: "Cavite",
    city: "Dasmarinas",
    barangays: ["Salawag", "Burol Main", "Paliparan", "Langkaan"],
    postalCode: "4114",
  },
  {
    province: "Bulacan",
    city: "Malolos",
    barangays: ["Bulihan", "Mojon", "Sumapang Matanda", "Longos"],
    postalCode: "3000",
  },
  {
    province: "Pampanga",
    city: "Angeles",
    barangays: ["Balibago", "Malabanias", "Pulung Maragul", "Cutcut"],
    postalCode: "2009",
  },
  {
    province: "Rizal",
    city: "Antipolo",
    barangays: ["San Roque", "Mayamot", "Cupang", "Dalig"],
    postalCode: "1870",
  },
  {
    province: "Iloilo",
    city: "Iloilo City",
    barangays: ["Jaro", "Mandurriao", "La Paz", "Molo"],
    postalCode: "5000",
  },
  {
    province: "Negros Occidental",
    city: "Bacolod",
    barangays: ["Mandalagan", "Villamonte", "Alijis", "Granada"],
    postalCode: "6100",
  },
  {
    province: "Batangas",
    city: "Lipa",
    barangays: ["Sabang", "Marawoy", "Balintawak", "Tambo"],
    postalCode: "4217",
  },
  {
    province: "Benguet",
    city: "Baguio",
    barangays: ["Burnham-Legarda", "Session Road Area", "Camp 7", "Loakan Proper"],
    postalCode: "2600",
  },
  {
    province: "Pangasinan",
    city: "Dagupan",
    barangays: ["Bonuan Gueset", "Tapuac", "Mayombo", "Lucao"],
    postalCode: "2400",
  },
];

/** Provinces in the order people look for them: Metro Manila first, then A to Z. */
export const PH_PROVINCES: string[] = [...new Set(PH_LOCATIONS.map((l) => l.province))].sort(
  (a, b) => (a === "Metro Manila" ? -1 : b === "Metro Manila" ? 1 : a.localeCompare(b)),
);

export function citiesIn(province: string): PhLocation[] {
  return PH_LOCATIONS.filter((location) => location.province === province).sort((a, b) =>
    a.city.localeCompare(b.city),
  );
}

export function findLocation(province: string, city: string): PhLocation | undefined {
  return PH_LOCATIONS.find((l) => l.province === province && l.city === city);
}
