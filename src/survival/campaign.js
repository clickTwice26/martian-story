/**
 * Part Two: Survive Jezero.
 *
 * The campaign script. Each mission is a short chain of objectives that are
 * checked in order; the engine (survival.js) runs the life-support numbers,
 * the world objects and the HUD. Every number the player is told comes from
 * the research report in reports/ - the source is named on the card - and
 * anything scaled for play says so.
 *
 * Objective: { text, at?, done(S), progress?(S) -> [value, max, unit], say? }
 * Station:   { id, at, r?, when(S), label(S), use(S) }   (E to use)
 */

const fmt = (v, d = 0) => Number(v).toFixed(d);

/* --------------------------------------------------------------- salvage -- */
/** Crate kinds. Masses are kept under the 80 kg suited lift limit. */
export const CRATES = {
  hab:      { code: 'HAB',  accent: '#e0672a', mass: 68, label: 'habitat pack', size: [0.7, 0.55, 0.7] },
  solar:    { code: 'PV',   accent: '#3a6fd8', mass: 52, label: 'solar array cassette' },
  food:     { code: 'FOOD', accent: '#3fae4a', mass: 55, label: 'ration crate (30 sols)' },
  isru:     { code: 'O2',   accent: '#e8e8e8', mass: 74, label: 'O₂ electrolysis stack', size: [0.7, 0.55, 0.66] },
  oven:     { code: 'OVEN', accent: '#c46a2a', mass: 47, label: 'regolith oven' },
  purifier: { code: 'H2O',  accent: '#4c9fe0', mass: 28, label: 'water purifier', size: [0.5, 0.5, 0.5] },
  seeds:    { code: 'SEED', accent: '#7ccf3a', mass: 24, label: 'hydroponics kit', size: [0.5, 0.45, 0.5] },
  sabatier: { code: 'CH4',  accent: '#5e86c2', mass: 66, label: 'Sabatier reactor' },
  hose:     { code: 'LINE', accent: '#e0a02a', mass: 31, label: 'cryogenic fuel line reel', size: [0.6, 0.5, 0.6] },
  cargo:    { code: 'NASA', accent: '#d8d8d8', mass: 72, label: 'resupply pod (200 sols)', size: [0.72, 0.55, 0.72] },
};

/* ------------------------------------------------------------- the story -- */
export const OPENING = [
  ['K-7', 'Good morning, Commander. Sol one after impact. You slept in the cockpit; I kept watch.'],
  ['K-7', 'Bad news first: the cabin oxygen ran out at 06:12. Your suit is on its reserve.'],
  ['K-7', 'Good news: the cargo bay is still sealed, and Earth knows we are alive. Let’s keep it that way.'],
];

export const MISSIONS = [
  /* ================================================================ 1 ===== */
  {
    id: 'air', act: 'I', title: 'FIRST BREATH',
    tagline: 'Your suit has under two hours of oxygen.',
    points: 150,
    brief: [
      ['K-7', 'There is an emergency O₂ bottle in the aft cargo bay. Follow the beacon. Walk, don’t run — running burns oxygen faster.'],
    ],
    objectives: [
      { text: 'Reach the Kestrel’s cargo bay', at: 'bay', done: S => S.near('bay', 3.5) },
      { text: 'Refill your suit from the emergency bottle  [E]', at: 'bay', done: S => S.flag.firstRefill },
    ],
    fact: {
      title: 'How much air does one person need?',
      body: 'NASA budgets an average of 0.84 kg of oxygen per crew member per day (range 0.49–1.25 kg, depending on work). A suit tank lasts a shift, not a day — so on Mars, oxygen has to be made, not just carried.',
      src: [['NASA NTRS 20120015343', 'https://ntrs.nasa.gov/api/citations/20120015343/downloads/20120015343.pdf']],
    },
  },

  /* ================================================================ 2 ===== */
  {
    id: 'salvage', act: 'I', title: 'SALVAGE',
    tagline: 'Everything you need to live is scattered down the impact furrow.',
    points: 250,
    brief: [
      ['K-7', 'I found flat, measured ground for a camp. Three crates were thrown down the furrow: habitat, solar array, rations.'],
      ['K-7', 'Pick them up with E and carry them to camp. Mars gravity is 0.38 g — a 68 kg crate weighs like 26 kg would on Earth.'],
    ],
    setup: S => { S.spawnCrate('hab'); S.spawnCrate('solar'); S.spawnCrate('food'); S.showZone('base'); },
    objectives: [
      { text: 'Go to the camp site K-7 marked', at: 'base', done: S => S.near('base', 6) },
      { text: 'Bring the habitat pack to camp', at: S => S.crateTarget('hab'), done: S => S.delivered('hab') },
      { text: 'Bring the solar array cassette to camp', at: S => S.crateTarget('solar'), done: S => S.delivered('solar') },
      { text: 'Bring the ration crate to camp', at: S => S.crateTarget('food'), done: S => S.delivered('food'),
        say: [['K-7', 'Last one: food. Thirty sols of rations, and twelve litres of water packed in with them.']] },
    ],
    onComplete: S => { S.res.food += 30; S.res.water += 12; },
    fact: {
      title: 'Why Jezero was a candidate for people',
      body: 'At NASA’s 2015 human landing-site workshop, Jezero was proposed as an Exploration Zone (centred 17.75°N, 77.04°E) for its delta sediments, carbonate-altered olivine, water-bearing clays and a 500 m stack of hydrated Mg-sulfate rock. Mars surface gravity is 3.72 m/s², 0.38 g.',
      src: [['Mustard et al., LPI abstract 1034', 'https://www.hou.usra.edu/meetings/explorationzone2015/pdf/1034.pdf'],
            ['NASA Mars Fact Sheet', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html']],
    },
  },

  /* ================================================================ 3 ===== */
  {
    id: 'shelter', act: 'I', title: 'SHELTER',
    tagline: 'Air pressure out here is 0.7% of Earth’s. You need walls — then dirt on top.',
    points: 300,
    brief: [
      ['K-7', 'Inflate the habitat first. Then we bury it: the radiation here is the real long-term killer.'],
      ['K-7', 'Your dosimeter already reads 390 mSv — 212 days of cruise at about 1.84 mSv per day. NASA’s career limit is 600.'],
    ],
    stations: [
      { id: 'inflate', at: 'base', r: 6, when: S => !S.built.hab && !S.job,
        label: () => 'Inflate the habitat', use: S => S.startJob('Inflating habitat', 10, 'base', () => S.build('hab')) },
    ],
    objectives: [
      { text: 'Inflate the habitat  [E at camp]', at: 'base', done: S => S.built.hab,
        say: [['K-7', 'Habitat holding pressure. It carries six kilograms of oxygen — about a week. Step inside the ring to breathe from it and refill your suit.']] },
      { text: S => `Pile rock on the berm — throw or carry rocks next to the hab`, at: 'base',
        progress: S => [S.c.shieldKg, S.SHIELD_KG, 'kg'], done: S => S.c.shieldKg >= S.SHIELD_KG,
        enter: S => { S.flag.shieldOpen = true; } },
    ],
    onComplete: S => { S.flag.shieldOpen = false; },
    fact: {
      title: 'Why a thin roof is worse than none',
      body: 'Curiosity’s RAD measured about 0.64–0.67 mSv per day on the surface and 1.84 mSv per day in cruise. Modelling checked against RAD shows dose peaks about 30 cm below the surface, because regolith makes secondary neutrons; it takes roughly 1–1.6 m of cover to bring the annual dose down to 100 mSv. NASA’s career limit is 600 mSv.',
      src: [['DLR / Reitz (MSL-RAD)', 'https://elib.dlr.de/106090/1/ME-SBA-2016-Reitz_MSL-RAD_ICES_2016.pdf'],
            ['Space.com on Zhang et al. 2022', 'https://www.space.com/mars-radiation-protection-astronauts-underground'],
            ['NASA OCHMO radiation brief', 'https://www.nasa.gov/wp-content/uploads/2023/03/radiation-protection-technical-brief-ochmo.pdf']],
    },
  },

  /* ================================================================ 4 ===== */
  {
    id: 'power', act: 'I', title: 'SUNLIGHT',
    tagline: 'Mars gets 43% of Earth’s sunlight. The sun in this sky is the real one.',
    points: 250,
    brief: [
      ['K-7', 'Deploy the solar array on the pad west of the hab. It tracks the sun — the actual sun position at Jezero, from NASA’s Mars24 algorithm.'],
    ],
    stations: [
      { id: 'deploySolar', at: 'solar', r: 6, when: S => !S.built.solar && !S.job,
        label: () => 'Unfold the solar array', use: S => S.startJob('Unfolding 40 m² of panels', 8, 'solar', () => S.build('solar')) },
    ],
    objectives: [
      { text: 'Deploy the solar array  [E at the pad]', at: 'solar', done: S => S.built.solar },
      { text: 'Charge the battery — rest in the hab if it is dark', at: 'door',
        progress: S => [S.res.battery, 24, 'kWh'], done: S => S.res.battery >= 24, wait: true,
        say: [['K-7', 'Watch the POWER line: output follows the sun’s elevation. At night it is zero. Rest in the hab [E at the airlock] to pass time.']] },
    ],
    fact: {
      title: 'Sunlight at Mars',
      body: 'Sunlight at Mars averages 586 W/m² at the top of the atmosphere, 43% of Earth’s 1,361. Dust storms can last weeks or months; the 2018 global storm ended the solar-powered Opportunity rover.',
      src: [['NASA Mars Fact Sheet', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html'],
            ['Spaceflight Now, 2018', 'https://spaceflightnow.com/2018/06/13/huge-dust-storm-knocks-aging-mars-rover-out-of-contact-with-earth/']],
    },
  },

  /* ================================================================ 5 ===== */
  {
    id: 'moxie', act: 'II', title: 'MAKE AIR',
    tagline: 'The habitat’s tank will not last. Make oxygen from the sky.',
    points: 350,
    brief: [
      ['K-7', 'The atmosphere is 95% carbon dioxide. Perseverance’s MOXIE split it into oxygen right here in Jezero, 122 grams over 16 runs.'],
      ['K-7', 'We carry a stack ten times its size. It is in the cargo bay. Bring it to the plant pad.'],
    ],
    setup: S => { S.spawnCrate('isru'); },
    stations: [
      { id: 'startO2', at: 'plant', r: 5, when: S => S.delivered('isru') && !S.built.o2plant && !S.job,
        label: () => 'Assemble the O₂ plant', use: S => S.startJob('Heating the stack to 800 °C', 10, 'plant', () => S.build('o2plant')) },
    ],
    objectives: [
      { text: 'Carry the O₂ electrolysis stack to the plant pad', at: S => S.crateTarget('isru', 'plant'), done: S => S.delivered('isru') },
      { text: 'Assemble the plant  [E]', at: 'plant', done: S => S.built.o2plant },
      { text: 'Make oxygen: fill the habitat tank to 7 kg', at: 'door',
        progress: S => [S.res.habO2, 7, 'kg'], done: S => S.res.habO2 >= 7, wait: true,
        say: [['K-7', 'It needs about 3 kW. It only runs when the battery can spare it — resting through the day helps.']] },
    ],
    fact: {
      title: 'MOXIE: oxygen made on Mars',
      body: 'MOXIE heated Jezero air to 800 °C and split CO₂ with a solid-oxide electrolyser: 122 g of O₂ over 16 runs, peaking at 12 g/hour at ≥98% purity, on 300 W. A crewed ascent needs ~31 t of oxygen at 2–3 kg/hour — about 200 MOXIEs. (The game’s stack is a 10× MOXIE: 120 g/h at 3 kW.)',
      src: [['NASA JPL', 'https://www.jpl.nasa.gov/news/nasas-oxygen-generating-experiment-moxie-completes-mars-mission/'],
            ['Hoffman, Hecht et al. 2022', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/']],
    },
  },

  /* ================================================================ 6 ===== */
  {
    id: 'water', act: 'II', title: 'NO ICE HERE',
    tagline: 'Jezero is at 18°N. There is no ice to dig. The water is locked inside rock.',
    points: 400,
    brief: [
      ['K-7', 'The nearest confirmed shallow ice is at 35°N, about a thousand kilometres north. Perseverance’s radar sees solid rock beneath us.'],
      ['K-7', 'But some rocks here hold water in their crystals — hydrated sulfates. I marked an outcrop. Bake them at 150 °C and the water comes out.'],
    ],
    setup: S => { S.spawnCrate('oven'); S.showZone('ore'); },
    stations: [
      { id: 'setupOven', at: 'oven', r: 5, when: S => S.delivered('oven') && !S.built.oven && !S.job,
        label: () => 'Set up the oven', use: S => S.startJob('Bolting the oven to the plant', 6, 'oven', () => S.build('oven')) },
    ],
    objectives: [
      { text: 'Carry the regolith oven to the plant', at: S => S.crateTarget('oven', 'oven'), done: S => S.delivered('oven') },
      { text: 'Set up the oven  [E]', at: 'oven', done: S => S.built.oven },
      { text: 'Bake 5 L of water: carry rocks from the sulfate outcrop into the oven', at: S => S.carryingRock() ? 'oven' : 'ore',
        progress: S => [S.res.waterRaw + S.c.waterPurified, 5, 'L'], done: S => S.res.waterRaw + S.c.waterPurified >= 5,
        enter: S => { S.flag.oreOpen = true; },
        say: [['K-7', 'Look at a rock before you lift it: I read its water content with the laser spectrometer. Grey basalt is dry — don’t waste the trip.']] },
    ],
    fact: {
      title: 'Where the water is — and is not',
      body: 'Confirmed shallow ice starts near 35°N; NASA’s SWIM maps put likely ice no closer than ~30°N. NASA’s Mars Water ISRU study ranks hydrated sulfate (~20 wt% water, 150 °C) as the best mineral ore: 1.6 kW versus 7.4 kW for ordinary soil at 1.5%. NASA Glenn’s lab oven recovered about half the water. (In the game, each rock’s grade is set between 4% and 20%, the study’s clay-to-gypsum range; 50% is recovered.)',
      src: [['Dundas et al. 2021', 'https://agupubs.onlinelibrary.wiley.com/doi/full/10.1029/2020JE006617'],
            ['Morgan et al. 2025 (SWIM)', 'https://iopscience.iop.org/article/10.3847/PSJ/ad9b24'],
            ['M-WIP report', 'https://sciences.ucf.edu/class/wp-content/uploads/sites/23/2020/04/Mars_Water_ISRU_Stud1.pdf'],
            ['Trunek et al., NTRS', 'https://ntrs.nasa.gov/api/citations/20180002377/downloads/20180002377.pdf']],
    },
  },

  /* ================================================================ 7 ===== */
  {
    id: 'clean', act: 'II', title: 'POISON IN THE WATER',
    tagline: 'Martian water comes out laced with perchlorate.',
    points: 300,
    brief: [
      ['K-7', 'Do not drink that. The regolith here carries about 2% chlorine as chlorides and perchlorates. Perchlorate blocks your thyroid.'],
      ['K-7', 'The purifier is in the bay. Distil, then polish. Set it next to the oven.'],
    ],
    setup: S => { S.spawnCrate('purifier'); },
    stations: [
      { id: 'setupPurifier', at: 'purifier', r: 5, when: S => S.delivered('purifier') && !S.built.purifier && !S.job,
        label: () => 'Install the purifier', use: S => S.startJob('Plumbing the distillation column', 6, 'purifier', () => S.build('purifier')) },
      { id: 'purify', at: 'purifier', r: 4, when: S => S.built.purifier && S.res.waterRaw > 0.05 && !S.job,
        label: S => `Purify ${fmt(S.res.waterRaw, 1)} L (${fmt(S.res.waterRaw * 0.25, 1)} kWh)`,
        use: S => S.purify() },
    ],
    objectives: [
      { text: 'Carry the purifier to the plant', at: S => S.crateTarget('purifier', 'purifier'), done: S => S.delivered('purifier') },
      { text: 'Install the purifier  [E]', at: 'purifier', done: S => S.built.purifier },
      { text: 'Purify your water  [E at the purifier]', at: 'purifier',
        progress: S => [S.c.waterPurified, 4, 'L'], done: S => S.c.waterPurified >= 4,
        say: [['K-7', 'Need more raw water? The oven still takes rock.']] },
    ],
    onComplete: S => { S.flag.recycler = true; },
    fact: {
      title: 'Perchlorate',
      body: 'Phoenix measured 0.4–0.6% perchlorate in soil; Perseverance’s PIXL found Jezero regolith at 2.0 ± 0.5 wt% chlorine. Perchlorate blocks iodide uptake by the thyroid. A molybdenum catalyst removed >99.99% in the lab. With the purifier online, the habitat now recycles 98% of its water, like the ISS.',
      src: [['Hecht et al. 2009', 'https://experts.arizona.edu/en/publications/detection-of-perchlorate-and-the-soluble-chemistry-of-martian-soi/'],
            ['Astrobiology.com (PIXL, Jezero)', 'https://astrobiology.com/2025/10/11/mineralogically-diverse-and-salt-rich-regolith-in-jezero-crater-characterized-using-x-ray-spectroscopy/'],
            ['NSF', 'https://www.nsf.gov/news/new-water-treatment-earth-could-also-help-mars'],
            ['NASA ECLSS fact sheet', 'https://www.nasa.gov/wp-content/uploads/2025/08/g-657270-59-hp-environmental-control-and-life-support-system-eclss.pdf']],
    },
  },

  /* ================================================================ 8 ===== */
  {
    id: 'food', act: 'II', title: 'GREEN',
    tagline: 'Thirty sols of rations. Mars soil cannot feed you yet — but water and light can.',
    points: 300,
    brief: [
      ['K-7', 'NASA plans 3,000 kcal a day per person: 1.83 kg of food. Rations will run out long before a rescue.'],
      ['K-7', 'There is a hydroponics kit in the bay. Not Martian soil — it is full of salts. Water, light, nutrients.'],
    ],
    setup: S => { S.spawnCrate('seeds'); },
    stations: [
      { id: 'plant', at: 'greenhouse', r: 6, when: S => S.delivered('seeds') && !S.built.greenhouse && !S.job && S.res.water >= 3,
        label: () => 'Build the greenhouse (uses 3 L water)', use: S => { S.res.water -= 3; S.startJob('Raising the dome, seeding racks', 10, 'greenhouse', () => S.build('greenhouse')); } },
    ],
    objectives: [
      { text: 'Carry the hydroponics kit to the greenhouse site', at: S => S.crateTarget('seeds', 'greenhouse'), done: S => S.delivered('seeds') },
      { text: 'Build the greenhouse  [E, needs 3 L water]', at: 'greenhouse', done: S => S.built.greenhouse },
      { text: 'Rest until the first harvest', at: 'door', progress: S => [S.c.growth, 1, 'grown'], done: S => S.c.harvest >= 1, wait: true },
    ],
    fact: {
      title: 'Farming on Mars',
      body: 'Veggie and the Advanced Plant Habitat have grown lettuce, kale and Hatch chile peppers on the ISS. Nine of ten crops grew in a NASA Mars soil simulant — but that simulant has no perchlorate and the plants had Earth air. NASA’s 2024 Deep Space Food Challenge aimed to supplement stored food, not replace it. (In the game the greenhouse covers 35% of your diet.)',
      src: [['NASA NTRS 20140010665', 'https://ntrs.nasa.gov/api/citations/20140010665/downloads/20140010665.pdf'],
            ['CNN via ABC17 (chile peppers)', 'https://abc17news.com/news/national-world/cnn-national/2021/07/18/astronauts-on-international-space-station-are-growing-chile-peppers-in-a-first-for-nasa/'],
            ['Sci.News on Wamelink et al.', 'https://www.sci.news/space/crops-simulated-martian-lunar-dirt-07697.html'],
            ['NASA Deep Space Food Challenge', 'https://www.nasa.gov/news-release/nasa-awards-1-25-million-to-three-teams-at-deep-space-food-finale']],
    },
  },

  /* ================================================================ 9 ===== */
  {
    id: 'storm', act: 'III', title: 'DUST STORM',
    tagline: 'A regional storm is rolling in from the west. The sun is about to go out.',
    points: 400,
    brief: [
      ['EARTH', 'Kestrel, Houston. Orbiters show a regional dust storm reaching Jezero within hours. Shelter and conserve. (Message sent 14 minutes ago.)'],
      ['K-7', 'Solar output will fall below a fifth. Get inside, then cut the greenhouse lights — they draw 1.2 kW.'],
    ],
    setup: S => { S.flag.storm = true; },
    stations: [
      { id: 'lightsOff', at: 'greenhouse', r: 6, when: S => S.built.greenhouse && S.flag.greenOn !== false,
        label: () => 'Switch greenhouse to storm mode (lights off)', use: S => { S.flag.greenOn = false; S.say([['K-7', 'Lights off. The plants will sulk, but they will live.']]); } },
    ],
    objectives: [
      { text: 'Switch the greenhouse to storm mode  [E]', at: 'greenhouse', done: S => S.flag.greenOn === false },
      { text: 'Get inside the habitat', at: 'door', done: S => S.inside },
      { text: 'Ride out the storm: rest for 2 sols', at: 'door', progress: S => [S.c.stormSols, 2, 'sols'], done: S => S.c.stormSols >= 2 },
    ],
    onComplete: S => {
      S.flag.storm = false; S.flag.greenOn = true;
      if (!S.flag.stormBrownout) S.award('storm-rider');
      S.say([['K-7', 'Sky is clearing. Solar alone will not carry us through the next one. There is another way — it is behind the wreck.']]);
    },
    fact: {
      title: 'Why NASA chose nuclear',
      body: 'In December 2024 NASA baselined fission as the primary surface power for crewed Mars missions: sunlight at Mars is less than half of Earth’s and dust storms last weeks to months. Perseverance’s weather station saw Jezero’s daily pressure swing double during a regional storm.',
      src: [['NASA Mars Surface Power Decision (ACR24)', 'https://www.nasa.gov/wp-content/uploads/2024/12/acr24-mars-surface-power-decision.pdf'],
            ['Rodríguez-Manfredi et al., Nature Geoscience', 'https://link.springer.com/article/10.1038/s41561-022-01084-0']],
    },
  },

  /* =============================================================== 10 ===== */
  {
    id: 'fission', act: 'III', title: 'FISSION',
    tagline: 'The Kestrel carried a 10 kWe reactor for its surface stay. It survived the crash.',
    points: 450,
    brief: [
      ['K-7', 'The reactor sled is behind the tail. Release the clamps and I will tow it out — 80 metres from camp. Distance is shielding.'],
    ],
    setup: S => S.setupReactor(),
    stations: [
      { id: 'releaseSled', at: 'sled', r: 4.5, when: S => S.reactorState === 'wreck',
        label: () => 'Release the tow clamps', use: S => S.towReactor() },
      { id: 'startReactor', at: 'reactor', r: 6, when: S => S.reactorState === 'site' && !S.job,
        label: () => 'Extend radiators, start the reactor', use: S => S.startJob('Withdrawing control drums', 10, 'reactor', () => S.build('reactor')) },
    ],
    objectives: [
      { text: 'Reach the reactor sled behind the wreck', at: 'sled', done: S => S.near('sled', 5) || S.reactorState !== 'wreck' },
      { text: 'Release the tow clamps  [E]', at: 'sled', done: S => S.reactorState !== 'wreck' },
      { text: 'Follow K-7 to the reactor site', at: 'reactor', done: S => S.reactorState === 'site' && S.near('reactor', 9) },
      { text: 'Start the reactor  [E]', at: 'reactor', done: S => S.built.reactor },
    ],
    fact: {
      title: 'Power for a Mars base',
      body: 'NASA’s decision paper says even a two-person, 30-day stay needs at least 10 kW, and propellant production needs hundreds of kW. In NASA’s Design Reference Architecture 5.0, a 30 kWe reactor weighed 7.8 t against 22.5 t and 4,300 m² for solar. Perseverance’s own power source gives about 110 W.',
      src: [['NASA ACR24 surface power', 'https://www.nasa.gov/wp-content/uploads/2024/12/acr24-mars-surface-power-decision.pdf'],
            ['NASA DRA 5.0 (SP-2009-566)', 'https://www.nasa.gov/wp-content/uploads/2015/09/373665main_nasa-sp-2009-566.pdf'],
            ['JPL Mars 2020 press kit', 'https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/mission/spacecraft/power/']],
    },
  },

  /* =============================================================== 11 ===== */
  {
    id: 'resupply', act: 'IV', title: 'CARGO FROM HOME',
    tagline: 'A NASA cargo lander came down 30 metres from camp.',
    points: 300,
    brief: [
      ['EARTH', 'Kestrel, Houston. Cargo lander touchdown confirmed. Two hundred sols of food. Go get it.'],
    ],
    setup: S => { S.spawnCrate('cargo'); },
    objectives: [
      { text: 'Bring the resupply pod to camp', at: S => S.crateTarget('cargo'), done: S => S.delivered('cargo') },
    ],
    onComplete: S => { S.res.food += 200; },
    fact: {
      title: 'Cargo goes first',
      body: 'NASA’s reference architecture sends cargo and the propellant plant ahead of the crew, and its 2024 analysis warns that the most ISRU-heavy options may need infrastructure running years before people arrive.',
      src: [['NASA DRA 5.0', 'https://www.nasa.gov/wp-content/uploads/2015/09/373665main_nasa-sp-2009-566.pdf'],
            ['NASA ACR 2024', 'https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf']],
    },
  },

  /* =============================================================== 12 ===== */
  {
    id: 'fuel', act: 'IV', title: 'THE WAY HOME',
    tagline: 'The cockpit pod is an ascent stage with empty tanks. Fill them from Mars.',
    points: 500,
    brief: [
      ['EARTH', 'Kestrel, Houston. The relay ship can meet you in orbit, but it cannot land. Make your own propellant. We’re with you.'],
      ['K-7', 'Methane and oxygen. Sabatier: CO₂ plus hydrogen gives methane and water. Split the water again for more hydrogen and oxygen.'],
      ['K-7', 'Net: every tonne of methane costs 2.25 tonnes of water and 2.75 of CO₂, and gives 4 tonnes of oxygen. My crawler will mine the sulfate ore.'],
    ],
    setup: S => { S.spawnCrate('sabatier'); S.spawnCrate('hose'); },
    stations: [
      { id: 'installSab', at: 'sabatier', r: 5, when: S => S.delivered('sabatier') && !S.built.sabatier && !S.job,
        label: () => 'Install the Sabatier reactor', use: S => S.startJob('Loading nickel catalyst beds', 10, 'sabatier', () => S.build('sabatier')) },
      { id: 'connect', at: 'capsule', r: 5, when: S => S.delivered('hose') && !S.built.fuelLine && !S.job,
        label: () => 'Connect the fuel line to the pod', use: S => S.startJob('Laying cryogenic line to the pod', 8, 'capsule', () => S.build('fuelLine')) },
    ],
    objectives: [
      { text: 'Carry the Sabatier reactor to the plant', at: S => S.crateTarget('sabatier', 'sabatier'), done: S => S.delivered('sabatier') },
      { text: 'Install it  [E]', at: 'sabatier', done: S => S.built.sabatier },
      { text: 'Carry the fuel line reel to the ascent pod', at: S => S.crateTarget('hose', 'capsule'), done: S => S.delivered('hose') },
      { text: 'Connect the line  [E at the pod]', at: 'capsule', done: S => S.built.fuelLine },
      { text: 'Run the plant: rest in the hab (50 sols per rest)', at: 'door',
        progress: S => [S.res.propellant * 100, 35, '%'], done: S => S.res.propellant >= 0.35,
        enter: S => { S.flag.campaign = true; } },
    ],
    fact: {
      title: 'Ascent propellant',
      body: 'NASA calls ascent propellant the single largest mass that would otherwise have to be landed on Mars. A six-crew methane/oxygen ascent vehicle needs about 31 t of oxygen and 9 t of methane. DRA 5.0’s plant ran for at least 300 days on a 30 kWe reactor. (The game’s pod is smaller; its plant also runs ~300 sols.)',
      src: [['NASA ACR 2024: ascent propellant', 'https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf'],
            ['Hoffman, Hecht et al. 2022', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9432831/'],
            ['NASA NTRS 20230017069 (kiloton ISRU)', 'https://ntrs.nasa.gov/api/citations/20230017069/downloads/SciTech%20Mars%20kiloton%20ISRU%20Final.pdf']],
    },
  },

  /* =============================================================== 13 ===== */
  {
    id: 'tanks', act: 'IV', title: 'FULL TANKS',
    tagline: 'Hundreds of sols of grinding, baking and splitting. Keep it running.',
    points: 500,
    brief: [
      ['K-7', 'Keep resting and the plant keeps working. I will flag anything that breaks.'],
    ],
    stations: [
      { id: 'cleanPV', at: 'solar', r: 7, when: S => S.flag.dusty,
        label: () => 'Brush the dust off the panels', use: S => S.startJob('Brushing 40 m² of panels', 6, 'solar', () => { S.flag.dusty = false; }) },
      { id: 'unjam', at: 'oven', r: 5, when: S => S.flag.jam,
        label: () => 'Clear the oven auger', use: S => S.startJob('Clearing a jammed auger', 6, 'oven', () => { S.flag.jam = false; }) },
    ],
    objectives: [
      { text: 'Run the plant to 65%', at: 'door', progress: S => [S.res.propellant * 100, 65, '%'], done: S => S.res.propellant >= 0.65 },
      { text: 'Brush dust off the solar array  [E]', at: 'solar', done: S => !S.flag.dusty,
        enter: S => { S.flag.dusty = true; S.say([['K-7', 'Panels are coated — output is down 60%. Dust settles on everything here.']]); } },
      { text: 'Clear the jammed oven auger  [E]', at: 'oven', done: S => !S.flag.jam,
        enter: S => { S.flag.jam = true; S.say([['K-7', 'The ore auger jammed on a sulfate clod. The plant is stopped until you clear it.']]); } },
      { text: 'Run the plant to 100%', at: 'door', progress: S => [S.res.propellant * 100, 100, '%'], done: S => S.res.propellant >= 1 },
    ],
    fact: {
      title: 'Where the water went',
      body: 'Making methane brings everything back to water: 9 t of methane would need about 20 t of water — more than NASA’s whole 16 t Mars water-plant reference case. Ice would be easier, if a site had it; Jezero does not.',
      src: [['M-WIP report', 'https://sciences.ucf.edu/class/wp-content/uploads/sites/23/2020/04/Mars_Water_ISRU_Stud1.pdf'],
            ['NASA ACR 2024', 'https://www.lpi.usra.edu/lunar/strategies/resources/M2M_ACR2024_MarsAscentPropellantConsiderations.pdf']],
    },
  },

  /* =============================================================== 14 ===== */
  {
    id: 'ascent', act: 'V', title: 'ASCENT',
    tagline: 'Tanks full. Orbit window open.',
    points: 600,
    brief: [
      ['EARTH', 'Kestrel, Houston. Relay ship in position. You are go for ascent. Welcome home, Commander.'],
      ['K-7', 'I am staying. Someone has to keep the plant warm for the next crew. Go.'],
    ],
    stations: [
      { id: 'launch', at: 'capsule', r: 5, when: S => !S.ending,
        label: () => 'Board the pod and launch', use: S => S.launch() },
    ],
    objectives: [
      { text: 'Board the ascent pod  [E]', at: 'capsule', done: S => S.flag.launched },
    ],
    fact: {
      title: 'Survivable, not easy',
      body: 'Oxygen from air is the one resource NASA has made on Mars. Everything else here — water from sulfate, methane, a reactor — is designed, tested on Earth, or planned. That is the honest state of Mars survival in 2026.',
      src: [['Research report: reports/Mars survival resources from NASA data.md', 'https://github.com/clickTwice26/martian-story/tree/main/reports']],
    },
  },
];

/* ---------------------------------------------------------------- awards -- */
export const BADGES = {
  'first-breath': ['First Breath', 'Refilled your suit before it ran dry.'],
  'pack-mule':    ['Pack Mule', 'Hauled every salvage crate to camp.'],
  'rock-hound':   ['Rock Hound', 'Moved 400 kg of Martian rock by hand.'],
  'water-witch':  ['Water Witch', 'Baked 10 L of water out of sulfate.'],
  'storm-rider':  ['Storm Rider', 'Never ran the battery flat in the storm.'],
  'no-blackout':  ['Steady Breath', 'Finished without a single blackout.'],
  'under-limit':  ['Under the Limit', 'Launched under NASA’s 600 mSv career limit.'],
  'homeward':     ['Homeward', 'Launched from Jezero on Martian propellant.'],
};

export const RANKS = [
  [0, 'CASTAWAY'], [900, 'SURVIVOR'], [2200, 'HOMESTEADER'], [3600, 'PIONEER'], [5200, 'ARES LEGEND'],
];
