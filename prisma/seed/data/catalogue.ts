/**
 * The catalogue is written out rather than generated. faker product names read
 * as noise the moment anyone who knows the category looks at them, and SPEC
 * section 7 asks for realistic PH-market names, specs and peso prices.
 *
 * Prices are VAT-inclusive SRP in pesos, which is what a Philippine shelf price
 * means. `costRatio` is landed cost as a fraction of the VAT-exclusive price.
 */

export type BrandSeed = { slug: string; name: string; website: string };

export const BRANDS: BrandSeed[] = [
  { slug: "aureus", name: "Aureus Peripherals", website: "https://aureus.example.ph" },
  { slug: "corvid", name: "Corvid Input", website: "https://corvid.example.ph" },
  { slug: "kaizen", name: "Kaizen Works", website: "https://kaizenworks.example.ph" },
  { slug: "northbridge", name: "Northbridge Audio", website: "https://northbridge.example.ph" },
  { slug: "tanay", name: "Tanay Keyboards", website: "https://tanaykeyboards.example.ph" },
  { slug: "velasco", name: "Velasco Audio", website: "https://velascoaudio.example.ph" },
  { slug: "orbita", name: "Orbita Devices", website: "https://orbita.example.ph" },
  { slug: "nimbus", name: "Nimbus Gear", website: "https://nimbusgear.example.ph" },
  { slug: "lakan", name: "Lakan Supply", website: "https://lakansupply.example.ph" },
  { slug: "pylon", name: "Pylon Labs", website: "https://pylonlabs.example.ph" },
  { slug: "meridian", name: "Meridian Optic", website: "https://meridianoptic.example.ph" },
  { slug: "sampaguita", name: "Sampaguita Studio", website: "https://sampaguita.example.ph" },
];

export type CategorySeed = { slug: string; name: string; description: string };

export const CATEGORIES: CategorySeed[] = [
  {
    slug: "keyboards",
    name: "Keyboards",
    description: "Mechanical and low-profile keyboards, wired and wireless.",
  },
  {
    slug: "keycaps",
    name: "Keycaps",
    description: "PBT and ABS keycap sets, full kits and accent packs.",
  },
  {
    slug: "switches",
    name: "Switches",
    description: "Linear, tactile and clicky mechanical switches sold in packs.",
  },
  {
    slug: "mice",
    name: "Mice",
    description: "Wired, wireless and ultralight mice for work and play.",
  },
  {
    slug: "mousepads",
    name: "Mousepads and Desk Mats",
    description: "Cloth, hybrid and hard-surface pads in desk and mat sizes.",
  },
  {
    slug: "audio",
    name: "Headsets and Audio",
    description: "Gaming headsets, studio monitors and desktop audio.",
  },
  {
    slug: "streaming",
    name: "Streaming and Capture",
    description: "Webcams, microphones, capture cards and lighting.",
  },
  {
    slug: "connectivity",
    name: "Cables, Hubs and Mounts",
    description: "Coiled cables, USB hubs, docks and monitor mounts.",
  },
];

export type VariantSeed = {
  suffix: string;
  attributes: [string, string][];
  priceDeltaPhp?: number;
};

export type ProductSeed = {
  name: string;
  brand: string;
  category: string;
  pricePhp: number;
  costRatio: number;
  tags: string[];
  specs: [string, string][];
  variants: VariantSeed[];
};

const SWITCH_COLOURS: Record<string, string> = {
  "Tanay Red": "#d64545",
  "Tanay Brown": "#8a5a3b",
  "Tanay Blue": "#3b6ea5",
  "Kaizen Jade": "#1f8f7a",
  "Kaizen Amber": "#c98a2b",
  "Lakan Ink": "#2b3350",
};

export const SWITCH_SWATCHES = SWITCH_COLOURS;

export const PRODUCTS: ProductSeed[] = [
  // ----------------------------------------------------------------- keyboards
  {
    name: "Aureus K87 Tenkeyless",
    brand: "aureus",
    category: "keyboards",
    pricePhp: 4190,
    costRatio: 0.62,
    tags: ["tkl", "hot-swap", "wired"],
    specs: [
      ["Layout", "87-key tenkeyless"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "USB-C detachable"],
      ["Backlight", "Per-key RGB"],
      ["Polling rate", "1000 Hz"],
      ["Plate", "Aluminium"],
    ],
    variants: [
      {
        suffix: "Black / Tanay Red",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Red"],
          ["Layout", "TKL"],
        ],
      },
      {
        suffix: "Black / Tanay Brown",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Brown"],
          ["Layout", "TKL"],
        ],
      },
      {
        suffix: "White / Tanay Red",
        attributes: [
          ["Color", "White"],
          ["Switch", "Tanay Red"],
          ["Layout", "TKL"],
        ],
        priceDeltaPhp: 200,
      },
      {
        suffix: "White / Kaizen Jade",
        attributes: [
          ["Color", "White"],
          ["Switch", "Kaizen Jade"],
          ["Layout", "TKL"],
        ],
        priceDeltaPhp: 350,
      },
    ],
  },
  {
    name: "Aureus K61 Compact",
    brand: "aureus",
    category: "keyboards",
    pricePhp: 3590,
    costRatio: 0.6,
    tags: ["60-percent", "hot-swap", "wired"],
    specs: [
      ["Layout", "61-key 60 percent"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "USB-C detachable"],
      ["Backlight", "Per-key RGB"],
      ["Polling rate", "1000 Hz"],
    ],
    variants: [
      {
        suffix: "Black / Tanay Red",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Red"],
          ["Layout", "60%"],
        ],
      },
      {
        suffix: "Navy / Tanay Brown",
        attributes: [
          ["Color", "Navy"],
          ["Switch", "Tanay Brown"],
          ["Layout", "60%"],
        ],
      },
      {
        suffix: "Cream / Kaizen Amber",
        attributes: [
          ["Color", "Cream"],
          ["Switch", "Kaizen Amber"],
          ["Layout", "60%"],
        ],
        priceDeltaPhp: 250,
      },
    ],
  },
  {
    name: "Tanay Kalesa 75",
    brand: "tanay",
    category: "keyboards",
    pricePhp: 8950,
    costRatio: 0.66,
    tags: ["75-percent", "gasket", "premium", "wireless"],
    specs: [
      ["Layout", "82-key 75 percent"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "2.4 GHz, Bluetooth 5.1, USB-C"],
      ["Mounting", "Gasket"],
      ["Battery", "4000 mAh"],
      ["Plate", "FR4"],
    ],
    variants: [
      {
        suffix: "Slate / Tanay Brown",
        attributes: [
          ["Color", "Slate"],
          ["Switch", "Tanay Brown"],
          ["Layout", "75%"],
        ],
      },
      {
        suffix: "Slate / Kaizen Jade",
        attributes: [
          ["Color", "Slate"],
          ["Switch", "Kaizen Jade"],
          ["Layout", "75%"],
        ],
      },
      {
        suffix: "Sand / Tanay Red",
        attributes: [
          ["Color", "Sand"],
          ["Switch", "Tanay Red"],
          ["Layout", "75%"],
        ],
        priceDeltaPhp: 400,
      },
    ],
  },
  {
    name: "Tanay Balangay 65",
    brand: "tanay",
    category: "keyboards",
    pricePhp: 6480,
    costRatio: 0.64,
    tags: ["65-percent", "gasket", "wireless"],
    specs: [
      ["Layout", "68-key 65 percent"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "2.4 GHz, Bluetooth 5.1, USB-C"],
      ["Mounting", "Gasket"],
      ["Battery", "3000 mAh"],
    ],
    variants: [
      {
        suffix: "Black / Tanay Red",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Red"],
          ["Layout", "65%"],
        ],
      },
      {
        suffix: "Olive / Tanay Brown",
        attributes: [
          ["Color", "Olive"],
          ["Switch", "Tanay Brown"],
          ["Layout", "65%"],
        ],
      },
      {
        suffix: "Ivory / Lakan Ink",
        attributes: [
          ["Color", "Ivory"],
          ["Switch", "Lakan Ink"],
          ["Layout", "65%"],
        ],
        priceDeltaPhp: 300,
      },
    ],
  },
  {
    name: "Corvid Rook Full-Size",
    brand: "corvid",
    category: "keyboards",
    pricePhp: 5290,
    costRatio: 0.63,
    tags: ["full-size", "office", "wired"],
    specs: [
      ["Layout", "104-key full size"],
      ["Switch type", "Hot-swap 3-pin"],
      ["Connectivity", "USB-C detachable"],
      ["Backlight", "White LED"],
      ["Polling rate", "1000 Hz"],
    ],
    variants: [
      {
        suffix: "Black / Tanay Brown",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Brown"],
          ["Layout", "Full"],
        ],
      },
      {
        suffix: "Grey / Tanay Red",
        attributes: [
          ["Color", "Grey"],
          ["Switch", "Tanay Red"],
          ["Layout", "Full"],
        ],
      },
    ],
  },
  {
    name: "Corvid Jackdaw Low Profile",
    brand: "corvid",
    category: "keyboards",
    pricePhp: 4890,
    costRatio: 0.61,
    tags: ["low-profile", "office", "wireless"],
    specs: [
      ["Layout", "84-key low profile"],
      ["Switch type", "Low-profile mechanical"],
      ["Connectivity", "Bluetooth 5.1, 2.4 GHz"],
      ["Battery", "2500 mAh"],
      ["Height", "22 mm"],
    ],
    variants: [
      {
        suffix: "Graphite",
        attributes: [
          ["Color", "Graphite"],
          ["Layout", "75%"],
        ],
      },
      {
        suffix: "Silver",
        attributes: [
          ["Color", "Silver"],
          ["Layout", "75%"],
        ],
      },
    ],
  },
  {
    name: "Kaizen KB Pro Wireless",
    brand: "kaizen",
    category: "keyboards",
    pricePhp: 7250,
    costRatio: 0.65,
    tags: ["75-percent", "wireless", "premium"],
    specs: [
      ["Layout", "82-key 75 percent"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "2.4 GHz, Bluetooth 5.1, USB-C"],
      ["Mounting", "Top mount"],
      ["Battery", "4000 mAh"],
    ],
    variants: [
      {
        suffix: "Midnight / Kaizen Jade",
        attributes: [
          ["Color", "Midnight"],
          ["Switch", "Kaizen Jade"],
          ["Layout", "75%"],
        ],
      },
      {
        suffix: "Midnight / Kaizen Amber",
        attributes: [
          ["Color", "Midnight"],
          ["Switch", "Kaizen Amber"],
          ["Layout", "75%"],
        ],
      },
      {
        suffix: "Fog / Kaizen Jade",
        attributes: [
          ["Color", "Fog"],
          ["Switch", "Kaizen Jade"],
          ["Layout", "75%"],
        ],
      },
    ],
  },
  {
    name: "Kaizen Field 40",
    brand: "kaizen",
    category: "keyboards",
    pricePhp: 5950,
    costRatio: 0.67,
    tags: ["40-percent", "enthusiast", "wired"],
    specs: [
      ["Layout", "47-key 40 percent"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "USB-C"],
      ["Mounting", "O-ring"],
      ["Case", "Anodised aluminium"],
    ],
    variants: [
      {
        suffix: "Black / Kaizen Amber",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Kaizen Amber"],
          ["Layout", "40%"],
        ],
      },
      {
        suffix: "Bronze / Lakan Ink",
        attributes: [
          ["Color", "Bronze"],
          ["Switch", "Lakan Ink"],
          ["Layout", "40%"],
        ],
        priceDeltaPhp: 600,
      },
    ],
  },
  {
    name: "Nimbus Stratus TKL",
    brand: "nimbus",
    category: "keyboards",
    pricePhp: 2890,
    costRatio: 0.58,
    tags: ["tkl", "budget", "wired"],
    specs: [
      ["Layout", "87-key tenkeyless"],
      ["Switch type", "Fixed, outemu style"],
      ["Connectivity", "USB-A braided"],
      ["Backlight", "Single-colour blue"],
      ["Polling rate", "1000 Hz"],
    ],
    variants: [
      {
        suffix: "Black / Tanay Blue",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Blue"],
          ["Layout", "TKL"],
        ],
      },
      {
        suffix: "Black / Tanay Red",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Red"],
          ["Layout", "TKL"],
        ],
      },
    ],
  },
  {
    name: "Nimbus Cirrus 68",
    brand: "nimbus",
    category: "keyboards",
    pricePhp: 2290,
    costRatio: 0.56,
    tags: ["65-percent", "budget", "wired"],
    specs: [
      ["Layout", "68-key 65 percent"],
      ["Switch type", "Fixed"],
      ["Connectivity", "USB-C detachable"],
      ["Backlight", "Rainbow"],
      ["Polling rate", "1000 Hz"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Layout", "65%"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Layout", "65%"],
        ],
      },
      {
        suffix: "Pink",
        attributes: [
          ["Color", "Pink"],
          ["Layout", "65%"],
        ],
      },
    ],
  },
  {
    name: "Lakan Katipunan Split",
    brand: "lakan",
    category: "keyboards",
    pricePhp: 11900,
    costRatio: 0.69,
    tags: ["split", "ergonomic", "enthusiast"],
    specs: [
      ["Layout", "Split 58-key columnar"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "USB-C, TRRS bridge"],
      ["Case", "CNC aluminium"],
      ["Firmware", "QMK and VIA"],
    ],
    variants: [
      {
        suffix: "Raw / Kaizen Jade",
        attributes: [
          ["Color", "Raw aluminium"],
          ["Switch", "Kaizen Jade"],
          ["Layout", "Split"],
        ],
      },
      {
        suffix: "Black / Tanay Brown",
        attributes: [
          ["Color", "Black"],
          ["Switch", "Tanay Brown"],
          ["Layout", "Split"],
        ],
      },
    ],
  },
  {
    name: "Lakan Bayani 1800",
    brand: "lakan",
    category: "keyboards",
    pricePhp: 9850,
    costRatio: 0.68,
    tags: ["1800-compact", "enthusiast", "wired"],
    specs: [
      ["Layout", "96-key 1800 compact"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "USB-C"],
      ["Mounting", "Gasket"],
      ["Case", "CNC aluminium"],
    ],
    variants: [
      {
        suffix: "Slate / Lakan Ink",
        attributes: [
          ["Color", "Slate"],
          ["Switch", "Lakan Ink"],
          ["Layout", "1800"],
        ],
      },
      {
        suffix: "Sand / Kaizen Amber",
        attributes: [
          ["Color", "Sand"],
          ["Switch", "Kaizen Amber"],
          ["Layout", "1800"],
        ],
      },
    ],
  },
  {
    name: "Orbita Type-R Wireless",
    brand: "orbita",
    category: "keyboards",
    pricePhp: 6190,
    costRatio: 0.63,
    tags: ["65-percent", "wireless", "office"],
    specs: [
      ["Layout", "68-key 65 percent"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "Bluetooth 5.1, 2.4 GHz, USB-C"],
      ["Battery", "3500 mAh"],
      ["Multi-device", "Three paired devices"],
    ],
    variants: [
      {
        suffix: "Charcoal / Tanay Brown",
        attributes: [
          ["Color", "Charcoal"],
          ["Switch", "Tanay Brown"],
          ["Layout", "65%"],
        ],
      },
      {
        suffix: "Bone / Tanay Red",
        attributes: [
          ["Color", "Bone"],
          ["Switch", "Tanay Red"],
          ["Layout", "65%"],
        ],
      },
    ],
  },
  {
    name: "Pylon Deckhand Macropad",
    brand: "pylon",
    category: "keyboards",
    pricePhp: 2450,
    costRatio: 0.55,
    tags: ["macropad", "productivity"],
    specs: [
      ["Layout", "12-key with rotary encoder"],
      ["Switch type", "Hot-swap 5-pin"],
      ["Connectivity", "USB-C"],
      ["Firmware", "QMK and VIA"],
      ["Screen", "0.91 inch OLED"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "12-key"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "12-key"],
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ keycaps
  {
    name: "Sampaguita Bayan PBT Set",
    brand: "sampaguita",
    category: "keycaps",
    pricePhp: 2890,
    costRatio: 0.58,
    tags: ["pbt", "dye-sub", "cherry-profile"],
    specs: [
      ["Material", "PBT"],
      ["Profile", "Cherry"],
      ["Legends", "Dye sublimated"],
      ["Thickness", "1.5 mm"],
      ["Kit size", "129 keys"],
    ],
    variants: [
      {
        suffix: "Sampaguita White",
        attributes: [
          ["Color", "White and green"],
          ["Size", "129-key"],
        ],
      },
      {
        suffix: "Narra Brown",
        attributes: [
          ["Color", "Brown and cream"],
          ["Size", "129-key"],
        ],
      },
      {
        suffix: "Tinikling Red",
        attributes: [
          ["Color", "Red and ivory"],
          ["Size", "129-key"],
        ],
      },
    ],
  },
  {
    name: "Sampaguita Jeepney Accent Pack",
    brand: "sampaguita",
    category: "keycaps",
    pricePhp: 990,
    costRatio: 0.5,
    tags: ["pbt", "novelty", "accent"],
    specs: [
      ["Material", "PBT"],
      ["Profile", "Cherry"],
      ["Legends", "Dye sublimated"],
      ["Kit size", "12 keys"],
    ],
    variants: [
      {
        suffix: "Chrome and Red",
        attributes: [
          ["Color", "Chrome and red"],
          ["Size", "12-key"],
        ],
      },
      {
        suffix: "Chrome and Blue",
        attributes: [
          ["Color", "Chrome and blue"],
          ["Size", "12-key"],
        ],
      },
    ],
  },
  {
    name: "Aureus Monochrome PBT",
    brand: "aureus",
    category: "keycaps",
    pricePhp: 1890,
    costRatio: 0.54,
    tags: ["pbt", "minimal"],
    specs: [
      ["Material", "PBT"],
      ["Profile", "OEM"],
      ["Legends", "Doubleshot"],
      ["Kit size", "108 keys"],
    ],
    variants: [
      {
        suffix: "Black on Grey",
        attributes: [
          ["Color", "Black and grey"],
          ["Size", "108-key"],
        ],
      },
      {
        suffix: "White on Grey",
        attributes: [
          ["Color", "White and grey"],
          ["Size", "108-key"],
        ],
      },
    ],
  },
  {
    name: "Kaizen Shine-Through Doubleshot",
    brand: "kaizen",
    category: "keycaps",
    pricePhp: 1490,
    costRatio: 0.52,
    tags: ["abs", "rgb", "shine-through"],
    specs: [
      ["Material", "ABS"],
      ["Profile", "OEM"],
      ["Legends", "Doubleshot shine-through"],
      ["Kit size", "104 keys"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "104-key"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "104-key"],
        ],
      },
    ],
  },
  {
    name: "Lakan Artisan Carabao",
    brand: "lakan",
    category: "keycaps",
    pricePhp: 1650,
    costRatio: 0.45,
    tags: ["artisan", "resin", "single"],
    specs: [
      ["Material", "Hand-cast resin"],
      ["Profile", "SA R1"],
      ["Mount", "Cherry MX"],
      ["Kit size", "1 key"],
    ],
    variants: [
      {
        suffix: "Slate",
        attributes: [
          ["Color", "Slate"],
          ["Size", "1-key"],
        ],
      },
      {
        suffix: "Amber",
        attributes: [
          ["Color", "Amber"],
          ["Size", "1-key"],
        ],
      },
    ],
  },
  {
    name: "Orbita Blank PBT Kit",
    brand: "orbita",
    category: "keycaps",
    pricePhp: 1290,
    costRatio: 0.5,
    tags: ["pbt", "blank", "minimal"],
    specs: [
      ["Material", "PBT"],
      ["Profile", "XDA"],
      ["Legends", "None"],
      ["Kit size", "120 keys"],
    ],
    variants: [
      {
        suffix: "Charcoal",
        attributes: [
          ["Color", "Charcoal"],
          ["Size", "120-key"],
        ],
      },
      {
        suffix: "Bone",
        attributes: [
          ["Color", "Bone"],
          ["Size", "120-key"],
        ],
      },
      {
        suffix: "Sage",
        attributes: [
          ["Color", "Sage"],
          ["Size", "120-key"],
        ],
      },
    ],
  },
  {
    name: "Corvid Nightfall Cherry Profile",
    brand: "corvid",
    category: "keycaps",
    pricePhp: 2290,
    costRatio: 0.56,
    tags: ["pbt", "dark", "cherry-profile"],
    specs: [
      ["Material", "PBT"],
      ["Profile", "Cherry"],
      ["Legends", "Dye sublimated"],
      ["Kit size", "126 keys"],
    ],
    variants: [
      {
        suffix: "Nightfall",
        attributes: [
          ["Color", "Black and purple"],
          ["Size", "126-key"],
        ],
      },
      {
        suffix: "Dawn",
        attributes: [
          ["Color", "Grey and orange"],
          ["Size", "126-key"],
        ],
      },
    ],
  },
  {
    name: "Tanay Kamagong Wood Set",
    brand: "tanay",
    category: "keycaps",
    pricePhp: 4250,
    costRatio: 0.6,
    tags: ["wood", "premium", "artisan"],
    specs: [
      ["Material", "Kamagong hardwood"],
      ["Profile", "Flat"],
      ["Finish", "Hand oiled"],
      ["Kit size", "87 keys"],
    ],
    variants: [
      {
        suffix: "Natural",
        attributes: [
          ["Color", "Natural"],
          ["Size", "87-key"],
        ],
      },
      {
        suffix: "Dark Ebony",
        attributes: [
          ["Color", "Dark ebony"],
          ["Size", "87-key"],
        ],
        priceDeltaPhp: 450,
      },
    ],
  },

  // ----------------------------------------------------------------- switches
  {
    name: "Tanay Red Linear Switches",
    brand: "tanay",
    category: "switches",
    pricePhp: 390,
    costRatio: 0.48,
    tags: ["linear", "pack-10"],
    specs: [
      ["Type", "Linear"],
      ["Actuation force", "45 g"],
      ["Travel", "4.0 mm"],
      ["Pins", "5-pin"],
      ["Factory lube", "Light"],
    ],
    variants: [
      { suffix: "Pack of 10", attributes: [["Size", "10 pieces"]] },
      { suffix: "Pack of 35", attributes: [["Size", "35 pieces"]], priceDeltaPhp: 960 },
      { suffix: "Pack of 70", attributes: [["Size", "70 pieces"]], priceDeltaPhp: 2260 },
    ],
  },
  {
    name: "Tanay Brown Tactile Switches",
    brand: "tanay",
    category: "switches",
    pricePhp: 410,
    costRatio: 0.48,
    tags: ["tactile", "pack-10"],
    specs: [
      ["Type", "Tactile"],
      ["Actuation force", "55 g"],
      ["Travel", "4.0 mm"],
      ["Pins", "5-pin"],
      ["Factory lube", "Light"],
    ],
    variants: [
      { suffix: "Pack of 10", attributes: [["Size", "10 pieces"]] },
      { suffix: "Pack of 35", attributes: [["Size", "35 pieces"]], priceDeltaPhp: 1010 },
      { suffix: "Pack of 70", attributes: [["Size", "70 pieces"]], priceDeltaPhp: 2380 },
    ],
  },
  {
    name: "Tanay Blue Clicky Switches",
    brand: "tanay",
    category: "switches",
    pricePhp: 380,
    costRatio: 0.47,
    tags: ["clicky", "pack-10"],
    specs: [
      ["Type", "Clicky"],
      ["Actuation force", "60 g"],
      ["Travel", "4.0 mm"],
      ["Pins", "5-pin"],
    ],
    variants: [
      { suffix: "Pack of 10", attributes: [["Size", "10 pieces"]] },
      { suffix: "Pack of 35", attributes: [["Size", "35 pieces"]], priceDeltaPhp: 930 },
    ],
  },
  {
    name: "Kaizen Jade Tactile Switches",
    brand: "kaizen",
    category: "switches",
    pricePhp: 690,
    costRatio: 0.52,
    tags: ["tactile", "premium", "pack-10"],
    specs: [
      ["Type", "Tactile"],
      ["Actuation force", "62 g"],
      ["Travel", "3.6 mm"],
      ["Pins", "5-pin"],
      ["Factory lube", "Full"],
      ["Housing", "Nylon and polycarbonate"],
    ],
    variants: [
      { suffix: "Pack of 10", attributes: [["Size", "10 pieces"]] },
      { suffix: "Pack of 35", attributes: [["Size", "35 pieces"]], priceDeltaPhp: 1790 },
      { suffix: "Pack of 70", attributes: [["Size", "70 pieces"]], priceDeltaPhp: 4090 },
    ],
  },
  {
    name: "Kaizen Amber Linear Switches",
    brand: "kaizen",
    category: "switches",
    pricePhp: 720,
    costRatio: 0.52,
    tags: ["linear", "premium", "pack-10"],
    specs: [
      ["Type", "Linear"],
      ["Actuation force", "50 g"],
      ["Travel", "3.4 mm"],
      ["Pins", "5-pin"],
      ["Factory lube", "Full"],
      ["Stem", "POM"],
    ],
    variants: [
      { suffix: "Pack of 10", attributes: [["Size", "10 pieces"]] },
      { suffix: "Pack of 35", attributes: [["Size", "35 pieces"]], priceDeltaPhp: 1880 },
    ],
  },
  {
    name: "Lakan Ink Silent Linear",
    brand: "lakan",
    category: "switches",
    pricePhp: 890,
    costRatio: 0.55,
    tags: ["silent", "linear", "premium"],
    specs: [
      ["Type", "Silent linear"],
      ["Actuation force", "48 g"],
      ["Travel", "3.5 mm"],
      ["Pins", "5-pin"],
      ["Factory lube", "Full"],
      ["Dampening", "Silicone stem pads"],
    ],
    variants: [
      { suffix: "Pack of 10", attributes: [["Size", "10 pieces"]] },
      { suffix: "Pack of 35", attributes: [["Size", "35 pieces"]], priceDeltaPhp: 2410 },
    ],
  },
  {
    name: "Pylon Switch Opener and Lube Kit",
    brand: "pylon",
    category: "switches",
    pricePhp: 1290,
    costRatio: 0.44,
    tags: ["tools", "modding"],
    specs: [
      ["Contents", "Opener, tweezers, brush, 3 g lube"],
      ["Compatible", "MX and Kailh Box"],
      ["Material", "Anodised aluminium"],
    ],
    variants: [
      { suffix: "Standard", attributes: [["Size", "Kit"]] },
      { suffix: "Pro with Films", attributes: [["Size", "Kit with films"]], priceDeltaPhp: 540 },
    ],
  },

  // --------------------------------------------------------------------- mice
  {
    name: "Orbita Vector 8K Wireless",
    brand: "orbita",
    category: "mice",
    pricePhp: 5890,
    costRatio: 0.62,
    tags: ["wireless", "esports", "lightweight"],
    specs: [
      ["Sensor", "Optical 26000 DPI"],
      ["Polling rate", "8000 Hz"],
      ["Weight", "58 g"],
      ["Connectivity", "2.4 GHz, USB-C"],
      ["Buttons", "6 programmable"],
      ["Battery", "90 hours"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Medium"],
        ],
      },
    ],
  },
  {
    name: "Orbita Vector Mini",
    brand: "orbita",
    category: "mice",
    pricePhp: 4690,
    costRatio: 0.6,
    tags: ["wireless", "small-hands", "lightweight"],
    specs: [
      ["Sensor", "Optical 19000 DPI"],
      ["Polling rate", "1000 Hz"],
      ["Weight", "49 g"],
      ["Connectivity", "2.4 GHz, USB-C"],
      ["Buttons", "6 programmable"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Small"],
        ],
      },
      {
        suffix: "Mint",
        attributes: [
          ["Color", "Mint"],
          ["Size", "Small"],
        ],
      },
    ],
  },
  {
    name: "Corvid Talon Ultralight",
    brand: "corvid",
    category: "mice",
    pricePhp: 3490,
    costRatio: 0.58,
    tags: ["wired", "ultralight", "esports"],
    specs: [
      ["Sensor", "Optical 16000 DPI"],
      ["Polling rate", "1000 Hz"],
      ["Weight", "44 g"],
      ["Connectivity", "USB-C paracord"],
      ["Shell", "Honeycomb"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "Red",
        attributes: [
          ["Color", "Red"],
          ["Size", "Medium"],
        ],
      },
    ],
  },
  {
    name: "Corvid Talon Pro Wireless",
    brand: "corvid",
    category: "mice",
    pricePhp: 6290,
    costRatio: 0.63,
    tags: ["wireless", "ultralight", "esports"],
    specs: [
      ["Sensor", "Optical 30000 DPI"],
      ["Polling rate", "4000 Hz"],
      ["Weight", "47 g"],
      ["Connectivity", "2.4 GHz, Bluetooth, USB-C"],
      ["Battery", "110 hours"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Medium"],
        ],
      },
    ],
  },
  {
    name: "Aureus Glide Office Mouse",
    brand: "aureus",
    category: "mice",
    pricePhp: 1590,
    costRatio: 0.52,
    tags: ["office", "wireless", "silent"],
    specs: [
      ["Sensor", "Optical 4000 DPI"],
      ["Polling rate", "125 Hz"],
      ["Weight", "78 g"],
      ["Connectivity", "2.4 GHz dongle"],
      ["Clicks", "Silent"],
      ["Battery", "AA, 12 months"],
    ],
    variants: [
      {
        suffix: "Graphite",
        attributes: [
          ["Color", "Graphite"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "Rose",
        attributes: [
          ["Color", "Rose"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "Sky",
        attributes: [
          ["Color", "Sky"],
          ["Size", "Medium"],
        ],
      },
    ],
  },
  {
    name: "Aureus Glide Ergo Vertical",
    brand: "aureus",
    category: "mice",
    pricePhp: 2390,
    costRatio: 0.55,
    tags: ["office", "ergonomic", "wireless"],
    specs: [
      ["Sensor", "Optical 4000 DPI"],
      ["Angle", "57 degrees"],
      ["Weight", "104 g"],
      ["Connectivity", "Bluetooth, 2.4 GHz"],
      ["Buttons", "6"],
    ],
    variants: [
      {
        suffix: "Graphite",
        attributes: [
          ["Color", "Graphite"],
          ["Size", "Large"],
        ],
      },
      {
        suffix: "Bone",
        attributes: [
          ["Color", "Bone"],
          ["Size", "Large"],
        ],
      },
    ],
  },
  {
    name: "Nimbus Drift Wired",
    brand: "nimbus",
    category: "mice",
    pricePhp: 990,
    costRatio: 0.48,
    tags: ["budget", "wired"],
    specs: [
      ["Sensor", "Optical 7200 DPI"],
      ["Polling rate", "1000 Hz"],
      ["Weight", "88 g"],
      ["Connectivity", "USB-A braided"],
      ["Backlight", "RGB"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Medium"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Medium"],
        ],
      },
    ],
  },
  {
    name: "Kaizen Precision MMO",
    brand: "kaizen",
    category: "mice",
    pricePhp: 4990,
    costRatio: 0.6,
    tags: ["mmo", "wired", "programmable"],
    specs: [
      ["Sensor", "Optical 20000 DPI"],
      ["Polling rate", "1000 Hz"],
      ["Weight", "112 g"],
      ["Buttons", "17 programmable"],
      ["Connectivity", "USB-C detachable"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Large"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Large"],
        ],
      },
    ],
  },
  {
    name: "Meridian Trackball Studio",
    brand: "meridian",
    category: "mice",
    pricePhp: 5450,
    costRatio: 0.64,
    tags: ["trackball", "ergonomic", "studio"],
    specs: [
      ["Sensor", "Optical 2400 DPI"],
      ["Ball", "34 mm"],
      ["Connectivity", "Bluetooth, 2.4 GHz"],
      ["Buttons", "8"],
      ["Battery", "Rechargeable, 4 months"],
    ],
    variants: [
      {
        suffix: "Graphite",
        attributes: [
          ["Color", "Graphite"],
          ["Size", "Large"],
        ],
      },
      {
        suffix: "Off-white",
        attributes: [
          ["Color", "Off-white"],
          ["Size", "Large"],
        ],
      },
    ],
  },
  {
    name: "Pylon Grip Tape Set",
    brand: "pylon",
    category: "mice",
    pricePhp: 450,
    costRatio: 0.4,
    tags: ["accessory", "grip"],
    specs: [
      ["Material", "Textured polyurethane"],
      ["Thickness", "0.5 mm"],
      ["Contents", "2 sheets"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Universal"],
        ],
      },
      {
        suffix: "Clear",
        attributes: [
          ["Color", "Clear"],
          ["Size", "Universal"],
        ],
      },
    ],
  },
  {
    name: "Pylon PTFE Glide Skates",
    brand: "pylon",
    category: "mice",
    pricePhp: 590,
    costRatio: 0.42,
    tags: ["accessory", "skates"],
    specs: [
      ["Material", "Virgin PTFE"],
      ["Thickness", "0.8 mm"],
      ["Edges", "Rounded"],
    ],
    variants: [
      { suffix: "For Talon", attributes: [["Size", "Corvid Talon"]] },
      { suffix: "For Vector", attributes: [["Size", "Orbita Vector"]] },
    ],
  },
  {
    name: "Orbita Dock Charging Base",
    brand: "orbita",
    category: "mice",
    pricePhp: 1890,
    costRatio: 0.5,
    tags: ["accessory", "charging"],
    specs: [
      ["Compatible", "Orbita Vector series"],
      ["Connectivity", "USB-C"],
      ["Indicator", "RGB charge ring"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Standard"],
        ],
      },
    ],
  },

  // --------------------------------------------------------------- mousepads
  {
    name: "Lakan Banig Desk Mat",
    brand: "lakan",
    category: "mousepads",
    pricePhp: 1450,
    costRatio: 0.5,
    tags: ["desk-mat", "cloth", "stitched"],
    specs: [
      ["Surface", "Cloth, mid speed"],
      ["Base", "Natural rubber"],
      ["Thickness", "4 mm"],
      ["Edges", "Stitched"],
    ],
    variants: [
      {
        suffix: "900 x 400",
        attributes: [
          ["Size", "900 x 400 mm"],
          ["Color", "Sand"],
        ],
      },
      {
        suffix: "800 x 300",
        attributes: [
          ["Size", "800 x 300 mm"],
          ["Color", "Sand"],
        ],
        priceDeltaPhp: -250,
      },
      {
        suffix: "900 x 400 Slate",
        attributes: [
          ["Size", "900 x 400 mm"],
          ["Color", "Slate"],
        ],
      },
    ],
  },
  {
    name: "Corvid Control Pad",
    brand: "corvid",
    category: "mousepads",
    pricePhp: 990,
    costRatio: 0.46,
    tags: ["control", "cloth", "esports"],
    specs: [
      ["Surface", "Cloth, control"],
      ["Base", "Natural rubber"],
      ["Thickness", "4 mm"],
      ["Edges", "Stitched"],
    ],
    variants: [
      {
        suffix: "XL",
        attributes: [
          ["Size", "450 x 400 mm"],
          ["Color", "Black"],
        ],
      },
      {
        suffix: "L",
        attributes: [
          ["Size", "360 x 300 mm"],
          ["Color", "Black"],
        ],
        priceDeltaPhp: -200,
      },
    ],
  },
  {
    name: "Corvid Speed Pad",
    brand: "corvid",
    category: "mousepads",
    pricePhp: 1090,
    costRatio: 0.46,
    tags: ["speed", "cloth", "esports"],
    specs: [
      ["Surface", "Cloth, speed"],
      ["Base", "Natural rubber"],
      ["Thickness", "3 mm"],
      ["Edges", "Stitched"],
    ],
    variants: [
      {
        suffix: "XL",
        attributes: [
          ["Size", "450 x 400 mm"],
          ["Color", "Black"],
        ],
      },
      {
        suffix: "L",
        attributes: [
          ["Size", "360 x 300 mm"],
          ["Color", "Black"],
        ],
        priceDeltaPhp: -200,
      },
    ],
  },
  {
    name: "Kaizen Glass Pad",
    brand: "kaizen",
    category: "mousepads",
    pricePhp: 2190,
    costRatio: 0.55,
    tags: ["hard", "glass", "premium"],
    specs: [
      ["Surface", "Tempered glass, micro-etched"],
      ["Base", "Silicone feet"],
      ["Thickness", "4 mm"],
      ["Edges", "Polished"],
    ],
    variants: [
      {
        suffix: "490 x 420",
        attributes: [
          ["Size", "490 x 420 mm"],
          ["Color", "Frosted"],
        ],
      },
      {
        suffix: "400 x 350",
        attributes: [
          ["Size", "400 x 350 mm"],
          ["Color", "Frosted"],
        ],
        priceDeltaPhp: -400,
      },
    ],
  },
  {
    name: "Sampaguita Tropical Desk Mat",
    brand: "sampaguita",
    category: "mousepads",
    pricePhp: 1290,
    costRatio: 0.48,
    tags: ["desk-mat", "printed"],
    specs: [
      ["Surface", "Cloth, printed"],
      ["Base", "Natural rubber"],
      ["Thickness", "4 mm"],
      ["Print", "Sublimated"],
    ],
    variants: [
      {
        suffix: "Banaue",
        attributes: [
          ["Size", "900 x 400 mm"],
          ["Color", "Green"],
        ],
      },
      {
        suffix: "Palawan",
        attributes: [
          ["Size", "900 x 400 mm"],
          ["Color", "Blue"],
        ],
      },
      {
        suffix: "Mayon",
        attributes: [
          ["Size", "900 x 400 mm"],
          ["Color", "Charcoal"],
        ],
      },
    ],
  },
  {
    name: "Nimbus Basic Pad",
    brand: "nimbus",
    category: "mousepads",
    pricePhp: 450,
    costRatio: 0.42,
    tags: ["budget", "cloth"],
    specs: [
      ["Surface", "Cloth"],
      ["Base", "Rubber"],
      ["Thickness", "3 mm"],
    ],
    variants: [
      {
        suffix: "M",
        attributes: [
          ["Size", "320 x 270 mm"],
          ["Color", "Black"],
        ],
      },
      {
        suffix: "L",
        attributes: [
          ["Size", "450 x 400 mm"],
          ["Color", "Black"],
        ],
        priceDeltaPhp: 180,
      },
    ],
  },

  // ------------------------------------------------------------------- audio
  {
    name: "Northbridge Meridian 7 Headset",
    brand: "northbridge",
    category: "audio",
    pricePhp: 6890,
    costRatio: 0.63,
    tags: ["headset", "wireless", "gaming"],
    specs: [
      ["Driver", "50 mm neodymium"],
      ["Connectivity", "2.4 GHz, Bluetooth 5.2"],
      ["Battery", "60 hours"],
      ["Microphone", "Detachable cardioid"],
      ["Weight", "312 g"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Over-ear"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Over-ear"],
        ],
      },
    ],
  },
  {
    name: "Northbridge Studio Monitor Pair",
    brand: "northbridge",
    category: "audio",
    pricePhp: 12900,
    costRatio: 0.68,
    tags: ["monitors", "studio", "desktop"],
    specs: [
      ["Driver", "4 inch woofer, 1 inch tweeter"],
      ["Power", "60 W total"],
      ["Inputs", "TRS, RCA, USB-C"],
      ["Frequency", "56 Hz to 22 kHz"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "4 inch"],
        ],
      },
      {
        suffix: "Walnut",
        attributes: [
          ["Color", "Walnut"],
          ["Size", "4 inch"],
        ],
        priceDeltaPhp: 1500,
      },
    ],
  },
  {
    name: "Velasco Balibago IEM",
    brand: "velasco",
    category: "audio",
    pricePhp: 3450,
    costRatio: 0.58,
    tags: ["iem", "wired", "local"],
    specs: [
      ["Driver", "10 mm dynamic"],
      ["Impedance", "32 ohm"],
      ["Cable", "Detachable 2-pin"],
      ["Connector", "3.5 mm"],
    ],
    variants: [
      {
        suffix: "Clear",
        attributes: [
          ["Color", "Clear"],
          ["Size", "Universal"],
        ],
      },
      {
        suffix: "Smoke",
        attributes: [
          ["Color", "Smoke"],
          ["Size", "Universal"],
        ],
      },
    ],
  },
  {
    name: "Velasco Desk Amp DAC",
    brand: "velasco",
    category: "audio",
    pricePhp: 4890,
    costRatio: 0.6,
    tags: ["dac", "amp", "desktop"],
    specs: [
      ["DAC", "ES9038Q2M"],
      ["Output", "6.35 mm, 3.5 mm, RCA"],
      ["Input", "USB-C, optical"],
      ["Power", "1.2 W at 32 ohm"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Desktop"],
        ],
      },
      {
        suffix: "Silver",
        attributes: [
          ["Color", "Silver"],
          ["Size", "Desktop"],
        ],
      },
    ],
  },
  {
    name: "Aureus Comm Headset",
    brand: "aureus",
    category: "audio",
    pricePhp: 2290,
    costRatio: 0.54,
    tags: ["headset", "office", "bpo"],
    specs: [
      ["Driver", "40 mm"],
      ["Connectivity", "USB-A"],
      ["Microphone", "Noise cancelling boom"],
      ["Certification", "Teams and Zoom"],
      ["Weight", "186 g"],
    ],
    variants: [
      {
        suffix: "Mono",
        attributes: [
          ["Size", "Mono"],
          ["Color", "Black"],
        ],
      },
      {
        suffix: "Stereo",
        attributes: [
          ["Size", "Stereo"],
          ["Color", "Black"],
        ],
        priceDeltaPhp: 400,
      },
    ],
  },
  {
    name: "Nimbus Cloudline Headset",
    brand: "nimbus",
    category: "audio",
    pricePhp: 1690,
    costRatio: 0.5,
    tags: ["headset", "budget", "wired"],
    specs: [
      ["Driver", "50 mm"],
      ["Connectivity", "3.5 mm"],
      ["Microphone", "Flip to mute"],
      ["Weight", "298 g"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Over-ear"],
        ],
      },
      {
        suffix: "Blue",
        attributes: [
          ["Color", "Blue"],
          ["Size", "Over-ear"],
        ],
      },
    ],
  },
  {
    name: "Northbridge Boom Arm",
    brand: "northbridge",
    category: "audio",
    pricePhp: 2890,
    costRatio: 0.52,
    tags: ["accessory", "mic-arm"],
    specs: [
      ["Reach", "830 mm"],
      ["Load", "1.5 kg"],
      ["Mount", "Desk clamp"],
      ["Routing", "Internal cable channel"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Standard"],
        ],
      },
    ],
  },
  {
    name: "Velasco Earpad Set",
    brand: "velasco",
    category: "audio",
    pricePhp: 890,
    costRatio: 0.44,
    tags: ["accessory", "earpads"],
    specs: [
      ["Material", "Protein leather and memory foam"],
      ["Compatible", "Northbridge Meridian, Nimbus Cloudline"],
      ["Contents", "One pair"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "Velour Grey",
        attributes: [
          ["Color", "Grey"],
          ["Size", "Standard"],
        ],
        priceDeltaPhp: 160,
      },
    ],
  },

  // --------------------------------------------------------------- streaming
  {
    name: "Meridian Optic C4 Webcam",
    brand: "meridian",
    category: "streaming",
    pricePhp: 5990,
    costRatio: 0.62,
    tags: ["webcam", "1440p", "streaming"],
    specs: [
      ["Resolution", "1440p at 60 fps"],
      ["Sensor", "1/2.8 inch CMOS"],
      ["Field of view", "78 degrees"],
      ["Focus", "Autofocus"],
      ["Connectivity", "USB-C"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "Graphite",
        attributes: [
          ["Color", "Graphite"],
          ["Size", "Standard"],
        ],
      },
    ],
  },
  {
    name: "Meridian Optic C2 Webcam",
    brand: "meridian",
    category: "streaming",
    pricePhp: 2790,
    costRatio: 0.56,
    tags: ["webcam", "1080p", "office"],
    specs: [
      ["Resolution", "1080p at 30 fps"],
      ["Field of view", "70 degrees"],
      ["Focus", "Fixed"],
      ["Microphone", "Dual stereo"],
      ["Connectivity", "USB-A"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "Grey",
        attributes: [
          ["Color", "Grey"],
          ["Size", "Standard"],
        ],
      },
    ],
  },
  {
    name: "Velasco Cardioid USB Microphone",
    brand: "velasco",
    category: "streaming",
    pricePhp: 4490,
    costRatio: 0.59,
    tags: ["microphone", "usb", "streaming"],
    specs: [
      ["Pattern", "Cardioid"],
      ["Sample rate", "48 kHz, 24 bit"],
      ["Connectivity", "USB-C"],
      ["Monitoring", "3.5 mm zero latency"],
      ["Mount", "5/8 inch thread"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "Silver",
        attributes: [
          ["Color", "Silver"],
          ["Size", "Standard"],
        ],
      },
    ],
  },
  {
    name: "Pylon Capture 4K HDMI",
    brand: "pylon",
    category: "streaming",
    pricePhp: 7890,
    costRatio: 0.66,
    tags: ["capture", "4k", "streaming"],
    specs: [
      ["Input", "HDMI 2.0"],
      ["Passthrough", "4K at 60 fps"],
      ["Capture", "1080p at 60 fps"],
      ["Connectivity", "USB-C 3.2"],
      ["Latency", "Under 60 ms"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Standard"],
        ],
      },
      {
        suffix: "Silver",
        attributes: [
          ["Color", "Silver"],
          ["Size", "Standard"],
        ],
      },
    ],
  },
  {
    name: "Nimbus Key Light Panel",
    brand: "nimbus",
    category: "streaming",
    pricePhp: 4290,
    costRatio: 0.58,
    tags: ["lighting", "streaming"],
    specs: [
      ["Output", "2500 lumens"],
      ["Colour temperature", "2900 K to 7000 K"],
      ["Control", "App and desktop"],
      ["Mount", "Desk clamp"],
    ],
    variants: [
      {
        suffix: "Single",
        attributes: [
          ["Size", "One panel"],
          ["Color", "Black"],
        ],
      },
      {
        suffix: "Twin Kit",
        attributes: [
          ["Size", "Two panels"],
          ["Color", "Black"],
        ],
        priceDeltaPhp: 3600,
      },
    ],
  },
  {
    name: "Pylon Stream Deck 8",
    brand: "pylon",
    category: "streaming",
    pricePhp: 6490,
    costRatio: 0.63,
    tags: ["control-surface", "streaming"],
    specs: [
      ["Keys", "8 LCD keys"],
      ["Connectivity", "USB-C"],
      ["Software", "Windows and macOS"],
      ["Stand", "Adjustable"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "8-key"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "8-key"],
        ],
      },
    ],
  },

  // ------------------------------------------------------------ connectivity
  {
    name: "Sampaguita Coiled Aviator Cable",
    brand: "sampaguita",
    category: "connectivity",
    pricePhp: 1490,
    costRatio: 0.45,
    tags: ["cable", "coiled", "custom"],
    specs: [
      ["Connector", "USB-C to USB-A"],
      ["Length", "1.5 m coiled"],
      ["Sleeve", "Double sleeved paracord"],
      ["Detachable", "GX16 aviator"],
    ],
    variants: [
      {
        suffix: "Sampaguita White",
        attributes: [
          ["Color", "White and green"],
          ["Size", "1.5 m"],
        ],
      },
      {
        suffix: "Tinikling Red",
        attributes: [
          ["Color", "Red and ivory"],
          ["Size", "1.5 m"],
        ],
      },
      {
        suffix: "Lakan Ink",
        attributes: [
          ["Color", "Navy and black"],
          ["Size", "1.5 m"],
        ],
      },
    ],
  },
  {
    name: "Pylon Hub 7-Port USB-C",
    brand: "pylon",
    category: "connectivity",
    pricePhp: 3290,
    costRatio: 0.57,
    tags: ["hub", "usb-c", "desk"],
    specs: [
      ["Ports", "4 x USB-A, 2 x USB-C, 1 x SD"],
      ["Power delivery", "100 W passthrough"],
      ["Data rate", "10 Gbps"],
      ["Housing", "Aluminium"],
    ],
    variants: [
      {
        suffix: "Space Grey",
        attributes: [
          ["Color", "Space grey"],
          ["Size", "7-port"],
        ],
      },
      {
        suffix: "Silver",
        attributes: [
          ["Color", "Silver"],
          ["Size", "7-port"],
        ],
      },
    ],
  },
  {
    name: "Pylon Dock Pro Triple Display",
    brand: "pylon",
    category: "connectivity",
    pricePhp: 11500,
    costRatio: 0.68,
    tags: ["dock", "usb-c", "office"],
    specs: [
      ["Displays", "Three at 4K 60 Hz"],
      ["Ports", "2 x HDMI, 1 x DP, 5 x USB-A, 2 x USB-C, RJ45"],
      ["Power delivery", "100 W"],
      ["Ethernet", "2.5 Gbps"],
    ],
    variants: [
      {
        suffix: "Space Grey",
        attributes: [
          ["Color", "Space grey"],
          ["Size", "Dock"],
        ],
      },
      {
        suffix: "Silver",
        attributes: [
          ["Color", "Silver"],
          ["Size", "Dock"],
        ],
      },
    ],
  },
  {
    name: "Orbita Monitor Arm Single",
    brand: "orbita",
    category: "connectivity",
    pricePhp: 3890,
    costRatio: 0.55,
    tags: ["mount", "monitor-arm", "desk"],
    specs: [
      ["Load", "2 to 9 kg"],
      ["Screen size", "17 to 32 inch"],
      ["Mount", "Clamp and grommet"],
      ["VESA", "75 x 75, 100 x 100"],
      ["Routing", "Internal cable channel"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Single"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Single"],
        ],
      },
    ],
  },
  {
    name: "Orbita Monitor Arm Dual",
    brand: "orbita",
    category: "connectivity",
    pricePhp: 6290,
    costRatio: 0.6,
    tags: ["mount", "monitor-arm", "desk"],
    specs: [
      ["Load", "2 to 9 kg per arm"],
      ["Screen size", "17 to 32 inch"],
      ["Mount", "Clamp and grommet"],
      ["VESA", "75 x 75, 100 x 100"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "Dual"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "Dual"],
        ],
      },
    ],
  },
  {
    name: "Nimbus USB-C Cable 2 m",
    brand: "nimbus",
    category: "connectivity",
    pricePhp: 390,
    costRatio: 0.4,
    tags: ["cable", "budget"],
    specs: [
      ["Connector", "USB-C to USB-C"],
      ["Length", "2 m"],
      ["Rating", "60 W, 480 Mbps"],
      ["Sleeve", "Braided nylon"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "2 m"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "2 m"],
        ],
      },
    ],
  },
  {
    name: "Lakan Cable Management Tray",
    brand: "lakan",
    category: "connectivity",
    pricePhp: 1290,
    costRatio: 0.46,
    tags: ["accessory", "cable-management", "desk"],
    specs: [
      ["Length", "600 mm"],
      ["Mount", "Under-desk clamp, no drilling"],
      ["Material", "Powder-coated steel"],
      ["Load", "8 kg"],
    ],
    variants: [
      {
        suffix: "Black",
        attributes: [
          ["Color", "Black"],
          ["Size", "600 mm"],
        ],
      },
      {
        suffix: "White",
        attributes: [
          ["Color", "White"],
          ["Size", "600 mm"],
        ],
      },
    ],
  },
];
